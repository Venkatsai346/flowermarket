/**
 * FulfillmentTimeLog — one row per DELIVERED order recording actual
 * pick/pack/delivery durations (Phase 3.5).
 *
 * This is the "closing the loop" input for slot forecasting: every completed
 * order feeds REAL throughput numbers back so the next forecast self-corrects
 * (if a hub consistently blows its promised window, physical_limit should
 * shrink next day, not repeat the same over-optimistic capacity).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { SLOT_WINDOW_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const FulfillmentTimeLogSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true },
    slotId: { type: Types.ObjectId, ref: 'DeliverySlot', default: null },
    slotType: {
      type: String,
      enum: Object.values(SLOT_WINDOW_TYPE),
      default: SLOT_WINDOW_TYPE.NORMAL,
    },
    weekday: { type: Number, min: 0, max: 6, index: true }, // 0=Sunday

    pickSeconds: { type: Number, default: null, min: 0 },
    packSeconds: { type: Number, default: null, min: 0 },
    deliverySeconds: { type: Number, default: null, min: 0 },

    deliveredAt: { type: Date, default: Date.now },
  },
  { collection: 'fulfillmenttimelogs' }
);

FulfillmentTimeLogSchema.index({ tenantId: 1, hubId: 1, weekday: 1, slotType: 1 });

FulfillmentTimeLogSchema.plugin(auditPlugin);
FulfillmentTimeLogSchema.plugin(softDeletePlugin);
FulfillmentTimeLogSchema.plugin(toJSONPlugin);

export default mongoose.model('FulfillmentTimeLog', FulfillmentTimeLogSchema);
