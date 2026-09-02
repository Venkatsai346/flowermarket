/**
 * RefundTransaction — one refund leg (order cancellation / return QC pass /
 * instant claim / admin override). `idempotencyKey` unique -> no double refunds.
 * `destination` WALLET (instant) vs ORIGINAL_METHOD (gateway round-trip).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  REFUND_DESTINATION,
  REFUND_TRANSACTION_STATUS,
  REFUND_REASON,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const RefundTransactionSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    paymentId: { type: Types.ObjectId, ref: 'Payment', default: null },
    returnRequestId: { type: Types.ObjectId, ref: 'ReturnRequest', default: null },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },
    reason: { type: String, enum: Object.values(REFUND_REASON), required: true },

    // ---- Phase 3.5: component breakdown (finance/credit-note compliant).
    //      `amount` = totalRefund = item + tax + fee. Storing components
    //      separately lets a GST credit note show reversed tax as its own
    //      line — required the moment refunds scale past manual handling. ----
    refundItemAmount: { type: Number, default: 0, min: 0 },
    refundTaxAmount: { type: Number, default: 0, min: 0 },
    refundFeeAmount: { type: Number, default: 0, min: 0 },

    destination: {
      type: String,
      enum: Object.values(REFUND_DESTINATION),
      default: REFUND_DESTINATION.WALLET,
    },
    status: {
      type: String,
      enum: Object.values(REFUND_TRANSACTION_STATUS),
      default: REFUND_TRANSACTION_STATUS.PENDING,
      index: true,
    },

    idempotencyKey: { type: String, required: true },
    gatewayRef: { type: String, default: null },
    walletTxnId: { type: Types.ObjectId, ref: 'WalletTransaction', default: null },
    rawGatewayResponse: { type: Schema.Types.Mixed, default: null },

    initiatedBy: { type: Types.ObjectId, ref: 'User', default: null },
    initiatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },
  },
  { collection: 'refundtransactions' }
);

RefundTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
RefundTransactionSchema.index({ orderId: 1 });
RefundTransactionSchema.index({ status: 1, createdAt: 1 }); // reconciliation sweep
RefundTransactionSchema.index({ userId: 1, createdAt: -1 });

RefundTransactionSchema.plugin(auditPlugin);
RefundTransactionSchema.plugin(softDeletePlugin);
RefundTransactionSchema.plugin(toJSONPlugin);

export default mongoose.model('RefundTransaction', RefundTransactionSchema);
