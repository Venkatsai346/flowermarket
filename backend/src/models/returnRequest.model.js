/**
 * ReturnRequest — the two return flows from the doc:
 *   A) PICKUP_QC   : physical pickup + QC before refund (packaged goods)
 *   B) INSTANT_CLAIM: perishable quality-guarantee — no pickup, refund direct
 *
 * `eligibility` records the check result (window, returnable items, claim count).
 * `autoApproved` marks the fraud-guard auto-approval path.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  RETURN_CLAIM_TYPE,
  RETURN_REQUEST_STATUS,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const EligibilitySchema = new Schema(
  {
    isEligible: { type: Boolean, default: false },
    windowExpired: { type: Boolean, default: false },
    nonReturnableItems: { type: Boolean, default: false },
    claimLimitReached: { type: Boolean, default: false },
    reason: { type: String, default: null, maxlength: 300 },
  },
  { _id: false }
);

const ReviewSchema = new Schema(
  {
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 500 },
  },
  { _id: false }
);

const ReturnRequestSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    claimType: {
      type: String,
      enum: Object.values(RETURN_CLAIM_TYPE),
      required: true,
    },
    reasonCode: { type: String, default: null, maxlength: 60 },
    reason: { type: String, required: true, maxlength: 500 },
    customerNote: { type: String, default: null, maxlength: 500 },

    status: {
      type: String,
      enum: Object.values(RETURN_REQUEST_STATUS),
      default: RETURN_REQUEST_STATUS.REQUESTED,
      index: true,
    },

    refundAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },

    eligibility: { type: EligibilitySchema, default: () => ({}) },
    autoApproved: { type: Boolean, default: false },
    review: { type: ReviewSchema, default: () => ({}) },
    refundTransactionId: { type: Types.ObjectId, ref: 'RefundTransaction', default: null },

    pickupScheduledAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    qcCompletedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'returnrequests' }
);

ReturnRequestSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
ReturnRequestSchema.index({ orderId: 1 });
ReturnRequestSchema.index({ status: 1, createdAt: 1 }); // ops queue

ReturnRequestSchema.plugin(auditPlugin);
ReturnRequestSchema.plugin(softDeletePlugin);
ReturnRequestSchema.plugin(toJSONPlugin);

export default mongoose.model('ReturnRequest', ReturnRequestSchema);
