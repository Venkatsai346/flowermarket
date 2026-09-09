/**
 * Subscription — recurring order model (Phase 7.8.1).
 *
 * Supports:
 *   - Weekly / bi-weekly / monthly delivery cadence
 *   - Auto-generates orders on schedule
 *   - Pause / resume / cancel lifecycle
 *   - Per-subscription pricing (locked at subscribe time)
 *   - Skip next delivery
 *
 * The scheduler (subscription.service.js) runs daily and creates orders
 * for subscriptions whose nextDeliveryAt has come due.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const SUBSCRIPTION_FREQUENCY = Object.freeze({
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
});

const SubscriptionSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    items: [{
      tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },
      quantity: { type: Number, required: true, min: 1 },
      unitPrice: { type: Number, required: true, min: 0 }, // locked at subscribe time
    }],

    frequency: {
      type: String,
      enum: Object.values(SUBSCRIPTION_FREQUENCY),
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.ACTIVE,
      index: true,
    },

    nextDeliveryAt: { type: Date, required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null }, // null = indefinite

    // Delivery preferences
    deliveryAddress: { type: Types.ObjectId, ref: 'Address', default: null },
    preferredSlotId: { type: Types.ObjectId, default: null },

    // Billing
    paymentMethodId: { type: String, default: null }, // Razorpay token
    totalOrders: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    // Pause/resume
    pausedAt: { type: Date, default: null },
    pauseReason: { type: String, default: '' },
    resumedAt: { type: Date, default: null },

    // Cancellation
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },

    // Metadata
    notes: { type: String, default: '' },
  },
  { collection: 'subscriptions' }
);

// Find subscriptions due for order generation
SubscriptionSchema.index({ status: 1, nextDeliveryAt: 1 });

// User's subscriptions
SubscriptionSchema.index({ tenantId: 1, userId: 1, status: 1 });

SubscriptionSchema.plugin(auditPlugin);
SubscriptionSchema.plugin(softDeletePlugin);
SubscriptionSchema.plugin(toJSONPlugin);

export default mongoose.model('Subscription', SubscriptionSchema);
