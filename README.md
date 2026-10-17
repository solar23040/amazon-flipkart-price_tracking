# Price History Tracker

Track product prices on Amazon.in, Flipkart and (later) other retailers, compare them side by side, and get alerted on price drops.

- Full plan: [plan.md](plan.md)
- Status: **M5 (hardening) complete**

Everything (code, database, logs, backups) lives under `/mnt/media/projects/price_history`.

## Prereqs

- Node.js >= 22 (`node --version`)
- npm (comes with Node)
- `sqlite3` CLI, optional but recommended (consistent backups; the backup script falls back to file copies without it)
- The HDD mounted at `/mnt/media` when running anything

## Setup

```bash
# 1. Config: copy the example, then edit as needed (at minimum it works as-is)
cp .env.example .env

# 2. Dependencies (each project manages its own node_modules)
cd backend  && npm install
cd ../frontend && npm install

# 3. Confirm the HDD is mounted, writable, and that SQLite can write to it
./scripts/check-mount.sh
```

npm's cache is kept inside the project (`.npmrc` -> `.cache/npm`), so nothing lands on the root filesystem.

## Dev run

Two terminals:

```bash
# Terminal 1: backend API on http://localhost:3000 (tsx watch)
cd backend && npm run dev

# Terminal 2: Angular dev server on http://localhost:4200
cd frontend && npm run dev   # or: npm start
```

The dev server proxies `/api` to `http://localhost:3000`. Point it elsewhere with `API_PROXY_TARGET=http://localhost:4000 npm start`. The Angular port is `FRONTEND_PORT` (default 4200).

## Tests

```bash
cd backend  && npm test   # vitest: unit + API smoke tests (no network)
cd frontend && npm test   # Angular unit tests
```

Backend tests run against an in-memory SQLite DB and stubbed scrapers, so they never hit the live sites.

## Build

```bash
cd frontend && npm run build   # output: frontend/dist/frontend
cd ../backend && npm run build # output: backend/dist
```

## Production

Build both first, then start from `backend/`:

```bash
NODE_ENV=production npm start
```

- `start` first runs `scripts/check-mount.sh` (fails fast if the HDD is missing), then `node dist/index.js`.
- With `NODE_ENV=production` the backend serves the built Angular app from `frontend/dist/frontend` (assets live in its `browser/` subdirectory), including SPA fallback, on `PORT` (default `3000`).
- Override the frontend location with `FRONTEND_DIST` (absolute, or relative to the project root). Setting it alone, even in dev mode, enables static serving.
- Logs: structured JSON to stdout and `LOG_DIR/app.log`. `LOG_LEVEL` controls verbosity (default `info`).
- Keep it running with systemd or pm2; start the service via `npm start` so the mount check runs.

## Deploy (Fly.io)

The repo ships `Dockerfile`, `.dockerignore`, and `fly.toml`, so deploying needs no code changes. The container builds both apps; the backend serves the built frontend in production mode. SQLite and logs live on a Fly volume mounted at `/data`.

```bash
fly auth login          # one-time

# 1. Make the app name in fly.toml globally unique (e.g. my-prices-1234)
# 2. Create the app and its volume, then deploy:
fly launch --no-deploy
fly volumes create data --size 1 --region bom
fly deploy
```

- The machine is kept always-on (`auto_stop_machines = "off"`, `min_machines_running = 1`) so the in-process scheduler never sleeps. Don't scale beyond one machine: SQLite assumes a single writer.
- `shared-cpu-1x` + `256mb` fits Fly's free allowance. Bump `[[vm]] memory` to `"512mb"` (~$2/mo) if scrapes ever hit OOM.
- Set secrets in the Fly dashboard or CLI, e.g. `fly secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...` (any variable from the table below works).
- On-volume backups: `fly ssh console -C "sh /app/scripts/backup-db.sh /data/prices.db /data/backups"`.
- The app is served at `https://<app-name>.fly.dev` (HTTPS, so the PWA install prompt works).

## Backup

```bash
cd backend && npm run backup
```

- Writes `backups/prices-YYYYMMDD-HHMMSS.db`. Uses `VACUUM INTO` when the `sqlite3` CLI is available (consistent snapshot, WAL included); otherwise copies db+wal+shm with a warning.
- Keeps the newest 14 backups, deletes older ones. Override with `BACKUP_KEEP`.
- Custom paths: `bash scripts/backup-db.sh /path/to/prices.db /path/to/backups`, or set `DB_PATH` / `BACKUP_DIR`.

Run it from cron/systemd nightly for real protection.

## Env vars

Set in `.env` (see `.env.example` for all of them). Empty values mean "unset".

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port, bound on 0.0.0.0 |
| `DB_PATH` | `data/prices.db` | SQLite file (created at runtime) |
| `LOG_DIR` | `logs/` | Directory for `app.log` |
| `LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |
| `FRONTEND_DIST` | unset | Serve this built frontend (production default: `frontend/dist/frontend`) |
| `SCHEDULER_ENABLED` | `true` | Run the scrape scheduler in-process |
| `SCRAPE_INTERVAL_MINUTES` | `360` | Base interval between scrape cycles |
| `SCRAPE_JITTER_SECONDS` | `120` | Random extra delay per cycle |
| `SCRAPE_SITE_DELAY_SECONDS` | `20` | Minimum gap between requests to the same site |
| `SCRAPE_MAX_RETRIES` | `2` | Retries per listing on transient errors |
| `SCRAPE_RETRY_BASE_MS` | `2000` | Base delay for exponential backoff |
| `SCRAPE_MAX_CONSECUTIVE_FAILURES` | `5` | Pause a listing after this many failures |
| `SAVE_SNAPSHOTS` | `false` | Save raw HTML for scraper debugging |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Enable Telegram alerts |
| `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | unset | Enable email alerts |
| `ALERT_DESKTOP_ENABLED` | `false` | Enable desktop notifications (GUI sessions only) |
| `AMAZON_PAAPI_*`, `FLIPKART_AFFILIATE_*` | unset | Reserved for official APIs |

Never commit `.env`.
