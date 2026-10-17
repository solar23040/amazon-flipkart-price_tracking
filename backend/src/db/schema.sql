CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  canonical_key TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id              INTEGER PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  site            TEXT NOT NULL,
  url             TEXT NOT NULL UNIQUE,
  external_id     TEXT,
  variant_note    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT 1,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  last_scraped_at DATETIME
);

CREATE TABLE IF NOT EXISTS price_points (
  id           INTEGER PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price_minor  INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'INR',
  in_stock     BOOLEAN NOT NULL,
  scraped_at   DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_points_listing_time ON price_points(listing_id, scraped_at);

CREATE TABLE IF NOT EXISTS alerts (
  id                 INTEGER PRIMARY KEY,
  listing_id         INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  target_price_minor INTEGER NOT NULL,
  channel            TEXT NOT NULL,
  last_triggered_at  DATETIME
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
