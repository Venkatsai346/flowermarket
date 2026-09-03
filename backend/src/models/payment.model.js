/**
 * Payment — the money movement header for an order.
 *
 * `idempotencyKey` (unique) prevents double-charging on client/orchestrator
 * retries — the doc's "idempotency everywhere money moves" rule. One Payment
 * may have many PaymentTransactions (initial CHARGE + later REFUNDs).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PaymentSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },
    method: {
      type: String,
      enum: Object.values(PAYMENT_METHOD),
      default: PAYMENT_METHOD.UPI,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.MOCK,
    },

    idempotencyKey: { type: String, required: true },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    gatewayOrderId: { type: String, default: null },
    gatewayPaymentId: { type: String, default: null },

    refundedAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },

    // Internal optimistic "only one thread debits the wallet for this Payment"
    // claim. Wallet debits CANNOT be safely retried on a raw idempotency key
    // alone, so a concurrent retry must not race the first debit; the winner
    // holds a token here and the loser heals/retries once the token clears.
    walletClaimToken: { type: String, default: null },
    walletClaimedAt: { type: Date, default: null },
  },
  { collection: 'payments' }
);

PaymentSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
PaymentSchema.index({ orderId: 1 });
PaymentSchema.index({ status: 1, createdAt: 1 }); // reconciliation sweep

PaymentSchema.plugin(auditPlugin);
PaymentSchema.plugin(softDeletePlugin);
PaymentSchema.plugin(toJSONPlugin);

export default mongoose.model('Payment', PaymentSchema);
