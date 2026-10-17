/**
 * Parse a price string like "₹1,299.00" or "Rs. 1,29,900" into minor units (paise).
 * Returns null when no positive number can be found.
 */
export function parsePriceToMinor(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/[\u00a0\s]+/g, ' ').match(/(\d[\d,]*(?:\.\d{1,2})?)/);
  const raw = match?.[1];
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Collapse whitespace in scraped text (titles, availability strings, ...). */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
