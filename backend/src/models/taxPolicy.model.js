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
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TaxPolicySchema = new Schema(
  {
    categoryId: { type: Types.ObjectId, ref: 'Category', required: true, index: true },

    gstSlabPct: { type: Number, required: true, min: 0, max: 100 },
    hsnCode: { type: String, trim: true, maxlength: 16, default: null },

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

// at most one ACTIVE row per category at a time
TaxPolicySchema.index(
  { categoryId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

TaxPolicySchema.plugin(auditPlugin);
TaxPolicySchema.plugin(softDeletePlugin);
TaxPolicySchema.plugin(toJSONPlugin);

export default mongoose.model('TaxPolicy', TaxPolicySchema);
