/**
 * SlotReservation — the HELD slot row the atomic capacity counter protects
 * (per the order-lifecycle doc).
 *
 * Lifecycle:
 *   HELD (created at checkout start, TTL 10 min) -> CONFIRMED (payment ok)
 *   HELD -> EXPIRED (TTL sweep / lazy check) | RELEASED (compensation/cancel)
 *
 * The partial TTL index only expires HELD rows — confirmed reservations are
 * durable and never swept.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { SLOT_RESERVATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const SlotReservationSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    slotId: { type: Types.ObjectId, ref: 'DeliverySlot', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null, index: true },

    status: {
      type: String,
      enum: Object.values(SLOT_RESERVATION_STATUS),
      default: SLOT_RESERVATION_STATUS.HELD,
      index: true,
    },
    heldAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null }, // set when HELD
    confirmedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    releasedReason: { type: String, default: null, maxlength: 120 },
  },
  { collection: 'slotreservations' }
);

// one live hold per (user, slot) — prevents double-booking the same slot twice
SlotReservationSchema.index(
  { slotId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'held' } }
);
// partial TTL: only HELD rows expire server-side
SlotReservationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: 'held' } }
);
SlotReservationSchema.index({ userId: 1, status: 1, createdAt: -1 });

SlotReservationSchema.plugin(auditPlugin);
SlotReservationSchema.plugin(softDeletePlugin);
SlotReservationSchema.plugin(toJSONPlugin);

export default mongoose.model('SlotReservation', SlotReservationSchema);
