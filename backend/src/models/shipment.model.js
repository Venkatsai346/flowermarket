import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

export const SHIPMENT_STATUS = Object.freeze({
  PLANNED: 'planned', QUEUED: 'queued', PICKING: 'picking', PACKED: 'packed',
  OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered',
  DELIVERY_FAILED: 'delivery_failed', CANCELLED: 'cancelled',
});

const ShipmentSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
  shipmentNumber: { type: String, required: true, maxlength: 80 },
  sequence: { type: Number, required: true, min: 1 },
  hubId: { type: Types.ObjectId, ref: 'Hub', required: true, index: true },
  warehouseCode: { type: String, default: null, maxlength: 40 },
  status: { type: String, enum: Object.values(SHIPMENT_STATUS), default: SHIPMENT_STATUS.PLANNED, index: true },
  itemsCount: { type: Number, default: 0, min: 0 },
  unitsCount: { type: Number, default: 0, min: 0 },
  merchandiseTotal: { type: Number, default: 0, min: 0 },
  deliveryFee: { type: Number, default: 0, min: 0 },
  taxAmount: { type: Number, default: 0, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  promiseMinAt: { type: Date, default: null },
  promiseMaxAt: { type: Date, default: null },
  distanceKm: { type: Number, default: null, min: 0 },
  trackingCode: { type: String, required: true, maxlength: 96 },
  carrierName: { type: String, default: null, maxlength: 120 },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, default: null, maxlength: 300 },
  cancellation: {
    inventoryRestoredAt: { type: Date, default: null },
    refundStatus: { type: String, enum: ['not_applicable', 'pending', 'success', 'failed'], default: 'not_applicable' },
    refundAmount: { type: Number, default: 0, min: 0 },
    refundTransactionId: { type: Types.ObjectId, ref: 'RefundTransaction', default: null },
    requestedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  deliveredAt: { type: Date, default: null },
  version: { type: Number, default: 1, min: 1 },
}, { collection: 'shipments' });

ShipmentSchema.index({ tenantId: 1, orderId: 1, sequence: 1 }, { unique: true, name: 'shipment_order_sequence_uq' });
ShipmentSchema.index({ tenantId: 1, shipmentNumber: 1 }, { unique: true, name: 'shipment_number_uq' });
ShipmentSchema.index({ tenantId: 1, trackingCode: 1 }, { unique: true, name: 'shipment_tracking_uq' });
ShipmentSchema.index({ tenantId: 1, status: 1, promiseMaxAt: 1 });
ShipmentSchema.plugin(auditPlugin);
ShipmentSchema.plugin(toJSONPlugin);

export default mongoose.models.Shipment || mongoose.model('Shipment', ShipmentSchema);
