import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { SearchAllResult } from '../scrapers/index.js';
import { createSearchRouter } from './search.js';

const sample: SearchAllResult = {
  results: [
    {
      site: 'amazon',
      title: 'boAt Rockerz 255 Pro+',
      url: 'https://www.amazon.in/dp/B08TV2P1N8',
      priceMinor: 89900,
      inStock: null,
    },
  ],
  sites: [{ site: 'amazon', ok: true }],
};

function createTestApp(
  search: (query: string) => Promise<SearchAllResult>,
  ttlMs?: number,
  now?: () => number,
): express.Express {
  const app = express();
  app.use('/api/search', createSearchRouter(search, ttlMs, now));
  return app;
}

describe('GET /api/search', () => {
  it('returns results and caches repeat queries', async () => {
    let calls = 0;
    const app = createTestApp(async (query) => {
      calls++;
      expect(query).toBe('boat rockerz');
      return sample;
    });

    const first = await request(app).get('/api/search?q=boat%20rockerz');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ...sample, cached: false });

    // Same query (ignoring case/whitespace) is served from the cache.
    const second = await request(app).get('/api/search?q= BOAT ROCKERZ ');
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('expires cache entries after the ttl', async () => {
    let calls = 0;
    let clock = 1_000;
    const app = createTestApp(
      async () => {
        calls++;
        return sample;
      },
      5_000,
      () => clock,
    );

    expect((await request(app).get('/api/search?q=boat')).body.cached).toBe(false);
    clock += 4_999;
    expect((await request(app).get('/api/search?q=boat')).body.cached).toBe(true);
    clock += 2;
    expect((await request(app).get('/api/search?q=boat')).body.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it('rejects missing, too short and too long queries', async () => {
    const app = createTestApp(async () => sample);

    expect((await request(app).get('/api/search')).status).toBe(400);
    expect((await request(app).get('/api/search?q=a')).status).toBe(400);
    expect((await request(app).get('/api/search?q=' + 'x'.repeat(101))).status).toBe(400);
    // Repeated query params arrive as an array, which is not a valid query either.
    expect((await request(app).get('/api/search?q=boat&q=rockerz')).status).toBe(400);
  });

  it('returns 502 when the search itself fails', async () => {
    const app = createTestApp(async () => {
      throw new Error('everything broke');
    });
    const res = await request(app).get('/api/search?q=boat');
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});
