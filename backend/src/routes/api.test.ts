import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createRepository, type Repository } from '../db/repository.js';
import { createScheduler } from '../jobs/scheduler.js';
import type { Tracker } from '../services/tracker.js';

const stubTracker: Tracker = {
  scrapeListing: async () => ({ ok: true, title: 'Stub title', priceMinor: 12345, inStock: true }),
};

describe('api routes', () => {
  let app: ReturnType<typeof createApp>;
  let repo: Repository;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    app = createApp(repo, stubTracker);
  });

  it('responds to the health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('creates a product with a name only', async () => {
    const res = await request(app).post('/api/products').send({ name: 'My product' });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe('My product');
    expect(res.body.listing).toBeNull();
    expect(res.body.latestPrice).toBeNull();
  });

  it('creates a product from an amazon url and scrapes through the tracker', async () => {
    const res = await request(app).post('/api/products').send({ url: 'https://www.amazon.in/dp/B08TV2P1N8' });
    expect(res.status).toBe(201);
    expect(res.body.listing.site).toBe('amazon');
    expect(res.body.listing.external_id).toBe('B08TV2P1N8');
    expect(res.body.scrape.ok).toBe(true);
    // No name given, so the scraped title becomes the product name.
    expect(res.body.product.name).toBe('Stub title');
  });

  it('rejects unsupported urls and empty bodies', async () => {
    expect((await request(app).post('/api/products').send({ url: 'https://example.com/x' })).status).toBe(400);
    expect((await request(app).post('/api/products').send({})).status).toBe(400);
  });

  it('rejects duplicate urls with 409', async () => {
    const url = 'https://www.flipkart.com/x/p/itm123';
    expect((await request(app).post('/api/products').send({ url })).status).toBe(201);
    const second = await request(app).post('/api/products').send({ url });
    expect(second.status).toBe(409);
  });

  it('adds a second listing for comparison and serves price history', async () => {
    const created = await request(app).post('/api/products').send({ name: 'boAt Rockerz 255 Pro+' });
    const productId = created.body.product.id;

    const fc = await request(app)
      .post(`/api/products/${productId}/listings`)
      .send({ url: 'https://www.flipkart.com/x/p/itm123' });
    expect(fc.status).toBe(201);
    const listingId = fc.body.listing.id;

    repo.insertPricePoint(listingId, 89900, 'INR', true, '2026-10-16T00:00:00.000Z');
    repo.insertPricePoint(listingId, 84900, 'INR', true, '2026-10-17T00:00:00.000Z');

    const prices = await request(app).get(`/api/listings/${listingId}/prices?limit=10`);
    expect(prices.status).toBe(200);
    expect(prices.body.points.map((p: { price_minor: number }) => p.price_minor)).toEqual([89900, 84900]);

    const detail = await request(app).get(`/api/products/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe('boAt Rockerz 255 Pro+');
    expect(detail.body.listings).toHaveLength(1);
    expect(detail.body.listings[0].latestPrice.price_minor).toBe(84900);
  });

  it('runs a manual scrape through POST /api/listings/:id/scrape', async () => {
    const created = await request(app).post('/api/products').send({ url: 'https://www.amazon.in/dp/B08TV2P1N8' });
    const listingId = created.body.listing.id;
    const res = await request(app).post(`/api/listings/${listingId}/scrape`);
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.listing.id).toBe(listingId);
  });

  it('validates ids and rejects bad price queries', async () => {
    const created = await request(app).post('/api/products').send({ name: 'x' });
    const productId = created.body.product.id;

    expect((await request(app).get('/api/products/999')).status).toBe(404);
    expect((await request(app).get('/api/products/abc')).status).toBe(400);

    const listing = repo.addListing({
      productId,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/ZZZZZZZZZZ',
    });
    expect((await request(app).get(`/api/listings/${listing.id}/prices?limit=0`)).status).toBe(400);
    expect((await request(app).get(`/api/listings/${listing.id}/prices?from=not-a-date`)).status).toBe(400);
    expect((await request(app).get(`/api/listings/${listing.id}/prices?limit=10`)).status).toBe(200);
  });

  it('returns 400 for malformed json and 404 for unknown routes', async () => {
    const bad = await request(app).post('/api/products').set('content-type', 'application/json').send('{nope');
    expect(bad.status).toBe(400);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });

  it('validates search queries before hitting any site', async () => {
    expect((await request(app).get('/api/search')).status).toBe(400);
    expect((await request(app).get('/api/search?q=x')).status).toBe(400);
  });

  it('pauses and resumes a listing through PATCH', async () => {
    const created = await request(app).post('/api/products').send({ name: 'x' });
    const listing = repo.addListing({
      productId: created.body.product.id,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/PAUSE00001',
    });
    repo.markScrapedFailure(listing.id);

    const paused = await request(app).patch(`/api/listings/${listing.id}`).send({ isActive: false });
    expect(paused.status).toBe(200);
    expect(paused.body.listing.is_active).toBe(false);
    expect(paused.body.listing.fail_count).toBe(1);

    const resumed = await request(app).patch(`/api/listings/${listing.id}`).send({ isActive: true });
    expect(resumed.status).toBe(200);
    expect(resumed.body.listing.is_active).toBe(true);
    expect(resumed.body.listing.fail_count).toBe(0);

    expect((await request(app).patch(`/api/listings/${listing.id}`).send({ isActive: 'yes' })).status).toBe(400);
    expect((await request(app).patch(`/api/listings/${listing.id}`).send({})).status).toBe(400);
    expect((await request(app).patch('/api/listings/999').send({ isActive: false })).status).toBe(404);
    expect((await request(app).patch('/api/listings/abc').send({ isActive: false })).status).toBe(400);
  });
});

describe('alerts api', () => {
  let app: ReturnType<typeof createApp>;
  let repo: Repository;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    app = createApp(repo, stubTracker);
  });

  const addListing = (productId: number) =>
    repo.addListing({
      productId,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/ALERT00001',
    });

  it('creates, lists, updates and deletes alerts', async () => {
    const product = repo.createProduct('boAt Rockerz 255 Pro+');
    const listing = addListing(product.id);

    const created = await request(app)
      .post(`/api/listings/${listing.id}/alerts`)
      .send({ targetPriceMinor: 90000, channel: 'telegram' });
    expect(created.status).toBe(201);
    expect(created.body.alert.listing_id).toBe(listing.id);
    expect(created.body.alert.target_price_minor).toBe(90000);
    expect(created.body.alert.channel).toBe('telegram');
    expect(created.body.alert.last_triggered_at).toBeNull();

    const listed = await request(app).get(`/api/listings/${listing.id}/alerts`);
    expect(listed.status).toBe(200);
    expect(listed.body.listingId).toBe(listing.id);
    expect(listed.body.alerts).toHaveLength(1);

    const patched = await request(app)
      .patch(`/api/alerts/${created.body.alert.id}`)
      .send({ targetPriceMinor: 85000, channel: 'email' });
    expect(patched.status).toBe(200);
    expect(patched.body.alert.target_price_minor).toBe(85000);
    expect(patched.body.alert.channel).toBe('email');

    const removed = await request(app).delete(`/api/alerts/${created.body.alert.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });
    expect((await request(app).get(`/api/listings/${listing.id}/alerts`)).body.alerts).toEqual([]);
  });

  it('validates alert ids, listing ids and bodies', async () => {
    const product = repo.createProduct('p');
    const listing = addListing(product.id);

    expect((await request(app).get('/api/listings/abc/alerts')).status).toBe(400);
    expect((await request(app).get('/api/listings/999/alerts')).status).toBe(404);
    expect((await request(app).post('/api/listings/999/alerts').send({ targetPriceMinor: 1 })).status).toBe(404);

    expect((await request(app).post(`/api/listings/${listing.id}/alerts`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/listings/${listing.id}/alerts`).send({ targetPriceMinor: -5 })).status).toBe(400);
    expect(
      (await request(app).post(`/api/listings/${listing.id}/alerts`).send({ targetPriceMinor: 100, channel: 'sms' })).status,
    ).toBe(400);

    const alert = repo.addAlert({ listingId: listing.id, targetPriceMinor: 100, channel: 'telegram' });
    expect((await request(app).patch('/api/alerts/abc').send({ targetPriceMinor: 1 })).status).toBe(400);
    expect((await request(app).patch('/api/alerts/999').send({ targetPriceMinor: 1 })).status).toBe(404);
    expect((await request(app).patch(`/api/alerts/${alert.id}`).send({})).status).toBe(400);
    expect((await request(app).delete('/api/alerts/999')).status).toBe(404);

    // Default channel is telegram when the body omits it.
    const defaulted = await request(app).post(`/api/listings/${listing.id}/alerts`).send({ targetPriceMinor: 500 });
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.alert.channel).toBe('telegram');
  });
});

describe('scheduler routes', () => {
  let app: ReturnType<typeof createApp>;
  let repo: Repository;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    migrate(db);
    repo = createRepository(db);
    const scheduler = createScheduler(
      repo,
      stubTracker,
      { intervalMs: 60_000, jitterMs: 0, siteDelayMs: 0, maxRetries: 0, retryBaseMs: 100, maxConsecutiveFailures: 5 },
      { sleep: async () => {}, random: () => 0, now: () => 0, log: () => {} },
    );
    app = createApp(repo, stubTracker, scheduler);
  });

  it('runs a cycle on demand and reports status', async () => {
    const created = await request(app).post('/api/products').send({ name: 'x' });
    repo.addListing({
      productId: created.body.product.id,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/CYCLE00001',
    });

    const before = await request(app).get('/api/scheduler');
    expect(before.status).toBe(200);
    expect(before.body.started).toBe(false);
    expect(before.body.nextRunAt).toBeNull();
    expect(before.body.lastReport).toBeNull();

    const run = await request(app).post('/api/scheduler/run');
    expect(run.status).toBe(200);
    expect(run.body.report.listings).toBe(1);
    expect(run.body.report.succeeded).toBe(1);

    const after = await request(app).get('/api/scheduler');
    expect(after.body.lastReport.succeeded).toBe(1);
  });
});
