import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createRepository, type Repository } from '../db/repository.js';
import type { ScraperAdapter } from '../scrapers/types.js';
import { createAlertService, formatInrMinor, shouldTriggerAlert, type AlertService } from './alerts.js';
import type { AlertChannel, AlertNotification, Notifier, SendResult } from './notifier.js';
import { createTracker } from './tracker.js';

describe('shouldTriggerAlert', () => {
  const alert = { target_price_minor: 100000, last_triggered_at: null };
  const triggered = { ...alert, last_triggered_at: '2026-10-17T12:00:00.000Z' };

  it('fires below target when never triggered', () => {
    expect(shouldTriggerAlert(alert, 99900, null)).toBe(true);
    expect(shouldTriggerAlert(alert, 100000, null)).toBe(false);
    expect(shouldTriggerAlert(alert, 100100, null)).toBe(false);
  });

  it('does not repeat at the same or a higher price after a trigger', () => {
    expect(shouldTriggerAlert(triggered, 98000, 98000)).toBe(false);
    expect(shouldTriggerAlert(triggered, 99000, 98000)).toBe(false);
    expect(shouldTriggerAlert(triggered, 100000, 98000)).toBe(false);
  });

  it('fires again when the price drops below the last triggered price', () => {
    expect(shouldTriggerAlert(triggered, 97999, 98000)).toBe(true);
    expect(shouldTriggerAlert({ ...alert, last_triggered_at: triggered.last_triggered_at }, 100, null)).toBe(true);
  });
});

describe('formatInrMinor', () => {
  it('formats paise as rupee amounts', () => {
    expect(formatInrMinor(89900)).toContain('899.00');
  });
});

interface StubNotifier {
  notifier: Notifier;
  calls: Array<{ channel: string; notification: AlertNotification }>;
}

function stubNotifier(behavior: (channel: string, call: number) => SendResult = () => ({ ok: true })): StubNotifier {
  const calls: Array<{ channel: string; notification: AlertNotification }> = [];
  return {
    calls,
    notifier: {
      async send(channel: string, notification: AlertNotification): Promise<SendResult> {
        calls.push({ channel, notification });
        return behavior(channel, calls.length);
      },
      configuredChannels: (): AlertChannel[] => ['telegram'],
    },
  };
}

