/**
 * PayoutBatch — one disbursement to one vendor for one cycle (Phase 6.3).
 *
 * `idempotencyKey` is unique on (vendor, cycle) so recomputing a cycle can
 * never create a second batch, and it is ALSO the key handed to the payment
 * provider — doubled idempotency, because the failure mode this guards against
 * (paying twice) is unrecoverable.
 *
 * `needsReconciliation` is set when a submission ends ambiguously (timeout,
 * 5xx). Such a batch is NEVER retried; the reconciliation sweep resolves it by
 * asking the provider what actually happened.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PAYOUT_STATE, PAYOUT_METHOD, PAYOUT_TRANSFER_MODE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PayoutBatchSchema = new Schema(
  {
    batchNumber: { type: String, required: true, unique: true, maxlength: 32 }, // PO-2609-000007
    vendorId: { type: Types.ObjectId, ref: 'Vendor', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },

    cycle: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      label: { type: String, default: null, maxlength: 40 },
    },

    lineItemCount: { type: Number, default: 0 },
    // ---- the arithmetic (all integer paise) ----
    grossPaise: { type: Number, default: 0 },
    sellerGstPaise: { type: Number, default: 0 },
    commissionPaise: { type: Number, default: 0 },
    gstOnCommissionPaise: { type: Number, default: 0 },
    tcsPaise: { type: Number, default: 0 },
    tdsPaise: { type: Number, default: 0 },
    adjustmentsPaise: { type: Number, default: 0 }, // signed
    openingBalancePaise: { type: Number, default: 0 }, // carried from last cycle (signed)
    netPaise: { type: Number, default: 0 },
    carryForwardPaise: { type: Number, default: 0 }, // below floor / negative → next cycle

    // ---- destination snapshot (never a live reference) ----
    payoutAccount: {
      accountId: { type: Types.ObjectId, ref: 'VendorPayoutAccount', default: null },
      method: { type: String, enum: Object.values(PAYOUT_METHOD), default: null },
      maskedAccount: { type: String, default: null, maxlength: 40 },
      ifsc: { type: String, default: null, maxlength: 11 },
      vpa: { type: String, default: null, maxlength: 100 },
      holderName: { type: String, default: null, maxlength: 120 },
      fingerprint: { type: String, default: null },
    },
    transferMode: { type: String, enum: Object.values(PAYOUT_TRANSFER_MODE), default: null },

    // ---- lifecycle ----
    state: {
      type: String,
      enum: Object.values(PAYOUT_STATE),
      default: PAYOUT_STATE.DRAFT,
      index: true,
    },
    idempotencyKey: { type: String, required: true, unique: true },
    approvals: [{
      userId: { type: Types.ObjectId, ref: 'User' },
      at: { type: Date, default: Date.now },
      note: { type: String, default: null, maxlength: 300 },
    }],
    requiresDualApproval: { type: Boolean, default: false },

    providerRef: { type: String, default: null, index: true },
    providerStatus: { type: String, default: null, maxlength: 40 },
    provider: { type: String, default: null, maxlength: 20 },
    utr: { type: String, default: null, maxlength: 40 },
    failureReason: { type: String, default: null, maxlength: 400 },
    needsReconciliation: { type: Boolean, default: false, index: true },

    submittedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
    ledgerJournalIds: [{ type: Types.ObjectId, ref: 'LedgerJournal' }],
    statementMediaAssetId: { type: Types.ObjectId, ref: 'MediaAsset', default: null },

    initiatedBy: { type: Types.ObjectId, ref: 'User', default: null },
    currency: { type: String, default: 'INR', maxlength: 8 },
  },
  { collection: 'payoutbatches' }
);

PayoutBatchSchema.index({ vendorId: 1, 'cycle.from': 1, 'cycle.to': 1 }, { unique: true });
PayoutBatchSchema.index({ state: 1, submittedAt: 1 });

PayoutBatchSchema.plugin(auditPlugin);
PayoutBatchSchema.plugin(softDeletePlugin);
PayoutBatchSchema.plugin(toJSONPlugin);

export default mongoose.model('PayoutBatch', PayoutBatchSchema);
