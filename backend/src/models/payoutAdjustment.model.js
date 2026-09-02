/**
 * PayoutAdjustment — a manual, reason-coded correction to a vendor's balance.
 * Signed paise: negative = penalty/clawback, positive = goodwill/correction.
 * Applied to the next computed batch, then pinned to it so it can never be
 * consumed twice.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PAYOUT_ADJUSTMENT_REASON } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PayoutAdjustmentSchema = new Schema(
  {
    vendorId: { type: Types.ObjectId, ref: 'Vendor', required: true, index: true },
    amountPaise: { type: Number, required: true }, // signed
    reasonCode: { type: String, enum: Object.values(PAYOUT_ADJUSTMENT_REASON), required: true },
    note: { type: String, default: null, maxlength: 400 },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null },
    appliedInBatchId: { type: Types.ObjectId, ref: 'PayoutBatch', default: null, index: true },
    appliedAt: { type: Date, default: null },
    createdByUserId: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'payoutadjustments' }
);

PayoutAdjustmentSchema.index({ vendorId: 1, appliedInBatchId: 1 });

PayoutAdjustmentSchema.plugin(auditPlugin);
PayoutAdjustmentSchema.plugin(softDeletePlugin);
PayoutAdjustmentSchema.plugin(toJSONPlugin);

export default mongoose.model('PayoutAdjustment', PayoutAdjustmentSchema);