describe('alert service', () => {
  let repo: Repository;
  let service: AlertService;
  let stub: StubNotifier;
  let listingId: number;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    stub = stubNotifier();
    service = createAlertService(repo, stub.notifier, { log: () => {}, now: () => new Date('2026-10-17T13:00:00.000Z') });
    const product = repo.createProduct('boAt Rockerz 255 Pro+');
    listingId = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/B08TV2P1N8' }).id;
  });

  /** What tracker.scrapeListing does before evaluating: store the fresh point. */
  const storePrice = (priceMinor: number, at: string): void => {
    repo.insertPricePoint(listingId, priceMinor, 'INR', true, at);
  };

  it('notifies once, records last_triggered_at, then stays quiet at the same price', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 99900, channel: 'telegram' });

    storePrice(95000, '2026-10-17T12:00:00.000Z');
    const first = await service.evaluateListing(listingId, 95000, true);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ notified: true, channel: 'telegram' });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.notification.subject).toContain('950.00');
    expect(stub.calls[0]?.notification.text).toContain('Target price:');
    expect(repo.listAlertsByListing(listingId)[0]?.last_triggered_at).toBe('2026-10-17T13:00:00.000Z');

    storePrice(95000, '2026-10-17T14:00:00.000Z');
    const second = await service.evaluateListing(listingId, 95000, true);
    expect(second).toEqual([]);
    expect(stub.calls).toHaveLength(1);
  });

  it('re-notifies only when the price drops below the last triggered price', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 99900, channel: 'telegram' });
    storePrice(95000, '2026-10-17T12:00:00.000Z');
    await service.evaluateListing(listingId, 95000, true);

    // Still below target but higher than the last trigger: quiet.
    storePrice(97000, '2026-10-17T14:00:00.000Z');
    expect(await service.evaluateListing(listingId, 97000, true)).toEqual([]);

    // Now strictly lower than the last triggered price: notify again.
    storePrice(94000, '2026-10-17T16:00:00.000Z');
    const third = await service.evaluateListing(listingId, 94000, true);
    expect(third).toHaveLength(1);
    expect(third[0]?.notified).toBe(true);
    expect(stub.calls).toHaveLength(2);
  });

  it('skips alerts whose target is not reached', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 80000, channel: 'telegram' });
    storePrice(95000, '2026-10-17T12:00:00.000Z');
    expect(await service.evaluateListing(listingId, 95000, true)).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('keeps the alert un-triggered when sending fails, and never throws', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 99900, channel: 'telegram' });
    stub = stubNotifier(() => ({ ok: false, error: 'telegram responded 401' }));
    const failing = createAlertService(repo, stub.notifier, { log: () => {}, now: () => new Date('2026-10-17T13:00:00.000Z') });

    storePrice(95000, '2026-10-17T12:00:00.000Z');
    const results = await failing.evaluateListing(listingId, 95000, true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ notified: false, error: 'telegram responded 401' });
    expect(repo.listAlertsByListing(listingId)[0]?.last_triggered_at).toBeNull();

    // A later successful send still fires (no trigger was consumed).
    const okService = createAlertService(repo, stubNotifier().notifier, { log: () => {}, now: () => new Date('2026-10-17T15:00:00.000Z') });
    const retry = await okService.evaluateListing(listingId, 95000, true);
    expect(retry[0]?.notified).toBe(true);
    expect(repo.listAlertsByListing(listingId)[0]?.last_triggered_at).toBe('2026-10-17T15:00:00.000Z');
  });

  it('fans out to every alert on the listing', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 99900, channel: 'telegram' });
    repo.addAlert({ listingId, targetPriceMinor: 99000, channel: 'email' });
    repo.addAlert({ listingId, targetPriceMinor: 90000, channel: 'desktop' });

    storePrice(95000, '2026-10-17T12:00:00.000Z');
    const results = await service.evaluateListing(listingId, 95000, true);
    expect(results.map((r) => r.channel)).toEqual(['telegram', 'email']);
    expect(stub.calls.map((c) => c.channel)).toEqual(['telegram', 'email']);
  });

  it('survives a notifier that throws', async () => {
    repo.addAlert({ listingId, targetPriceMinor: 99900, channel: 'telegram' });
    const throwing: Notifier = {
      send: async () => {
        throw new Error('boom');
      },
      configuredChannels: () => [],
    };
    const guarded = createAlertService(repo, throwing, { log: () => {} });
    storePrice(95000, '2026-10-17T12:00:00.000Z');
    const results = await guarded.evaluateListing(listingId, 95000, true);
    expect(results[0]).toMatchObject({ notified: false, error: 'boom' });
    expect(repo.listAlertsByListing(listingId)[0]?.last_triggered_at).toBeNull();
  });

  it('does nothing for listings without alerts or unknown listings', async () => {
    storePrice(100, '2026-10-17T12:00:00.000Z');
    expect(await service.evaluateListing(listingId, 100, true)).toEqual([]);
    expect(await service.evaluateListing(4242, 100, true)).toEqual([]);
  });
});

describe('alert service through the tracker', () => {
  it('reacts to scrapes: one alert, no repeat, then re-alert on a lower price', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const repo = createRepository(db);
    const product = repo.createProduct('boAt');
    const listing = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/B08TV2P1N8' });
    repo.addAlert({ listingId: listing.id, targetPriceMinor: 99900, channel: 'telegram' });

    const stub = stubNotifier();
    const service = createAlertService(repo, stub.notifier, { log: () => {} });
    const tracker = createTracker(repo, {
      onScraped: (listingId, priceMinor, inStock) => service.evaluateListing(listingId, priceMinor, inStock),
      log: () => {},
    });
    const fakeAdapter = (priceMinor: number): ScraperAdapter => ({
      site: 'amazon',
      matches: () => true,
      extractExternalId: () => null,
      fetchPrice: async () => ({ title: 'T', priceMinor, inStock: true, currency: 'INR' }),
    });

    expect((await tracker.scrapeListing(listing.id, fakeAdapter(95000))).ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(repo.listAlertsByListing(listing.id)[0]?.last_triggered_at).toBeTruthy();

    // Same price again: no new notification.
    await tracker.scrapeListing(listing.id, fakeAdapter(95000));
    expect(stub.calls).toHaveLength(1);

    // Deeper drop: re-alert.
    await tracker.scrapeListing(listing.id, fakeAdapter(92000));
    expect(stub.calls).toHaveLength(2);
  });
});
