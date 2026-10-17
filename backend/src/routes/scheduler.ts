import { Router } from 'express';
import type { Scheduler } from '../jobs/scheduler.js';

export function createSchedulerRouter(scheduler: Scheduler): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(scheduler.status());
  });

  // Manual trigger for ops: run a full scrape cycle right now (e.g. after adding a product).
  router.post('/run', async (_req, res) => {
    const report = await scheduler.runCycle();
    if (!report) {
      res.status(409).json({ error: 'a scrape cycle is already running' });
      return;
    }
    res.json({ report, status: scheduler.status() });
  });

  return router;
}
