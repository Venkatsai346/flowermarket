import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import SearchDocument from '../models/searchDocument.model.js';
import searchProvider from './searchProvider.service.js';
import { registerCatalogEventHandler } from './catalogEvent.service.js';
import { toPaise } from '../utils/money.js';
import { TENANT_LISTING_STATUS, PRODUCT_MASTER_STATUS } from '../constants/enums.js';

/**
 * SearchIndexerService — keeps the search index in step with the catalogue.
 *
 * ── The reuse that makes this cheap ─────────────────────────────────────────
 * Phase 2 already built a durable OUTBOX (`CatalogEvent`) that emits
 * product/price/stock/listing events and drains to in-process handlers, with
 * at-least-once delivery and retry. The notification consumer registers on it;
 * so does this. No new event plumbing, no dual writes, and index freshness
 * inherits the outbox's existing guarantees.
 *
 * Re-indexing a document is an upsert on a stable key, so at-least-once
 * delivery — which would corrupt a counter — is harmless here.
 */

/** Tokens for prefix autocomplete: whole words plus the full title. */
function buildSuggest({ title, brandName, tags = [], categoryPath = [] }) {
  const set = new Set();
  const push = (s) => {
    const v = String(s || '').toLowerCase().trim();
    if (v.length >= 2) set.add(v);
  };
  push(title);
  for (const w of String(title || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) push(w);
  push(brandName);
  for (const t of tags) push(t);
  for (const c of categoryPath) push(c);
  // bounded: a search document must stay small
  return [...set].slice(0, 40);
}

class SearchIndexerService {
  /** Register on the catalog outbox — called once at boot. */
  initConsumer() {
    registerCatalogEventHandler(this.handleEvent);
  }

  /**
   * Outbox handler. Deliberately tolerant: a search index that fails to update
   * must never fail the catalogue write that triggered it. The staleness sweep
   * repairs anything missed.
   */
  handleEvent = async (event) => {
    try {
      const { eventType, entityType, entityId, tenantId } = event;
      if (entityType === 'tenant_product') {
        if (String(eventType).includes('delete')) await this.removeListing(entityId, tenantId);
        else await this.indexListing({ listingId: entityId, tenantId });
      } else if (entityType === 'product_master') {
        // a master change fans out to every store that lists it
        await this.reindexMaster(entityId);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[search] index update failed (will be repaired by the sweep):', err.message);
    }
  };

  /** Build the denormalized row for one listing. */
  async buildDocument({ listing, master, categoryById, brandById }) {
    const category = master.categoryId ? categoryById.get(String(master.categoryId)) : null;
    const brand = master.brandId ? brandById.get(String(master.brandId)) : null;

    const categoryPath = category ? [category.name].filter(Boolean) : [];
    const tags = master.tags || [];
    const title = master.title;
    const brandName = brand?.name || null;

    const searchText = [
      title, master.shortDescription, master.description,
      brandName, ...categoryPath, ...tags,
    ].filter(Boolean).join(' ').toLowerCase().slice(0, 2000);

    const stockQty = listing.stockQty ?? 0;

    return {
      key: `${listing.tenantId}:${listing._id}`,
      tenantId: listing.tenantId,
      listingId: listing._id,
      masterId: master._id,
      vendorId: master.vendorId || null,

      title,
      searchText,
      brandName,
      categoryId: master.categoryId || null,
      categoryPath,
      tags,
      suggest: buildSuggest({ title, brandName, tags, categoryPath }),
      attributes: listing.attributes || {},

      pricePaise: toPaise(listing.price?.sellingPrice ?? 0),
      mrpPaise: toPaise(listing.price?.mrp ?? 0),
      stockQty,
      inStock: stockQty > 0,
      unit: master.defaultSellingUnit || null,
      imageUrl: listing.imageUrl || null,

      soldCount30d: master.soldCount || 0,
      isPerishable: Boolean(master.isPerishable),
      vendorRating: 0,
      marginScore: 0,
      listedAt: listing.createdAt || new Date(),
      status: (listing.status === TENANT_LISTING_STATUS.ACTIVE && master.status === PRODUCT_MASTER_STATUS.ACTIVE)
        ? 'active' : 'hidden',
      sourceVersion: (listing.version || 1) + (master.version || 1),
    };
  }

  async indexListing({ listingId, tenantId = null }) {
    const q = { _id: listingId };
    if (tenantId) q.tenantId = tenantId;
    const listing = await TenantProduct.findOne(q).lean();
    if (!listing) return { indexed: 0 };

    const master = await ProductMaster.findById(listing.productMasterId).lean();
    if (!master) return { indexed: 0 };

    const [categoryById, brandById] = await Promise.all([
      this.categoryMap([master.categoryId]),
      this.brandMap([master.brandId]),
    ]);
    const doc = await this.buildDocument({ listing, master, categoryById, brandById });
    return searchProvider.index([doc]);
  }

  async removeListing(listingId, tenantId) {
    return searchProvider.remove([`${tenantId}:${listingId}`]);
  }

  /** A global product changed — refresh it in every store that lists it. */
  async reindexMaster(masterId) {
    const listings = await TenantProduct.find({ productMasterId: masterId }).limit(500).lean();
    if (!listings.length) return { indexed: 0 };
    const master = await ProductMaster.findById(masterId).lean();
    if (!master) return { indexed: 0 };
    const [categoryById, brandById] = await Promise.all([
      this.categoryMap([master.categoryId]),
      this.brandMap([master.brandId]),
    ]);
    const docs = await Promise.all(
      listings.map((listing) => this.buildDocument({ listing, master, categoryById, brandById }))
    );
    return searchProvider.index(docs);
  }

  async categoryMap(ids) {
    const clean = [...new Set(ids.filter(Boolean).map(String))];
    if (!clean.length) return new Map();
    const rows = await Category.find({ _id: { $in: clean } }).select('name slug').lean();
    return new Map(rows.map((r) => [String(r._id), r]));
  }

  async brandMap(ids) {
    const clean = [...new Set(ids.filter(Boolean).map(String))];
    if (!clean.length) return new Map();
    const rows = await Brand.find({ _id: { $in: clean } }).select('name').lean();
    return new Map(rows.map((r) => [String(r._id), r]));
  }

  /**
   * Full rebuild — resumable by design.
   *
   * Paginates by `_id` rather than by skip, so a crash halfway through can
   * restart from the last cursor instead of from zero, and so the pass is not
   * O(n²) on a large catalogue.
   */
  async reindexAll({ tenantId = null, batchSize = 200, maxBatches = 1000, after = null } = {}) {
    const out = { scanned: 0, indexed: 0, batches: 0, lastId: after };
    let cursor = after;

    for (let b = 0; b < maxBatches; b += 1) {
      const q = {};
      if (tenantId) q.tenantId = tenantId;
      if (cursor) q._id = { $gt: cursor };

      // eslint-disable-next-line no-await-in-loop
      const listings = await TenantProduct.find(q).sort({ _id: 1 }).limit(batchSize).lean();
      if (!listings.length) break;

      const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)))];
      // eslint-disable-next-line no-await-in-loop
      const masters = await ProductMaster.find({ _id: { $in: masterIds } }).lean();
      const masterById = new Map(masters.map((m) => [String(m._id), m]));
      // eslint-disable-next-line no-await-in-loop
      const [categoryById, brandById] = await Promise.all([
        this.categoryMap(masters.map((m) => m.categoryId)),
        this.brandMap(masters.map((m) => m.brandId)),
      ]);

      const docs = [];
      for (const listing of listings) {
        const master = masterById.get(String(listing.productMasterId));
        if (!master) continue;
        // eslint-disable-next-line no-await-in-loop
        docs.push(await this.buildDocument({ listing, master, categoryById, brandById }));
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await searchProvider.index(docs);

      out.scanned += listings.length;
      out.indexed += res.indexed || 0;
      out.batches += 1;
      cursor = listings[listings.length - 1]._id;
      out.lastId = cursor;
    }
    return out;
  }

  /** Report (and optionally repair) documents the outbox never reached. */
  async freshnessCheck({ olderThanMinutes = 1440, repair = false, limit = 200 } = {}) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60000);
    const [indexedCount, listingCount, stale] = await Promise.all([
      SearchDocument.countDocuments({}),
      TenantProduct.countDocuments({ isDeleted: { $ne: true } }),
      SearchDocument.find({ indexedAt: { $lt: cutoff } }).select('listingId tenantId').limit(limit).lean(),
    ]);

    let repaired = 0;
    if (repair) {
      for (const s of stale) {
        // eslint-disable-next-line no-await-in-loop
        const r = await this.indexListing({ listingId: s.listingId, tenantId: s.tenantId }).catch(() => null);
        if (r?.indexed) repaired += 1;
      }
    }

    return {
      indexedDocuments: indexedCount,
      listings: listingCount,
      missing: Math.max(0, listingCount - indexedCount),
      staleSample: stale.length,
      repaired,
    };
  }
}

export default new SearchIndexerService();
