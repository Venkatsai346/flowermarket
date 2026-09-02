/**
 * PriceHistory — append-only pricing audit per tenant listing.
 * Feeds pricing audits & analytics; never updated after insert.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PRICE_CHANGE_REASON, PRICE_CHANGE_SOURCE, PRICE_CURRENCY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PriceSnapshotSchema = new Schema(
  {
    mrp: { type: Number, min: 0, default: null },
    sellingPrice: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const PriceHistorySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
    before: { type: PriceSnapshotSchema, default: () => ({}) },
    after: { type: PriceSnapshotSchema, default: () => ({}) },
    currency: {
      type: String,
      enum: Object.values(PRICE_CURRENCY),
      default: PRICE_CURRENCY.INR,
    },
    reason: {
      type: String,
      enum: Object.values(PRICE_CHANGE_REASON),
      default: PRICE_CHANGE_REASON.MANUAL,
    },
    source: {
      type: String,
      enum: Object.values(PRICE_CHANGE_SOURCE),
      default: PRICE_CHANGE_SOURCE.TENANT,
    },
    changedBy: { type: Types.ObjectId, ref: 'User', default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { collection: 'pricehistories' }
);

PriceHistorySchema.index({ tenantProductId: 1, changedAt: -1 });
PriceHistorySchema.index({ tenantId: 1, changedAt: -1 });

// append-only: expose soft-delete plugin for consistency, but this collection is
// never updated in practice — history is immutable by convention.
PriceHistorySchema.plugin(auditPlugin);
PriceHistorySchema.plugin(softDeletePlugin);
PriceHistorySchema.plugin(toJSONPlugin);

export default mongoose.model('PriceHistory', PriceHistorySchema);
