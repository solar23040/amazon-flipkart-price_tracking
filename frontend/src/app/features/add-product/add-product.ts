import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { ApiService, apiErrorBody, apiErrorMessage } from '../../core/api';
import type { CreateProductResponse } from '../../core/models';
import { InrPipe } from '../../shared/inr.pipe';

@Component({
  selector: 'app-add-product',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    InrPipe,
  ],
  templateUrl: './add-product.html',
  styleUrl: './add-product.scss',
})
export class AddProduct {
  private readonly api = inject(ApiService);

  protected readonly url = signal('');
  protected readonly submitting = signal(false);
  protected readonly result = signal<CreateProductResponse | null>(null);
  /** productId is set when the failure refers to an already-tracked product (409). */
  protected readonly error = signal<{ message: string; productId: number | null } | null>(null);

  protected onUrlInput(event: Event): void {
    this.url.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const url = this.url().trim();
    if (!url || this.submitting()) return;
    if (!/^https?:\/\//i.test(url)) {
      this.error.set({ message: 'Enter a full product URL starting with http(s)://', productId: null });
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    this.result.set(null);
    this.api.createProduct(url).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.result.set(response);
        this.url.set('');
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set({
          message: apiErrorMessage(err),
          productId: apiErrorBody(err)?.productId ?? null,
        });
      },
    });
  }

  protected reset(): void {
    this.result.set(null);
    this.error.set(null);
  }
}
