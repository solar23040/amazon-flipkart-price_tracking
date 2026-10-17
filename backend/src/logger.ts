import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import type { Config } from './config.js';

/** App-wide logger type, so services/routes can accept a logger without importing pino directly. */
export type Logger = pino.Logger;

const LOG_FILE_NAME = 'app.log';

/**
 * Structured JSON logs to stdout and to LOG_DIR/app.log.
 * sync: true keeps every line safe on process exit; volume here is tiny (a few lines per scrape cycle).
 */
export function createLogger(config: Config): Logger {
  mkdirSync(config.LOG_DIR, { recursive: true });
  const file = path.join(config.LOG_DIR, LOG_FILE_NAME);
  return pino(
    { level: config.LOG_LEVEL },
    pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination({ dest: file, sync: true }) },
    ]),
  );
}
