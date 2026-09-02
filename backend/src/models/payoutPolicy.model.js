/**
 * PayoutPolicy — settlement rules as DATA (Phase 6.3).
 *
 * One platform-scoped row, optionally overridden per vendor. Everything that
 * decides WHEN and HOW MUCH a vendor is paid lives here rather than in code,
 * so changing a return window or a payout floor is an admin action with an
 * audit trail, not a deploy.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const PayoutPolicySchema = new Schema(
  {
    scope: { type: String, enum: ['platform', 'vendor'], default: 'platform', index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },

    /** Cycle cadence — 'weekly:wed' | 'daily' | 'monthly:1'. */
    schedule: { type: String, default: 'weekly:wed', maxlength: 20 },
    /** Below this, the balance rolls into the next cycle instead of paying. */
    minPayoutPaise: { type: Number, default: 50000, min: 0 }, // ₹500

    /**
     * GATE 1 — return risk. A line becomes eligible only after the customer's
     * window to send it back has closed.
     */
    returnWindowDays: { type: Number, default: 7, min: 0 },
    perishableReturnWindowDays: { type: Number, default: 1, min: 0 },

    /**
     * GATE 2 — cash in hand. When true a line is only eligible once the PSP has
     * actually settled the money to us (a `psp_settled` ledger entry exists).
     * Paying before that is lending the vendor our own money. Defaults to false
     * until settlement-report ingestion lands in M5.
     */
    requirePspSettlement: { type: Boolean, default: false },

    /** GST the platform charges on its own commission service. */
    commissionGstBps: { type: Number, default: 1800, min: 0, max: 10000 },

    deductions: {
      commission: { type: Boolean, default: true },
      gstOnCommission: { type: Boolean, default: true },
      tcs: { type: Boolean, default: true },
      tds: { type: Boolean, default: true },
    },

    holdOnDispute: { type: Boolean, default: true },
    negativeBalanceCarryForward: { type: Boolean, default: true },
    /** Batches at or above this need two distinct approvers. */
    dualApprovalPaise: { type: Number, default: 10000000, min: 0 }, // ₹1,00,000
    /** Refuse to build a batch larger than this (blast-radius limit). */
    maxBatchPaise: { type: Number, default: 50000000, min: 0 }, // ₹5,00,000

    isActive: { type: Boolean, default: true },
  },
  { collection: 'payoutpolicies' }
);

PayoutPolicySchema.index(
  { scope: 1, vendorId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

PayoutPolicySchema.plugin(auditPlugin);
PayoutPolicySchema.plugin(softDeletePlugin);
PayoutPolicySchema.plugin(toJSONPlugin);

export default mongoose.model('PayoutPolicy', PayoutPolicySchema);
