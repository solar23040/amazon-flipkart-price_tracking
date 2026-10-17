import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { ApiService, apiErrorMessage } from '../../core/api';
import type { ProductWithListings } from '../../core/models';
import { InrPipe } from '../../shared/inr.pipe';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    InrPipe,
    TimeAgoPipe,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(ApiService);

  /** null while loading. */
  protected readonly products = signal<ProductWithListings[] | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.products.set(null);
    this.error.set(null);
    this.api.listProducts().subscribe({
      next: (products) => this.products.set(products),
      error: (err: unknown) => {
        this.products.set([]);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
