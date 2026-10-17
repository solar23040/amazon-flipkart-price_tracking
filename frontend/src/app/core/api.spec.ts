import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiService, apiErrorBody, apiErrorMessage } from './api';
import type { ProductWithListings, SearchResponse } from './models';

const sampleProduct: ProductWithListings = {
  id: 1,
  name: 'boAt Rockerz 255 Pro+',
  canonical_key: null,
  created_at: '2026-10-16T00:00:00.000Z',
  listings: [
    {
      id: 10,
      product_id: 1,
      site: 'amazon',
      url: 'https://www.amazon.in/dp/B08TV2P1N8',
      external_id: 'B08TV2P1N8',
      variant_note: null,
      is_active: true,
      fail_count: 0,
      last_scraped_at: '2026-10-17T00:00:00.000Z',
      latestPrice: {
        id: 100,
        listing_id: 10,
        price_minor: 89900,
        currency: 'INR',
        in_stock: true,
        scraped_at: '2026-10-17T00:00:00.000Z',
      },
    },
  ],
};

describe('ApiService', () => {
  let service: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('unwraps the products list', () => {
    let result: ProductWithListings[] | undefined;
    service.listProducts().subscribe((products) => (result = products));

    const request = http.expectOne('/api/products');
    expect(request.request.method).toBe('GET');
    request.flush({ products: [sampleProduct] });

    expect(result).toEqual([sampleProduct]);
  });

  it('posts a url when creating a product', () => {
    service.createProduct('https://www.amazon.in/dp/B08TV2P1N8').subscribe();

    const request = http.expectOne('/api/products');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ url: 'https://www.amazon.in/dp/B08TV2P1N8' });
    request.flush({ product: sampleProduct, listing: null, latestPrice: null, scrape: null });
  });

  it('requests price history with a limit', () => {
    service.getPrices(10, 250).subscribe();

    const request = http.expectOne((req) => req.url === '/api/listings/10/prices');
    expect(request.request.params.get('limit')).toBe('250');
    request.flush({ listingId: 10, points: [] });
  });

  it('requests a cross-site search with the query param', () => {
    let result: SearchResponse | undefined;
    service.search('boat rockerz').subscribe((response) => (result = response));

    const request = http.expectOne((req) => req.url === '/api/search');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('q')).toBe('boat rockerz');
    request.flush({ results: [], sites: [{ site: 'amazon', ok: true }], cached: false });

    expect(result?.sites).toEqual([{ site: 'amazon', ok: true }]);
  });
});

describe('apiErrorMessage', () => {
  it('extracts the backend error text and extra fields', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { error: 'this url is already tracked', listingId: 7, productId: 3 },
      url: '/api/products',
    });
    expect(apiErrorMessage(error)).toBe('this url is already tracked');
    expect(apiErrorBody(error)?.productId).toBe(3);
  });

  it('explains connection failures', () => {
    const error = new HttpErrorResponse({ status: 0, url: '/api/products' });
    expect(apiErrorMessage(error)).toContain('Cannot reach the backend');
  });

  it('falls back to a status code for unknown error bodies', () => {
    const error = new HttpErrorResponse({ status: 500, error: '<html>oops</html>', url: '/api/products' });
    expect(apiErrorMessage(error)).toBe('Request failed (HTTP 500)');
  });

  it('handles non-http errors', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('boom');
    expect(apiErrorMessage('weird')).toBe('Unexpected error');
  });
});
