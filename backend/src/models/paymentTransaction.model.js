/**
 * PaymentTransaction — CHARGE / REFUND legs of a Payment.
 * `idempotencyKey` dedupes retries; `rawGatewayResponse` keeps provider payloads
 * for reconciliation/debugging.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  PAYMENT_TRANSACTION_TYPE,
  PAYMENT_TRANSACTION_STATUS,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PaymentTransactionSchema = new Schema(
  {
    paymentId: { type: Types.ObjectId, ref: 'Payment', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    type: {
      type: String,
      enum: Object.values(PAYMENT_TRANSACTION_TYPE),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_TRANSACTION_STATUS),
      default: PAYMENT_TRANSACTION_STATUS.PENDING,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },

    idempotencyKey: { type: String, required: true },
    gatewayRef: { type: String, default: null },
    rawGatewayResponse: { type: Schema.Types.Mixed, default: null },

    completedAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },
  },
  { collection: 'paymenttransactions' }
);

PaymentTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentTransactionSchema.index({ paymentId: 1, type: 1 });
PaymentTransactionSchema.index({ status: 1, createdAt: 1 });

PaymentTransactionSchema.plugin(auditPlugin);
PaymentTransactionSchema.plugin(softDeletePlugin);
PaymentTransactionSchema.plugin(toJSONPlugin);

export default mongoose.model('PaymentTransaction', PaymentTransactionSchema);
