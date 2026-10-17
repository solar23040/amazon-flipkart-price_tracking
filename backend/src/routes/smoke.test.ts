import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createRepository, type Repository } from '../db/repository.js';
import { createScheduler } from '../jobs/scheduler.js';
import type { Tracker } from '../services/tracker.js';

/**
 * End-to-end smoke tests: one pass over the main user flows with an in-memory DB
 * and a stub tracker, so nothing here touches the network.
 */
describe('smoke tests', () => {
  let app: ReturnType<typeof createApp>;
  let repo: Repository;

  // Same shape as the real tracker (stores a price point, updates bookkeeping) without adapters.
  const stubTracker = (): Tracker => ({
    scrapeListing: async (listingId: number) => {
      const scrapedAt = new Date().toISOString();
      repo.insertPricePoint(listingId, 459900, 'INR', true, scrapedAt);
      repo.markScrapedSuccess(listingId, scrapedAt);
      return { ok: true, title: 'boAt Rockerz 255 Pro+', priceMinor: 459900, inStock: true };
    },
  });

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);

    const scheduler = createScheduler(
      repo,
      stubTracker(),
      { intervalMs: 60_000, jitterMs: 0, siteDelayMs: 0, maxRetries: 0, retryBaseMs: 100, maxConsecutiveFailures: 5 },
      { sleep: async () => {}, random: () => 0, now: () => 0, log: () => {} },
    );
    app = createApp(repo, stubTracker(), scheduler);
  });

  it('creates a product by name', async () => {
    const res = await request(app).post('/api/products').send({ name: 'boAt Rockerz 255 Pro+' });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe('boAt Rockerz 255 Pro+');
    expect(res.body.listing).toBeNull();
    expect(res.body.latestPrice).toBeNull();
  });

  it('creates a product by url, scrapes it (stubbed) and stores the price', async () => {
    const res = await request(app).post('/api/products').send({ url: 'https://www.amazon.in/dp/B08TV2P1N8' });
    expect(res.status).toBe(201);
    expect(res.body.listing.site).toBe('amazon');
    expect(res.body.listing.external_id).toBe('B08TV2P1N8');
    expect(res.body.scrape).toMatchObject({ ok: true, priceMinor: 459900, inStock: true });
    expect(res.body.latestPrice.price_minor).toBe(459900);
    // No name was given, so it comes from the scrape.
    expect(res.body.product.name).toBe('boAt Rockerz 255 Pro+');
  });

  it('exposes the scheduler status', async () => {
    const res = await request(app).get('/api/scheduler');
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(false);
    expect(res.body.running).toBe(false);
    expect(res.body.intervalMs).toBe(60_000);
    expect(res.body.lastReport).toBeNull();
  });

  it('creates, lists and deletes an alert for a listing', async () => {
    const created = await request(app)
      .post('/api/products')
      .send({ url: 'https://www.flipkart.com/x/p/itm123' });
    expect(created.status).toBe(201);
    const listingId = created.body.listing.id;

    const alert = await request(app)
      .post(`/api/listings/${listingId}/alerts`)
      .send({ targetPriceMinor: 300000, channel: 'telegram' });
    expect(alert.status).toBe(201);
    expect(alert.body.alert.listing_id).toBe(listingId);
    expect(alert.body.alert.target_price_minor).toBe(300000);

    const listed = await request(app).get(`/api/listings/${listingId}/alerts`);
    expect(listed.status).toBe(200);
    expect(listed.body.listingId).toBe(listingId);
    expect(listed.body.alerts.map((a: { id: number }) => a.id)).toEqual([alert.body.alert.id]);

    const removed = await request(app).delete(`/api/alerts/${alert.body.alert.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });
    expect((await request(app).get(`/api/listings/${listingId}/alerts`)).body.alerts).toEqual([]);
  });

  it('rejects short search queries before touching any site', async () => {
    expect((await request(app).get('/api/search')).status).toBe(400);
    expect((await request(app).get('/api/search?q=x')).status).toBe(400);
  });
});
