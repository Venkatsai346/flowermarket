/**
 * Subscription — a tenant's marketplace billing subscription (Phase 5).
 *
 * One ACTIVE subscription per tenant (partial unique index). Plan pricing is
 * snapshotted at subscribe/change time so a plan edit never rewrites history.
 * `pendingAdjustment` carries a mid-period plan-change proration that the next
 * invoice applies (then clears). The billing cycle advances periods.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { SUBSCRIPTION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const SubscriptionSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    planCode: { type: String, required: true, index: true },
    planSnapshot: {
      name: { type: String, default: null },
      priceMonthly: { type: Number, default: 0, min: 0 },
    },
    commissionRateBps: { type: Number, default: 100, min: 0, max: 10000 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIAL,
      index: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    trialEndsAt: { type: Date, default: null },

    cancelAtPeriodEnd: { type: Boolean, default: false },
    pendingAdjustment: {
      amount: { type: Number, default: 0 }, // signed (credit when negative)
      label: { type: String, default: null },
    },
    changedAt: { type: Date, default: null },
  },
  { collection: 'subscriptions' }
);

// one live subscription per tenant
SubscriptionSchema.index(
  { tenantId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['trial', 'active', 'past_due'] } } }
);

SubscriptionSchema.plugin(auditPlugin);
SubscriptionSchema.plugin(softDeletePlugin);
SubscriptionSchema.plugin(toJSONPlugin);

export default mongoose.model('Subscription', SubscriptionSchema);
