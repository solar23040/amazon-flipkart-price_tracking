import type { Db } from './index.js';

export interface Product {
  id: number;
  name: string;
  canonical_key: string | null;
  created_at: string;
}

export interface Listing {
  id: number;
  product_id: number;
  site: string;
  url: string;
  external_id: string | null;
  variant_note: string | null;
  is_active: boolean;
  fail_count: number;
  last_scraped_at: string | null;
}

export interface PricePoint {
  id: number;
  listing_id: number;
  price_minor: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
}

export interface Alert {
  id: number;
  listing_id: number;
  target_price_minor: number;
  /** 'telegram' | 'email' | 'desktop' — kept as plain text so new channels need no migration. */
  channel: string;
  last_triggered_at: string | null;
}

export interface NewListing {
  productId: number;
  site: string;
  url: string;
  externalId?: string | null;
  variantNote?: string | null;
}

export interface NewAlert {
  listingId: number;
  targetPriceMinor: number;
  channel: string;
}

export interface AlertPatch {
  targetPriceMinor?: number;
  channel?: string;
}

export interface PricePointQuery {
  limit?: number;
  from?: string;
  to?: string;
}

// Rows as stored in SQLite (booleans are 0/1 integers).
interface ListingRow extends Omit<Listing, 'is_active'> {
  is_active: number;
}
interface PricePointRow extends Omit<PricePoint, 'in_stock'> {
  in_stock: number;
}

const toListing = (row: ListingRow): Listing => ({ ...row, is_active: row.is_active !== 0 });
const toPricePoint = (row: PricePointRow): PricePoint => ({ ...row, in_stock: row.in_stock !== 0 });

