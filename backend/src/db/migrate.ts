import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

const SCHEMA_VERSION = '1';

// Works both in dev (src/db) and in dist (dist/db, where the build copies schema.sql).
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

/** Apply the schema. Every statement is idempotent, so this runs on every boot. */
export function migrate(db: Db): void {
  db.exec(readFileSync(schemaPath, 'utf8'));
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(
    'schema_version',
    SCHEMA_VERSION,
  );
}
