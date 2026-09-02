/**
 * FulfillmentTask — picking job at the dark store (per the doc's saga step).
 * QUEUED -> PICKING -> PACKED (then delivery takes over); FAILED on abort.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { FULFILLMENT_TASK_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const FulfillmentTaskSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true },

    status: {
      type: String,
      enum: Object.values(FULFILLMENT_TASK_STATUS),
      default: FULFILLMENT_TASK_STATUS.QUEUED,
      index: true,
    },
    pickerId: { type: Types.ObjectId, ref: 'User', default: null },
    itemsCount: { type: Number, default: 0, min: 0 },
    assignedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    pickedAt: { type: Date, default: null },
    packedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },
  },
  { collection: 'fulfillmenttasks' }
);

FulfillmentTaskSchema.index({ orderId: 1 }, { unique: true });
FulfillmentTaskSchema.index({ tenantId: 1, status: 1 });

FulfillmentTaskSchema.plugin(auditPlugin);
FulfillmentTaskSchema.plugin(softDeletePlugin);
FulfillmentTaskSchema.plugin(toJSONPlugin);

export default mongoose.model('FulfillmentTask', FulfillmentTaskSchema);
