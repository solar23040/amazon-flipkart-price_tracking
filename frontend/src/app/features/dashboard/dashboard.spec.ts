import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type Observable, of, throwError } from 'rxjs';
import { ApiService } from '../../core/api';
import type { ProductWithListings } from '../../core/models';
import { Dashboard } from './dashboard';

function fakeApi(listProducts: () => Observable<ProductWithListings[]>): Pick<ApiService, 'listProducts'> {
  return { listProducts };
}

const product: ProductWithListings = {
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
    {
      id: 11,
      product_id: 1,
      site: 'flipkart',
      url: 'https://www.flipkart.com/x/p/itm123',
      external_id: null,
      variant_note: null,
      is_active: false,
      fail_count: 5,
      last_scraped_at: null,
      latestPrice: null,
    },
  ],
};

async function render(source: Observable<ProductWithListings[]>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [{ provide: ApiService, useValue: fakeApi(() => source) }, provideRouter([])],
  });
  const fixture = TestBed.createComponent(Dashboard);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Dashboard', () => {
  it('shows the empty state when no products are tracked', async () => {
    const element = await render(of([]));
    expect(element.textContent).toContain('No products yet');
    expect(element.querySelector('.grid')).toBeNull();
  });

  it('renders listings with formatted prices and a paused badge', async () => {
    const element = await render(of([product]));

    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
    expect(element.textContent).toContain('₹899.00');
    expect(element.textContent).toContain('in stock');
    expect(element.textContent).toContain('no price yet');
    expect(element.querySelector('.badge.paused')?.textContent).toContain('Paused');
    expect(element.querySelectorAll('.listing-row')).toHaveLength(2);
  });

  it('shows an error card when the request fails', async () => {
    const element = await render(
      throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' }, url: '/api/products' })),
    );
    expect(element.textContent).toContain('boom');
    expect(element.textContent).toContain('Retry');
    expect(element.textContent).not.toContain('No products yet');
  });
});
