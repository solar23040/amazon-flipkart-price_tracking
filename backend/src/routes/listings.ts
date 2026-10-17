import { Router } from 'express';
import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import type { Tracker } from '../services/tracker.js';
import { createListingAlertsRouter } from './alerts.js';
import { issueList } from './issues.js';
import { createPricesRouter } from './prices.js';

const patchListingSchema = z.object({
  isActive: z.boolean(),
});

export function createListingsRouter(repo: Repository, tracker: Tracker): Router {
  const router = Router();

  router.post('/:id/scrape', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    if (!repo.getListing(id)) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }

    const result = await tracker.scrapeListing(id);
    res.json({
      result,
      listing: repo.getListing(id) ?? null,
      latestPrice: repo.latestPricePoint(id) ?? null,
    });
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    if (!repo.getListing(id)) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }

    const parsed = patchListingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body', details: issueList(parsed.error) });
      return;
    }

    // Re-activating clears fail_count, so a resumed listing gets a fresh failure budget.
    const listing = repo.setListingActive(id, parsed.data.isActive);
    res.json({ listing });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    const listing = repo.getListing(id);
    if (!listing) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }

    res.json({
      ...listing,
      latestPrice: repo.latestPricePoint(id) ?? null,
      recentPrices: repo.listPricePoints(id, { limit: 10 }),
    });
  });

  router.use('/:id/prices', createPricesRouter(repo));
  router.use('/:id/alerts', createListingAlertsRouter(repo));

  return router;
}
