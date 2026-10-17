import * as cheerio from 'cheerio';
import { cleanText, parsePriceToMinor } from '../services/normalize.js';
import { fetchPage } from './http.js';
import {
  BlockedError,
  ParseError,
  type ScrapedProduct,
  type ScraperAdapter,
  type SearchCandidate,
} from './types.js';

const BLOCKED_MARKERS = /Access Denied|Oops! Something went wrong|verify you are a human|enter the characters/i;

export function flipkartMatches(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'flipkart.com' || host.endsWith('.flipkart.com');
  } catch {
    return false;
  }
}

export function flipkartExtractExternalId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pid = parsed.searchParams.get('pid');
    if (pid) return pid;
    return parsed.pathname.match(/\/p\/([a-z0-9]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the JSON assigned to window.__INITIAL_STATE__ with a brace-balanced scan
 * (a regex cannot handle the nested quotes/braces in that payload).
 */
export function extractInitialState(html: string): unknown | null {
  const marker = html.indexOf('__INITIAL_STATE__');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function getPath(value: unknown, ...keys: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPositiveAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Pure HTML parser, exported separately so tests can run against saved fixtures.
 * Order of trust: __INITIAL_STATE__ JSON -> inline "finalPrice" in raw HTML -> h1 title.
 */
export function parseFlipkartHtml(html: string): ScrapedProduct {
  const state = extractInitialState(html);
  const psi = getPath(state, 'multiWidgetState', 'pageDataResponse', 'pageContext', 'fdpEventTracking', 'events', 'psi');

  const title =
    asNonEmptyString(getPath(state, 'multiWidgetState', 'pageDataResponse', 'seoData', 'schema', 0, 'name')) ??
    asNonEmptyString(
      getPath(
        state,
        'multiWidgetState',
        'widgetsData',
        'slots',
        0,
        'slotData',
        'widget',
        'data',
        'dlsData',
        'label_2',
        'value',
        'text',
      ),
    ) ??
    cleanText(cheerio.load(html)('h1').first().text()).replace(/\.\.\.more$/, '');

  let priceMinor = asPositiveAmount(getPath(psi, 'ppd', 'finalPrice')) ?? asPositiveAmount(getPath(psi, 'ppd', 'fsp'));
  if (priceMinor === null) {
    // The same values also appear inline in the raw HTML; a regex survives minor shape changes.
    const match = html.match(/"finalPrice":(\d+(?:\.\d+)?)/) ?? html.match(/"fsp":(\d+(?:\.\d+)?)/);
    if (match?.[1]) priceMinor = asPositiveAmount(match[1]);
  }

  const statusCandidate = getPath(psi, 'availabilityStatus') ?? getPath(psi, 'pls');
  const availabilityStatus =
    asNonEmptyString(statusCandidate) ?? html.match(/"availabilityStatus":"([A-Z_]+)"/)?.[1];
  const inStock =
    availabilityStatus !== undefined
      ? availabilityStatus === 'IN_STOCK'
      : priceMinor !== null && !/sold out|out of stock/i.test(html);

  if (!title) {
    if (BLOCKED_MARKERS.test(html)) throw new BlockedError('Flipkart served a bot-check page');
    throw new ParseError('could not find product title - page structure may have changed');
  }

  if (priceMinor === null) {
    if (!inStock) return { title, priceMinor: 0, inStock: false, currency: 'INR' };
    throw new ParseError('could not find a price on the page - page structure may have changed');
  }

  // priceMinor is rupees from Flipkart's state; store paise like everywhere else.
  return { title, priceMinor: Math.round(priceMinor * 100), inStock, currency: 'INR' };
}

export const flipkartAdapter: ScraperAdapter = {
  site: 'flipkart',
  matches: flipkartMatches,
  extractExternalId: flipkartExtractExternalId,
  fetchPrice: async (url) => parseFlipkartHtml(await fetchPage(url)),
  search: async (query) => parseFlipkartSearchHtml(await fetchPage(flipkartSearchUrl(query))),
};

const SEARCH_RESULT_LIMIT = 10;

export function flipkartSearchUrl(query: string): string {
  return `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
}

/** First "₹1,299" style price in a chunk of text, as paise. */
function firstRupeePrice(text: string): number | null {
  const match = text.replace(/\s+/g, ' ').match(/₹\s?[\d,]+(?:\.\d{1,2})?/);
  return match ? parsePriceToMinor(match[0]) : null;
}

/**
 * Turn a search-result href into a stable product URL, dropping session-specific
 * tracking params but keeping ?pid=. Returns null for anything off-site or not a product.
 */
export function normalizeFlipkartProductHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://www.flipkart.com');
    if (url.hostname !== 'flipkart.com' && !url.hostname.endsWith('.flipkart.com')) return null;
    if (!/\/p\/[a-z0-9]+/i.test(url.pathname)) return null;
    const pid = url.searchParams.get('pid');
    url.hash = '';
    url.search = '';
    if (pid) url.searchParams.set('pid', pid);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Pure search-page parser, exported separately so tests can run against saved fixtures.
 * Each product card carries a data-id (the product pid) and at least one /p/ link.
 * Throws BlockedError on a bot-check page, otherwise returns [] rather than throwing.
 */
export function parseFlipkartSearchHtml(html: string, limit = SEARCH_RESULT_LIMIT): SearchCandidate[] {
  const $ = cheerio.load(html);
  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  $('a[href*="/p/"]').each((_index, element) => {
    if (results.length >= limit) return false;
    const anchor = $(element);
    const url = normalizeFlipkartProductHref(anchor.attr('href'));
    if (!url || seen.has(url)) return;

    // The containing card (data-id = product pid) also holds the price, outside the link.
    const card = anchor.closest('div[data-id]');
    const container = card.length > 0 ? card : anchor;

    const imageAlt = cleanText(container.find('img[alt]').first().attr('alt') ?? '');
    const title =
      imageAlt ||
      container
        .find('div, span, a')
        .toArray()
        .map((node) => cleanText($(node).text()))
        .find((text) => text.length >= 15 && !text.includes('₹')) ||
      cleanText(anchor.text());
    if (!title) return;

    seen.add(url);
    results.push({
      site: 'flipkart',
      title,
      url,
      priceMinor: firstRupeePrice(container.text()),
      inStock: null,
      imageUrl: container.find('img').first().attr('src') ?? null,
    });
  });

  if (results.length === 0 && BLOCKED_MARKERS.test(html)) {
    throw new BlockedError('Flipkart served a bot-check page');
  }
  return results;
}
