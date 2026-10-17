import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Repository } from './db/repository.js';
import type { Scheduler } from './jobs/scheduler.js';
import type { Logger } from './logger.js';
import { createAlertsRouter } from './routes/alerts.js';
import { createListingsRouter } from './routes/listings.js';
import { createProductsRouter } from './routes/products.js';
import { createSchedulerRouter } from './routes/scheduler.js';
import { createSearchRouter } from './routes/search.js';
import type { Tracker } from './services/tracker.js';

export interface CreateAppOptions {
  /** Structured logger for unhandled errors. Default: console.error. */
  logger?: Logger;
  /** Built frontend to serve for non-API GETs. Accepts the dir with index.html, or an Angular output root. */
  staticDir?: string;
}

function isJsonParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

/** Angular's application builder puts the browser bundle in a browser/ subdirectory; plain dirs hold index.html directly. */
function resolveStaticRoot(dir: string): string | null {
  if (existsSync(path.join(dir, 'index.html'))) return dir;
  const browserDir = path.join(dir, 'browser');
  if (existsSync(path.join(browserDir, 'index.html'))) return browserDir;
  return null;
}

export function createApp(
  repo: Repository,
  tracker: Tracker,
  scheduler?: Scheduler,
  options: CreateAppOptions = {},
): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/products', createProductsRouter(repo, tracker));
  app.use('/api/listings', createListingsRouter(repo, tracker));
  app.use('/api/alerts', createAlertsRouter(repo));
  app.use('/api/search', createSearchRouter());
  if (scheduler) {
    app.use('/api/scheduler', createSchedulerRouter(scheduler));
  }

  const staticRoot = options.staticDir ? resolveStaticRoot(options.staticDir) : null;
  if (staticRoot) {
    app.use(express.static(staticRoot));
    const indexHtml = path.join(staticRoot, 'index.html');
    // SPA fallback: client-side routes get index.html, /api requests fall through to the 404 below.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(indexHtml, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isJsonParseError(error)) {
      res.status(400).json({ error: 'invalid json body' });
      return;
    }
    if (options.logger) {
      options.logger.error({ err: error }, 'unhandled error');
    } else {
      console.error('unhandled error:', error);
    }
    if (res.headersSent) {
      _next(error);
      return;
    }
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
