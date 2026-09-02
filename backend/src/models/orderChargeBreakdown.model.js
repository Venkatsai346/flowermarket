/**
 * OrderChargeBreakdown — the IMMUTABLE pricing snapshot of an order (Phase 3.5).
 *
 * The core idea from the doc: persist the breakdown at order time so that
 *  - historical orders keep showing what the customer was actually charged
 *    (even if DeliveryFeePolicy changes tomorrow), and
 *  - refunds compute against persisted per-item amounts (OrderItem.taxAmount /
 *    discountAllocated), never against today's policy.
 *
 * Policy ids are audit refs only — the numbers on this row are the truth.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const OrderChargeBreakdownSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    itemSubtotal: { type: Number, required: true, min: 0 }, // Σ sellingPrice×qty (before discount/tax)
    deliveryFee: { type: Number, required: true, min: 0 },
    taxTotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },

    // ---- policy audit refs (which policy versions produced these numbers) ----
    deliveryFeePolicyId: { type: Types.ObjectId, ref: 'DeliveryFeePolicy', default: null },
    discountPolicyId: { type: Types.ObjectId, ref: 'DiscountPolicy', default: null },
    couponCode: { type: String, default: null, maxlength: 32 },

    createdBy: { type: Types.ObjectId, ref: 'User', default: null }, // order owner
  },
  { collection: 'orderchargebreakdowns', timestamps: true }
);

OrderChargeBreakdownSchema.index({ orderId: 1 }, { unique: true });

OrderChargeBreakdownSchema.plugin(auditPlugin);
OrderChargeBreakdownSchema.plugin(softDeletePlugin);
OrderChargeBreakdownSchema.plugin(toJSONPlugin);

export default mongoose.model('OrderChargeBreakdown', OrderChargeBreakdownSchema);
