/**
 * ReturnItem — which order items (and qty) are being returned, + QC outcome.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { RETURN_QC_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ReturnItemSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    returnRequestId: { type: Types.ObjectId, ref: 'ReturnRequest', required: true, index: true },
    orderItemId: { type: Types.ObjectId, ref: 'OrderItem', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    shipmentId: { type: Types.ObjectId, ref: 'Shipment', default: null, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },

    qty: { type: Number, required: true, min: 1 },
    refundAmount: { type: Number, default: 0, min: 0 }, // share of this line
    quantityDisposition: {
      type: String,
      enum: ['reserved', 'returned', 'rejected', 'voided_duplicate'],
      default: 'reserved',
      index: true,
    },
    qcStatus: {
      type: String,
      enum: Object.values(RETURN_QC_STATUS),
      default: RETURN_QC_STATUS.PENDING,
    },
    qcNote: { type: String, default: null, maxlength: 500 },
  },
  { collection: 'returnitems' }
);

ReturnItemSchema.index({ tenantId: 1, returnRequestId: 1, orderItemId: 1 }, { unique: true, name: 'return_item_request_line_uq' });

ReturnItemSchema.plugin(auditPlugin);
ReturnItemSchema.plugin(softDeletePlugin);
ReturnItemSchema.plugin(toJSONPlugin);

export default mongoose.model('ReturnItem', ReturnItemSchema);
