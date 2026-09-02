/**
 * RankingProfile — search weights as DATA (Phase 6.5).
 *
 * The same argument as Plans and NotificationTemplates: a merchandiser must be
 * able to retune relevance without a deploy, and every change must be audited
 * so a revenue dip is traceable to a weight edit.
 *
 * `trafficPct` makes a profile an EXPERIMENT: visitors are bucketed
 * deterministically by session, so the same person always sees the same
 * ranking, and the query log records which bucket produced each result set.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const RankingProfileSchema = new Schema(
  {
    code: { type: String, required: true, lowercase: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: null, maxlength: 400 },
    /** null = the platform default, inherited by every store. */
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },

    weights: {
      text: { type: Number, default: 1.0, min: 0, max: 5 },
      popularity: { type: Number, default: 0.6, min: 0, max: 5 },
      ctr: { type: Number, default: 0.5, min: 0, max: 5 },
      availability: { type: Number, default: 0.8, min: 0, max: 5 },
      freshness: { type: Number, default: 0.4, min: 0, max: 5 },
      discount: { type: Number, default: 0.2, min: 0, max: 5 },
      vendor: { type: Number, default: 0.2, min: 0, max: 5 },
      margin: { type: Number, default: 0.1, min: 0, max: 5 },
    },
    tuning: {
      popularityReference: { type: Number, default: 1000 },
      ctrPrior: { type: Number, default: 0.08 },
      ctrWeight: { type: Number, default: 50 },
      freshnessHalfLifeHours: { type: Number, default: 72 },
      lowStockThreshold: { type: Number, default: 5 },
      promotedBoost: { type: Number, default: 0.25 },
      returnPenalty: { type: Number, default: 0.3 },
      outOfStockFloor: { type: Boolean, default: true },
    },

    /** Editorial control: force to the top, or push to the bottom. */
    pins: [{ query: { type: String, maxlength: 80 }, listingIds: [{ type: Types.ObjectId }] }],
    buries: [{ type: Types.ObjectId }],

    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
    /** 0 = off, 100 = everyone. Anything between is an A/B test. */
    trafficPct: { type: Number, default: 0, min: 0, max: 100 },
  },
  { collection: 'rankingprofiles' }
);

RankingProfileSchema.index({ tenantId: 1, code: 1 }, { unique: true });

RankingProfileSchema.plugin(auditPlugin);
RankingProfileSchema.plugin(softDeletePlugin);
RankingProfileSchema.plugin(toJSONPlugin);

export default mongoose.model('RankingProfile', RankingProfileSchema);
