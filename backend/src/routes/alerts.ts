import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import { ALERT_CHANNELS } from '../services/notifier.js';
import { issueList } from './issues.js';

const createAlertSchema = z.object({
  targetPriceMinor: z.coerce.number().int().positive(),
  channel: z.enum(ALERT_CHANNELS).default('telegram'),
});

const patchAlertSchema = z
  .object({
    targetPriceMinor: z.coerce.number().int().positive().optional(),
    channel: z.enum(ALERT_CHANNELS).optional(),
  })
  .refine((patch) => patch.targetPriceMinor !== undefined || patch.channel !== undefined, {
    message: 'provide at least one of targetPriceMinor or channel',
  });

const readId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** Mounted inside the listings router at '/:id/alerts' (mergeParams gives access to :id). */
export function createListingAlertsRouter(repo: Repository): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req: Request<{ id: string }>, res) => {
    const id = readId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    if (!repo.getListing(id)) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }
    res.json({ listingId: id, alerts: repo.listAlertsByListing(id) });
  });

  router.post('/', (req: Request<{ id: string }>, res) => {
    const id = readId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid listing id' });
      return;
    }
    if (!repo.getListing(id)) {
      res.status(404).json({ error: 'listing not found' });
      return;
    }

    const parsed = createAlertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body', details: issueList(parsed.error) });
      return;
    }

    const alert = repo.addAlert({
      listingId: id,
      targetPriceMinor: parsed.data.targetPriceMinor,
      channel: parsed.data.channel,
    });
    res.status(201).json({ alert });
  });

  return router;
}

/** Mounted at '/api/alerts' for edits/deletes that don't need the listing in the path. */
export function createAlertsRouter(repo: Repository): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    const id = readId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid alert id' });
      return;
    }
    if (!repo.getAlert(id)) {
      res.status(404).json({ error: 'alert not found' });
      return;
    }

    const parsed = patchAlertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body', details: issueList(parsed.error) });
      return;
    }

    const alert = repo.updateAlert(id, parsed.data);
    res.json({ alert });
  });

  router.delete('/:id', (req, res) => {
    const id = readId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid alert id' });
      return;
    }
    if (!repo.deleteAlert(id)) {
      res.status(404).json({ error: 'alert not found' });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
