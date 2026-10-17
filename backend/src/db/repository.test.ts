import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './index.js';
import { migrate } from './migrate.js';
import { createRepository, type Repository } from './repository.js';

describe('repository', () => {
  let repo: Repository;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
  });

  it('creates products and listings', () => {
    const product = repo.createProduct('boAt Rockerz 255 Pro+');
    expect(product.id).toBeGreaterThan(0);

    const listing = repo.addListing({
      productId: product.id,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/B08TV2P1N8',
      externalId: 'B08TV2P1N8',
    });
    expect(listing.site).toBe('amazon');
    expect(listing.is_active).toBe(true);
    expect(listing.fail_count).toBe(0);
    expect(listing.last_scraped_at).toBeNull();
    expect(repo.getListingByUrl('https://www.amazon.in/dp/B08TV2P1N8')?.id).toBe(listing.id);
    expect(repo.listListingsByProduct(product.id)).toHaveLength(1);
  });

  it('stores price points and returns them ascending with the latest price', () => {
    const product = repo.createProduct('p');
    const listing = repo.addListing({ productId: product.id, site: 'flipkart', url: 'https://www.flipkart.com/x/p/itm1' });

    repo.insertPricePoint(listing.id, 129900, 'INR', true, '2026-10-01T00:00:00.000Z');
    repo.insertPricePoint(listing.id, 119900, 'INR', false, '2026-10-02T00:00:00.000Z');

    const points = repo.listPricePoints(listing.id);
    expect(points.map((p) => p.price_minor)).toEqual([129900, 119900]);
    expect(points[1]?.in_stock).toBe(false);
    expect(repo.latestPricePoint(listing.id)?.price_minor).toBe(119900);
  });

  it('filters price points by date range and limit', () => {
    const product = repo.createProduct('p');
    const listing = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/AAAAAAAAAA' });
    repo.insertPricePoint(listing.id, 100, 'INR', true, '2026-10-01T00:00:00.000Z');
    repo.insertPricePoint(listing.id, 200, 'INR', true, '2026-10-05T00:00:00.000Z');
    repo.insertPricePoint(listing.id, 300, 'INR', true, '2026-10-10T00:00:00.000Z');

    const range = repo.listPricePoints(listing.id, { from: '2026-10-02T00:00:00.000Z', to: '2026-10-06T00:00:00.000Z' });
    expect(range.map((p) => p.price_minor)).toEqual([200]);
    const limited = repo.listPricePoints(listing.id, { limit: 2 });
    expect(limited.map((p) => p.price_minor)).toEqual([100, 200]);
  });

  it('tracks scrape success and failure counters', () => {
    const product = repo.createProduct('p');
    const listing = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/BBBBBBBBBB' });

    repo.markScrapedFailure(listing.id);
    repo.markScrapedFailure(listing.id);
    expect(repo.getListing(listing.id)?.fail_count).toBe(2);

    repo.markScrapedSuccess(listing.id, '2026-10-17T10:00:00.000Z');
    const updated = repo.getListing(listing.id);
    expect(updated?.fail_count).toBe(0);
    expect(updated?.last_scraped_at).toBe('2026-10-17T10:00:00.000Z');
  });

  it('lists active listings oldest-scrape-first and excludes paused ones', () => {
    const product = repo.createProduct('p');
    const never = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/NEVER00001' });
    const old = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/OLD0000001' });
    const recent = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/RECENT0001' });
    const paused = repo.addListing({ productId: product.id, site: 'flipkart', url: 'https://www.flipkart.com/x/p/itm9' });

    repo.markScrapedSuccess(recent.id, '2026-10-17T10:00:00.000Z');
    repo.markScrapedSuccess(old.id, '2026-10-16T10:00:00.000Z');
    repo.setListingActive(paused.id, false);

    // Never-scraped first, then the stalest scrape.
    expect(repo.listActiveListings().map((l) => l.id)).toEqual([never.id, old.id, recent.id]);
  });

  it('pauses and resumes listings, resetting fail_count on resume', () => {
    const product = repo.createProduct('p');
    const listing = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/BBBBBBBBBC' });
    repo.markScrapedFailure(listing.id);
    repo.markScrapedFailure(listing.id);

    const paused = repo.setListingActive(listing.id, false);
    expect(paused?.is_active).toBe(false);
    expect(paused?.fail_count).toBe(2);

    const resumed = repo.setListingActive(listing.id, true);
    expect(resumed?.is_active).toBe(true);
    expect(resumed?.fail_count).toBe(0);

    expect(repo.setListingActive(999, false)).toBeUndefined();
  });

  it('renames products', () => {
    const product = repo.createProduct('New product');
    repo.renameProduct(product.id, 'Real name from scrape');
    expect(repo.getProduct(product.id)?.name).toBe('Real name from scrape');
  });

  it('enforces unique listing urls', () => {
    const product = repo.createProduct('p');
    const url = 'https://www.amazon.in/dp/UNIQUE1234';
    repo.addListing({ productId: product.id, site: 'amazon', url });
    expect(() => repo.addListing({ productId: product.id, site: 'amazon', url })).toThrow(/UNIQUE/i);
  });

  it('creates, lists, updates, triggers and deletes alerts', () => {
    const product = repo.createProduct('p');
    const listing = repo.addListing({ productId: product.id, site: 'amazon', url: 'https://www.amazon.in/dp/ALERT00001' });

    const alert = repo.addAlert({ listingId: listing.id, targetPriceMinor: 99900, channel: 'telegram' });
    expect(alert.id).toBeGreaterThan(0);
    expect(alert.last_triggered_at).toBeNull();
    expect(alert.channel).toBe('telegram');
    expect(repo.getAlert(alert.id)?.target_price_minor).toBe(99900);
    expect(repo.listAlertsByListing(listing.id)).toHaveLength(1);
    // Alerts of other listings are not mixed in.
    expect(repo.listAlertsByListing(999)).toEqual([]);

    const updated = repo.updateAlert(alert.id, { targetPriceMinor: 89900 });
    expect(updated?.target_price_minor).toBe(89900);
    expect(updated?.channel).toBe('telegram');
    const rechanneled = repo.updateAlert(alert.id, { channel: 'email' });
    expect(rechanneled?.channel).toBe('email');
    expect(rechanneled?.target_price_minor).toBe(89900);
    expect(repo.updateAlert(999, { channel: 'email' })).toBeUndefined();

    repo.insertPricePoint(listing.id, 95000, 'INR', true, '2026-10-17T10:00:00.000Z');
    repo.insertPricePoint(listing.id, 90000, 'INR', true, '2026-10-17T12:00:00.000Z');
    expect(repo.pricePointAtOrBefore(listing.id, '2026-10-17T11:00:00.000Z')?.price_minor).toBe(95000);
    expect(repo.pricePointAtOrBefore(listing.id, '2026-10-17T12:00:00.000Z')?.price_minor).toBe(90000);
    expect(repo.pricePointAtOrBefore(listing.id, '2026-10-17T09:00:00.000Z')).toBeUndefined();

    repo.markAlertTriggered(alert.id, '2026-10-17T12:00:01.000Z');
    expect(repo.getAlert(alert.id)?.last_triggered_at).toBe('2026-10-17T12:00:01.000Z');
    expect(repo.pricePointAtOrBefore(listing.id, '2026-10-17T12:00:01.000Z')?.price_minor).toBe(90000);

    expect(repo.deleteAlert(alert.id)).toBe(true);
    expect(repo.deleteAlert(alert.id)).toBe(false);
    expect(repo.listAlertsByListing(listing.id)).toHaveLength(0);
  });
});
