import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractInitialState, flipkartAdapter, flipkartExtractExternalId, parseFlipkartHtml } from './flipkart.js';
import { BlockedError, ParseError } from './types.js';

const fixture = readFileSync(new URL('../../fixtures/flipkart/boat-rockerz-255-pro.html', import.meta.url), 'utf8');

describe('flipkart adapter', () => {
  it('matches flipkart.com URLs only', () => {
    expect(flipkartAdapter.matches('https://www.flipkart.com/x/p/itm123')).toBe(true);
    expect(flipkartAdapter.matches('https://flipkart.com/x/p/itm123')).toBe(true);
    expect(flipkartAdapter.matches('https://www.amazon.in/dp/B08TV2P1N8')).toBe(false);
  });

  it('extracts the product id from query or path', () => {
    expect(
      flipkartExtractExternalId('https://www.flipkart.com/x/p/itm123?pid=ACCFZ95MTQSX7NFD'),
    ).toBe('ACCFZ95MTQSX7NFD');
    expect(flipkartExtractExternalId('https://www.flipkart.com/x/p/itmd77038e81de30')).toBe('itmd77038e81de30');
  });

  it('extracts the initial state JSON with a balanced-brace scan', () => {
    const state = extractInitialState('<script>window.__INITIAL_STATE__ = {"a":{"b":"x}"},"c":1};</script>');
    expect(state).toEqual({ a: { b: 'x}' }, c: 1 });
    expect(extractInitialState('<html>no state here</html>')).toBeNull();
  });

  it('parses a real saved product page', () => {
    const product = parseFlipkartHtml(fixture);
    expect(product.title).toContain('boAt Rockerz 255 Pro+');
    expect(product.priceMinor).toBe(89900);
    expect(product.inStock).toBe(true);
    expect(product.currency).toBe('INR');
  });

  it('falls back to the inline finalPrice when the state JSON is missing', () => {
    const html =
      '<html><body><h1>Some Product</h1>"finalPrice":1249,"availabilityStatus":"IN_STOCK"</body></html>';
    const product = parseFlipkartHtml(html);
    expect(product.title).toBe('Some Product');
    expect(product.priceMinor).toBe(124900);
    expect(product.inStock).toBe(true);
  });

  it('throws BlockedError when Flipkart serves a bot-check page', () => {
    expect(() => parseFlipkartHtml('<html><body>Something went wrong. Access Denied</body></html>')).toThrow(
      BlockedError,
    );
  });

  it('throws ParseError when neither state nor price can be found', () => {
    expect(() => parseFlipkartHtml('<html><body>hello</body></html>')).toThrow(ParseError);
  });
});
