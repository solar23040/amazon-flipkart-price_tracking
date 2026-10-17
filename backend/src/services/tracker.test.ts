import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createRepository, type Repository } from '../db/repository.js';
import { BlockedError, type ScraperAdapter } from '../scrapers/types.js';
import { createTracker, type Tracker } from './tracker.js';

const fakeAdapter = (fetchPrice: ScraperAdapter['fetchPrice']): ScraperAdapter => ({
  site: 'amazon',
  matches: () => true,
  extractExternalId: () => null,
  fetchPrice,
});

describe('tracker', () => {
  let repo: Repository;
  let tracker: Tracker;
  let listingId: number;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    tracker = createTracker(repo);
    const product = repo.createProduct('p');
    listingId = repo.addListing({
      productId: product.id,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/B08TV2P1N8',
    }).id;
  });

  it('stores a price point and resets failure state on success', async () => {
    repo.markScrapedFailure(listingId);

    const result = await tracker.scrapeListing(
      listingId,
      fakeAdapter(async () => ({ title: 'T', priceMinor: 89900, inStock: true, currency: 'INR' })),
    );

    expect(result).toMatchObject({ ok: true, priceMinor: 89900, inStock: true, title: 'T' });
    const points = repo.listPricePoints(listingId);
    expect(points).toHaveLength(1);
    expect(points[0]?.price_minor).toBe(89900);
    const listing = repo.getListing(listingId);
    expect(listing?.fail_count).toBe(0);
    expect(listing?.last_scraped_at).toBeTruthy();
  });

  it('increments fail_count and stores no price point when the scrape fails', async () => {
    const result = await tracker.scrapeListing(
      listingId,
      fakeAdapter(async () => {
        throw new BlockedError('bot-check page');
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('blocked');
    expect(repo.listPricePoints(listingId)).toHaveLength(0);
    expect(repo.getListing(listingId)?.fail_count).toBe(1);
  });

  it('reports listings with no registered adapter instead of throwing', async () => {
    const product = repo.createProduct('q');
    const other = repo.addListing({ productId: product.id, site: 'croma', url: 'https://www.croma.com/x' });
    const result = await tracker.scrapeListing(other.id);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('unsupported');
  });

  it('returns an error result for unknown listings', async () => {
    const result = await tracker.scrapeListing(999);
    expect(result.ok).toBe(false);
  });

  it('calls the post-scrape hook with the fresh price and survives a throwing hook', async () => {
    const calls: Array<{ listingId: number; priceMinor: number; inStock: boolean }> = [];
    const hooked = createTracker(repo, {
      onScraped: async (id, priceMinor, inStock) => {
        calls.push({ listingId: id, priceMinor, inStock });
      },
      log: () => {},
    });

    const first = await hooked.scrapeListing(
      listingId,
      fakeAdapter(async () => ({ title: 'T', priceMinor: 89900, inStock: true, currency: 'INR' })),
    );
    expect(first.ok).toBe(true);
    expect(calls).toEqual([{ listingId, priceMinor: 89900, inStock: true }]);

    const broken = createTracker(repo, {
      onScraped: async () => {
        throw new Error('notification exploded');
      },
      log: () => {},
    });
    const second = await broken.scrapeListing(
      listingId,
      fakeAdapter(async () => ({ title: 'T', priceMinor: 79900, inStock: false, currency: 'INR' })),
    );
    expect(second).toMatchObject({ ok: true, priceMinor: 79900, inStock: false });
    expect(repo.listPricePoints(listingId)).toHaveLength(2);
  });

  it('does not run the hook when the scrape fails', async () => {
    let hookRuns = 0;
    const hooked = createTracker(repo, {
      onScraped: async () => {
        hookRuns += 1;
      },
      log: () => {},
    });

    const result = await hooked.scrapeListing(
      listingId,
      fakeAdapter(async () => {
        throw new BlockedError('nope');
      }),
    );
    expect(result.ok).toBe(false);
    expect(hookRuns).toBe(0);
  });
});
