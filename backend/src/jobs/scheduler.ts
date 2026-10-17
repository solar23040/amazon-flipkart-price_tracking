import cron, { type ScheduledTask } from 'node-cron';
import type { Listing, Repository } from '../db/repository.js';
import type { ScrapeErrorKind, ScrapeResult, Tracker } from '../services/tracker.js';

export interface SchedulerOptions {
  /** Base interval between scrape cycles. */
  intervalMs: number;
  /** Extra random delay (0..jitterMs) added to each interval, so cycles don't start on a fixed beat. */
  jitterMs: number;
  /** Minimum gap between two requests to the same site (applies to retries as well). */
  siteDelayMs: number;
  /** Retries per listing on retryable errors, so maxRetries + 1 total attempts. */
  maxRetries: number;
  /** Base delay for exponential backoff: retryBaseMs * 2^(attempt-1), plus up to retryBaseMs of jitter. */
  retryBaseMs: number;
  /** Consecutive failed *attempts* after which a listing is paused (fail_count resets on any success). */
  maxConsecutiveFailures: number;
}

export interface ListingResult {
  listingId: number;
  site: string;
  ok: boolean;
  attempts: number;
  errorKind?: ScrapeErrorKind;
  error?: string;
  paused: boolean;
}

export interface CycleReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  listings: number;
  succeeded: number;
  failed: number;
  paused: number[];
  results: ListingResult[];
}

export interface SchedulerStatus {
  started: boolean;
  running: boolean;
  intervalMs: number;
  jitterMs: number;
  siteDelayMs: number;
  maxRetries: number;
  maxConsecutiveFailures: number;
  nextRunAt: string | null;
  lastReport: CycleReport | null;
}

/** Only transient-looking errors are retried within a cycle; blocked/parse/not_found wait for the next cycle. */
const RETRYABLE: ReadonlySet<ScrapeErrorKind> = new Set(['network', 'unknown']);

export interface SchedulerDeps {
  /** Injectable for tests. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Default: Math.random. */
  random?: () => number;
  /** Injectable for tests. Default: Date.now. */
  now?: () => number;
  /** Injectable for tests. Default: console.log. */
  log?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createScheduler(
  repo: Repository,
  tracker: Tracker,
  options: SchedulerOptions,
  deps: SchedulerDeps = {},
) {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.log(message));

  let task: ScheduledTask | null = null;
  let started = false;
  let running = false;
  let nextRunAt: Date | null = null;
  let lastReport: CycleReport | null = null;

  // Last request time per site, so back-to-back cycles and retries stay rate limited.
  const lastRequestAt = new Map<string, number>();

  /** Wait until at least siteDelayMs has passed since the last request to this site. */
  async function gate(site: string): Promise<void> {
    const last = lastRequestAt.get(site);
    if (last !== undefined) {
      const waitMs = options.siteDelayMs - (now() - last);
      if (waitMs > 0) await sleep(waitMs);
    }
    lastRequestAt.set(site, now());
  }

  async function scrapeWithRetry(listing: Listing): Promise<{ result: ScrapeResult; attempts: number }> {
    let attempts = 0;
    for (;;) {
      attempts += 1;
      await gate(listing.site);
      const result = await tracker.scrapeListing(listing.id);
      if (result.ok || !result.errorKind || !RETRYABLE.has(result.errorKind) || attempts > options.maxRetries) {
        return { result, attempts };
      }
      const backoffMs = options.retryBaseMs * 2 ** (attempts - 1) + Math.floor(random() * options.retryBaseMs);
      log(
        `[scheduler] listing ${listing.id} (${listing.site}) ${result.errorKind} error, retrying in ${backoffMs}ms ` +
          `(attempt ${attempts + 1}/${options.maxRetries + 1}): ${result.error}`,
      );
      await sleep(backoffMs);
    }
  }

  /**
   * One full pass over all active listings, oldest scrape first.
   * Returns null when a cycle is already in progress (overlap is skipped, never queued).
   */
  async function runCycle(): Promise<CycleReport | null> {
    if (running) return null;
    running = true;
    const startedAtMs = now();
    try {
      const listings = repo.listActiveListings();
      log(`[scheduler] cycle starting: ${listings.length} active listing(s)`);

      const results: ListingResult[] = [];
      const paused: number[] = [];

      for (const listing of listings) {
        let entry: ListingResult;
        try {
          const { result, attempts } = await scrapeWithRetry(listing);
          entry = {
            listingId: listing.id,
            site: listing.site,
            ok: result.ok,
            attempts,
            errorKind: result.errorKind,
            error: result.error,
            paused: false,
          };
          if (!result.ok) {
            const fresh = repo.getListing(listing.id);
            if (fresh && fresh.is_active && fresh.fail_count >= options.maxConsecutiveFailures) {
              repo.setListingActive(listing.id, false);
              entry.paused = true;
              paused.push(listing.id);
              log(
                `[scheduler] paused listing ${listing.id} (${listing.site}) after ${fresh.fail_count} consecutive failures: ${result.error}`,
              );
            }
          }
        } catch (error) {
          // The tracker is designed not to throw, but a cycle must survive anything short of that.
          entry = {
            listingId: listing.id,
            site: listing.site,
            ok: false,
            attempts: 0,
            errorKind: 'unknown',
            error: error instanceof Error ? error.message : String(error),
            paused: false,
          };
        }
        results.push(entry);
      }

      const finishedAtMs = now();
      const succeeded = results.filter((r) => r.ok).length;
      const report: CycleReport = {
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        listings: results.length,
        succeeded,
        failed: results.length - succeeded,
        paused,
        results,
      };
      lastReport = report;
      log(
        `[scheduler] cycle done in ${report.durationMs}ms: ${succeeded} ok, ${report.failed} failed, ${paused.length} paused`,
      );
      return report;
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    nextRunAt = new Date(now() + options.intervalMs + Math.floor(random() * options.jitterMs));
  }

  async function tick(): Promise<void> {
    if (!nextRunAt || now() < nextRunAt.getTime()) return;
    nextRunAt = null;
    try {
      await runCycle();
    } catch (error) {
      log(`[scheduler] cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      scheduleNext();
    }
  }

  return {
    /** Start the cron tick loop. The first cycle runs after one interval (+ jitter), not immediately. */
    start(): void {
      if (task) return;
      started = true;
      scheduleNext();
      // Tick every minute and run when due: works for any interval (e.g. 360 min), not just cron-expressible ones.
      task = cron.schedule('* * * * *', () => {
        void tick();
      });
      log(
        `[scheduler] started: every ${Math.round(options.intervalMs / 60_000)} min ` +
          `(jitter up to ${Math.round(options.jitterMs / 1000)}s), next run ${nextRunAt?.toISOString()}`,
      );
    },

    /** Stop the tick loop. An in-flight cycle runs to completion. */
    stop(): void {
      if (task) {
        task.stop();
        task.destroy();
        task = null;
      }
      started = false;
      nextRunAt = null;
    },

    runCycle,

    status(): SchedulerStatus {
      return {
        started,
        running,
        intervalMs: options.intervalMs,
        jitterMs: options.jitterMs,
        siteDelayMs: options.siteDelayMs,
        maxRetries: options.maxRetries,
        maxConsecutiveFailures: options.maxConsecutiveFailures,
        nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
        lastReport,
      };
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
