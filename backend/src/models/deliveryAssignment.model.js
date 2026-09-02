/**
 * DeliveryAssignment — rider leg + Proof of Delivery (OTP/photo/signature),
 * with the FULL explicit rider state machine (Phase 3.5 rider app):
 *
 *   PENDING_ACCEPT -> ACCEPTED -> AT_HUB -> IN_TRANSIT -> ARRIVED -> DELIVERED
 *   PENDING_ACCEPT -> (reject/timeout) -> reassigned to next rider (same row)
 *   IN_TRANSIT | ARRIVED -> FAILED -> retry resets to PENDING_ACCEPT
 *
 * `podReference` stores the HASHED OTP (never plaintext) or photo/signature URL.
 * `pendingAcceptExpiresAt` drives the accept-timeout auto-reassignment sweep.
 * `rejectedRiderIds` is capped (RIDER_REJECT_CAP) — beyond that the assignment
 * escalates to manual ops instead of paging an unbounded rider list.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { DELIVERY_ASSIGNMENT_STATUS, POD_TYPE, RIDER_REJECT_CAP } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DeliveryAssignmentSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    riderId: { type: Types.ObjectId, ref: 'User', default: null, index: true },

    status: {
      type: String,
      enum: Object.values(DELIVERY_ASSIGNMENT_STATUS),
      default: DELIVERY_ASSIGNMENT_STATUS.PENDING_ACCEPT,
      index: true,
    },
    assignedAt: { type: Date, default: Date.now },
    pendingAcceptExpiresAt: { type: Date, default: null }, // auto-reassign when passed
    needsManualAssignment: { type: Boolean, default: false }, // reject-cap hit

    acceptedAt: { type: Date, default: null },
    atHubAt: { type: Date, default: null },
    inTransitAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 300 },

    // package handoff gate: rider must confirm the scanned package matches
    packageVerified: { type: Boolean, default: false },

    // capped rejection list — bounded so the doc never grows unboundedly
    rejectedRiderIds: { type: [Types.ObjectId], default: [], maxlength: RIDER_REJECT_CAP },
    rejectCount: { type: Number, default: 0, min: 0 },

    podType: { type: String, enum: Object.values(POD_TYPE), default: null },
    podReference: { type: String, default: null }, // hashed OTP or media URL
  },
  { collection: 'deliveryassignments' }
);

DeliveryAssignmentSchema.index({ orderId: 1 }, { unique: true });
DeliveryAssignmentSchema.index({ riderId: 1, status: 1 });
DeliveryAssignmentSchema.index({ tenantId: 1, status: 1, pendingAcceptExpiresAt: 1 });

DeliveryAssignmentSchema.plugin(auditPlugin);
DeliveryAssignmentSchema.plugin(softDeletePlugin);
DeliveryAssignmentSchema.plugin(toJSONPlugin);

export default mongoose.model('DeliveryAssignment', DeliveryAssignmentSchema);
