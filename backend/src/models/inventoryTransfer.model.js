import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const TransferItemSchema = new Schema({
  tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },
  qty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  failureReason: { type: String, default: null, maxlength: 100 },
  completedAt: { type: Date, default: null },
}, { _id: false });

const InventoryTransferSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  requestKey: { type: String, required: true, trim: true, maxlength: 128 },
  requestFingerprint: { type: String, required: true, maxlength: 64 },
  fromHubId: { type: Types.ObjectId, ref: 'Hub', required: true },
  toHubId: { type: Types.ObjectId, ref: 'Hub', required: true },
  status: { type: String, enum: ['processing', 'completed', 'partial', 'failed'], default: 'processing', index: true },
  items: { type: [TransferItemSchema], required: true },
  transferredCount: { type: Number, default: 0, min: 0 },
  failedCount: { type: Number, default: 0, min: 0 },
  actorId: { type: Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null },
}, { collection: 'inventorytransfers' });

InventoryTransferSchema.index({ tenantId: 1, requestKey: 1 }, { unique: true, name: 'inventory_transfer_idempotency_uq' });
InventoryTransferSchema.index({ tenantId: 1, createdAt: -1 });
InventoryTransferSchema.plugin(auditPlugin);
InventoryTransferSchema.plugin(toJSONPlugin);

export default mongoose.models.InventoryTransfer
  || mongoose.model('InventoryTransfer', InventoryTransferSchema);
