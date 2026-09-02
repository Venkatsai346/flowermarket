/**
 * Order — the saga-orchestrated business transaction (per the order-lifecycle doc).
 *
 * DESIGN NOTES:
 *  - Items are NOT embedded -> OrderItem collection (bounded docs).
 *  - `addressSnapshot` + `slotSnapshot` are denormalized AT ORDER TIME so history
 *    stays correct even if the user edits their address or slots are re-planned.
 *  - `version` = optimistic locking during saga steps (two concurrent admin
 *    actions must not silently overwrite).
 *  - Status machine (ORDER_STATUS) transitions are validated by a central state
 *    machine util; every transition writes an OrderStatusHistory row.
 *  - `cancellation` records the reverse-saga outcome (refund status etc.).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  ORDER_STATUS,
  ORDER_CANCELLATION_REASON,
  ORDER_SOURCE,
  PAYMENT_METHOD,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AddressSnapshotSchema = new Schema(
  {
    addressId: { type: Types.ObjectId, ref: 'Address', required: true },
    name: { type: String, default: null },
    phone: { type: String, default: null },
    line1: { type: String, required: true },
    line2: { type: String, default: null },
    landmark: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    pincode: { type: String, required: true },
    coordinates: { type: [Number], default: null },
  },
  { _id: false }
);

const SlotSnapshotSchema = new Schema(
  {
    slotId: { type: Types.ObjectId, ref: 'DeliverySlot', required: true },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    displayLabel: { type: String, default: null },
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null },
    windowType: { type: String, default: 'normal' }, // normal | express | ... (fee surge input)
  },
  { _id: false }
);

const CancellationSchema = new Schema(
  {
    reason: {
      type: String,
      enum: Object.values(ORDER_CANCELLATION_REASON),
      default: null,
    },
    reasonText: { type: String, default: null, maxlength: 500 },
    cancelledBy: { type: Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'success', 'failed'],
      default: 'not_applicable',
    },
    refundTransactionId: { type: Types.ObjectId, ref: 'RefundTransaction', default: null },
  },
  { _id: false }
);

const OrderSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, index: true }, // e.g. FM-260831-00042

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.CREATED,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(ORDER_SOURCE),
      default: ORDER_SOURCE.APP,
    },

    // ---- totals (recomputed at checkout; snapshot semantics) ----
    itemsCount: { type: Number, default: 0, min: 0 },
    itemsSubtotal: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },

    // ---- fulfilment context ----
    cartId: { type: Types.ObjectId, ref: 'Cart', default: null },
    slotReservationId: { type: Types.ObjectId, ref: 'SlotReservation', default: null, index: true },
    slotSnapshot: { type: SlotSnapshotSchema, default: null },
    addressSnapshot: { type: AddressSnapshotSchema, default: null },

    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHOD),
      default: PAYMENT_METHOD.UPI,
    },
    paymentSummary: {
      paymentId: { type: Types.ObjectId, ref: 'Payment', default: null },
      status: { type: String, enum: ['pending', 'success', 'failed', 'refunded', 'partially_refunded'], default: 'pending' },
      paidAt: { type: Date, default: null },
      refundedAmount: { type: Number, default: 0, min: 0 },
    },

    // ---- Phase 3.5: immutable charge breakdown (see OrderChargeBreakdown) ----
    chargeBreakdownId: { type: Types.ObjectId, ref: 'OrderChargeBreakdown', default: null },
    couponCode: { type: String, default: null, maxlength: 32 },

    cancellation: { type: CancellationSchema, default: () => ({}) },

    deliveryRetryCount: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 1, min: 1 }, // optimistic lock during saga steps
  },
  { collection: 'orders' }
);

OrderSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });

OrderSchema.plugin(auditPlugin);
OrderSchema.plugin(softDeletePlugin);
OrderSchema.plugin(toJSONPlugin);

export default mongoose.model('Order', OrderSchema);
