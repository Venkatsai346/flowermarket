import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const ShipmentItemSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
  shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true, index: true },
  orderItemId: { type: Types.ObjectId, ref: 'OrderItem', required: true, index: true },
  tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },
  qty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  lineTotal: { type: Number, required: true, min: 0 },
  taxAmount: { type: Number, default: 0, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  cancelledQty: { type: Number, default: 0, min: 0 },
  returnedQty: { type: Number, default: 0, min: 0 },
}, { collection: 'shipmentitems' });

ShipmentItemSchema.index({ tenantId: 1, shipmentId: 1, orderItemId: 1 }, { unique: true, name: 'shipment_item_line_uq' });
ShipmentItemSchema.index({ tenantId: 1, orderId: 1, shipmentId: 1 }, { name: 'shipment_item_order_idx' });
ShipmentItemSchema.plugin(auditPlugin);
ShipmentItemSchema.plugin(toJSONPlugin);

export default mongoose.models.ShipmentItem || mongoose.model('ShipmentItem', ShipmentItemSchema);
