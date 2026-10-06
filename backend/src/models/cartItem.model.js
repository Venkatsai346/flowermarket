/**
 * CartItem — one line of a cart. Own collection (bounded carts; no 16MB risk).
 *
 * `priceSnapshot` and `stockSnapshot` are captured at add/update time and are
 * NEVER trusted at checkout — checkout re-fetches live price/stock and shows the
 * customer any diff for explicit re-confirmation (the stale-cart problem solved).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const PriceSnapshotSchema = new Schema(
  {
    mrp: { type: Number, min: 0, default: null },
    sellingPrice: { type: Number, min: 0, default: null },
    currency: { type: String, default: 'INR' },
  },
  { _id: false }
);

const CartItemSchema = new Schema(
  {
    cartId: { type: Types.ObjectId, ref: 'Cart', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true },
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null },

    qty: { type: Number, required: true, min: 1, max: 999 },

    // ---- snapshots at add-time ----
    priceSnapshot: { type: PriceSnapshotSchema, required: true },
    stockSnapshot: {
      availableQty: { type: Number, default: 0, min: 0 },
      checkedAt: { type: Date, default: Date.now },
    },
    titleSnapshot: { type: String, default: null, maxlength: 200 },
    imageUrlSnapshot: { type: String, default: null },
    unitSnapshot: { type: String, default: null },
    unitQuantitySnapshot: { type: Number, default: 1, min: Number.EPSILON },

    lineTotal: { type: Number, default: 0, min: 0 }, // qty * sellingPrice
    // Immutable commercial promise captured when the line enters the cart.
    returnPolicySnapshot: {
      mode: { type: String, enum: ['returnable', 'quality_claim_only', 'final_sale'], default: 'returnable' },
      returnWindowDays: { type: Number, min: 0, max: 365, default: 7 },
      instantClaimHours: { type: Number, min: 0, max: 720, default: 24 },
      requiresQc: { type: Boolean, default: true },
      customerNote: { type: String, default: null, maxlength: 300 },
    },
    isReturnable: { type: Boolean, default: true },
    /** PII-free search query attribution, verified when the line is added. */
    searchQueryId: { type: String, default: null, maxlength: 64 },
    fulfillmentSnapshot: {
      pincode: { type: String, default: null, maxlength: 12 },
      warehouseId: { type: Types.ObjectId, ref: 'Hub', default: null },
      warehouseName: { type: String, default: null, maxlength: 120 },
      allocatableQty: { type: Number, default: 0, min: 0 },
      networkAvailableQty: { type: Number, default: 0, min: 0 },
      promiseMinAt: { type: Date, default: null },
      promiseMaxAt: { type: Date, default: null },
      checkedAt: { type: Date, default: null },
    },

    addedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'cartitems' }
);

CartItemSchema.index({ cartId: 1, tenantProductId: 1 }, { unique: true });

CartItemSchema.plugin(auditPlugin);
CartItemSchema.plugin(softDeletePlugin);
CartItemSchema.plugin(toJSONPlugin);

export default mongoose.model('CartItem', CartItemSchema);
