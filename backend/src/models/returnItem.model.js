/**
 * ReturnItem — which order items (and qty) are being returned, + QC outcome.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { RETURN_QC_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ReturnItemSchema = new Schema(
  {
    returnRequestId: { type: Types.ObjectId, ref: 'ReturnRequest', required: true, index: true },
    orderItemId: { type: Types.ObjectId, ref: 'OrderItem', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true },

    qty: { type: Number, required: true, min: 1 },
    refundAmount: { type: Number, default: 0, min: 0 }, // share of this line
    qcStatus: {
      type: String,
      enum: Object.values(RETURN_QC_STATUS),
      default: RETURN_QC_STATUS.PENDING,
    },
    qcNote: { type: String, default: null, maxlength: 500 },
  },
  { collection: 'returnitems' }
);

ReturnItemSchema.index({ returnRequestId: 1, orderItemId: 1 });

ReturnItemSchema.plugin(auditPlugin);
ReturnItemSchema.plugin(softDeletePlugin);
ReturnItemSchema.plugin(toJSONPlugin);

export default mongoose.model('ReturnItem', ReturnItemSchema);
