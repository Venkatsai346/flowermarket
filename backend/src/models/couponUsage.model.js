/**
 * CouponUsage — one row per coupon redemption (per customer per order).
 *
 * Separate collection (not embedded): a heavy user can redeem a coupon many
 * times over months — embedding would grow the DiscountPolicy document
 * unboundedly. Unique (couponId, orderId) makes double-redemption impossible.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const CouponUsageSchema = new Schema(
  {
    couponId: { type: Types.ObjectId, ref: 'DiscountPolicy', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    discountAmount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, trim: true, maxlength: 32 },
  },
  { collection: 'couponusages' }
);

CouponUsageSchema.index({ couponId: 1, orderId: 1 }, { unique: true });
CouponUsageSchema.index({ userId: 1, couponId: 1, createdAt: -1 });

CouponUsageSchema.plugin(auditPlugin);
CouponUsageSchema.plugin(softDeletePlugin);
CouponUsageSchema.plugin(toJSONPlugin);

export default mongoose.model('CouponUsage', CouponUsageSchema);
