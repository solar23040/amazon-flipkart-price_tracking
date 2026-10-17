import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// backend/src/config.ts (or backend/dist/config.js) -> repository root
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const envFile = path.join(projectRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().trim().min(1).default(path.join(projectRoot, 'data', 'prices.db')),
  LOG_DIR: z.string().trim().min(1).default(path.join(projectRoot, 'logs')),
  // Empty string means "unset" so the default applies instead of failing validation.
  LOG_LEVEL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  // Path to a built Angular app; when set the backend serves it (see index.ts).
  FRONTEND_DIST: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  SCRAPE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(360),
  SCRAPE_JITTER_SECONDS: z.coerce.number().int().min(0).default(120),
  SCHEDULER_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
  SCRAPE_SITE_DELAY_SECONDS: z.coerce.number().int().min(0).default(20),
  SCRAPE_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  SCRAPE_RETRY_BASE_MS: z.coerce.number().int().min(100).default(2000),
  SCRAPE_MAX_CONSECUTIVE_FAILURES: z.coerce.number().int().min(1).default(5),
  SAVE_SNAPSHOTS: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SMTP_HOST: z.string().trim().optional(),
  // Empty string means "unset", so it doesn't coerce to 0 and trip the positive() check.
  SMTP_PORT: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().positive().default(587)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().trim().optional(),
  ALERT_EMAIL_TO: z.string().trim().optional(),
  ALERT_DESKTOP_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
