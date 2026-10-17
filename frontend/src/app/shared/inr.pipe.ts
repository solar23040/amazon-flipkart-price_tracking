import { Pipe, type PipeTransform } from '@angular/core';
import { formatInrMinor } from './format';

/** Formats a paise amount as Indian rupees, e.g. 89900 -> "₹899.00". */
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(priceMinor: number | null | undefined): string {
    return priceMinor == null ? '—' : formatInrMinor(priceMinor);
  }
}
