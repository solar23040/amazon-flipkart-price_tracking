import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createRepository, type Repository } from '../db/repository.js';
import { BlockedError, NetworkError, type ScraperAdapter } from '../scrapers/types.js';
import { createTracker, type Tracker } from '../services/tracker.js';
import { createScheduler, type SchedulerOptions } from './scheduler.js';

type FetchPrice = ScraperAdapter['fetchPrice'];

describe('scheduler', () => {
  let repo: Repository;
  let productId: number;
  // Deterministic clock: injected sleeps advance it, so rate-limit math is exact.
  let clock: number;
  let sleeps: number[];

  const random = () => 0.5;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };

  const addListing = (site: string, url: string) =>
    repo.addListing({ productId, site, url }).id;

  const makeScheduler = (fetchPrice: FetchPrice, overrides: Partial<SchedulerOptions> = {}) => {
    const realTracker = createTracker(repo);
    const adapter: ScraperAdapter = {
      site: 'amazon',
      matches: () => true,
      extractExternalId: () => null,
      fetchPrice,
    };
    const tracker: Tracker = { scrapeListing: (id) => realTracker.scrapeListing(id, adapter) };
    const options: SchedulerOptions = {
      intervalMs: 60_000,
      jitterMs: 10_000,
      siteDelayMs: 1000,
      maxRetries: 2,
      retryBaseMs: 100,
      maxConsecutiveFailures: 10,
      ...overrides,
    };
    return createScheduler(repo, tracker, options, { sleep, random, now: () => clock, log: () => {} });
  };

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    productId = repo.createProduct('p').id;
    clock = 0;
    sleeps = [];
  });

  it('scrapes active listings, stores price points and reports the cycle', async () => {
    const amazon = addListing('amazon', 'https://www.amazon.in/dp/A1');
    const flipkart = addListing('flipkart', 'https://www.flipkart.com/x/p/itm1');
    const scheduler = makeScheduler(async () => ({ title: 'T', priceMinor: 89900, inStock: true, currency: 'INR' }));

    const report = await scheduler.runCycle();

    expect(report?.listings).toBe(2);
    expect(report?.succeeded).toBe(2);
    expect(report?.failed).toBe(0);
    expect(report?.paused).toEqual([]);
    expect(report?.results.map((r) => r.listingId).sort()).toEqual([amazon, flipkart].sort());
    expect(repo.listPricePoints(amazon)).toHaveLength(1);
    expect(repo.latestPricePoint(amazon)?.price_minor).toBe(89900);
    expect(repo.getListing(amazon)?.last_scraped_at).toBeTruthy();
    expect(scheduler.status().lastReport?.succeeded).toBe(2);
  });

  it('skips inactive listings', async () => {
    const paused = addListing('amazon', 'https://www.amazon.in/dp/A1');
    const active = addListing('amazon', 'https://www.amazon.in/dp/A2');
    repo.setListingActive(paused, false);
    let calls = 0;
    const scheduler = makeScheduler(async () => {
      calls += 1;
      return { title: 'T', priceMinor: 100, inStock: true, currency: 'INR' };
    });

    const report = await scheduler.runCycle();

    expect(calls).toBe(1);
    expect(report?.results.map((r) => r.listingId)).toEqual([active]);
  });

  it('waits siteDelayMs between requests to the same site', async () => {
    addListing('amazon', 'https://www.amazon.in/dp/A1');
    addListing('amazon', 'https://www.amazon.in/dp/A2');
    const scheduler = makeScheduler(async () => ({ title: 'T', priceMinor: 100, inStock: true, currency: 'INR' }));

    await scheduler.runCycle();

    expect(sleeps).toEqual([1000]);
  });

  it('does not wait between requests to different sites', async () => {
    addListing('amazon', 'https://www.amazon.in/dp/A1');
    addListing('flipkart', 'https://www.flipkart.com/x/p/itm1');
    const scheduler = makeScheduler(async () => ({ title: 'T', priceMinor: 100, inStock: true, currency: 'INR' }));

    await scheduler.runCycle();

    expect(sleeps).toEqual([]);
  });

  it('retries transient errors with exponential backoff and recovers', async () => {
    const listing = addListing('amazon', 'https://www.amazon.in/dp/A1');
    let attempts = 0;
    const scheduler = makeScheduler(async () => {
      attempts += 1;
      if (attempts === 1) throw new NetworkError('connection reset');
      return { title: 'T', priceMinor: 89900, inStock: true, currency: 'INR' };
    });

    const report = await scheduler.runCycle();

    // backoff 100 * 2^0 + jitter 50, then the per-site gate waits the rest of the 1000ms window.
    expect(sleeps).toEqual([150, 850]);
    expect(report?.succeeded).toBe(1);
    expect(report?.results[0]?.attempts).toBe(2);
    expect(repo.getListing(listing)?.fail_count).toBe(0);
    expect(repo.listPricePoints(listing)).toHaveLength(1);
  });

  it('gives up after maxRetries and counts one failure per attempt', async () => {
    const listing = addListing('amazon', 'https://www.amazon.in/dp/A1');
    const scheduler = makeScheduler(async () => {
      throw new NetworkError('offline');
    });

    const report = await scheduler.runCycle();

    expect(report?.failed).toBe(1);
    expect(report?.results[0]?.attempts).toBe(3);
    expect(repo.getListing(listing)?.fail_count).toBe(3);
    expect(repo.listPricePoints(listing)).toHaveLength(0);
  });

  it('does not retry blocked errors within a cycle', async () => {
    const listing = addListing('amazon', 'https://www.amazon.in/dp/A1');
    const scheduler = makeScheduler(async () => {
      throw new BlockedError('captcha');
    });

    const report = await scheduler.runCycle();

    expect(report?.results[0]?.attempts).toBe(1);
    expect(repo.getListing(listing)?.fail_count).toBe(1);
  });

  it('pauses a listing after maxConsecutiveFailures and stops scraping it', async () => {
    const listing = addListing('amazon', 'https://www.amazon.in/dp/A1');
    let calls = 0;
    const scheduler = makeScheduler(async () => {
      calls += 1;
      throw new BlockedError('captcha');
    }, { maxConsecutiveFailures: 2 });

    const first = await scheduler.runCycle();
    expect(first?.paused).toEqual([]);
    expect(repo.getListing(listing)?.is_active).toBe(true);

    const second = await scheduler.runCycle();
    expect(second?.paused).toEqual([listing]);
    expect(repo.getListing(listing)?.is_active).toBe(false);

    const third = await scheduler.runCycle();
    expect(third?.listings).toBe(0);
    expect(calls).toBe(2);
  });

  it('resuming a paused listing resets its failure budget', async () => {
    const listing = addListing('amazon', 'https://www.amazon.in/dp/A1');
    const scheduler = makeScheduler(async () => {
      throw new BlockedError('captcha');
    }, { maxConsecutiveFailures: 1 });

    await scheduler.runCycle();
    expect(repo.getListing(listing)?.is_active).toBe(false);
    expect(repo.getListing(listing)?.fail_count).toBe(1);

    const resumed = repo.setListingActive(listing, true);
    expect(resumed?.is_active).toBe(true);
    expect(resumed?.fail_count).toBe(0);
  });

  it('skips overlapping cycles instead of queueing them', async () => {
    addListing('amazon', 'https://www.amazon.in/dp/A1');
    let release: () => void = () => {};
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = makeScheduler(async () => {
      await hang;
      return { title: 'T', priceMinor: 100, inStock: true, currency: 'INR' };
    });

    const first = scheduler.runCycle();
    // Let the first cycle reach the hanging fetch before asking for a second one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await scheduler.runCycle()).toBeNull();

    release();
    expect((await first)?.succeeded).toBe(1);
  });

  it('schedules the next run with jitter and stops cleanly', () => {
    const scheduler = makeScheduler(async () => ({ title: 'T', priceMinor: 100, inStock: true, currency: 'INR' }));

    expect(scheduler.status().started).toBe(false);
    scheduler.start();
    scheduler.start(); // idempotent
    expect(scheduler.status().started).toBe(true);
    // interval 60s + 0.5 * 10s jitter, starting from clock 0.
    expect(scheduler.status().nextRunAt).toBe(new Date(65_000).toISOString());

    scheduler.stop();
    expect(scheduler.status().started).toBe(false);
    expect(scheduler.status().nextRunAt).toBeNull();
  });
});
