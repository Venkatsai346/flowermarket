/**
 * PlatformDaily — cross-tenant marketplace rollup (Phase 5).
 *
 * One row per date aggregating every tenant (orders, GMV, commissions, MRR,
 * tenant/vendor counts). Built idempotently (unique date upsert) by
 * `POST /marketplace/admin/analytics/rebuild` and the nightly marketplace
 * pass. The platform dashboard reads this when present, else live-computes.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema } = mongoose;

const PlatformDailySchema = new Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
    orders: { type: Number, default: 0, min: 0 },
    gmv: { type: Number, default: 0, min: 0 },
    netRevenue: { type: Number, default: 0, min: 0 },
    commissionsAccrued: { type: Number, default: 0, min: 0 }, // open+paid commission lines, period-billed
    mrr: { type: Number, default: 0, min: 0 }, // Σ active subscriptions priceMonthly
    activeTenants: { type: Number, default: 0, min: 0 },
    newTenants: { type: Number, default: 0, min: 0 },
    newVendors: { type: Number, default: 0, min: 0 },
    byPlan: { type: Schema.Types.Mixed, default: {} }, // {free: n, pro: n, business: n}
    computedAt: { type: Date, default: Date.now },
  },
  { collection: 'platformdailies' }
);

PlatformDailySchema.plugin(auditPlugin);
PlatformDailySchema.plugin(softDeletePlugin);
PlatformDailySchema.plugin(toJSONPlugin);

export default mongoose.model('PlatformDaily', PlatformDailySchema);
