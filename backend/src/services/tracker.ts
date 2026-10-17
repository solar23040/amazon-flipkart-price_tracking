import type { Repository } from '../db/repository.js';
import { getAdapter } from '../scrapers/index.js';
import { BlockedError, NetworkError, NotFoundError, ParseError, type ScraperAdapter, type Site } from '../scrapers/types.js';

export type ScrapeErrorKind = 'blocked' | 'parse' | 'not_found' | 'network' | 'unsupported' | 'unknown';

export interface ScrapeResult {
  ok: boolean;
  title?: string;
  priceMinor?: number;
  inStock?: boolean;
  error?: string;
  errorKind?: ScrapeErrorKind;
}

export interface TrackerDeps {
  /**
   * Called after a successful scrape has stored its price point (before the result is returned).
   * Alert evaluation lives here so manual scrapes and scheduler cycles both notify.
   * A failing hook is logged and swallowed: it never changes the scrape result.
   */
  onScraped?: (listingId: number, priceMinor: number, inStock: boolean) => Promise<void>;
  /** Injectable for tests. Default: console.error. */
  log?: (message: string) => void;
}

export function createTracker(repo: Repository, deps: TrackerDeps = {}) {
  const logError = deps.log ?? ((message: string) => console.error(message));

  return {
    /**
     * Scrape one listing: fetch the page, store a price point, update bookkeeping.
     * Never throws for scrape failures; returns them so routes/schedulers can decide.
     * `adapterOverride` exists so tests can run without touching the network.
     */
    async scrapeListing(listingId: number, adapterOverride?: ScraperAdapter): Promise<ScrapeResult> {
      const listing = repo.getListing(listingId);
      if (!listing) return { ok: false, error: `listing ${listingId} not found`, errorKind: 'unknown' };

      const adapter = adapterOverride ?? getAdapter(listing.site as Site);
      if (!adapter) {
        return { ok: false, error: `no adapter registered for site "${listing.site}"`, errorKind: 'unsupported' };
      }

      try {
        const scraped = await adapter.fetchPrice(listing.url);
        const scrapedAt = new Date().toISOString();
        repo.insertPricePoint(listing.id, scraped.priceMinor, scraped.currency, scraped.inStock, scrapedAt);
        repo.markScrapedSuccess(listing.id, scrapedAt);
        if (deps.onScraped) {
          try {
            await deps.onScraped(listing.id, scraped.priceMinor, scraped.inStock);
          } catch (error) {
            logError(
              `[tracker] post-scrape hook failed for listing ${listing.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { ok: true, title: scraped.title, priceMinor: scraped.priceMinor, inStock: scraped.inStock };
      } catch (error) {
        repo.markScrapedFailure(listing.id);
        if (error instanceof BlockedError) return { ok: false, error: error.message, errorKind: 'blocked' };
        if (error instanceof ParseError) return { ok: false, error: error.message, errorKind: 'parse' };
        if (error instanceof NotFoundError) return { ok: false, error: error.message, errorKind: 'not_found' };
        if (error instanceof NetworkError) return { ok: false, error: error.message, errorKind: 'network' };
        return { ok: false, error: error instanceof Error ? error.message : String(error), errorKind: 'unknown' };
      }
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
