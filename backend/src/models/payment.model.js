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
  USER_ROLES,
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
    // end-to-end correlation id (Phase 10) — inherited from the order
    traceId: { type: String, default: null, index: true },

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

    // ---- cash on delivery: the money fact that happens at the door ----
    /**
     * `amount` is what the customer owes at the door; `amountCollected` is what
     * the rider actually recorded. They must agree — a shortfall is a theft or
     * shortage signal, never a rounding error, so `collectCashOnDelivery()`
     * refuses to post the ledger entry unless the two match exactly.
     */
    amountCollected: { type: Number, default: null, min: 0 },
    collectedAt: { type: Date, default: null, index: true },
    collectedBy: { type: Types.ObjectId, ref: 'User', default: null },
    collectedByRole: {
      type: String,
      enum: [...Object.values(USER_ROLES), null],
      default: null,
    },
    collectionNote: { type: String, default: null, maxlength: 300 },
    /**
     * Remittance: when the collected notes were actually banked. Cash sits in
     * `cash_on_hand` between collection and deposit, which is why the two
     * moments are stored separately — the gap is exactly the exposure a finance
     * team wants to see ("how much cash is on bikes, and since when?").
     */
    depositedAt: { type: Date, default: null },
    depositRef: { type: String, default: null, maxlength: 80 },

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
// COD ops queue: outstanding cash, oldest first (also the aging report)
PaymentSchema.index({ provider: 1, status: 1, collectedAt: 1 });

PaymentSchema.plugin(auditPlugin);
PaymentSchema.plugin(softDeletePlugin);
PaymentSchema.plugin(toJSONPlugin);

export default mongoose.model('Payment', PaymentSchema);