export function createRepository(db: Db) {
  const stmt = {
    insertProduct: db.prepare('INSERT INTO products (name, canonical_key) VALUES (?, ?)'),
    getProduct: db.prepare('SELECT * FROM products WHERE id = ?'),
    listProducts: db.prepare('SELECT * FROM products ORDER BY created_at DESC, id DESC'),
    renameProduct: db.prepare('UPDATE products SET name = ? WHERE id = ?'),
    insertListing: db.prepare(
      'INSERT INTO listings (product_id, site, url, external_id, variant_note) VALUES (?, ?, ?, ?, ?)',
    ),
    getListing: db.prepare('SELECT * FROM listings WHERE id = ?'),
    getListingByUrl: db.prepare('SELECT * FROM listings WHERE url = ?'),
    listListingsByProduct: db.prepare('SELECT * FROM listings WHERE product_id = ? ORDER BY site, id'),
    // NULLs sort first in ASC, so never-scraped listings go to the front of the queue.
    listActiveListings: db.prepare('SELECT * FROM listings WHERE is_active = 1 ORDER BY last_scraped_at ASC, id ASC'),
    activateListing: db.prepare('UPDATE listings SET is_active = 1, fail_count = 0 WHERE id = ?'),
    pauseListing: db.prepare('UPDATE listings SET is_active = 0 WHERE id = ?'),
    markScrapedSuccess: db.prepare('UPDATE listings SET last_scraped_at = ?, fail_count = 0 WHERE id = ?'),
    markScrapedFailure: db.prepare('UPDATE listings SET fail_count = fail_count + 1 WHERE id = ?'),
    insertPricePoint: db.prepare(
      'INSERT INTO price_points (listing_id, price_minor, currency, in_stock, scraped_at) VALUES (?, ?, ?, ?, ?)',
    ),
    latestPricePoint: db.prepare(
      'SELECT * FROM price_points WHERE listing_id = ? ORDER BY scraped_at DESC, id DESC LIMIT 1',
    ),
    insertAlert: db.prepare('INSERT INTO alerts (listing_id, target_price_minor, channel) VALUES (?, ?, ?)'),
    getAlert: db.prepare('SELECT * FROM alerts WHERE id = ?'),
    listAlertsByListing: db.prepare('SELECT * FROM alerts WHERE listing_id = ? ORDER BY id ASC'),
    updateAlert: db.prepare('UPDATE alerts SET target_price_minor = ?, channel = ? WHERE id = ?'),
    deleteAlert: db.prepare('DELETE FROM alerts WHERE id = ?'),
    markAlertTriggered: db.prepare('UPDATE alerts SET last_triggered_at = ? WHERE id = ?'),
    // Price point that was current when an alert last fired, so we can compare against it.
    pricePointAtOrBefore: db.prepare(
      'SELECT * FROM price_points WHERE listing_id = ? AND scraped_at <= ? ORDER BY scraped_at DESC, id DESC LIMIT 1',
    ),
  };

  return {
    createProduct(name: string, canonicalKey: string | null = null): Product {
      const result = stmt.insertProduct.run(name, canonicalKey);
      return stmt.getProduct.get(Number(result.lastInsertRowid)) as Product;
    },

    getProduct(id: number): Product | undefined {
      return stmt.getProduct.get(id) as Product | undefined;
    },

    listProducts(): Product[] {
      return stmt.listProducts.all() as Product[];
    },

    renameProduct(id: number, name: string): void {
      stmt.renameProduct.run(name, id);
    },

    addListing(input: NewListing): Listing {
      const result = stmt.insertListing.run(
        input.productId,
        input.site,
        input.url,
        input.externalId ?? null,
        input.variantNote ?? null,
      );
      return toListing(stmt.getListing.get(Number(result.lastInsertRowid)) as ListingRow);
    },

    getListing(id: number): Listing | undefined {
      const row = stmt.getListing.get(id) as ListingRow | undefined;
      return row ? toListing(row) : undefined;
    },

    getListingByUrl(url: string): Listing | undefined {
      const row = stmt.getListingByUrl.get(url) as ListingRow | undefined;
      return row ? toListing(row) : undefined;
    },

    listListingsByProduct(productId: number): Listing[] {
      return (stmt.listListingsByProduct.all(productId) as ListingRow[]).map(toListing);
    },

    listActiveListings(): Listing[] {
      return (stmt.listActiveListings.all() as ListingRow[]).map(toListing);
    },

    /** Pause or resume a listing. Resuming resets fail_count so auto-pause starts fresh. */
    setListingActive(id: number, active: boolean): Listing | undefined {
      (active ? stmt.activateListing : stmt.pauseListing).run(id);
      const row = stmt.getListing.get(id) as ListingRow | undefined;
      return row ? toListing(row) : undefined;
    },

    markScrapedSuccess(listingId: number, scrapedAt: string): void {
      stmt.markScrapedSuccess.run(scrapedAt, listingId);
    },

    markScrapedFailure(listingId: number): void {
      stmt.markScrapedFailure.run(listingId);
    },

    insertPricePoint(
      listingId: number,
      priceMinor: number,
      currency: string,
      inStock: boolean,
      scrapedAt: string,
    ): number {
      const result = stmt.insertPricePoint.run(listingId, priceMinor, currency, inStock ? 1 : 0, scrapedAt);
      return Number(result.lastInsertRowid);
    },

    listPricePoints(listingId: number, query: PricePointQuery = {}): PricePoint[] {
      const clauses = ['listing_id = ?'];
      const params: Array<number | string> = [listingId];
      if (query.from) {
        clauses.push('scraped_at >= ?');
        params.push(query.from);
      }
      if (query.to) {
        clauses.push('scraped_at <= ?');
        params.push(query.to);
      }
      const limit = Math.min(Math.max(query.limit ?? 500, 1), 5000);
      params.push(limit);

      const rows = db
        .prepare(
          `SELECT * FROM price_points WHERE ${clauses.join(' AND ')} ORDER BY scraped_at ASC, id ASC LIMIT ?`,
        )
        .all(...params) as PricePointRow[];
      return rows.map(toPricePoint);
    },

    latestPricePoint(listingId: number): PricePoint | undefined {
      const row = stmt.latestPricePoint.get(listingId) as PricePointRow | undefined;
      return row ? toPricePoint(row) : undefined;
    },

    addAlert(input: NewAlert): Alert {
      const result = stmt.insertAlert.run(input.listingId, input.targetPriceMinor, input.channel);
      return stmt.getAlert.get(Number(result.lastInsertRowid)) as Alert;
    },

    getAlert(id: number): Alert | undefined {
      return stmt.getAlert.get(id) as Alert | undefined;
    },

    listAlertsByListing(listingId: number): Alert[] {
      return stmt.listAlertsByListing.all(listingId) as Alert[];
    },

    /** Read-modify-write so callers can patch just the target or just the channel. */
    updateAlert(id: number, patch: AlertPatch): Alert | undefined {
      const existing = stmt.getAlert.get(id) as Alert | undefined;
      if (!existing) return undefined;
      stmt.updateAlert.run(patch.targetPriceMinor ?? existing.target_price_minor, patch.channel ?? existing.channel, id);
      return stmt.getAlert.get(id) as Alert;
    },

    deleteAlert(id: number): boolean {
      return stmt.deleteAlert.run(id).changes > 0;
    },

    markAlertTriggered(id: number, triggeredAt: string): void {
      stmt.markAlertTriggered.run(triggeredAt, id);
    },

    pricePointAtOrBefore(listingId: number, scrapedAtOrBefore: string): PricePoint | undefined {
      const row = stmt.pricePointAtOrBefore.get(listingId, scrapedAtOrBefore) as PricePointRow | undefined;
      return row ? toPricePoint(row) : undefined;
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
