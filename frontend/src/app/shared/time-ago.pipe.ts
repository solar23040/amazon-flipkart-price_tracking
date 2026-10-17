import { Pipe, type PipeTransform } from '@angular/core';
import { timeAgo } from './format';

/** Formats an ISO timestamp as relative time, e.g. "3h ago". */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return timeAgo(iso ?? null);
  }
}
