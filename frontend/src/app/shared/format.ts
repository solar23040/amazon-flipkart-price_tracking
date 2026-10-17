const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** 89900 paise -> "₹899.00" */
export function formatInrMinor(priceMinor: number): string {
  return inrFormatter.format(priceMinor / 100);
}

/** For chart values that are already in rupees. */
export function formatRupees(amount: number): string {
  return inrFormatter.format(amount);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / full date for older timestamps. */
export function timeAgo(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'never';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 'never';

  const seconds = Math.max(0, Math.round((nowMs - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(iso);
}
