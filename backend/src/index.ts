import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createRepository } from './db/repository.js';
import { createScheduler } from './jobs/scheduler.js';
import { createLogger } from './logger.js';
import { createAlertService } from './services/alerts.js';
import { createNotifier } from './services/notifier.js';
import { createTracker } from './services/tracker.js';

// backend/src/index.ts (or backend/dist/index.js) -> repository root
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const config = loadConfig();
const logger = createLogger(config);

/**
 * Create the database's own directory, but never its missing parents:
 * that silently litters the root filesystem when the HDD is not mounted.
 */
function ensureDatabaseDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (!existsSync(parent)) {
      throw new Error(
        `database directory ${dir} does not exist and its parent ${parent} is missing ` +
          '(is the HDD mounted at /mnt/media?)',
      );
    }
    mkdirSync(dir, { recursive: true });
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`database directory ${dir} is not writable (check permissions and the HDD mount)`);
  }
}

/** Production (or an explicit FRONTEND_DIST) serves the built Angular app; dev mode leaves this undefined. */
function resolveFrontendDist(): string | undefined {
  if (config.FRONTEND_DIST) return path.resolve(projectRoot, config.FRONTEND_DIST);
  if (process.env.NODE_ENV === 'production') {
    return path.join(projectRoot, 'frontend', 'dist', 'frontend');
  }
  return undefined;
}

ensureDatabaseDir(config.DB_PATH);
const db = openDatabase(config.DB_PATH);
migrate(db);

const repo = createRepository(db);
const notifier = createNotifier(config);
const alertService = createAlertService(repo, notifier, { log: (message) => logger.info(message) });
const tracker = createTracker(repo, {
  log: (message) => logger.error(message),
  // Every successful scrape (manual or scheduled) checks this listing's alerts.
  onScraped: async (listingId, priceMinor, inStock) => {
    await alertService.evaluateListing(listingId, priceMinor, inStock);
  },
});
const scheduler = createScheduler(
  repo,
  tracker,
  {
    intervalMs: config.SCRAPE_INTERVAL_MINUTES * 60_000,
    jitterMs: config.SCRAPE_JITTER_SECONDS * 1000,
    siteDelayMs: config.SCRAPE_SITE_DELAY_SECONDS * 1000,
    maxRetries: config.SCRAPE_MAX_RETRIES,
    retryBaseMs: config.SCRAPE_RETRY_BASE_MS,
    maxConsecutiveFailures: config.SCRAPE_MAX_CONSECUTIVE_FAILURES,
  },
  { log: (message) => logger.info(message) },
);
const app = createApp(repo, tracker, scheduler, { logger, staticDir: resolveFrontendDist() });

const server = app.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`price-history backend listening on http://0.0.0.0:${config.PORT} (db: ${config.DB_PATH})`);
  const channels = notifier.configuredChannels();
  logger.info(
    `[alerts] configured channels: ${channels.length > 0 ? channels.join(', ') : 'none (fill in .env to enable)'}`,
  );
});

if (config.SCHEDULER_ENABLED) {
  scheduler.start();
} else {
  logger.info('[scheduler] disabled (SCHEDULER_ENABLED=false)');
}

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, shutting down`);
  scheduler.stop();
  logger.flush();
  server.close(() => process.exit(0));
  // Don't let a stuck keep-alive connection block shutdown forever.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
