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
    // Signed-in carts have a userId; anonymous drafts have a guestKey. Checkout
    // always requires a user — guest carts merge on login (cart.service).
    userId: { type: Types.ObjectId, ref: 'User', default: null, index: true },
    guestKey: { type: String, default: null, trim: true, minlength: 16, maxlength: 64, index: true },
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

    // Florist gift draft — copied onto order.giftSnapshot at checkout.
    // Delivery instructions may exist without isGift (gate codes, "call first").
    gift: {
      type: new Schema({
        isGift: { type: Boolean, default: false },
        occasion: { type: String, default: null, maxlength: 32 },
        message: { type: String, default: null, maxlength: 280 },
        senderName: { type: String, default: null, maxlength: 80 },
        recipientName: { type: String, default: null, maxlength: 80 },
        recipientPhone: { type: String, default: null, maxlength: 16 },
        hidePrices: { type: Boolean, default: false },
        deliveryInstructions: { type: String, default: null, maxlength: 240 },
      }, { _id: false }),
      default: () => ({
        isGift: false,
        occasion: null,
        message: null,
        senderName: null,
        recipientName: null,
        recipientPhone: null,
        hidePrices: false,
        deliveryInstructions: null,
      }),
    },

    lastActivityAt: { type: Date, default: Date.now },
    checkedOutAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    // checkout result (kept for reference; order owns the durable truth)
    lastCheckoutMeta: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'carts' }
);

// one active cart per (tenant, user) — partial so guest carts (no userId) do not collide
CartSchema.index(
  { tenantId: 1, userId: 1, status: 1 },
  {
    unique: true,
    name: 'uniq_active_user_cart',
    partialFilterExpression: { status: 'active', userId: { $exists: true, $type: 'objectId' } },
  }
);
// one active cart per (tenant, guest key)
CartSchema.index(
  { tenantId: 1, guestKey: 1, status: 1 },
  {
    unique: true,
    name: 'uniq_active_guest_cart',
    partialFilterExpression: { status: 'active', guestKey: { $type: 'string' } },
  }
);
// abandoned-cart TTL (30 days)
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'active' } });

CartSchema.plugin(auditPlugin);
CartSchema.plugin(softDeletePlugin);
CartSchema.plugin(toJSONPlugin);

export default mongoose.model('Cart', CartSchema);
