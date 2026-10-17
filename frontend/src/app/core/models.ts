/** API response shapes, matching backend/src/routes/*.ts exactly (snake_case comes from SQLite rows). */

export type Site = 'amazon' | 'flipkart';

export interface Product {
  id: number;
  name: string;
  canonical_key: string | null;
  created_at: string;
}

export interface Listing {
  id: number;
  product_id: number;
  site: Site;
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
  /** Price in paise (₹1 = 100). */
  price_minor: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
}

export interface ListingWithLatest extends Listing {
  latestPrice: PricePoint | null;
}

export type AlertChannel = 'telegram' | 'email' | 'desktop';

/** A target price on one listing. last_triggered_at is null until it first fires. */
export interface Alert {
  id: number;
  listing_id: number;
  target_price_minor: number;
  channel: AlertChannel;
  last_triggered_at: string | null;
}

export interface ProductWithListings extends Product {
  listings: ListingWithLatest[];
}

export type ScrapeErrorKind = 'blocked' | 'parse' | 'not_found' | 'network' | 'unsupported' | 'unknown';

export interface ScrapeResult {
  ok: boolean;
  title?: string;
  priceMinor?: number;
  inStock?: boolean;
  error?: string;
  errorKind?: ScrapeErrorKind;
}

/** POST /api/products */
export interface CreateProductResponse {
  product: Product;
  listing: Listing | null;
  latestPrice: PricePoint | null;
  scrape: ScrapeResult | null;
}

/** POST /api/products/:id/listings */
export interface AddListingResponse {
  listing: Listing;
  latestPrice: PricePoint | null;
  scrape: ScrapeResult;
}

/** POST /api/listings/:id/scrape */
export interface ScrapeListingResponse {
  result: ScrapeResult;
  listing: Listing | null;
  latestPrice: PricePoint | null;
}

/** One result row from a cross-site search. */
export interface SearchCandidate {
  site: Site;
  title: string;
  url: string;
  /** Price in paise; null when the search page did not show one (still trackable). */
  priceMinor: number | null;
  /** null when the search page does not say. */
  inStock: boolean | null;
  imageUrl?: string | null;
}

/** Per-site outcome of a search; ok=false means blocked or unreachable, not "no results". */
export interface SearchSiteStatus {
  site: Site;
  ok: boolean;
  error?: string;
}

/** GET /api/search */
export interface SearchResponse {
  results: SearchCandidate[];
  sites: SearchSiteStatus[];
  cached: boolean;
}

/** Body the backend returns for 4xx responses. */
export interface ApiErrorBody {
  error: string;
  details?: Array<{ path: string; message: string }>;
  /** Present on 409 from POST /api/products. */
  listingId?: number;
  productId?: number;
}
