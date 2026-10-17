import { formatDateTime, formatInrMinor, formatRupees, timeAgo } from './format';

describe('format helpers', () => {
  it('formats paise as INR', () => {
    expect(formatInrMinor(89900)).toBe('₹899.00');
    expect(formatInrMinor(129900)).toBe('₹1,299.00');
  });

  it('formats rupee amounts', () => {
    expect(formatRupees(899)).toBe('₹899.00');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-17T12:00:00.000Z');
    expect(timeAgo('2026-10-17T11:59:30.000Z', now)).toBe('just now');
    expect(timeAgo('2026-10-17T11:45:00.000Z', now)).toBe('15m ago');
    expect(timeAgo('2026-10-17T08:00:00.000Z', now)).toBe('4h ago');
    expect(timeAgo('2026-10-14T12:00:00.000Z', now)).toBe('3d ago');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('not-a-date', now)).toBe('never');
  });

  it('falls back to a full date for bad input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDateTime('2026-10-17T12:00:00.000Z')).not.toBe('—');
  });
});
