import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <mat-card appearance="outlined" class="notice-card rise-in">
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <a matButton="filled" routerLink="/">Back to dashboard</a>
    </mat-card>
  `,
  styles: `
    .notice-card {
      max-width: 460px;
      margin: 4rem auto 0;
      text-align: center;
      padding: 2.75rem 1.75rem 2.25rem;
      border-radius: var(--mat-sys-corner-large, 16px);

      h1 {
        margin: 0 0 0.4rem;
        font-size: 1.5rem;
        letter-spacing: -0.015em;
        line-height: 1.25;
      }

      p {
        margin: 0 0 1.1rem;
        line-height: 1.55;
      }
    }
  `,
})
export class NotFound {}
