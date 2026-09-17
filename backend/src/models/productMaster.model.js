/**
 * ProductMaster — the GLOBAL, single source of truth for "what this product is".
 *
 * Owned by Central Catalog Ops (admin). Per the multi-tenant catalog architecture:
 *  - A tenant can NEVER create/edit a master directly for a new global SKU — it
 *    goes through ProductChangeRequest + admin review (PENDING_REVIEW -> ACTIVE).
 *  - Global fields (title, description, category, brand, attributes, images,
 *    variants) live here. Tenant-scoped fields (price, stock, listing status)
 *    live on TenantProduct — see the field-ownership split in fieldOwnership.js.
 *  - `version` + optimistic locking guards concurrent admin edits.
 *  - EAV attributes / variants / images are separate collections (bounded docs).
 *
 * Status flow:
 *   PENDING_REVIEW -> ACTIVE | REJECTED ; ACTIVE -> DEPRECATED (cascade to listings)
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  PRODUCT_KIND,
  PRODUCT_MASTER_STATUS,
  SELLING_UNIT,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ReviewSchema = new Schema(
  {
    submittedAt: { type: Date, default: null },
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 500 },
  },
  { _id: false }
);

const ProductOptionSchema = new Schema(
  {
    code: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
    name: { type: String, required: true, maxlength: 80 },
    values: { type: [String], default: [], validate: (v) => v.length <= 100 },
    displayType: { type: String, enum: ['text', 'swatch', 'image'], default: 'text' },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const FulfillmentProfileSchema = new Schema(
  {
    requiresShipping: { type: Boolean, default: true },
    shippingClass: { type: String, default: 'standard', maxlength: 40 },
    weight: {
      value: { type: Number, default: null, min: 0 },
      unit: { type: String, enum: ['mg', 'g', 'kg', 'oz', 'lb'], default: 'g' },
    },
    dimensions: {
      length: { type: Number, default: null, min: 0 },
      width: { type: Number, default: null, min: 0 },
      height: { type: Number, default: null, min: 0 },
      unit: { type: String, enum: ['mm', 'cm', 'm', 'in', 'ft'], default: 'cm' },
    },
    fragile: { type: Boolean, default: false },
    hazardous: { type: Boolean, default: false },
    ageRestricted: { type: Boolean, default: false },
    requiresSerialTracking: { type: Boolean, default: false },
  },
  { _id: false }
);

const ProductMasterSchema = new Schema(
  {
    // ---- identity (global) ----
    skuGlobal: { type: String, required: true, trim: true, maxlength: 80 },
    // Open normalized class: presets improve UX, but arbitrary verticals do
    // not require schema migrations. `kind` controls fulfilment semantics.
    type: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9_]{0,59}$/, index: true },
    kind: { type: String, enum: Object.values(PRODUCT_KIND), default: PRODUCT_KIND.PHYSICAL, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
    shortDescription: { type: String, default: null, maxlength: 300 },
    description: { type: String, default: null, maxlength: 4000 },
    barcode: { type: String, trim: true, default: null },

    // ---- taxonomy ----
    categoryId: { type: Types.ObjectId, ref: 'Category', required: true, index: true },
    brandId: { type: Types.ObjectId, ref: 'Brand', default: null, index: true },
    tags: { type: [String], default: [], validate: (v) => v.length <= 50 },
    manufacturer: { type: String, default: null, trim: true, maxlength: 160 },
    modelNumber: { type: String, default: null, trim: true, maxlength: 100 },
    countryOfOrigin: { type: String, default: null, trim: true, maxlength: 80 },
    identifiers: {
      gtin: { type: String, default: null, trim: true, maxlength: 32 },
      mpn: { type: String, default: null, trim: true, maxlength: 100 },
      isbn: { type: String, default: null, trim: true, maxlength: 20 },
      hsn: { type: String, default: null, trim: true, maxlength: 16 },
    },
    condition: { type: String, enum: ['new', 'refurbished', 'used'], default: 'new' },
    warranty: {
      duration: { type: Number, default: null, min: 0 },
      unit: { type: String, enum: ['day', 'month', 'year'], default: 'month' },
      description: { type: String, default: null, maxlength: 500 },
    },
    seo: {
      title: { type: String, default: null, maxlength: 70 },
      description: { type: String, default: null, maxlength: 180 },
      keywords: { type: [String], default: [], validate: (v) => v.length <= 20 },
    },
    // Product-level option vocabulary. A sellable variant stores one value
    // per dimension and a canonical combinationKey (e.g. color=red&size=m).
    options: { type: [ProductOptionSchema], default: [], validate: (v) => v.length <= 6 },

    // ---- fulfilment characteristics (global) ----
    fulfillmentProfile: { type: FulfillmentProfileSchema, default: () => ({}) },
    isPerishable: { type: Boolean, default: false },
    requiresColdChain: { type: Boolean, default: false },
    defaultSellingUnit: {
      type: String,
      enum: Object.values(SELLING_UNIT),
      default: SELLING_UNIT.PIECE,
    },
    minOrderQty: { type: Number, default: 1, min: 1 },
    maxOrderQty: { type: Number, default: 100, min: 1 },
    complianceStatus: {
      type: String,
      enum: ['not_required', 'pending', 'compliant'],
      default: 'not_required',
    },

    // ---- lifecycle ----
    status: {
      type: String,
      enum: Object.values(PRODUCT_MASTER_STATUS),
      default: PRODUCT_MASTER_STATUS.PENDING_REVIEW,
      index: true,
    },
    review: { type: ReviewSchema, default: () => ({}) },
    version: { type: Number, default: 1, min: 1 },

    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
    soldCount: { type: Number, default: 0, min: 0 }, // global lifetime sold (denormalized)

    // ---- Phase 5: marketplace attribution & routing ----
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true }, // null = platform-owned
    marketplaceListed: { type: Boolean, default: false, index: true },
    marketplaceListedAt: { type: Date, default: null },

    // ---- search ----
    searchText: { type: String, default: null }, // precomputed: title + desc + tags + brand + category path
  },
  { collection: 'productmasters' }
);

// Unique constraints are SOFT-DELETE-AWARE (partial on isDeleted: false): a
// soft-deleted row releases its key, so a deleted master can be re-created
// with the same SKU/slug. Migration 003 drops the legacy full-unique indexes.
ProductMasterSchema.index(
  { skuGlobal: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
ProductMasterSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
ProductMasterSchema.index(
  { barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { $and: [{ barcode: { $type: 'string' } }, { isDeleted: false }] },
  }
);
ProductMasterSchema.index(
  { 'identifiers.gtin': 1 },
  { unique: true, partialFilterExpression: { $and: [{ 'identifiers.gtin': { $type: 'string' } }, { isDeleted: false }] } }
);
ProductMasterSchema.index({ categoryId: 1, status: 1 });
ProductMasterSchema.index({ brandId: 1, status: 1 });
ProductMasterSchema.index({ type: 1, kind: 1, status: 1 });
ProductMasterSchema.index({ searchText: 'text', title: 'text', tags: 'text' });

ProductMasterSchema.plugin(auditPlugin);
ProductMasterSchema.plugin(softDeletePlugin);
ProductMasterSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductMaster', ProductMasterSchema);
