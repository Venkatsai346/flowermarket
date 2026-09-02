/**
 * OrderItem — one line of an order (own collection).
 *
 * `skuSnapshot` (title/image/unit at order time) keeps order history correct even
 * if the catalog changes later — the doc's "history integrity" requirement.
 * `isReturnable` is evaluated at order time (perishables -> false for pickup).
 * Returned/cancelled qty track partials.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const OrderItemSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true },
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null },

    // ---- Phase 5: marketplace attribution (snapshot at order time) ----
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },

    // ---- snapshot at order time ----
    skuSnapshot: {
      skuGlobal: { type: String, default: null },
      title: { type: String, required: true, maxlength: 200 },
      imageUrl: { type: String, default: null },
      unit: { type: String, default: null },
    },
    priceAtOrder: {
      mrp: { type: Number, min: 0, default: null },
      sellingPrice: { type: Number, required: true, min: 0 },
      currency: { type: String, default: 'INR' },
    },
    qty: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },

    // ---- Phase 3.5: per-item pricing breakdown (persisted at order time,
    //      NEVER recomputed — the basis for correct partial refunds) ----
    taxAmount: { type: Number, default: 0, min: 0 },
    discountAllocated: { type: Number, default: 0, min: 0 },
    taxPolicyId: { type: Types.ObjectId, ref: 'TaxPolicy', default: null },
    hsnCode: { type: String, default: null, maxlength: 16 },

    isReturnable: { type: Boolean, default: true },
    returnedQty: { type: Number, default: 0, min: 0 },
    cancelledQty: { type: Number, default: 0, min: 0 },
  },
  { collection: 'orderitems' }
);

OrderItemSchema.index({ orderId: 1, tenantProductId: 1 });

OrderItemSchema.plugin(auditPlugin);
OrderItemSchema.plugin(softDeletePlugin);
OrderItemSchema.plugin(toJSONPlugin);

export default mongoose.model('OrderItem', OrderItemSchema);
