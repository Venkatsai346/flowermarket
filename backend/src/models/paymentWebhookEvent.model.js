/**
 * PaymentWebhookEvent — durable, event-level idempotency + audit trail for
 * gateway webhooks.
 *
 * WHY (beyond payment-state idempotency):
 *  - Gateways RETRY deliveries (Razorpay retries up to days). The same
 *    `eventId` can arrive N times. The UNIQUE (provider, eventId) index makes
 *    the first arrival win; replays are recorded as `duplicate` and never
 *    re-enter the state machine.
 *  - `mismatch` rows (gateway amount ≠ our recorded amount) are the fraud/
 *    misrouting signal: the payment is left untouched (PENDING) and the row
 *    is the audit evidence an operator investigates.
 *  - Gives the ops UI / metrics a per-event history of what the gateway told
 *    us and what we did with it — the "who moved the money, and why" log.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const PAYMENT_WEBHOOK_EVENT_STATUS = Object.freeze({
  RECEIVED: 'received',
  PROCESSED: 'processed',
  DUPLICATE: 'duplicate',
  MISMATCH: 'mismatch',
  IGNORED: 'ignored', // unknown payment / unrelated event type
});

const PaymentWebhookEventSchema = new Schema(
  {
    provider: { type: String, required: true, maxlength: 40 },
    eventId: { type: String, required: true, maxlength: 120 },
    eventType: { type: String, required: true, maxlength: 80 }, // e.g. payment.captured
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    paymentId: { type: Types.ObjectId, ref: 'Payment', default: null },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null },
    gatewayPaymentId: { type: String, default: null, maxlength: 120 },
    gatewayOrderId: { type: String, default: null, maxlength: 120 },
    amountPaise: { type: Number, default: null },
    currency: { type: String, default: null, maxlength: 8 },

    status: {
      type: String,
      enum: Object.values(PAYMENT_WEBHOOK_EVENT_STATUS),
      default: PAYMENT_WEBHOOK_EVENT_STATUS.RECEIVED,
      index: true,
    },
    note: { type: String, default: null, maxlength: 300 },
    raw: { type: Schema.Types.Mixed, default: null },
    processedAt: { type: Date, default: null },
    // delivery bookkeeping (replays increment; the terminal `status` is
    // first-writer-wins and is never overwritten by a replay)
    deliveries: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    // dedicated TTL expiry (repo convention — auditPlugin already owns the
    // plain `createdAt_1` index, and Mongo forbids a second index on the
    // same key with different options)
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  },
  { collection: 'paymentwebhookevents' }
);

// the idempotency backbone: one winner per (provider, eventId)
PaymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
// TTL: raw payloads are audit evidence; 30 days is plenty for disputes
PaymentWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

PaymentWebhookEventSchema.plugin(auditPlugin);
PaymentWebhookEventSchema.plugin(softDeletePlugin);
PaymentWebhookEventSchema.plugin(toJSONPlugin);

export { PAYMENT_WEBHOOK_EVENT_STATUS };
export default mongoose.model('PaymentWebhookEvent', PaymentWebhookEventSchema);
