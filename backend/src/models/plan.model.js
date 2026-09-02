/**
 * Plan — the marketplace plan catalog (Phase 5).
 *
 * Pricing is DATA (admin-editable, like notification templates): plans live here,
 * and the values are SNAPSHOTTED onto subscriptions/invoices so history never
 * mutates when pricing changes. Commission is expressed in basis points
 * (100 bps = 1%) to avoid float drift.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema } = mongoose;

const PlanSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40, index: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: null, maxlength: 400 },
    priceMonthly: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    commissionRateBps: { type: Number, default: 100, min: 0, max: 10000 }, // platform cut on GMV
    features: {
      maxHubs: { type: Number, default: 1, min: 0 },
      maxProducts: { type: Number, default: 0, min: 0 }, // 0 = unlimited
      maxStaff: { type: Number, default: 0, min: 0 },
      marketplaceEnabled: { type: Boolean, default: false },
    },
    trialDays: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
  },
  { collection: 'plans' }
);

PlanSchema.plugin(auditPlugin);
PlanSchema.plugin(softDeletePlugin);
PlanSchema.plugin(toJSONPlugin);

export default mongoose.model('Plan', PlanSchema);
