import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductPackage from '../models/productPackage.model.js';
import ProductCompliance from '../models/productCompliance.model.js';
import ProductVariantAttributeValue from '../models/productVariantAttributeValue.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import SearchDocument from '../models/searchDocument.model.js';
import searchProvider from './searchProvider.service.js';
import { registerCatalogEventHandler } from './catalogEvent.service.js';
import { toPaise } from '../utils/money.js';
import { primaryImageUrlFor, variantDisplayLabel } from '../utils/catalog/variantImages.js';
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
async function mapWithConcurrency(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      // Worker concurrency is deliberately bounded; each lane advances one item in order.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

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
      } else if (entityType === 'category') {
        await this.reindexCategory(entityId);
      }
    } catch (err) {
      console.error('[search] index update failed (will be repaired by the sweep):', err.message);
    }
  };

  /** Build the denormalized row for one listing. */
  async buildDocument({ listing, master, categoryById, brandById, variantById = null, imagesByMaster = null, structuresByMaster = null, attributesByVariant = null }) {
    const category = master.categoryId ? categoryById.get(String(master.categoryId)) : null;
    const brand = master.brandId ? brandById.get(String(master.brandId)) : null;

    const categoryPath = category ? [category.name].filter(Boolean) : [];
    const tags = master.tags || [];
    const title = listing.merchandising?.titleOverride || master.title;
    const brandName = brand?.name || null;

    // Variant context: preloaded maps in batch paths, single fetch otherwise.
    // (indexListing is called per event — one extra indexed read is fine there.)
    let variant = variantById ? variantById.get(String(listing.variantId || '')) || null : null;
    if (!variantById && listing.variantId) {
      variant = await ProductVariant.findById(listing.variantId).lean().catch(() => null);
    }
    const variantLabel = variant ? variantDisplayLabel(variant) : null;
    let flat = imagesByMaster ? (imagesByMaster.get(String(master._id)) || []) : null;
    if (!flat) {
      flat = await ProductImage.find({ productMasterId: master._id, status: 'active' })
        .sort({ isPrimary: -1, sortOrder: 1 }).lean().catch(() => []);
    }
    const imageUrl = primaryImageUrlFor(flat, listing.variantId || null);
    let structures = structuresByMaster?.get(String(master._id)) || null;
    if (!structures) {
      const [packages, compliance] = await Promise.all([
        ProductPackage.find({ productMasterId: master._id, status: 'active' }).select('code label identifiers').lean().catch(() => []),
        ProductCompliance.find({ productMasterId: master._id, status: 'verified' }).select('code title authority').lean().catch(() => []),
      ]);
      structures = { packages, compliance };
    }
    let variantAttributes = attributesByVariant?.get(String(listing.variantId || '')) || [];
    if (!attributesByVariant && listing.variantId) {
      variantAttributes = await ProductVariantAttributeValue.find({ productVariantId: listing.variantId })
        .select('attributeKey value textValue unit').lean().catch(() => []);
    }
    const packageTokens = (structures.packages || []).flatMap((item) => [item.code, item.label, item.identifiers?.sku, item.identifiers?.barcode, item.identifiers?.gtin]);
    const complianceTokens = (structures.compliance || []).flatMap((item) => [item.code, item.title, item.authority]);
    const attributeTokens = variantAttributes.flatMap((item) => [
      item.attributeKey,
      item.textValue || (item.value && typeof item.value === 'object' ? JSON.stringify(item.value) : item.value),
      item.unit,
    ]);

    const searchText = [
      title, master.title, listing.merchandising?.descriptionOverride,
      master.shortDescription, master.description, master.manufacturer, master.modelNumber,
      master.identifiers?.gtin, master.identifiers?.mpn, master.identifiers?.isbn,
      brandName, ...categoryPath, ...tags,
      variantLabel, variant?.value, variant?.sku, variant?.barcode,
      ...(variant?.optionValues || []).flatMap((o) => [o.name, o.value]),
      ...packageTokens, ...complianceTokens, ...attributeTokens,
    ].filter(Boolean).join(' ').toLowerCase().slice(0, 2000);

    const stockQty = listing.stockQty ?? 0;

    return {
      key: `${listing.tenantId}:${listing._id}`,
      tenantId: listing.tenantId,
      listingId: listing._id,
      masterId: master._id,
      vendorId: master.vendorId || null,
      variantId: listing.variantId || null,
      variantLabel,
      variantType: variant?.variantType || null,
      optionValues: variant?.optionValues || [],

      title,
      slug: master.slug || null,
      searchText,
      brandName,
      brandId: master.brandId || null,
      productType: master.type || null,
      productKind: master.kind || 'physical',
      unitPolicy: master.unitPolicy || null,
      packageCodes: (structures.packages || []).map((item) => item.code).slice(0, 100),
      complianceCodes: (structures.compliance || []).map((item) => item.code).slice(0, 100),
      variantAttributes: variantAttributes.slice(0, 100).map((item) => ({ key: item.attributeKey, value: item.value, unit: item.unit || null })),
      categoryId: master.categoryId || null,
      categoryPath,
      tags,
      suggest: buildSuggest({ title, brandName, tags, categoryPath }),

      pricePaise: toPaise(listing.price?.sellingPrice ?? 0),
      mrpPaise: toPaise(listing.price?.mrp ?? 0),
      stockQty,
      inStock: stockQty > 0,
      unit: master.defaultSellingUnit || null,
      imageUrl,

      soldCount30d: master.soldCount || 0,
      isPerishable: Boolean(master.isPerishable),
      vendorRating: 0,
      marginScore: 0,
      listedAt: listing.createdAt || new Date(),
      // Defense-in-depth publish gate. Legacy rows can predate activation
      // validation, and a variant can be archived after its listing was made.
      // Such rows remain indexed for repair/diagnostics but can never surface.
      status: (
        listing.status === TENANT_LISTING_STATUS.ACTIVE
        && master.status === PRODUCT_MASTER_STATUS.ACTIVE
        && master.complianceStatus !== 'pending'
        && Number.isFinite(Number(listing.price?.sellingPrice))
        && listing.price?.sellingPrice !== null
        && listing.price?.sellingPrice !== undefined
        && listing.channels?.storefront !== false
        && (!listing.variantId || (variant && variant.status === 'active'))
      ) ? 'active' : 'hidden',
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

    const [categoryById, brandById, { structuresByMaster, attributesByVariant }] = await Promise.all([
      this.categoryMap([master.categoryId]),
      this.brandMap([master.brandId]),
      this.structureMaps([listing]),
    ]);
    const doc = await this.buildDocument({ listing, master, categoryById, brandById, structuresByMaster, attributesByVariant });
    return searchProvider.index([doc]);
  }

  async removeListing(listingId, tenantId) {
    return searchProvider.remove([`${tenantId}:${listingId}`]);
  }

  /** Preload variant + image context for a batch of listings (no N+1). */
  async variantImageMaps(listings) {
    const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)).filter(Boolean))];
    if (!masterIds.length) return { variantById: new Map(), imagesByMaster: new Map() };
    const [variants, images] = await Promise.all([
      ProductVariant.find({ productMasterId: { $in: masterIds } }).lean(),
      ProductImage.find({ productMasterId: { $in: masterIds }, status: 'active' })
        .sort({ isPrimary: -1, sortOrder: 1 }).lean(),
    ]);
    const variantById = new Map(variants.map((v) => [String(v._id), v]));
    const imagesByMaster = new Map();
    for (const img of images) {
      const k = String(img.productMasterId);
      if (!imagesByMaster.has(k)) imagesByMaster.set(k, []);
      imagesByMaster.get(k).push(img);
    }
    return { variantById, imagesByMaster };
  }

  /** Preload bounded structural metadata for search without per-listing queries. */
  async structureMaps(listings) {
    const masterIds = [...new Set(listings.map((listing) => String(listing.productMasterId)).filter(Boolean))];
    const variantIds = [...new Set(listings.map((listing) => String(listing.variantId || '')).filter(Boolean))];
    const [packages, compliance, attributes] = await Promise.all([
      ProductPackage.find({ productMasterId: { $in: masterIds }, status: 'active' }).select('productMasterId code label identifiers').lean(),
      ProductCompliance.find({ productMasterId: { $in: masterIds }, status: 'verified' }).select('productMasterId code title authority').lean(),
      ProductVariantAttributeValue.find({ productVariantId: { $in: variantIds } }).select('productVariantId attributeKey value textValue unit').lean(),
    ]);
    const structuresByMaster = new Map(masterIds.map((masterId) => [masterId, { packages: [], compliance: [] }]));
    for (const item of packages) structuresByMaster.get(String(item.productMasterId))?.packages.push(item);
    for (const item of compliance) structuresByMaster.get(String(item.productMasterId))?.compliance.push(item);
    const attributesByVariant = new Map();
    for (const item of attributes) {
      const key = String(item.productVariantId);
      if (!attributesByVariant.has(key)) attributesByVariant.set(key, []);
      attributesByVariant.get(key).push(item);
    }
    return { structuresByMaster, attributesByVariant };
  }

  /** A taxonomy compliance/schema change can alter publishability and search text for every child product. */
  async reindexCategory(categoryId) {
    const total = { indexed: 0, scanned: 0 };
    let after = null;
    while (true) {
      const query = { categoryId, ...(after ? { _id: { $gt: after } } : {}) };
      // Category traversal is deliberately cursor-paginated to keep memory bounded.
      // eslint-disable-next-line no-await-in-loop
      const masters = await ProductMaster.find(query).sort({ _id: 1 }).select('_id').limit(200).lean();
      if (!masters.length) break;
      // Each page is deliberately completed before its cursor advances.
      // eslint-disable-next-line no-await-in-loop
      const results = await mapWithConcurrency(masters, 8, (master) => this.reindexMaster(master._id));
      for (const result of results) {
        total.indexed += result.indexed || 0;
        total.scanned += result.scanned || 0;
      }
      after = masters[masters.length - 1]._id;
    }
    return total;
  }

  /**
   * A global product changed — refresh it in EVERY store that lists it.
   * Cursor-paginated (the old single .limit(500) query left the tail stale
   * for masters listed in >500 tenants; nothing ever re-fetched them).
   */
  async reindexMaster(masterId) {
    const BATCH = 500;
    const MAX_BATCHES = 400; // 200k listings safety valve
    let cursor = null;
    let scanned = 0;
    let indexed = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const q = { productMasterId: masterId };
      if (cursor) q._id = { $gt: cursor };
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const listings = await TenantProduct.find(q).sort({ _id: 1 }).limit(BATCH).lean();
      if (!listings.length) break;
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const master = await ProductMaster.findById(masterId).lean();
      if (!master) break;
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const [categoryById, brandById, { variantById, imagesByMaster }, { structuresByMaster, attributesByVariant }] = await Promise.all([
        this.categoryMap([master.categoryId]),
        this.brandMap([master.brandId]),
        this.variantImageMaps(listings),
        this.structureMaps(listings),
      ]);
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const docs = await Promise.all(
        listings.map((listing) => this.buildDocument({ listing, master, categoryById, brandById, variantById, imagesByMaster, structuresByMaster, attributesByVariant }))
      );
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const res = await searchProvider.index(docs);
      scanned += listings.length;
      indexed += res?.indexed || 0;
      cursor = listings[listings.length - 1]._id;
    }
    return { indexed, scanned };
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

      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const listings = await TenantProduct.find(q).sort({ _id: 1 }).limit(batchSize).lean();
      if (!listings.length) break;

      const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)))];
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const masters = await ProductMaster.find({ _id: { $in: masterIds } }).lean();
      const masterById = new Map(masters.map((m) => [String(m._id), m]));
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const [categoryById, brandById, { variantById, imagesByMaster }, { structuresByMaster, attributesByVariant }] = await Promise.all([
        this.categoryMap(masters.map((m) => m.categoryId)),
        this.brandMap(masters.map((m) => m.brandId)),
        this.variantImageMaps(listings),
        this.structureMaps(listings),
      ]);

      const docs = [];
      for (const listing of listings) {
        const master = masterById.get(String(listing.productMasterId));
        if (!master) continue;
        // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
        // eslint-disable-next-line no-await-in-loop
        docs.push(await this.buildDocument({ listing, master, categoryById, brandById, variantById, imagesByMaster, structuresByMaster, attributesByVariant }));
      }
      // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
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
        // Index pagination is deliberately sequential because each bounded batch advances the previous cursor.
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
