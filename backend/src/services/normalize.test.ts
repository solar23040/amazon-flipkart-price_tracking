import { describe, expect, it } from 'vitest';
import { cleanText, parsePriceToMinor } from './normalize.js';

describe('parsePriceToMinor', () => {
  it('parses rupee strings with Indian grouping and decimals', () => {
    expect(parsePriceToMinor('₹1,299')).toBe(129900);
    expect(parsePriceToMinor('₹1,29,900.50')).toBe(12990050);
    expect(parsePriceToMinor('Rs. 899.00')).toBe(89900);
    expect(parsePriceToMinor('₹899.00')).toBe(89900);
  });

  it('parses plain numbers', () => {
    expect(parsePriceToMinor('249')).toBe(24900);
  });

  it('returns null for missing or unusable input', () => {
    expect(parsePriceToMinor(null)).toBeNull();
    expect(parsePriceToMinor(undefined)).toBeNull();
    expect(parsePriceToMinor('')).toBeNull();
    expect(parsePriceToMinor('Currently unavailable')).toBeNull();
    expect(parsePriceToMinor('₹0')).toBeNull();
  });
});

describe('cleanText', () => {
  it('collapses whitespace', () => {
    expect(cleanText('  a \n b\t c ')).toBe('a b c');
  });
});
