import { Router } from 'express';
import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import { getAdapterForUrl } from '../scrapers/index.js';
import type { Tracker } from '../services/tracker.js';
import { issueList } from './issues.js';

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  url: z.url().optional(),
  canonicalKey: z.string().trim().min(1).max(200).optional(),
});

const addListingSchema = z.object({
  url: z.url(),
  variantNote: z.string().trim().max(200).optional(),
});

const UNSUPPORTED_SITE = 'no scraper adapter matches this url (supported: amazon.in, flipkart.com)';

export function createProductsRouter(repo: Repository, tracker: Tracker): Router {
  const router = Router();

  const withListings = (productId: number) =>
    repo.listListingsByProduct(productId).map((listing) => ({
      ...listing,
      latestPrice: repo.latestPricePoint(listing.id) ?? null,
    }));

  router.get('/', (_req, res) => {
    const products = repo.listProducts().map((product) => ({ ...product, listings: withListings(product.id) }));
    res.json({ products });
  });

  router.post('/', async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body', details: issueList(parsed.error) });
      return;
    }
    const { name, url, canonicalKey } = parsed.data;
    if (!name && !url) {
      res.status(400).json({ error: 'provide at least a name or a url' });
      return;
    }

    let adapter = null;
    if (url) {
      adapter = getAdapterForUrl(url);
      if (!adapter) {
        res.status(400).json({ error: UNSUPPORTED_SITE });
        return;
      }
      const existing = repo.getListingByUrl(url);
      if (existing) {
        res.status(409).json({ error: 'this url is already tracked', listingId: existing.id, productId: existing.product_id });
        return;
      }
    }

    const product = repo.createProduct(name ?? 'New product', canonicalKey ?? null);
    let listing = null;
    let scrape = null;
    if (adapter && url) {
      listing = repo.addListing({
        productId: product.id,
        site: adapter.site,
        url,
        externalId: adapter.extractExternalId(url),
      });
      scrape = await tracker.scrapeListing(listing.id);
      // A product added by URL alone gets the real title from its first scrape.
      if (!name && scrape.ok && scrape.title) repo.renameProduct(product.id, scrape.title);
      listing = repo.getListing(listing.id) ?? listing;
    }

    res.status(201).json({
      product: repo.getProduct(product.id),
      listing,
      latestPrice: listing ? (repo.latestPricePoint(listing.id) ?? null) : null,
      scrape,
    });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid product id' });
      return;
    }
    const product = repo.getProduct(id);
    if (!product) {
      res.status(404).json({ error: 'product not found' });
      return;
    }
    res.json({ ...product, listings: withListings(id) });
  });

  // Add another site's listing to an existing product (this is what drives compare views).
  router.post('/:id/listings', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid product id' });
      return;
    }
    if (!repo.getProduct(id)) {
      res.status(404).json({ error: 'product not found' });
      return;
    }

    const parsed = addListingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body', details: issueList(parsed.error) });
      return;
    }
    const { url, variantNote } = parsed.data;

    const adapter = getAdapterForUrl(url);
    if (!adapter) {
      res.status(400).json({ error: UNSUPPORTED_SITE });
      return;
    }
    if (repo.getListingByUrl(url)) {
      res.status(409).json({ error: 'this url is already tracked' });
      return;
    }

    const listing = repo.addListing({
      productId: id,
      site: adapter.site,
      url,
      externalId: adapter.extractExternalId(url),
      variantNote: variantNote ?? null,
    });
    const scrape = await tracker.scrapeListing(listing.id);

    res.status(201).json({
      listing: repo.getListing(listing.id) ?? listing,
      latestPrice: repo.latestPricePoint(listing.id) ?? null,
      scrape,
    });
  });

  return router;
}
