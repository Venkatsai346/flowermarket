/**
 * DeliverySlot — BigBasket-style slotted delivery (the concurrency-critical piece).
 *
 * CAPACITY IS ATOMIC: reservation decrements remaining capacity via
 * `findOneAndUpdate` with a guard `$expr: reservedCapacity < totalCapacity` —
 * two concurrent reservations can never oversell a slot (no Redis/Lua needed;
 * the same atomicity the doc achieves with an in-memory counter).
 *
 * - `availableCapacity` is DERIVED (total - reserved), exposed as a virtual —
 *   no stored counter to drift out of sync.
 * - Slots are generated for a date window per tenant + hub (ops/forecasting
 *   decides the capacity number; this locking prevents overselling it).
 * - Cut-off: `lastOrderTime` (e.g. same-day slot closes 17:00).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { SLOT_WINDOW_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DeliverySlotSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true }, // dark store
    zoneId: { type: Types.ObjectId, ref: 'DeliveryZone', default: null, index: true }, // zone grouping

    date: { type: String, required: true, index: true }, // 'YYYY-MM-DD' (tenant tz)
    startTime: { type: String, required: true }, // 'HH:mm' tenant tz
    endTime: { type: String, required: true },
    windowType: {
      type: String,
      enum: Object.values(SLOT_WINDOW_TYPE),
      default: SLOT_WINDOW_TYPE.NORMAL,
    },
    displayLabel: { type: String, default: null }, // "10 AM – 1 PM" override

    // ---- capacity (source of truth = totalCapacity; reservedCapacity via atomic $inc) ----
    totalCapacity: { type: Number, default: 50, min: 1 },
    reservedCapacity: { type: Number, default: 0, min: 0 },

    // ---- rules ----
    lastOrderTime: { type: Date, default: null }, // cut-off for ordering into this slot
    minOrderValue: { type: Number, default: 0, min: 0 },
    codAllowed: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ['open', 'closed', 'full', 'cancelled'],
      default: 'open',
      index: true,
    },

    version: { type: Number, default: 1 }, // optimistic locking for capacity bumps

    // ---- Phase 3.5: forecast metadata (forecasting sets the number, the
    //      atomic lock enforces it) ----
    forecastCapacity: { type: Number, default: null, min: 0 }, // recommended capacity from forecast
    forecastAt: { type: Date, default: null },

    // ---- Phase 4: intraday ops override (admin dashboard). Effective
    //      capacity = manualCapacity ?? totalCapacity — the human override on
    //      top of forecast; the atomic reserve gate honors it via $ifNull. ----
    manualCapacity: { type: Number, default: null, min: 1 },
    manualCapacityAt: { type: Date, default: null },
    manualCapacityBy: { type: Types.ObjectId, ref: 'User', default: null },
    manualCapacityReason: { type: String, default: null, maxlength: 300 },
  },
  { collection: 'deliveryslots' }
);

DeliverySlotSchema.virtual('availableCapacity').get(function () {
  return Math.max(0, this.totalCapacity - this.reservedCapacity);
});

DeliverySlotSchema.index({ tenantId: 1, date: 1, status: 1 });
DeliverySlotSchema.index(
  { tenantId: 1, hubId: 1, date: 1, startTime: 1 },
  { unique: true }
);
DeliverySlotSchema.index({ hubId: 1, date: 1, status: 1 });

DeliverySlotSchema.plugin(auditPlugin);
DeliverySlotSchema.plugin(softDeletePlugin);
DeliverySlotSchema.plugin(toJSONPlugin);

export default mongoose.model('DeliverySlot', DeliverySlotSchema);
