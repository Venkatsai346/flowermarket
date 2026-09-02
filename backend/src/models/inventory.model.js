/**
 * Inventory — stock truth per tenant listing (+ optional warehouse/location).
 *
 * DESIGN NOTES:
 *  - qtyOnHand = physical stock; qtyReserved = held for open carts/orders.
 *  - qtyAvailable = onHand - reserved (computed virtual, not stored).
 *  - Reservation is atomic: findOneAndUpdate guarded by `qtyReserved + qty <= qtyOnHand`
 *    so over-reservation is impossible even under concurrency.
 *  - `version` for optimistic locking on manual set/adjust.
 *  - The TenantProduct.stockQty is a denormalized snapshot of qtyOnHand, refreshed
 *    by the inventory service so customer queries never join.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const InventorySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
    warehouseId: { type: Types.ObjectId, ref: 'Location', default: null }, // null = default store

    qtyOnHand: { type: Number, default: 0, min: 0 },
    qtyReserved: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
    },
    version: { type: Number, default: 1, min: 1 },
    lastUpdatedAt: { type: Date, default: null },
  },
  { collection: 'inventories' }
);

InventorySchema.virtual('qtyAvailable').get(function () {
  return Math.max(0, this.qtyOnHand - this.qtyReserved);
});

InventorySchema.index({ tenantProductId: 1, warehouseId: 1 }, { unique: true });
InventorySchema.index({ tenantId: 1, status: 1 });

InventorySchema.plugin(auditPlugin);
InventorySchema.plugin(softDeletePlugin);
InventorySchema.plugin(toJSONPlugin);

export default mongoose.model('Inventory', InventorySchema);
