/**
 * Cart — the disposable, fast-mutating draft (per the order-lifecycle doc).
 *
 * DESIGN NOTES:
 *  - Redis-primary in the reference; here Mongo is the store (single infra),
 *    keeping the SAME contract: one Cart per (tenant, user) while active,
 *    price/stock SNAPSHOTS at add-time, re-validated only at checkout.
 *  - Items live in `cartitems` (own collection — no unbounded arrays).
 *  - TTL index expires abandoned carts (30 days); expiry leaves items orphaned
 *    and they are cleaned lazily (or by a sweep).
 *  - subtotal/itemCount are denormalized counters for cheap reads; recomputed
 *    on every mutation.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { CART_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const CartSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(CART_STATUS),
      default: CART_STATUS.ACTIVE,
      index: true,
    },
    itemCount: { type: Number, default: 0, min: 0 },
    distinctItems: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 }, // sum of line totals (snapshot)
    currency: { type: String, default: 'INR', maxlength: 8 },

    // Phase 3.5: coupon applied to this cart (validated at apply-time, charged
    // at checkout; the discount share is computed in computeOrderCharges)
    couponCode: { type: String, default: null, trim: true, uppercase: true, maxlength: 32 },
    couponId: { type: Types.ObjectId, ref: 'DiscountPolicy', default: null },

    lastActivityAt: { type: Date, default: Date.now },
    checkedOutAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    // checkout result (kept for reference; order owns the durable truth)
    lastCheckoutMeta: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'carts' }
);

// one active cart per (tenant, user)
CartSchema.index(
  { tenantId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
// abandoned-cart TTL (30 days)
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'active' } });

CartSchema.plugin(auditPlugin);
CartSchema.plugin(softDeletePlugin);
CartSchema.plugin(toJSONPlugin);

export default mongoose.model('Cart', CartSchema);
