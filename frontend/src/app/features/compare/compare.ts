import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule, type MatSelectChange } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, apiErrorMessage } from '../../core/api';
import type { ListingWithLatest, PricePoint, ProductWithListings } from '../../core/models';
import { formatInrMinor } from '../../shared/format';
import { InrPipe } from '../../shared/inr.pipe';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

type PricedListing = ListingWithLatest & { latestPrice: PricePoint };

@Component({
  selector: 'app-compare',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    InrPipe,
    TimeAgoPipe,
  ],
  templateUrl: './compare.html',
  styleUrl: './compare.scss',
})
export class Compare {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly products = signal<ProductWithListings[] | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Selected via ?productId= in the URL, so the view can be linked and reloaded. */
  protected readonly selectedId = signal<number | null>(null);
  protected readonly addUrl = signal('');
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addNotice = signal<string | null>(null);

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    if (id === null) return null;
    return (this.products() ?? []).find((product) => product.id === id) ?? null;
  });

  /** Lowest in-stock price, only highlighted when there are at least two candidates. */
  protected readonly cheapestListingId = computed<number | null>(() => {
    const product = this.selected();
    if (!product) return null;
    const priced = product.listings.filter(
      (listing): listing is PricedListing =>
        listing.latestPrice !== null && listing.latestPrice.in_stock,
    );
    if (priced.length < 2) return null;
    return priced.reduce((best, listing) =>
      listing.latestPrice.price_minor < best.latestPrice.price_minor ? listing : best,
    ).id;
  });

  /** Percent more expensive than the cheapest in-stock listing, per listing id (display only). */
  protected readonly priceDiffs = computed<ReadonlyMap<number, number>>(() => {
    const diffs = new Map<number, number>();
    const product = this.selected();
    const cheapestId = this.cheapestListingId();
    if (!product || cheapestId === null) return diffs;

    const priced = product.listings.filter(
      (listing): listing is PricedListing =>
        listing.latestPrice !== null && listing.latestPrice.in_stock,
    );
    const cheapest = priced.find((listing) => listing.id === cheapestId);
    if (!cheapest || cheapest.latestPrice.price_minor <= 0) return diffs;

    for (const listing of priced) {
      if (listing.id === cheapestId) continue;
      const percent = Math.round(
        ((listing.latestPrice.price_minor - cheapest.latestPrice.price_minor) /
          cheapest.latestPrice.price_minor) *
          100,
      );
      if (percent > 0) diffs.set(listing.id, percent);
    }
    return diffs;
  });

  constructor() {
    this.load();
    this.route.queryParamMap.subscribe((params) => {
      const id = Number(params.get('productId'));
      this.selectedId.set(Number.isInteger(id) && id > 0 ? id : null);
    });
  }

  protected load(): void {
    this.error.set(null);
    this.api.listProducts().subscribe({
      next: (products) => this.products.set(products),
      error: (err: unknown) => {
        this.products.set([]);
        this.error.set(apiErrorMessage(err));
      },
    });
  }

  protected select(event: MatSelectChange): void {
    const id = Number(event.value);
    if (!Number.isInteger(id) || id <= 0) return;
    this.selectedId.set(id);
    void this.router.navigate([], {
      queryParams: { productId: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onAddUrlInput(event: Event): void {
    this.addUrl.set((event.target as HTMLInputElement).value);
  }

  protected addListing(event: Event): void {
    event.preventDefault();
    const product = this.selected();
    const url = this.addUrl().trim();
    if (!product || !url || this.adding()) return;
    if (!/^https?:\/\//i.test(url)) {
      this.addError.set('Enter a full product URL starting with http(s)://');
      return;
    }

    this.adding.set(true);
    this.addError.set(null);
    this.addNotice.set(null);
    this.api.addListing(product.id, url).subscribe({
      next: (response) => {
        this.adding.set(false);
        this.addUrl.set('');
        this.addNotice.set(
          response.scrape.ok
            ? `Added ${response.listing.site}${
                response.scrape.priceMinor !== undefined
                  ? ` at ${formatInrMinor(response.scrape.priceMinor)}`
                  : ''
              }.`
            : `Added ${response.listing.site}, but the first scrape failed (${response.scrape.errorKind ?? 'unknown'}).`,
        );
        this.load();
      },
      error: (err: unknown) => {
        this.adding.set(false);
        this.addError.set(apiErrorMessage(err));
      },
    });
  }
}
