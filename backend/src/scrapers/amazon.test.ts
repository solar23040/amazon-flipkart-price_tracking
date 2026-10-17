import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amazonAdapter, amazonExtractExternalId, parseAmazonHtml } from './amazon.js';
import { BlockedError, NotFoundError, ParseError } from './types.js';

const fixture = readFileSync(new URL('../../fixtures/amazon/boat-rockerz-255-pro.html', import.meta.url), 'utf8');

describe('amazon adapter', () => {
  it('matches amazon.in and amazon.com product URLs only', () => {
    expect(amazonAdapter.matches('https://www.amazon.in/dp/B08TV2P1N8')).toBe(true);
    expect(amazonAdapter.matches('https://amazon.in/gp/product/B08TV2P1N8')).toBe(true);
    expect(amazonAdapter.matches('https://www.amazon.com/dp/B08TV2P1N8')).toBe(true);
    expect(amazonAdapter.matches('https://www.flipkart.com/some-product/p/itm123')).toBe(false);
  });

  it('extracts the ASIN from common URL shapes', () => {
    expect(amazonExtractExternalId('https://www.amazon.in/dp/B08TV2P1N8')).toBe('B08TV2P1N8');
    expect(amazonExtractExternalId('https://www.amazon.in/gp/product/b08tv2p1n8/ref=sr_1_1?qid=1')).toBe('B08TV2P1N8');
    expect(amazonExtractExternalId('https://www.amazon.in/stores/page/xyz')).toBeNull();
  });

  it('parses a real saved product page', () => {
    const product = parseAmazonHtml(fixture);
    expect(product.title).toContain('boAt Rockerz 255 Pro+');
    expect(product.priceMinor).toBe(89900);
    expect(product.inStock).toBe(true);
    expect(product.currency).toBe('INR');
  });

  it('throws BlockedError on a captcha page', () => {
    const captcha = '<html><body><h4>Enter the characters you see below</h4></body></html>';
    expect(() => parseAmazonHtml(captcha)).toThrow(BlockedError);
  });

  it('throws NotFoundError on a missing product page', () => {
    const notFound = '<html><body><h1>Page Not Found</h1></body></html>';
    expect(() => parseAmazonHtml(notFound)).toThrow(NotFoundError);
  });

  it('throws ParseError when the page is unrecognizable', () => {
    expect(() => parseAmazonHtml('<html><body>hello</body></html>')).toThrow(ParseError);
  });
});
