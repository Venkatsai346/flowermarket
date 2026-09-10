/**
 * TenantSubscription — a STORE's plan billing subscription (Phase 5).
 *
 * One ACTIVE row per tenant (partial unique index). This is the tenant's seat
 * ON a plan from the super-admin-managed catalog (`plans`): pricing is
 * snapshotted at subscribe/change time so a plan edit never rewrites history.
 * `pendingAdjustment` carries a mid-period plan-change proration that the next
 * invoice applies (then clears). The billing cycle advances periods; the
 * overdue sweep flips delinquent rows to past_due (checkout blocked until
 * the owner pays).
 *
 * NOT customer recurring orders — those are Subscription (`subscriptions`
 * collection, SUBSCRIPTION_STATUS). See the vocabulary header in
 * constants/enums.js before touching either file.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { TENANT_SUBSCRIPTION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TenantSubscriptionSchema = new Schema(
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
      enum: Object.values(TENANT_SUBSCRIPTION_STATUS),
      default: TENANT_SUBSCRIPTION_STATUS.TRIAL,
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
  { collection: 'tenant_subscriptions' }
);

// one live subscription per tenant
TenantSubscriptionSchema.index(
  { tenantId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['trial', 'active', 'past_due'] } } }
);

TenantSubscriptionSchema.plugin(auditPlugin);
TenantSubscriptionSchema.plugin(softDeletePlugin);
TenantSubscriptionSchema.plugin(toJSONPlugin);

export default mongoose.model('TenantSubscription', TenantSubscriptionSchema);
