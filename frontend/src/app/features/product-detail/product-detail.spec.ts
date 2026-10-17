import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { type Observable, of, throwError } from 'rxjs';
import { ApiService } from '../../core/api';
import type { Alert, AlertChannel, PricePoint, ProductWithListings } from '../../core/models';
import { ProductDetail } from './product-detail';

interface FakeApi {
  getProduct: () => Observable<ProductWithListings>;
  getPrices: (listingId: number) => Observable<PricePoint[]>;
  listAlerts: (listingId: number) => Observable<Alert[]>;
  createAlert: (listingId: number, targetPriceMinor: number, channel: AlertChannel) => Observable<Alert>;
  deleteAlert: (alertId: number) => Observable<{ deleted: boolean }>;
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
  ],
};

interface RenderResult {
  element: HTMLElement;
  fixture: ReturnType<typeof TestBed.createComponent<ProductDetail>>;
}

async function render(fake: FakeApi): Promise<RenderResult> {
  TestBed.configureTestingModule({
    imports: [ProductDetail],
    providers: [
      { provide: ApiService, useValue: fake },
      provideRouter([]),
      // After provideRouter, so this stub wins over the real (param-less) ActivatedRoute.
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: '1' }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(ProductDetail);
  await fixture.whenStable();
  return { element: fixture.nativeElement as HTMLElement, fixture };
}

function baseFake(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getProduct: () => of(product),
    getPrices: () => of([]),
    listAlerts: () => of([]),
    createAlert: () => throwError(() => new Error('not stubbed')),
    deleteAlert: () => throwError(() => new Error('not stubbed')),
    ...overrides,
  };
}

describe('ProductDetail alerts', () => {
  it('lists alerts with target, channel, trigger state and a reached badge', async () => {
    const alerts: Alert[] = [
      { id: 1, listing_id: 10, target_price_minor: 99900, channel: 'telegram', last_triggered_at: null },
      { id: 2, listing_id: 10, target_price_minor: 50000, channel: 'email', last_triggered_at: '2026-10-17T09:00:00.000Z' },
    ];
    const { element } = await render(baseFake({ listAlerts: () => of(alerts) }));

    expect(element.querySelectorAll('.alert-row')).toHaveLength(2);
    const first = element.querySelectorAll('.alert-row')[0];
    expect(first?.textContent).toContain('telegram');
    expect(first?.textContent).toContain('₹999.00');
    expect(first?.textContent).toContain('not triggered yet');
    // 89900 < 99900, so the first alert's target is reached; the second one (50000) is not.
    expect(first?.querySelector('.badge.reached')).not.toBeNull();
    const second = element.querySelectorAll('.alert-row')[1];
    expect(second?.textContent).toContain('email');
    expect(second?.textContent).toContain('triggered');
    expect(second?.querySelector('.badge.reached')).toBeNull();
  });

  it('shows the empty state when a listing has no alerts', async () => {
    const { element } = await render(baseFake());
    expect(element.textContent).toContain('No alerts yet');
  });

  it('creates an alert from the inline form, converting rupees to paise', async () => {
    let alerts: Alert[] = [];
    const created: Array<{ listingId: number; targetPriceMinor: number; channel: AlertChannel }> = [];
    const fake = baseFake({
      listAlerts: () => of([...alerts]),
      createAlert: (listingId, targetPriceMinor, channel) => {
        created.push({ listingId, targetPriceMinor, channel });
        const alert: Alert = { id: 7, listing_id: listingId, target_price_minor: targetPriceMinor, channel, last_triggered_at: null };
        alerts = [alert];
        return of(alert);
      },
    });
    const { element, fixture } = await render(fake);

    const input = element.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input).not.toBeNull();
    if (input) {
      input.value = '900';
      input.dispatchEvent(new Event('input'));
    }
    element.querySelector<HTMLFormElement>('form.alert-form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(created).toEqual([{ listingId: 10, targetPriceMinor: 90000, channel: 'telegram' }]);
    expect(element.querySelectorAll('.alert-row')).toHaveLength(1);
    expect(element.textContent).toContain('₹900.00');
  });

  it('rejects an invalid target without calling the api', async () => {
    const created: Array<unknown> = [];
    const fake = baseFake({
      createAlert: () => {
        created.push(true);
        return throwError(() => new Error('should not be called'));
      },
    });
    const { element, fixture } = await render(fake);

    element.querySelector<HTMLFormElement>('form.alert-form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(created).toHaveLength(0);
    expect(element.textContent).toContain('greater than zero');
  });

  it('deletes an alert and refreshes the list', async () => {
    let alerts: Alert[] = [
      { id: 3, listing_id: 10, target_price_minor: 99900, channel: 'telegram', last_triggered_at: null },
    ];
    const deleted: number[] = [];
    const fake = baseFake({
      listAlerts: () => of([...alerts]),
      deleteAlert: (alertId) => {
        deleted.push(alertId);
        alerts = [];
        return of({ deleted: true });
      },
    });
    const { element, fixture } = await render(fake);

    element.querySelector<HTMLButtonElement>('.alert-row button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(deleted).toEqual([3]);
    expect(element.querySelectorAll('.alert-row')).toHaveLength(0);
    expect(element.textContent).toContain('No alerts yet');
  });

  it('keeps rendering when loading alerts fails', async () => {
    const { element } = await render(baseFake({ listAlerts: () => throwError(() => new Error('offline')) }));
    expect(element.textContent).toContain('boAt Rockerz 255 Pro+');
    expect(element.querySelectorAll('.alert-row')).toHaveLength(0);
  });
});
