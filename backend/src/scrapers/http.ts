import http2 from 'node:http2';
import { gunzipSync } from 'node:zlib';
import { BlockedError, NetworkError, NotFoundError, ScraperError } from './types.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchPageOptions {
  timeoutMs?: number;
}

/**
 * Fetch a product page as HTML with browser-like headers.
 * Throws typed ScraperErrors so callers can react differently per failure kind.
 */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IN,en;q=0.9',
        'cache-control': 'no-cache',
      },
    });

    if (response.status === 404 || response.status === 410) {
      throw new NotFoundError(`page not found (HTTP ${response.status}): ${url}`);
    }
    if (response.status === 429) {
      throw new BlockedError(`rate limited (HTTP 429): ${url}`);
    }
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof ScraperError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new NetworkError(`timed out after ${timeoutMs}ms: ${url}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new NetworkError(`fetch failed for ${url}: ${message}`);
  }
}

/**
 * Fetch a page over HTTP/2 with the same browser-like headers as fetchPage.
 * Amazon serves a bot-verification interstitial to HTTP/1.1 clients on its
 * search pages (worth trying for other sites that do the same), so search uses this.
 */
export async function fetchPageHttp2(url: string, options: FetchPageOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let current = url;

  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await http2Get(current, timeoutMs);
    if (REDIRECT_STATUSES.has(response.status) && response.location) {
      current = new URL(response.location, current).toString();
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      throw new NotFoundError(`page not found (HTTP ${response.status}): ${current}`);
    }
    if (response.status === 429) {
      throw new BlockedError(`rate limited (HTTP 429): ${current}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new NetworkError(`HTTP ${response.status} for ${current}`);
    }
    return response.body;
  }
  throw new NetworkError(`too many redirects: ${url}`);
}

interface Http2GetResult {
  status: number;
  location: string | undefined;
  body: string;
}

function http2Get(url: string, timeoutMs: number): Promise<Http2GetResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const session = http2.connect(target.origin);
    let settled = false;
    let status = 0;
    let location: string | undefined;
    let contentEncoding: string | undefined;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.destroy();
      reject(error);
    };

    const timer = setTimeout(() => fail(new NetworkError(`timed out after ${timeoutMs}ms: ${url}`)), timeoutMs);
    session.on('error', (error) => fail(new NetworkError(`fetch failed for ${url}: ${error.message}`)));
    session.on('close', () => fail(new NetworkError(`connection closed early for ${url}`)));

    const request = session.request({
      ':method': 'GET',
      ':path': `${target.pathname}${target.search}`,
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-IN,en;q=0.9',
      'accept-encoding': 'identity',
    });
    request.on('error', (error) => fail(new NetworkError(`fetch failed for ${url}: ${error.message}`)));

    request.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
      const rawLocation = headers.location;
      if (typeof rawLocation === 'string') location = rawLocation;
      const rawEncoding = headers['content-encoding'];
      if (typeof rawEncoding === 'string') contentEncoding = rawEncoding;
    });

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      try {
        resolve({ status, location, body: decodeBody(Buffer.concat(chunks), contentEncoding) });
      } catch (error) {
        reject(error instanceof Error ? error : new NetworkError(String(error)));
      }
    });

    request.end();
  });
}

function decodeBody(raw: Buffer, contentEncoding: string | undefined): string {
  if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') return gunzipSync(raw).toString('utf8');
  if (contentEncoding === undefined || contentEncoding === 'identity') return raw.toString('utf8');
  throw new NetworkError(`unsupported content-encoding "${contentEncoding}"`);
}
