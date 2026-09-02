/**
 * AnalyticsDaily — nightly KPI rollup (admin dashboard, Phase 4).
 *
 * One row per (tenantId, hubId, date); hubId:null = the tenant-wide row.
 * Built by analyticsService.rebuildDailyStats() — idempotent upsert, safe to
 * re-run (the nightly job simply calls it). Keeps export numbers consistent
 * and gives a scale-out path before any BI store is needed.
 *
 * topProducts is a BOUNDED array (max 20) — the only array on this doc.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const TopProductSchema = new Schema(
  {
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct' },
    skuGlobal: { type: String, default: null },
    title: { type: String, default: null },
    qty: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
  },
  { _id: false }
);

const AnalyticsDailySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true }, // null = tenant-wide
    date: { type: String, required: true }, // 'YYYY-MM-DD' tenant tz

    // ---- KPIs (see docs/API.md §analytics formulas) ----
    ordersCreated: { type: Number, default: 0, min: 0 },
    gmv: { type: Number, default: 0, min: 0 },
    netRevenue: { type: Number, default: 0, min: 0 },
    aov: { type: Number, default: 0, min: 0 },
    delivered: { type: Number, default: 0, min: 0 },
    cancelled: { type: Number, default: 0, min: 0 },
    returnRequests: { type: Number, default: 0, min: 0 },
    newCustomers: { type: Number, default: 0, min: 0 },
    repeatCustomers: { type: Number, default: 0, min: 0 },

    // bounded subdoc splits (objects, not arrays)
    byPaymentMethod: { type: Schema.Types.Mixed, default: {} },
    bySlotType: { type: Schema.Types.Mixed, default: {} },

    // bounded array (max 20)
    topProducts: { type: [TopProductSchema], default: [], maxlength: 20 },

    version: { type: Number, default: 1 },
    computedAt: { type: Date, default: Date.now },
  },
  { collection: 'analyticsdailies' }
);

AnalyticsDailySchema.index({ tenantId: 1, hubId: 1, date: 1 }, { unique: true });
AnalyticsDailySchema.index({ tenantId: 1, date: 1 });

AnalyticsDailySchema.plugin(auditPlugin);
AnalyticsDailySchema.plugin(softDeletePlugin);
AnalyticsDailySchema.plugin(toJSONPlugin);

export default mongoose.model('AnalyticsDaily', AnalyticsDailySchema);
