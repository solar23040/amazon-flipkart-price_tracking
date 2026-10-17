# Price History Tracker: Plan

**Location:** /mnt/media/projects/price_history
**Goal:** Track product prices over time on Amazon.in, Flipkart, and other retailers, compare them side by side, and alert on drops.
**Stack:** Angular frontend, Node.js + Express (TypeScript) backend, SQLite storage

---

## 1. Scope

### MVP
- Add a product by URL (Amazon.in and Flipkart first; more sites via adapters later)
- Scrape price, availability, and title on a schedule
- Store price history locally on the HDD
- Dashboard with product list, per-product price-history chart, and cross-site comparison
- Price-drop alerts (email and/or desktop notification)
- Everything (code, database, logs, backups) lives under /mnt/media/projects/price_history

### Later
- Target-price alerts with more channels (Telegram, WhatsApp, Discord)
- Additional retailers (Croma, Reliance Digital, Vijay Sales, Myntra, etc.)
- Export to CSV or JSON
- Multi-user support with login
- Mobile-friendly PWA view

### Out of Scope (for now)
- Automated purchasing
- Price prediction or machine learning
- Cloud hosting

---

## 2. Compliance and Data Access (decide before coding)

- **Amazon and Flipkart terms of service restrict automated access and scraping.** Read each site's current terms and decide on your approach before building scrapers.
- **Preferred route: official APIs where available.**
  - Amazon: Product Advertising API 5.0 (requires an Amazon Associates account with qualifying sales)
  - Flipkart: Affiliate API (requires a Flipkart Affiliate account)
- **Fallback: scraping at low frequency** (e.g. every 6 hours), with a realistic User-Agent, rate limiting, random jitter, caching, and personal-use only. Expect breakage when page layouts change.
- Keep every retailer behind a per-site adapter so an API-based adapter can replace a scraper later without touching the rest of the app.
- Do not store personal data from the sites. Store only product title, price, stock status, and the URL.

---

## 3. Why Angular over Astro

- The main UI is interactive: live search, filters, forms for adding products, charts, and a compare view. Angular handles this state-heavy UI well.
- Astro is strongest for content-heavy, mostly static sites. Its interactivity model (islands) works, but a dashboard with many stateful components is more awkward in it.
- Angular has built-in routing, forms, HTTP client, and dependency injection, so there are fewer third-party choices to make.

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Angular (latest stable) + Angular Material | Interactive dashboard, routing, forms |
| Charts | ngx-echarts (or ng2-charts with Chart.js) | Price-history line charts |
| Backend API | Node.js + Express (TypeScript) | Same language as scrapers and frontend |
| Database | SQLite via better-sqlite3, WAL mode | Single file on the HDD, no server to run |
| Scraping | Playwright (headless Chromium) for JS-heavy pages; Cheerio for plain HTML | Handles dynamic pages |
| Scheduler | node-cron inside the backend | Simple; can move to system cron later |
| Validation | Zod | Validate API input and scraper output |
| Alerts | Nodemailer (email) and node-notifier (desktop) | Built-in, no external services required |
| Logging | pino, writing to logs/ | Structured logs, low overhead |
| Testing | Vitest (backend), Jest or Vitest (Angular), Playwright (e2e) | Standard tooling |
| Package manager | pnpm | Fast and disk-efficient |

---

## 5. Folder Structure (everything under the HDD path)

```
/mnt/media/projects/price_history/
├── plan.md
├── README.md
├── .env.example
├── .gitignore
├── data/
│   ├── prices.db               # SQLite database (created at runtime)
│   ├── prices.db-wal           # WAL file (runtime)
│   └── snapshots/              # Optional raw HTML saved for debugging scrapers
├── backups/                    # Output of backup-db.sh
├── logs/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── fixtures/               # Saved HTML pages for scraper unit tests
│   │   ├── amazon/
│   │   └── flipkart/
│   └── src/
│       ├── index.ts            # Express server + scheduler startup
│       ├── config.ts           # Loads and validates .env
│       ├── db/
│       │   ├── schema.sql
│       │   ├── migrate.ts
│       │   └── repository.ts
│       ├── scrapers/
│       │   ├── types.ts        # ScraperAdapter interface
│       │   ├── amazon.ts
│       │   ├── flipkart.ts
│       │   └── index.ts        # Adapter registry
│       ├── services/
│       │   ├── tracker.ts      # Runs scrapes, writes price points
│       │   ├── alerts.ts       # Decides when to notify
│       │   ├── notifier.ts     # Sends email / desktop notifications
│       │   └── normalize.ts    # "₹1,299" -> 129900 paise
│       ├── routes/
│       │   ├── products.ts
│       │   ├── listings.ts
│       │   ├── prices.ts
│       │   └── alerts.ts
│       └── jobs/
│           └── scheduler.ts
├── frontend/
│   ├── package.json
│   ├── angular.json
│   └── src/app/
│       ├── core/               # API client, shared models, interceptors
│       ├── features/
│       │   ├── dashboard/      # Product list with latest prices
│       │   ├── add-product/    # Paste URL, auto-detect site
│       │   ├── product-detail/ # Price chart, per-site history
│       │   ├── compare/        # Side-by-side Amazon vs Flipkart
│       │   └── alerts/         # Manage target prices
│       └── shared/             # Reusable UI components and pipes
└── scripts/
    ├── backup-db.sh
    ├── check-mount.sh          # Fails fast if the HDD is not mounted
    └── seed-demo.ts
```

---

## 6. Data Model

