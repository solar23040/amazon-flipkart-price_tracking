import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { type Observable, of, throwError } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { ApiService } from '../../core/api';
import type { CreateProductResponse, Product, SearchResponse } from '../../core/models';
import { Search } from './search';

interface FakeSearchApi {
  search: (query: string) => Observable<SearchResponse>;
  createProduct: (url: string) => Observable<CreateProductResponse>;
}

const product: Product = {
  id: 7,
  name: 'boAt Rockerz 255 Pro+',
  canonical_key: null,
  created_at: '2026-10-17T00:00:00.000Z',
};

const sampleResponse: SearchResponse = {
  results: [
    {
      site: 'amazon',
      title: 'boAt Rockerz 255 Pro+',
      url: 'https://www.amazon.in/dp/B08TV2P1N8',
      priceMinor: 89900,
      inStock: null,
    },
    {
      site: 'flipkart',
      title: 'boAt Rockerz 255 Arc',
      url: 'https://www.flipkart.com/boat-rockerz/p/itm1234?pid=ABC123',
      priceMinor: null,
      inStock: null,
    },
  ],
  sites: [
    { site: 'amazon', ok: true },
    { site: 'flipkart', ok: true },
  ],
  cached: false,
};

interface Rendered {
  element: HTMLElement;
  fixture: ComponentFixture<Search>;
  router: Router;
}

async function render(api: FakeSearchApi): Promise<Rendered> {
  TestBed.configureTestingModule({
    imports: [Search],
    providers: [{ provide: ApiService, useValue: api }, provideRouter([])],
  });
  const fixture = TestBed.createComponent(Search);
  await fixture.whenStable();
  return { element: fixture.nativeElement as HTMLElement, fixture, router: TestBed.inject(Router) };
}

/** Types into the search box and waits for the 400ms debounce plus change detection. */
async function type(element: HTMLElement, fixture: ComponentFixture<Search>, value: string): Promise<void> {
  const input = element.querySelector('input');
  if (!input) throw new Error('search input not found');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await sleep(450);
  await fixture.whenStable();
  fixture.detectChanges();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buttonByText(element: HTMLElement, selector: string, text: string): HTMLButtonElement {
  const button = [...element.querySelectorAll<HTMLButtonElement>(selector)].find((candidate) =>
    candidate.textContent?.trim().includes(text),
  );
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Search page', () => {
  it('searches after the debounce and renders results grouped by site', async () => {
    let calls = 0;
    const { element, fixture } = await render({
      search: () => {
        calls++;
        return of(sampleResponse);
      },
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    await type(element, fixture, 'boat');

    expect(calls).toBe(1);
    expect(element.textContent).toContain('Amazon.in');
    expect(element.textContent).toContain('Flipkart');
    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
    expect(element.textContent).toContain('₹899.00');
    // A result without a price still renders, with a dash.
    expect(element.querySelectorAll('.result-card')).toHaveLength(2);
    expect([...element.querySelectorAll('.result-price')].map((node) => node.textContent)).toEqual([
      '₹899.00',
      '—',
    ]);
  });

  it('waits for the debounce before calling the api', async () => {
    let calls = 0;
    const { element, fixture } = await render({
      search: () => {
        calls++;
        return of(sampleResponse);
      },
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    const input = element.querySelector('input');
    if (!input) throw new Error('search input not found');
    input.value = 'boat';
    input.dispatchEvent(new Event('input'));

    await sleep(150);
    expect(calls).toBe(0);
    await sleep(350);
    await fixture.whenStable();
    expect(calls).toBe(1);
  });

  it('filters results with the site chips', async () => {
    const { element, fixture } = await render({
      search: () => of(sampleResponse),
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    await type(element, fixture, 'boat');
    buttonByText(element, '.chips .chip', 'Amazon').click();
    fixture.detectChanges();

    expect(element.querySelectorAll('.result-card')).toHaveLength(1);
    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
    expect(element.textContent).not.toContain('boAt Rockerz 255 Arc');
  });

  it('shows a per-site message when one site is blocked', async () => {
    const { element, fixture } = await render({
      search: () =>
        of({
          ...sampleResponse,
          results: [sampleResponse.results[0]!],
          sites: [
            { site: 'amazon', ok: true },
            { site: 'flipkart', ok: false, error: 'Flipkart served a bot-check page' },
          ],
        }),
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    await type(element, fixture, 'boat');

    expect(element.textContent).toContain("Couldn't load Flipkart results");
    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
  });

  it('shows an empty state when no site has results', async () => {
    const { element, fixture } = await render({
      search: () => of({ results: [], sites: sampleResponse.sites, cached: false }),
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    await type(element, fixture, 'unfindable thing');

    expect(element.textContent).toContain('No results for');
    expect(element.textContent).toContain('No Amazon.in results');
    expect(element.textContent).toContain('No Flipkart results');
  });

  it('shows an error state and retries', async () => {
    let calls = 0;
    const { element, fixture } = await render({
      search: () => {
        calls++;
        return calls === 1
          ? throwError(
              () =>
                new HttpErrorResponse({
                  status: 502,
                  error: { error: 'search failed, try again later' },
                  url: '/api/search',
                }),
            )
          : of(sampleResponse);
      },
      createProduct: () => of({ product, listing: null, latestPrice: null, scrape: null }),
    });

    await type(element, fixture, 'boat');
    expect(element.textContent).toContain('search failed, try again later');

    buttonByText(element, 'button', 'Retry').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toBe(2);
    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
  });

  it('tracks a result and opens the new product page', async () => {
    const { element, fixture, router } = await render({
      search: () => of(sampleResponse),
      createProduct: (url) => {
        expect(url).toBe('https://www.amazon.in/dp/B08TV2P1N8');
        return of({ product, listing: null, latestPrice: null, scrape: null });
      },
    });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await type(element, fixture, 'boat');
    buttonByText(element, '.track-button', 'Track this').click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/products', 7]);
  });

  it('opens the existing product when a result is already tracked (409)', async () => {
    const { element, fixture, router } = await render({
      search: () => of(sampleResponse),
      createProduct: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { error: 'this url is already tracked', listingId: 10, productId: 3 },
              url: '/api/products',
            }),
        ),
    });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await type(element, fixture, 'boat');
    buttonByText(element, '.track-button', 'Track this').click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/products', 3]);
  });
});
