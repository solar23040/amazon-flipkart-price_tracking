import * as cheerio from 'cheerio';
import { cleanText, parsePriceToMinor } from '../services/normalize.js';
import { fetchPage, fetchPageHttp2 } from './http.js';
import {
  BlockedError,
  NotFoundError,
  ParseError,
  type ScrapedProduct,
  type ScraperAdapter,
  type SearchCandidate,
} from './types.js';

const BLOCKED_MARKERS =
  /Enter the characters you see below|Robot Check|api-services-support@amazon\.|automated access to Amazon data|bm-verify|\/_sec\/verify/i;
const NOT_FOUND_MARKERS = /Page Not Found|we couldn't find that page|Looking for something\?/i;

// Ordered by trustworthiness; the first selector that yields a price wins.
const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#priceblock_saleprice',
  'span.priceToPay .a-offscreen',
  '#tp_price_block_total_price_ww .a-offscreen',
  '.a-price .a-offscreen',
  '#price_inside_buybox',
];

export function amazonMatches(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'amazon.in' || host.endsWith('.amazon.in') || host === 'amazon.com' || host.endsWith('.amazon.com')
    );
  } catch {
    return false;
  }
}

export function amazonExtractExternalId(url: string): string | null {
  const match = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

/** Pure HTML parser, exported separately so tests can run against saved fixtures. */
export function parseAmazonHtml(html: string): ScrapedProduct {
  const $ = cheerio.load(html);
  const title = cleanText($('#productTitle').first().text());

  if (!title) {
    if (BLOCKED_MARKERS.test(html)) throw new BlockedError('Amazon served a bot-check page');
    if (NOT_FOUND_MARKERS.test(html)) throw new NotFoundError('Amazon product page not found');
    throw new ParseError('could not find product title (#productTitle) - page structure may have changed');
  }

  let priceMinor: number | null = null;
  for (const selector of PRICE_SELECTORS) {
    priceMinor = parsePriceToMinor($(selector).first().text());
    if (priceMinor !== null) break;
  }

  const availabilityText = cleanText($('#availability').first().text());
  const inStock = availabilityText
    ? /in stock/i.test(availabilityText) && !/unavailable|out of stock/i.test(availabilityText)
    : $('#add-to-cart-button').length > 0;

  if (priceMinor === null) {
    // Unavailable items legitimately have no price; record 0 and let the UI mark it.
    if (!inStock) return { title, priceMinor: 0, inStock: false, currency: 'INR' };
    throw new ParseError('could not find a price on the page - page structure may have changed');
  }

  return { title, priceMinor, inStock, currency: 'INR' };
}

export const amazonAdapter: ScraperAdapter = {
  site: 'amazon',
  matches: amazonMatches,
  extractExternalId: amazonExtractExternalId,
  fetchPrice: async (url) => parseAmazonHtml(await fetchPage(url)),
  // Amazon's search pages challenge HTTP/1.1 clients (bm-verify interstitial), so use HTTP/2 here.
  search: async (query) => parseAmazonSearchHtml(await fetchPageHttp2(searchUrl(query))),
};

const SEARCH_RESULT_LIMIT = 10;

export function searchUrl(query: string): string {
  return `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
}

/**
 * Pure search-page parser, exported separately so tests can run against saved fixtures.
 * Sponsored results are included; items without a valid ASIN are skipped.
 * Throws BlockedError on a bot-check page, otherwise returns [] rather than throwing.
 */
export function parseAmazonSearchHtml(html: string, limit = SEARCH_RESULT_LIMIT): SearchCandidate[] {
  const $ = cheerio.load(html);
  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  $('.s-result-item[data-asin]').each((_index, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const asin = (item.attr('data-asin') ?? '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return;

    // Cards repeat h2 for brand + title; the longest h2 text is the title.
    const title = item
      .find('h2')
      .toArray()
      .map((heading) => cleanText($(heading).text()))
      .filter((text) => text.length > 0)
      .reduce((best, text) => (text.length > best.length ? text : best), '');
    if (!title) return;

    // Current prices use a plain .a-price; the M.R.P strike-through adds .a-text-price.
    const priceMinor = parsePriceToMinor(item.find('.a-price:not(.a-text-price) .a-offscreen').first().text());
    seen.add(asin);
    results.push({
      site: 'amazon',
      title,
      url: `https://www.amazon.in/dp/${asin}`,
      priceMinor,
      // Search result cards do not say reliably whether the item is in stock.
      inStock: null,
      imageUrl: item.find('img.s-image').first().attr('src') ?? null,
    });
  });

  if (results.length === 0 && BLOCKED_MARKERS.test(html)) {
    throw new BlockedError('Amazon served a bot-check page');
  }
  return results;
}
