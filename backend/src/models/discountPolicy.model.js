/**
 * DiscountPolicy — coupon codes (Phase 3.5).
 *
 * tenantId nullable => platform-wide coupon (usable by any tenant's customers).
 * Discounts are allocated PROPORTIONALLY across order lines by price weight at
 * order time (see PricingPolicyService), and the per-line share is persisted on
 * OrderItem.discountAllocated so refunds can reverse only the returned item's
 * share.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { DISCOUNT_TYPE, COUPON_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DiscountPolicySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true }, // null = platform-wide
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },

    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPE),
      required: true,
    },
    value: { type: Number, required: true, min: 0 }, // flat ₹ or percent

    minCartValue: { type: Number, default: 0, min: 0 },
    maxDiscountCap: { type: Number, default: null, min: 0 }, // null = uncapped
    usageLimitPerCustomer: { type: Number, default: null, min: 1 }, // null = unlimited

    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(COUPON_STATUS),
      default: COUPON_STATUS.ACTIVE,
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { collection: 'discountpolicies' }
);

DiscountPolicySchema.index({ tenantId: 1, code: 1 }, { unique: true });
DiscountPolicySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { tenantId: null } });

DiscountPolicySchema.plugin(auditPlugin);
DiscountPolicySchema.plugin(softDeletePlugin);
DiscountPolicySchema.plugin(toJSONPlugin);

export default mongoose.model('DiscountPolicy', DiscountPolicySchema);
