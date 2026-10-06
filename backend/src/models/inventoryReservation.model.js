import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';
import { INVENTORY_RESERVATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TransitionSchema = new Schema({
  from: { type: String, default: null },
  to: { type: String, required: true },
  reason: { type: String, default: null, maxlength: 120 },
  at: { type: Date, default: Date.now },
  actorId: { type: Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const InventoryReservationSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
  userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 160 },
  tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
  inventoryId: { type: Types.ObjectId, ref: 'Inventory', required: true },
  warehouseId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true },
  qty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  policySafetyStock: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  status: {
    type: String, enum: Object.values(INVENTORY_RESERVATION_STATUS),
    default: INVENTORY_RESERVATION_STATUS.ALLOCATING, index: true,
  },
  expiresAt: { type: Date, required: true, index: true },
  confirmedAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null },
  releaseReason: { type: String, default: null, maxlength: 120 },
  version: { type: Number, default: 1, min: 1 },
  transitions: { type: [TransitionSchema], default: [] },
}, { collection: 'inventoryreservations' });

InventoryReservationSchema.index(
  { tenantId: 1, orderId: 1, tenantProductId: 1, warehouseId: 1 },
  { unique: true, name: 'inventory_reservation_order_line_uq' },
);
InventoryReservationSchema.index(
  { tenantId: 1, idempotencyKey: 1, tenantProductId: 1, warehouseId: 1 },
  { unique: true, name: 'inventory_reservation_idempotency_uq' },
);
InventoryReservationSchema.index({ status: 1, expiresAt: 1 }, { name: 'inventory_reservation_expiry_idx' });
InventoryReservationSchema.index({ tenantId: 1, warehouseId: 1, status: 1 });
InventoryReservationSchema.plugin(auditPlugin);
InventoryReservationSchema.plugin(toJSONPlugin);

export default mongoose.models.InventoryReservation
  || mongoose.model('InventoryReservation', InventoryReservationSchema);
