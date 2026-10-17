import { Router, type Request } from 'express';
import type { Repository } from '../db/repository.js';

const MAX_LIMIT = 5000;

const readString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Mounted inside the listings router at '/:id/prices' (mergeParams gives access to :id).
 * GET /api/listings/:id/prices?from=&to=&limit=
 */
export function createPricesRouter(repo: Repository): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    if (!repo.getListing(id)) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }

    const limitParam = readString(req.query.limit);
    const limit = limitParam !== undefined ? Number(limitParam) : 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` });
      return;
    }

    const from = readString(req.query.from);
    const to = readString(req.query.to);
    for (const [name, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value !== undefined && Number.isNaN(Date.parse(value))) {
        res.status(400).json({ error: `${name} must be an ISO date string` });
        return;
      }
    }

    res.json({ listingId: id, points: repo.listPricePoints(id, { limit, from, to }) });
  });

  return router;
}
