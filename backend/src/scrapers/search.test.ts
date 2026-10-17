import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAmazonSearchHtml } from './amazon.js';
import { parseFlipkartSearchHtml, normalizeFlipkartProductHref } from './flipkart.js';
import { searchAll } from './index.js';
import { BlockedError, type ScraperAdapter, type SearchCandidate, type Site } from './types.js';

const amazonHtml = readFileSync(new URL('../../fixtures/amazon/search-boat-rockerz.html', import.meta.url), 'utf8');
const flipkartHtml = readFileSync(new URL('../../fixtures/flipkart/search-boat-rockerz.html', import.meta.url), 'utf8');

describe('amazon search parser', () => {
  it('parses product cards from a real saved search page', () => {
    const results = parseAmazonSearchHtml(amazonHtml);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    for (const candidate of results) {
      expect(candidate.site).toBe('amazon');
      expect(candidate.title.length).toBeGreaterThan(0);
      expect(candidate.url).toMatch(/^https:\/\/www\.amazon\.in\/dp\/[A-Z0-9]{10}$/);
      expect(candidate.inStock).toBeNull();
    }

    const rockerz = results.find((candidate) => candidate.url.endsWith('B08TV2P1N8'));
    expect(rockerz?.title).toContain('Rockerz 255 Pro+');
    expect(rockerz?.priceMinor).toBe(89900);
  });

  it('never returns duplicate urls', () => {
    const results = parseAmazonSearchHtml(amazonHtml);
    expect(new Set(results.map((candidate) => candidate.url)).size).toBe(results.length);
  });

  it('respects the result limit', () => {
    expect(parseAmazonSearchHtml(amazonHtml, 2)).toHaveLength(2);
  });

  it('throws BlockedError on a captcha page and returns [] on unrecognizable html', () => {
    expect(() => parseAmazonSearchHtml('<html><body>Enter the characters you see below</body></html>')).toThrow(
      BlockedError,
    );
    // The bm-verify interstitial shown to HTTP/1.1 clients.
    const interstitial =
      '<html><head><meta http-equiv="refresh" content="5; URL=\'/s?k=x&bm-verify=AAQAAAAO\'"></head><body></body></html>';
    expect(() => parseAmazonSearchHtml(interstitial)).toThrow(BlockedError);
    expect(parseAmazonSearchHtml('<html><body>hello</body></html>')).toEqual([]);
  });
});

describe('flipkart search parser', () => {
  it('parses product cards from a real saved search page', () => {
    const results = parseFlipkartSearchHtml(flipkartHtml);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    for (const candidate of results) {
      expect(candidate.site).toBe('flipkart');
      expect(candidate.title.length).toBeGreaterThan(0);
      expect(candidate.url).toMatch(/^https:\/\/www\.flipkart\.com\/.+\/p\/[a-z0-9]+\?pid=/i);
      expect(candidate.priceMinor).not.toBeNull();
    }

    const first = results[0];
    expect(first?.title).toContain('boAt Rockerz 255 Pro+');
    expect(first?.priceMinor).toBe(89900);
  });

  it('drops session-specific tracking params but keeps pid', () => {
    const url = normalizeFlipkartProductHref(
      '/boat-rockerz/p/itm1234?pid=ABC123&lid=LSTABC&ssid=abc123&iid=tracking-value',
    );
    expect(url).toBe('https://www.flipkart.com/boat-rockerz/p/itm1234?pid=ABC123');
    expect(normalizeFlipkartProductHref('https://example.com/p/itm1234?pid=ABC')).toBeNull();
    expect(normalizeFlipkartProductHref(undefined)).toBeNull();
  });

  it('throws BlockedError on a bot-check page and returns [] on unrecognizable html', () => {
    expect(() => parseFlipkartSearchHtml('<html><body>Access Denied</body></html>')).toThrow(BlockedError);
    expect(parseFlipkartSearchHtml('<html><body>hello</body></html>')).toEqual([]);
  });
});

function fakeAdapter(
  site: Site,
  search?: (query: string) => Promise<SearchCandidate[]>,
): ScraperAdapter {
  return {
    site,
    matches: (url) => url.includes(site === 'amazon' ? 'amazon.in' : 'flipkart.com'),
    extractExternalId: () => null,
    fetchPrice: async () => ({ title: 'x', priceMinor: 100, inStock: true, currency: 'INR' }),
    ...(search ? { search } : {}),
  };
}

const amazonCandidate: SearchCandidate = {
  site: 'amazon',
  title: 'boAt Rockerz 255 Pro+',
  url: 'https://www.amazon.in/dp/B08TV2P1N8',
  priceMinor: 89900,
  inStock: null,
};

const flipkartCandidate: SearchCandidate = {
  site: 'flipkart',
  title: 'boAt Rockerz 255 Pro+',
  url: 'https://www.flipkart.com/boat-rockerz/p/itm1234?pid=ABC123',
  priceMinor: 89900,
  inStock: null,
};

describe('searchAll', () => {
  it('merges results and drops duplicates plus foreign urls', async () => {
    const result = await searchAll('boat', [
      fakeAdapter('amazon', async () => [
        amazonCandidate,
        { ...amazonCandidate }, // duplicate url
        flipkartCandidate, // wrong site for this adapter - must be dropped
      ]),
      fakeAdapter('flipkart', async () => [flipkartCandidate]),
    ]);

    expect(result.results.map((candidate) => candidate.url)).toEqual([amazonCandidate.url, flipkartCandidate.url]);
    expect(result.sites).toEqual([
      { site: 'amazon', ok: true },
      { site: 'flipkart', ok: true },
    ]);
  });

  it('keeps the other site results when one site is blocked', async () => {
    const result = await searchAll('boat', [
      fakeAdapter('amazon', async () => [amazonCandidate]),
      fakeAdapter('flipkart', async () => {
        throw new BlockedError('Flipkart served a bot-check page');
      }),
    ]);

    expect(result.results).toEqual([amazonCandidate]);
    expect(result.sites).toEqual([
      { site: 'amazon', ok: true },
      { site: 'flipkart', ok: false, error: 'Flipkart served a bot-check page' },
    ]);
  });

  it('skips adapters without search support', async () => {
    const result = await searchAll('boat', [
      fakeAdapter('amazon', async () => [amazonCandidate]),
      fakeAdapter('flipkart'),
    ]);

    expect(result.sites).toEqual([{ site: 'amazon', ok: true }]);
    expect(result.results).toEqual([amazonCandidate]);
  });
});
