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
import { combinationKey } from '../utils/catalog/productStructure.js';

const { Schema, Types } = mongoose;

const OptionValueSchema = new Schema(
  {
    code: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
    name: { type: String, required: true, maxlength: 80 },
    value: { type: String, required: true, maxlength: 100 },
  },
  { _id: false }
);

const ProductVariantSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    // Legacy one-dimensional projection retained for old clients. Universal
    // variants use optionValues + combinationKey for arbitrary combinations.
    variantType: { type: String, enum: Object.values(VARIANT_TYPE), default: VARIANT_TYPE.OTHER },
    value: { type: String, trim: true, maxlength: 100, default: null },
    optionValues: { type: [OptionValueSchema], default: [], validate: (v) => v.length <= 6 },
    combinationKey: { type: String, default: null, maxlength: 800 },
    displayLabel: { type: String, trim: true, maxlength: 240, default: null },
    sku: { type: String, trim: true, maxlength: 80, default: null },
    barcode: { type: String, trim: true, maxlength: 60, default: null },
    identifiers: {
      gtin: { type: String, trim: true, maxlength: 32, default: null },
      mpn: { type: String, trim: true, maxlength: 100, default: null },
    },
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
    sellQuantity: {
      value: { type: Number, default: 1, min: Number.EPSILON },
      unitCode: { type: String, default: null, match: /^[a-z][a-z0-9_]{0,39}$/ },
    },
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

ProductVariantSchema.pre('validate', function normalizeCombination(next) {
  if (!this.value && !this.optionValues?.length) return next(new Error('A variant needs value or optionValues'));
  const optionCodes = (this.optionValues || []).map((option) => option.code);
  if (new Set(optionCodes).size !== optionCodes.length) return next(new Error('Variant option dimensions must be unique'));
  this.combinationKey = combinationKey(this.optionValues || [], {
    variantType: this.variantType,
    value: this.value,
  });
  if (!this.displayLabel) {
    this.displayLabel = this.optionValues?.length
      ? this.optionValues.map((o) => o.value).join(' / ')
      : this.value;
  }
  return next();
});

// Universal identity is the full canonical option combination, not one
// variantType/value pair. Migration 004 drops the superseded unique triple.
ProductVariantSchema.index({ productMasterId: 1, variantType: 1, value: 1 });
ProductVariantSchema.index(
  { productMasterId: 1, combinationKey: 1 },
  { unique: true, partialFilterExpression: { $and: [{ combinationKey: { $type: 'string' } }, { isDeleted: false }] } }
);
ProductVariantSchema.index(
  { sku: 1 },
  {
    unique: true,
    partialFilterExpression: { $and: [{ sku: { $type: 'string' } }, { isDeleted: false }] },
  }
);
ProductVariantSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { $and: [{ barcode: { $type: 'string' } }, { isDeleted: false }] } }
);
ProductVariantSchema.index(
  { 'identifiers.gtin': 1 },
  { unique: true, partialFilterExpression: { $and: [{ 'identifiers.gtin': { $type: 'string' } }, { isDeleted: false }] } }
);

ProductVariantSchema.plugin(auditPlugin);
ProductVariantSchema.plugin(softDeletePlugin);
ProductVariantSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductVariant', ProductVariantSchema);
