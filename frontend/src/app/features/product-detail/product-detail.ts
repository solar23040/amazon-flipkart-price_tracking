import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule, type MatSelectChange } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { forkJoin, map } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api';
import type {
  Alert,
  AlertChannel,
  ListingWithLatest,
  PricePoint,
  ProductWithListings,
} from '../../core/models';
import { formatInrMinor, formatRupees } from '../../shared/format';
import { InrPipe } from '../../shared/inr.pipe';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

// Tree-shaken echarts build, registered with this (lazy) route only.
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const isAlertChannel = (value: unknown): value is AlertChannel =>
  value === 'telegram' || value === 'email' || value === 'desktop';

@Component({
  selector: 'app-product-detail',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    NgxEchartsDirective,
    InrPipe,
    TimeAgoPipe,
  ],
  providers: [provideEchartsCore({ echarts })],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private productId: number | null = null;
  protected readonly product = signal<ProductWithListings | null>(null);
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly prices = signal<ReadonlyMap<number, PricePoint[]>>(new Map());
  /** Listing currently being scraped/paused, so its buttons can be disabled. */
  protected readonly busyListingId = signal<number | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Alerts per listing id. */
  protected readonly alerts = signal<ReadonlyMap<number, Alert[]>>(new Map());
  /** Alert currently being removed, so its button can be disabled. */
  protected readonly busyAlertId = signal<number | null>(null);
  /** Per-listing "set a target" form drafts (rupee string + channel). */
  protected readonly drafts = signal<Record<number, { target: string; channel: AlertChannel }>>({});

  /** One line per listing (site), values in rupees because that is what the axis shows. */
  protected readonly chartOptions = computed<EChartsCoreOption | null>(() => {
    const product = this.product();
    if (!product) return null;

    const prices = this.prices();
    const series = product.listings
      .map((listing) => ({
        name: listing.variant_note ? `${listing.site} (${listing.variant_note})` : listing.site,
        type: 'line',
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
        data: (prices.get(listing.id) ?? []).map(
          (point) => [point.scraped_at, point.price_minor / 100] as [string, number],
        ),
      }))
      .filter((entry) => entry.data.length > 0);
    if (series.length === 0) return null;

    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => (typeof value === 'number' ? formatRupees(value) : '—'),
      },
      legend: {
        data: series.map((entry) => entry.name),
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 8,
        itemGap: 16,
        textStyle: { fontSize: 12 },
      },
      grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
      xAxis: { type: 'time' },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          formatter: (value: unknown) => (typeof value === 'number' ? formatRupees(value) : ''),
        },
      },
      series,
    };
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.notFound.set(true);
      return;
    }
    this.productId = id;
    this.load();
  }

  protected load(): void {
    const id = this.productId;
    if (id === null) return;
    this.error.set(null);
    this.api.getProduct(id).subscribe({
      next: (product) => {
        this.product.set(product);
        this.loadPrices(product);
        this.loadAlerts();
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(apiErrorMessage(err));
        }
      },
    });
  }

  private loadPrices(product: ProductWithListings): void {
    if (product.listings.length === 0) {
      this.prices.set(new Map());
      return;
    }
    forkJoin(
      product.listings.map((listing) =>
        this.api.getPrices(listing.id).pipe(map((points) => [listing.id, points] as const)),
      ),
    ).subscribe({
      next: (entries) => this.prices.set(new Map(entries)),
      error: () => this.prices.set(new Map()),
    });
  }

  /** Fail-soft: a failed fetch keeps whatever was last shown instead of breaking the page. */
  private loadAlerts(): void {
    const product = this.product();
    if (!product || product.listings.length === 0) {
      this.alerts.set(new Map());
      return;
    }
    forkJoin(
      product.listings.map((listing) =>
        this.api.listAlerts(listing.id).pipe(map((alerts) => [listing.id, alerts] as const)),
      ),
    ).subscribe({
      next: (entries) => this.alerts.set(new Map(entries)),
      error: () => {},
    });
  }

  protected scrape(listingId: number): void {
    if (this.busyListingId() !== null) return;
    this.busyListingId.set(listingId);
    this.notice.set(null);
    this.api.scrapeListing(listingId).subscribe({
      next: (response) => {
        this.busyListingId.set(null);
        this.notice.set(
          response.result.ok
            ? `Scraped: ${response.result.priceMinor !== undefined ? formatInrMinor(response.result.priceMinor) : 'no price found'}`
            : `Scrape failed (${response.result.errorKind ?? 'unknown'}): ${response.result.error ?? 'no details'}`,
        );
        this.load();
      },
      error: (err: unknown) => {
        this.busyListingId.set(null);
        this.notice.set(apiErrorMessage(err));
      },
    });
  }

  protected toggleActive(listingId: number, isActive: boolean): void {
    if (this.busyListingId() !== null) return;
    this.busyListingId.set(listingId);
    this.notice.set(null);
    this.api.setListingActive(listingId, isActive).subscribe({
      next: (listing) => {
        this.busyListingId.set(null);
        this.notice.set(listing.is_active ? 'Listing resumed.' : 'Listing paused.');
        this.load();
      },
      error: (err: unknown) => {
        this.busyListingId.set(null);
        this.notice.set(apiErrorMessage(err));
      },
    });
  }

  protected alertsFor(listingId: number): Alert[] {
    return this.alerts().get(listingId) ?? [];
  }

  protected draftFor(listingId: number): { target: string; channel: AlertChannel } {
    return this.drafts()[listingId] ?? { target: '', channel: 'telegram' };
  }

  /** True when the latest price is strictly below the alert target. */
  protected targetReached(alert: Alert, listing: ListingWithLatest): boolean {
    const latest = listing.latestPrice;
    return latest !== null && latest.price_minor < alert.target_price_minor;
  }

  protected onTargetInput(listingId: number, event: Event): void {
    const target = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({
      ...drafts,
      [listingId]: { ...this.draftFor(listingId), target },
    }));
  }

  protected onChannelChange(listingId: number, event: MatSelectChange): void {
    if (!isAlertChannel(event.value)) return;
    const channel = event.value;
    this.drafts.update((drafts) => ({
      ...drafts,
      [listingId]: { ...this.draftFor(listingId), channel },
    }));
  }

  protected addAlert(listingId: number, event: Event): void {
    event.preventDefault();
    if (this.busyListingId() !== null) return;

    const draft = this.draftFor(listingId);
    const rupees = Number(draft.target);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      this.notice.set('Enter a target price in rupees greater than zero.');
      return;
    }

    this.busyListingId.set(listingId);
    this.notice.set(null);
    // The input is in rupees; the API stores paise like every other price.
    this.api.createAlert(listingId, Math.round(rupees * 100), draft.channel).subscribe({
      next: () => {
        this.busyListingId.set(null);
        this.notice.set('Target price set.');
        this.drafts.update((drafts) => ({
          ...drafts,
          [listingId]: { target: '', channel: draft.channel },
        }));
        this.loadAlerts();
      },
      error: (err: unknown) => {
        this.busyListingId.set(null);
        this.notice.set(apiErrorMessage(err));
      },
    });
  }

  protected removeAlert(alertId: number): void {
    if (this.busyAlertId() !== null) return;
    this.busyAlertId.set(alertId);
    this.notice.set(null);
    this.api.deleteAlert(alertId).subscribe({
      next: () => {
        this.busyAlertId.set(null);
        this.notice.set('Alert removed.');
        this.loadAlerts();
      },
      error: (err: unknown) => {
        this.busyAlertId.set(null);
        this.notice.set(apiErrorMessage(err));
      },
    });
  }
}
