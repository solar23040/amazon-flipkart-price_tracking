/** Normalized result of scraping one product page. */
export interface ScrapedProduct {
  title: string;
  /** Price in minor units (paise). 0 when the item is unavailable and has no price. */
  priceMinor: number;
  inStock: boolean;
  currency: 'INR';
}

/** One product found by a site search. Absent data stays null instead of being guessed. */
export interface SearchCandidate {
  site: Site;
  title: string;
  url: string;
  /** Price in paise. null when the search result page does not show one. */
  priceMinor: number | null;
  /** null when the search result page does not say. */
  inStock: boolean | null;
  imageUrl?: string | null;
}

/** Per-site scraper. Adapters never touch the database. */
export interface ScraperAdapter {
  site: Site;
  matches(url: string): boolean;
  extractExternalId(url: string): string | null;
  fetchPrice(url: string): Promise<ScrapedProduct>;
  /**
   * Optional site search. Rejects with a ScraperError when the site itself failed
   * (blocked / network); a parse failure should resolve with [] instead.
   */
  search?(query: string): Promise<SearchCandidate[]>;
}

export type Site = 'amazon' | 'flipkart';

export class ScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The site served a captcha / bot-check page. Back off. */
export class BlockedError extends ScraperError {}

/** The page loaded but its structure no longer matches what the parser expects. */
export class ParseError extends ScraperError {}

/** The product does not exist (404 or a "product not found" page). */
export class NotFoundError extends ScraperError {}

/** Network-level failure: timeout, DNS, HTTP 5xx, etc. */
export class NetworkError extends ScraperError {}
