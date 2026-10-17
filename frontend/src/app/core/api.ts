import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';
import type {
  AddListingResponse,
  Alert,
  AlertChannel,
  ApiErrorBody,
  CreateProductResponse,
  Listing,
  PricePoint,
  ProductWithListings,
  ScrapeListingResponse,
  SearchResponse,
} from './models';

/** Thin typed client for the backend API. All calls go through the dev-server proxy (/api -> :3000). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  listProducts(): Observable<ProductWithListings[]> {
    return this.http
      .get<{ products: ProductWithListings[] }>('/api/products')
      .pipe(map((response) => response.products));
  }

  getProduct(id: number): Observable<ProductWithListings> {
    return this.http.get<ProductWithListings>(`/api/products/${id}`);
  }

  createProduct(url: string): Observable<CreateProductResponse> {
    return this.http.post<CreateProductResponse>('/api/products', { url });
  }

  /** Cross-site product search (cached server-side for 5 minutes). */
  search(query: string): Observable<SearchResponse> {
    return this.http.get<SearchResponse>('/api/search', { params: { q: query } });
  }

  addListing(productId: number, url: string): Observable<AddListingResponse> {
    return this.http.post<AddListingResponse>(`/api/products/${productId}/listings`, { url });
  }

  scrapeListing(listingId: number): Observable<ScrapeListingResponse> {
    return this.http.post<ScrapeListingResponse>(`/api/listings/${listingId}/scrape`, {});
  }

  setListingActive(listingId: number, isActive: boolean): Observable<Listing> {
    return this.http
      .patch<{ listing: Listing }>(`/api/listings/${listingId}`, { isActive })
      .pipe(map((response) => response.listing));
  }

  getPrices(listingId: number, limit = 1000): Observable<PricePoint[]> {
    return this.http
      .get<{ listingId: number; points: PricePoint[] }>(`/api/listings/${listingId}/prices`, {
        params: { limit },
      })
      .pipe(map((response) => response.points));
  }

  listAlerts(listingId: number): Observable<Alert[]> {
    return this.http
      .get<{ listingId: number; alerts: Alert[] }>(`/api/listings/${listingId}/alerts`)
      .pipe(map((response) => response.alerts));
  }

  /** targetPriceMinor is in paise, like everywhere else. */
  createAlert(listingId: number, targetPriceMinor: number, channel: AlertChannel): Observable<Alert> {
    return this.http
      .post<{ alert: Alert }>(`/api/listings/${listingId}/alerts`, { targetPriceMinor, channel })
      .pipe(map((response) => response.alert));
  }

  updateAlert(alertId: number, patch: { targetPriceMinor?: number; channel?: AlertChannel }): Observable<Alert> {
    return this.http
      .patch<{ alert: Alert }>(`/api/alerts/${alertId}`, patch)
      .pipe(map((response) => response.alert));
  }

  deleteAlert(alertId: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`/api/alerts/${alertId}`);
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

/** The parsed JSON error body, when the request failed with one. */
export function apiErrorBody(error: unknown): ApiErrorBody | null {
  return error instanceof HttpErrorResponse && isApiErrorBody(error.error) ? error.error : null;
}

/** Best-effort human-readable message for anything a subscription can receive. */
export function apiErrorMessage(error: unknown): string {
  const body = apiErrorBody(error);
  if (body) return body.error;
  if (error instanceof HttpErrorResponse) {
    return error.status === 0
      ? 'Cannot reach the backend — is it running on the proxy target?'
      : `Request failed (HTTP ${error.status})`;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}
