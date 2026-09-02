/**
 * StatutoryRate — TCS/TDS rates as EFFECTIVE-DATED DATA (Phase 6.2).
 *
 * These rates are set by notification and have already been revised in
 * practice (TCS u/s 52 and TDS u/s 194-O both moved during 2024). Hard-coding
 * either one guarantees that historical documents silently re-price when the
 * constant is edited. So: one row per (kind, effective period), resolved by
 * the SUPPLY DATE, with the notification reference recorded for the auditor.
 *
 * Seed values must be confirmed with a chartered accountant before go-live —
 * the engineering contract is only that any rate can be expressed on any date
 * and that the rate which produced a historical number is provable.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { STATUTORY_RATE_KIND } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const StatutoryRateSchema = new Schema(
  {
    kind: { type: String, enum: Object.values(STATUTORY_RATE_KIND), required: true, index: true },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },

    /** What the rate applies to — the base differs between TCS and TDS. */
    appliesTo: { type: String, enum: ['net_taxable', 'gross_sales'], required: true },

    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null }, // null = still in force

    notificationRef: { type: String, default: null, maxlength: 200 },
    note: { type: String, default: null, maxlength: 500 },
    createdByUserId: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'statutoryrates' }
);

StatutoryRateSchema.index({ kind: 1, effectiveFrom: -1 });

StatutoryRateSchema.plugin(auditPlugin);
StatutoryRateSchema.plugin(softDeletePlugin);
StatutoryRateSchema.plugin(toJSONPlugin);

export default mongoose.model('StatutoryRate', StatutoryRateSchema);
