import type { Alert, Listing, Repository } from '../db/repository.js';
import type { AlertNotification, Notifier } from './notifier.js';

/**
 * Decide whether a scrape should notify for one alert.
 *
 * Rules (per M4 scope):
 * - only when the new price is strictly below the alert target;
 * - a first-time trigger always notifies;
 * - afterwards only a strictly lower price than the last triggered price re-notifies,
 *   so repeated scrapes at the same price stay quiet.
 *
 * `lastTriggeredPriceMinor` is the price point that was current when the alert last fired
 * (null when history for it is unavailable; then we prefer one extra notification over silence).
 */
export function shouldTriggerAlert(
  alert: Pick<Alert, 'target_price_minor' | 'last_triggered_at'>,
  currentPriceMinor: number,
  lastTriggeredPriceMinor: number | null,
): boolean {
  if (currentPriceMinor >= alert.target_price_minor) return false;
  if (alert.last_triggered_at === null) return true;
  if (lastTriggeredPriceMinor === null) return true;
  return currentPriceMinor < lastTriggeredPriceMinor;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInrMinor(priceMinor: number): string {
  return inr.format(priceMinor / 100);
}

export function buildAlertMessage(
  productName: string,
  listing: Listing,
  alert: Alert,
  priceMinor: number,
  inStock: boolean,
): AlertNotification {
  const current = formatInrMinor(priceMinor);
  const target = formatInrMinor(alert.target_price_minor);
  const stock = inStock ? 'in stock' : 'out of stock';
  return {
    subject: `Price drop: ${current} — ${productName} (${listing.site})`,
    text: [
      `Price drop for ${productName}`,
      '',
      `Current price: ${current} (${stock})`,
      `Target price:  ${target}`,
      `Site: ${listing.site}`,
      `URL: ${listing.url}`,
    ].join('\n'),
  };
}

export interface AlertEvaluationResult {
  alertId: number;
  channel: string;
  notified: boolean;
  error?: string;
}

export interface AlertService {
  /** Evaluate every alert on a listing against a freshly stored price. Never throws. */
  evaluateListing(listingId: number, priceMinor: number, inStock: boolean): Promise<AlertEvaluationResult[]>;
}

export interface AlertServiceDeps {
  /** Injectable for tests. Default: () => new Date(). */
  now?: () => Date;
  /** Injectable for tests. Default: console.log. */
  log?: (message: string) => void;
}

export function createAlertService(
  repo: Repository,
  notifier: Notifier,
  deps: AlertServiceDeps = {},
): AlertService {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message: string) => console.log(message));

  return {
    async evaluateListing(listingId: number, priceMinor: number, inStock: boolean): Promise<AlertEvaluationResult[]> {
      const results: AlertEvaluationResult[] = [];
      try {
        const listing = repo.getListing(listingId);
        if (!listing) return results;

        const alerts = repo.listAlertsByListing(listingId);
        if (alerts.length === 0) return results;

        const productName = repo.getProduct(listing.product_id)?.name ?? `listing ${listingId}`;

        for (const alert of alerts) {
          const lastTriggeredPriceMinor = alert.last_triggered_at
            ? (repo.pricePointAtOrBefore(listingId, alert.last_triggered_at)?.price_minor ?? null)
            : null;
          if (!shouldTriggerAlert(alert, priceMinor, lastTriggeredPriceMinor)) continue;

          const notification = buildAlertMessage(productName, listing, alert, priceMinor, inStock);
          // The notifier never throws, but an alert loop must survive anything anyway.
          let sent: { ok: boolean; error?: string };
          try {
            sent = await notifier.send(alert.channel, notification);
          } catch (error) {
            sent = { ok: false, error: error instanceof Error ? error.message : String(error) };
          }

          if (sent.ok) {
            repo.markAlertTriggered(alert.id, now().toISOString());
            log(
              `[alerts] listing ${listingId}: alert ${alert.id} (${alert.channel}) triggered at ${formatInrMinor(priceMinor)} ` +
                `(target ${formatInrMinor(alert.target_price_minor)})`,
            );
          } else {
            log(`[alerts] listing ${listingId}: alert ${alert.id} (${alert.channel}) not sent: ${sent.error ?? 'unknown error'}`);
          }
          results.push({
            alertId: alert.id,
            channel: alert.channel,
            notified: sent.ok,
            ...(sent.error !== undefined ? { error: sent.error } : {}),
          });
        }
      } catch (error) {
        log(`[alerts] evaluation failed for listing ${listingId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return results;
    },
  };
}