```sql
CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  canonical_key TEXT,                  -- Optional: groups the same item across sites
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE listings (                -- One product on one site
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  site          TEXT NOT NULL,         -- 'amazon' | 'flipkart' | ...
  url           TEXT NOT NULL UNIQUE,
  external_id   TEXT,                  -- ASIN, Flipkart PID, etc.
  variant_note  TEXT,                  -- e.g. "128GB, Black"
  is_active     BOOLEAN NOT NULL DEFAULT 1,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  last_scraped_at DATETIME
);

CREATE TABLE price_points (
  id            INTEGER PRIMARY KEY,
  listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price_minor   INTEGER NOT NULL,      -- Paise, stored as integer to avoid float errors
  currency      TEXT NOT NULL DEFAULT 'INR',
  in_stock      BOOLEAN NOT NULL,
  scraped_at    DATETIME NOT NULL
);

CREATE INDEX idx_price_points_listing_time ON price_points(listing_id, scraped_at);

CREATE TABLE alerts (
  id                  INTEGER PRIMARY KEY,
  listing_id          INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  target_price_minor  INTEGER NOT NULL,
  channel             TEXT NOT NULL,   -- 'email' | 'desktop'
  last_triggered_at   DATETIME
);
```

Notes:
- A `product` can have many `listings` (one per site). This is what makes cross-site comparison work.
- `fail_count` lets the scheduler pause listings that keep failing.
- Storing only changes in price (instead of every scrape) is an option to keep the database small. Start with every scrape, since storage is cheap.

---

## 7. Scraper Adapter Interface

```ts
export interface ScrapedProduct {
  title: string;
  priceMinor: number;   // Paise
  inStock: boolean;
  currency: 'INR';
}

export interface ScraperAdapter {
  site: 'amazon' | 'flipkart';
  matches(url: string): boolean;
  extractExternalId(url: string): string | null;
  fetchPrice(url: string): Promise<ScrapedProduct>;
}
```

Rules for adapters:
- Each site gets its own adapter.
- Adapters return normalized data and never write to the database directly.
- Adapters throw typed errors (`BlockedError`, `ParseError`, `NotFoundError`) so the tracker can react differently to each.
- Every adapter has unit tests that run against saved HTML fixtures, so tests do not hit the live site.

---

## 8. Milestones

**M0: Setup (1 day)**
- Create the folder structure on the HDD
- Confirm the HDD is mounted and writable, and that SQLite can create its file there
- Initialize git, backend, and frontend projects
- Add check-mount.sh

**M1: Backend core (3 to 4 days)**
- Schema, migrations, and repository
- Amazon and Flipkart adapters with unit tests against saved fixtures
- Endpoints: create product, add listing, manual scrape (`POST /api/listings/:id/scrape`), list prices

**M2: Scheduler and history (2 days)**
- node-cron job that scrapes active listings on an interval
- Random jitter and per-site rate limits
- Retries with exponential backoff
- Mark listings as paused after N consecutive failures

**M3: Frontend dashboard (4 to 5 days)**
- Add product (paste URL, auto-detect site)
- Dashboard with latest price per listing
- Product detail page with price-history chart
- Compare view: Amazon vs Flipkart for the same product

**M4: Alerts (2 days)**
- Set a target price per listing
- Email and desktop notifications when the price drops below target
- No repeat alerts for the same price until it changes again

**M5: Hardening (2 days)**
- Backup script for the SQLite file (`backups/`)
- Structured logs in `logs/`
- README with setup and run instructions
- Smoke tests for the main flows

**Total estimate:** about 3 to 4 weeks part-time.

---

## 9. Running It

- Backend: `pnpm --dir backend dev` (port 3000)
- Frontend: `pnpm --dir frontend start` (port 4200, proxies `/api` to port 3000)
- Production: build both, serve the Angular build from the Express app
- Run the backend as a service (systemd or pm2) so tracking continues when the browser is closed
- Before starting, `scripts/check-mount.sh` confirms the HDD is mounted at /mnt/media

---

## 10. Configuration (.env)

```
PORT=3000
DB_PATH=/mnt/media/projects/price_history/data/prices.db
LOG_DIR=/mnt/media/projects/price_history/logs
SCRAPE_INTERVAL_MINUTES=360
SCRAPE_JITTER_SECONDS=120
SAVE_SNAPSHOTS=false

ALERT_EMAIL_FROM=
ALERT_EMAIL_TO=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

AMAZON_PAAPI_ACCESS_KEY=
AMAZON_PAAPI_SECRET_KEY=
AMAZON_PARTNER_TAG=

FLIPKART_AFFILIATE_ID=
FLIPKART_AFFILIATE_TOKEN=
```

Never commit `.env`. Commit only `.env.example`.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Sites block scraping or change HTML | Per-site adapters; saved fixtures for tests; pause listings after repeated failures |
| Terms of service violations | Prefer official APIs; keep scraping low-frequency and personal-use only |
| HDD unmounted at boot | check-mount.sh runs before the backend starts; fail fast with a clear error |
| SQLite locking under concurrent writes | Single writer process; WAL mode enabled |
| Variant or pack-size mismatch across sites | Store `variant_note` per listing; match listings manually or by external ID |
| Database growth | Monitor size; optionally store only price changes after a few months |
| Data loss | Nightly backup script copying the database to `backups/` with a retention policy |

---

## 12. Open Questions

1. Do you have an Amazon Associates or Flipkart Affiliate account? This decides API vs scraping.
2. Which retailers beyond Amazon and Flipkart matter most?
3. How do you want to receive alerts: email, desktop, or a messaging app?
4. Single user on your machine, or should other people access the dashboard?
5. Does this run on your own computer or on a machine that stays on?

---

## 13. Next Steps

1. Answer the open questions above.
2. Create the folder structure and run M0.
3. Build the Amazon and Flipkart adapters first, since everything else depends on them.
