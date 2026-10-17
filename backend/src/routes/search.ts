import { Router } from 'express';
import { z } from 'zod';
import { searchAll, type SearchAllResult } from '../scrapers/index.js';
import { issueList } from './issues.js';

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'q must be at least 2 characters').max(100, 'q must be at most 100 characters'),
});

const CACHE_TTL_MS = 5 * 60_000;
// Repeat searches hit the cache, which also limits how often the sites see us.
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  value: SearchAllResult;
  expiresAt: number;
}

/**
 * GET /api/search?q=... - searches every site at once.
 * Results (including per-site failures) are cached in memory for 5 minutes.
 */
export function createSearchRouter(
  search: (query: string) => Promise<SearchAllResult> = searchAll,
  ttlMs: number = CACHE_TTL_MS,
  now: () => number = Date.now,
): Router {
  const router = Router();
  const cache = new Map<string, CacheEntry>();

  router.get('/', async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid search query', details: issueList(parsed.error) });
      return;
    }
    const query = parsed.data.q;
    const cacheKey = query.toLowerCase();

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      res.json({ ...cached.value, cached: true });
      return;
    }
    cache.delete(cacheKey);

    try {
      const value = await search(query);
      cache.set(cacheKey, { value, expiresAt: now() + ttlMs });
      if (cache.size > CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      res.json({ ...value, cached: false });
    } catch (error) {
      // searchAll already isolates per-site failures, so this only runs if everything broke.
      console.error('search failed:', error);
      res.status(502).json({ error: 'search failed, try again later' });
    }
  });

  return router;
}
