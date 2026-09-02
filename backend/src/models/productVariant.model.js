/**
 * ProductVariant — global variants of a ProductMaster (e.g. "10 stems" vs "20 stems",
 * 500g vs 1kg, red vs white roses). Own collection (no unbounded embeds).
 *
 * TenantProduct can reference a variant (variantId) to list a specific SKU;
 * a listing without variantId is the master-level listing.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { VARIANT_TYPE, ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ProductVariantSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    variantType: { type: String, enum: Object.values(VARIANT_TYPE), required: true },
    value: { type: String, required: true, trim: true, maxlength: 80 }, // e.g. "10 stems"
    displayLabel: { type: String, trim: true, maxlength: 120, default: null },
    sku: { type: String, trim: true, maxlength: 80, default: null }, // variant-level SKU
    sortOrder: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
      index: true,
    },
  },
  { collection: 'productvariants' }
);

ProductVariantSchema.index({ productMasterId: 1, variantType: 1, value: 1 }, { unique: true });
ProductVariantSchema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: 'string' } } }
);

ProductVariantSchema.plugin(auditPlugin);
ProductVariantSchema.plugin(softDeletePlugin);
ProductVariantSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductVariant', ProductVariantSchema);
