/**
 * SearchDocument — one denormalized, rankable row per (tenant, listing).
 *
 * WHY DENORMALIZE. The live catalogue read joins TenantProduct → ProductMaster
 * → Inventory and then filters, which is three collections and a `$lookup` on
 * the hottest path in the app. Search reads one collection with one index.
 * The cost is that it can go stale — which is exactly why it is fed by the
 * CatalogEvent OUTBOX rather than by hopeful dual writes: the outbox already
 * guarantees at-least-once delivery, and re-indexing the same document twice
 * is idempotent.
 *
 * Per (tenant, listing) and not per master, because the same global product
 * has a different price, stock and status in every store.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const SearchDocumentSchema = new Schema(
  {
    /** `{tenantId}:{listingId}` — stable, so re-indexing is an upsert. */
    key: { type: String, required: true, unique: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    listingId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },
    masterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },

    // ---- text ----
    title: { type: String, required: true, maxlength: 200 },
    searchText: { type: String, default: '' },
    brandName: { type: String, default: null, maxlength: 120 },
    categoryId: { type: Types.ObjectId, ref: 'Category', default: null, index: true },
    categoryPath: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    /** Prefix tokens for autocomplete — bounded, so the doc stays small. */
    suggest: { type: [String], default: [] },
    attributes: { type: Schema.Types.Mixed, default: {} },

    // ---- commerce ----
    pricePaise: { type: Number, default: 0, index: true },
    mrpPaise: { type: Number, default: 0 },
    stockQty: { type: Number, default: 0 },
    inStock: { type: Boolean, default: false, index: true },
    unit: { type: String, default: null, maxlength: 20 },
    imageUrl: { type: String, default: null },

    // ---- ranking signals (refreshed by the nightly rollup) ----
    soldCount30d: { type: Number, default: 0 },
    clicks30d: { type: Number, default: 0 },
    impressions30d: { type: Number, default: 0 },
    returnRate30d: { type: Number, default: 0, min: 0, max: 1 },
    vendorRating: { type: Number, default: 0, min: 0, max: 5 },
    marginScore: { type: Number, default: 0, min: 0, max: 1 },
    isPerishable: { type: Boolean, default: false },
    isPromoted: { type: Boolean, default: false },
    promotedUntil: { type: Date, default: null },

    listedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'hidden'], default: 'active', index: true },
    indexedAt: { type: Date, default: Date.now },
    /** Bumped on every source change; lets the sweep find stale rows. */
    sourceVersion: { type: Number, default: 1 },
  },
  { collection: 'searchdocuments' }
);

// the candidate-retrieval index: tenant + active + in-stock, then price
SearchDocumentSchema.index({ tenantId: 1, status: 1, inStock: -1, pricePaise: 1 });
SearchDocumentSchema.index({ tenantId: 1, categoryId: 1, status: 1 });
// full-text retrieval, weighted so a title hit beats a description hit
SearchDocumentSchema.index(
  { title: 'text', searchText: 'text', tags: 'text', brandName: 'text' },
  { weights: { title: 10, brandName: 4, tags: 3, searchText: 1 }, name: 'search_text_idx' }
);
// autocomplete
SearchDocumentSchema.index({ tenantId: 1, suggest: 1 });
// staleness sweep
SearchDocumentSchema.index({ indexedAt: 1 });

SearchDocumentSchema.plugin(auditPlugin);
SearchDocumentSchema.plugin(softDeletePlugin);
SearchDocumentSchema.plugin(toJSONPlugin);

export default mongoose.model('SearchDocument', SearchDocumentSchema);
