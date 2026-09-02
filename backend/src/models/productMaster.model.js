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
  PRODUCT_TYPE,
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

const ProductMasterSchema = new Schema(
  {
    // ---- identity (global) ----
    skuGlobal: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: Object.values(PRODUCT_TYPE), required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
    shortDescription: { type: String, default: null, maxlength: 300 },
    description: { type: String, default: null, maxlength: 4000 },
    barcode: { type: String, trim: true, default: null },

    // ---- taxonomy ----
    categoryId: { type: Types.ObjectId, ref: 'Category', required: true, index: true },
    brandId: { type: Types.ObjectId, ref: 'Brand', default: null, index: true },
    tags: { type: [String], default: [] }, // bounded

    // ---- fulfilment characteristics (global) ----
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

ProductMasterSchema.index({ skuGlobal: 1 }, { unique: true });
ProductMasterSchema.index({ slug: 1 }, { unique: true });
ProductMasterSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } }
);
ProductMasterSchema.index({ categoryId: 1, status: 1 });
ProductMasterSchema.index({ brandId: 1, status: 1 });
ProductMasterSchema.index({ type: 1, status: 1 });
ProductMasterSchema.index({ searchText: 'text', title: 'text', tags: 'text' });

ProductMasterSchema.plugin(auditPlugin);
ProductMasterSchema.plugin(softDeletePlugin);
ProductMasterSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductMaster', ProductMasterSchema);
