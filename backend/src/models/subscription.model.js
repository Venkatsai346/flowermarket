/**
 * Subscription — recurring order model (Phase 7.8.1).
 *
 * A CUSTOMER's frequency ordering: weekly / bi-weekly / monthly delivery
 * cadence. The scheduler (subscription.service.js) runs daily and creates
 * orders for subscriptions whose nextDeliveryAt has come due. Pause / resume /
 * cancel lifecycle, per-subscription pricing locked at subscribe time, skip
 * next delivery.
 *
 * NOT tenant plan billing — that is TenantSubscription (`tenant_subscriptions`
 * collection, TENANT_SUBSCRIPTION_STATUS). See the vocabulary header in
 * constants/enums.js before touching either file.
 */

import mongoose from 'mongoose';
import {
  softDeletePlugin,
  auditPlugin,
  toJSONPlugin,
} from './plugins/index.js';

import {
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_FREQUENCY,
} from '../constants/enums.js';

// Re-exported so Phase 7.8.1 consumers keep importing from the model file;
// the canonical home is constants/enums.js.
export {
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_FREQUENCY,
};

const { Schema, Types } = mongoose;

const SubscriptionSchema = new Schema(
  {
    tenantId: {
      type: Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    userId: {
      type: Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    items: [
      {
        tenantProductId: {
          type: Types.ObjectId,
          ref: 'TenantProduct',
          required: true,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        // Locked at subscribe time
        unitPrice: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

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

    nextDeliveryAt: {
      type: Date,
      required: true,
      index: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    // null = indefinite
    endDate: {
      type: Date,
      default: null,
    },

    // Delivery preferences
    deliveryAddress: {
      type: Types.ObjectId,
      ref: 'Address',
      default: null,
    },

    preferredSlotId: {
      type: Types.ObjectId,
      default: null,
    },

    // Billing
    paymentMethodId: {
      type: String,
      default: null,
    },

    totalOrders: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      default: 0,
    },

    // Pause / resume
    pausedAt: {
      type: Date,
      default: null,
    },

    pauseReason: {
      type: String,
      default: '',
    },

    resumedAt: {
      type: Date,
      default: null,
    },

    // Cancellation
    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelReason: {
      type: String,
      default: '',
    },

    // Metadata
    notes: {
      type: String,
      default: '',
    },
  },
  {
    collection: 'subscriptions',
  },
);

// Find subscriptions due for order generation
SubscriptionSchema.index({
  status: 1,
  nextDeliveryAt: 1,
});

// User's subscriptions
SubscriptionSchema.index({
  tenantId: 1,
  userId: 1,
  status: 1,
});

SubscriptionSchema.plugin(auditPlugin);
SubscriptionSchema.plugin(softDeletePlugin);
SubscriptionSchema.plugin(toJSONPlugin);

export default mongoose.model(
  'Subscription',
  SubscriptionSchema,
);
