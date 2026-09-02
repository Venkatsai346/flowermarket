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

    lineTotal: { type: Number, default: 0, min: 0 }, // qty * sellingPrice
    isReturnable: { type: Boolean, default: true },

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
