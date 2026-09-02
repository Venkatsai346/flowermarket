/**
 * TaxPolicy — GST classification per CATEGORY (Phase 3.5).
 *
 * Deliberately category-level, NOT tenant-level: GST is a legal
 * classification, not a business choice — every tenant selling a "Fresh
 * Flowers" category must charge the same slab. effective_from/to supports
 * slab changes over time; at most one ACTIVE row per category.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS, TAX_NATURE_OF_SUPPLY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TaxPolicySchema = new Schema(
  {
    categoryId: { type: Types.ObjectId, ref: 'Category', required: true, index: true },

    /**
     * Legacy percentage (Phase 3.5). Kept so the existing pricing engine and
     * every historical row keep working untouched.
     */
    gstSlabPct: { type: Number, required: true, min: 0, max: 100 },

    /**
     * Phase 6.2: the same rate in BASIS POINTS. Integer maths only — 18% is
     * 1800, not 18.0, so no float ever reaches a tax computation. Populated
     * from gstSlabPct when absent (see the pre-validate hook below).
     */
    rateBps: { type: Number, min: 0, max: 10000, default: null },

    /**
     * Nil-rated and exempt supplies are NOT "0% taxable": they are reported in
     * their own columns of GSTR-1. A flower catalogue is full of them (fresh
     * cut flowers, live plants), so the distinction is first-class here.
     */
    natureOfSupply: {
      type: String,
      enum: Object.values(TAX_NATURE_OF_SUPPLY),
      default: TAX_NATURE_OF_SUPPLY.TAXABLE,
      index: true,
    },
    cessBps: { type: Number, min: 0, default: 0 },

    hsnCode: { type: String, trim: true, maxlength: 16, default: null },

    /**
     * Effective dating is now RESOLVED BY SUPPLY DATE, not by `isActive`
     * alone: a slab change must not re-price documents issued before it.
     */
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
    },
  },
  { collection: 'taxpolicies' }
);

/** Keep rateBps and gstSlabPct in lockstep, whichever the caller supplied. */
TaxPolicySchema.pre('validate', function syncRate(next) {
  if (this.rateBps === null || this.rateBps === undefined) {
    this.rateBps = Math.round((this.gstSlabPct || 0) * 100);
  } else if (this.isModified('rateBps') && !this.isModified('gstSlabPct')) {
    this.gstSlabPct = this.rateBps / 100;
  }
  next();
});

// supply-date resolution
TaxPolicySchema.index({ categoryId: 1, effectiveFrom: -1 });

// at most one ACTIVE row per category at a time
TaxPolicySchema.index(
  { categoryId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

TaxPolicySchema.plugin(auditPlugin);
TaxPolicySchema.plugin(softDeletePlugin);
TaxPolicySchema.plugin(toJSONPlugin);

export default mongoose.model('TaxPolicy', TaxPolicySchema);
