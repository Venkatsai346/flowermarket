/**
 * OrderStatusHistory — append-only transition log per order.
 * Powers the customer "track your order" timeline AND ops debugging.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ORDER_STATUS, AUDIT_ACTOR_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const OrderStatusHistorySchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    fromStatus: { type: String, enum: Object.values(ORDER_STATUS), default: null },
    toStatus: { type: String, enum: Object.values(ORDER_STATUS), required: true },
    actorType: {
      type: String,
      enum: Object.values(AUDIT_ACTOR_TYPE),
      default: AUDIT_ACTOR_TYPE.SYSTEM,
    },
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: null, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'orderstatushistories' }
);

OrderStatusHistorySchema.index({ orderId: 1, createdAt: 1 });

OrderStatusHistorySchema.plugin(auditPlugin);
OrderStatusHistorySchema.plugin(softDeletePlugin);
OrderStatusHistorySchema.plugin(toJSONPlugin);

export default mongoose.model('OrderStatusHistory', OrderStatusHistorySchema);
