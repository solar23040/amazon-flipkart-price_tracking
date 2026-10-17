import { amazonAdapter } from './amazon.js';
import { flipkartAdapter } from './flipkart.js';
import type { ScraperAdapter, SearchCandidate, Site } from './types.js';

/** All registered adapters. Add new sites here; nothing else needs to change. */
export const adapters: ScraperAdapter[] = [amazonAdapter, flipkartAdapter];

export function getAdapterForUrl(url: string): ScraperAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}

export function getAdapter(site: Site): ScraperAdapter | null {
  return adapters.find((adapter) => adapter.site === site) ?? null;
}

/** How one site fared during a search; ok=false means blocked / unreachable, not "no results". */
export interface SiteSearchStatus {
  site: Site;
  ok: boolean;
  error?: string;
}

export interface SearchAllResult {
  results: SearchCandidate[];
  sites: SiteSearchStatus[];
}

type SearchCapableAdapter = ScraperAdapter & { search: (query: string) => Promise<SearchCandidate[]> };

function isSearchCapable(adapter: ScraperAdapter): adapter is SearchCapableAdapter {
  return typeof adapter.search === 'function';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'search failed';
}

/**
 * Runs every search-capable adapter in parallel. One site failing (blocked, timeout, ...)
 * never fails the rest: its failure is reported in `sites` instead.
 */
export async function searchAll(
  query: string,
  adapterList: ScraperAdapter[] = adapters,
): Promise<SearchAllResult> {
  const searchers = adapterList.filter(isSearchCapable);
  const settled = await Promise.allSettled(searchers.map((adapter) => adapter.search(query)));

  const results: SearchCandidate[] = [];
  const sites: SiteSearchStatus[] = [];
  const seenUrls = new Set<string>();

  settled.forEach((outcome, index) => {
    const adapter = searchers[index];
    if (!adapter) return;
    if (outcome.status === 'rejected') {
      sites.push({ site: adapter.site, ok: false, error: errorMessage(outcome.reason) });
      return;
    }
    sites.push({ site: adapter.site, ok: true });
    for (const candidate of outcome.value) {
      // Never trust a foreign URL: it must belong to the site that produced it.
      if (seenUrls.has(candidate.url) || getAdapterForUrl(candidate.url)?.site !== adapter.site) continue;
      seenUrls.add(candidate.url);
      results.push(candidate);
    }
  });

  return { results, sites };
}
