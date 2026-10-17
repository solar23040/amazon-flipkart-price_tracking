import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { ApiService, apiErrorBody, apiErrorMessage } from '../../core/api';
import type { SearchCandidate, SearchSiteStatus, Site } from '../../core/models';
import { InrPipe } from '../../shared/inr.pipe';

const SITE_LABELS: Record<Site, string> = {
  amazon: 'Amazon.in',
  flipkart: 'Flipkart',
};

const DEBOUNCE_MS = 400;

interface SearchGroup {
  site: Site;
  label: string;
  status: SearchSiteStatus | null;
  candidates: SearchCandidate[];
}

@Component({
  selector: 'app-search',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    InrPipe,
  ],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class Search {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly loading = signal(false);
  /** True once a search finished (successfully or not); empty states only show then. */
  protected readonly searched = signal(false);
  protected readonly results = signal<SearchCandidate[]>([]);
  protected readonly sites = signal<SearchSiteStatus[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly filter = signal<'all' | Site>('all');
  /** url of the result row currently being tracked, so only that row shows a spinner. */
  protected readonly trackingUrl = signal<string | null>(null);

  protected readonly filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'amazon', label: 'Amazon' },
    { value: 'flipkart', label: 'Flipkart' },
  ] as const;

  protected readonly groups = computed<SearchGroup[]>(() => {
    const filter = this.filter();
    const results = this.results();
    const statuses = new Map(this.sites().map((status) => [status.site, status]));
    return (['amazon', 'flipkart'] as const)
      .filter((site) => filter === 'all' || filter === site)
      .map((site) => ({
        site,
        label: SITE_LABELS[site],
        status: statuses.get(site) ?? null,
        candidates: results.filter((candidate) => candidate.site === site),
      }));
  });

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per request so a slow response cannot overwrite a newer one. */
  private searchSeq = 0;

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = null;

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      this.clearResults();
      return;
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.run(trimmed);
    }, DEBOUNCE_MS);
  }

  protected retry(): void {
    const trimmed = this.query().trim();
    if (trimmed.length >= 2) this.run(trimmed);
  }

  /** POST the result url through the existing track flow, then open the product page. */
  protected track(candidate: SearchCandidate): void {
    if (this.trackingUrl() !== null) return;
    this.trackingUrl.set(candidate.url);
    this.notice.set(null);
    this.api.createProduct(candidate.url).subscribe({
      next: (response) => void this.router.navigate(['/products', response.product.id]),
      error: (err: unknown) => {
        this.trackingUrl.set(null);
        // 409 (already tracked) carries the existing product id - open that instead.
        const body = apiErrorBody(err);
        if (body?.productId !== undefined) {
          void this.router.navigate(['/products', body.productId]);
          return;
        }
        this.notice.set(apiErrorMessage(err));
      },
    });
  }

  private run(query: string): void {
    const seq = ++this.searchSeq;
    this.loading.set(true);
    this.searched.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.results.set([]);
    this.sites.set([]);
    this.api.search(query).subscribe({
      next: (response) => {
        if (seq !== this.searchSeq) return;
        this.loading.set(false);
        this.results.set(response.results);
        this.sites.set(response.sites);
        this.searched.set(true);
      },
      error: (err: unknown) => {
        if (seq !== this.searchSeq) return;
        this.loading.set(false);
        this.error.set(apiErrorMessage(err));
        this.searched.set(true);
      },
    });
  }

  private clearResults(): void {
    this.searchSeq++;
    this.loading.set(false);
    this.searched.set(false);
    this.results.set([]);
    this.sites.set([]);
    this.error.set(null);
    this.notice.set(null);
  }
}
