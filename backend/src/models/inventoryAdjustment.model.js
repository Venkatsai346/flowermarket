/**
 * InventoryAdjustment — append-only manual stock ledger (admin dashboard, Phase 4).
 *
 * Rows are NEVER mutated or deleted. Every manual stock change (restock,
 * shrinkage, audit correction, return restock) writes one row with the
 * before/after quantities so the ledger is a complete, auditable trail.
 *
 * Order-driven movements (commit/restore at checkout) are NOT duplicated here —
 * they are derivable from orders; this collection records the OPS decisions.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { INVENTORY_ADJUSTMENT_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const InventoryAdjustmentSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    inventoryId: { type: Types.ObjectId, ref: 'Inventory', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
    warehouseId: { type: Types.ObjectId, ref: 'Location', default: null }, // null = default store

    type: {
      type: String,
      enum: Object.values(INVENTORY_ADJUSTMENT_TYPE),
      required: true,
    },
    qtyChange: { type: Number, required: true }, // signed, never 0
    qtyBefore: { type: Number, required: true, min: 0 },
    qtyAfter: { type: Number, required: true, min: 0 },

    reason: { type: String, required: true, trim: true, maxlength: 300 },
    note: { type: String, default: null, trim: true, maxlength: 500 },

    // optional reference (e.g. a return request that restocked goods)
    refType: { type: String, default: null },
    refId: { type: Types.ObjectId, default: null },

    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    actorType: { type: String, default: 'admin' },
  },
  { collection: 'inventoryadjustments' }
);

InventoryAdjustmentSchema.index({ tenantId: 1, tenantProductId: 1, createdAt: -1 });
InventoryAdjustmentSchema.index({ tenantId: 1, inventoryId: 1, createdAt: -1 });

InventoryAdjustmentSchema.plugin(auditPlugin);
InventoryAdjustmentSchema.plugin(softDeletePlugin);
InventoryAdjustmentSchema.plugin(toJSONPlugin);

export default mongoose.model('InventoryAdjustment', InventoryAdjustmentSchema);
