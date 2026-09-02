import FulfillmentTask from '../models/fulfillmentTask.model.js';
import DeliveryAssignment from '../models/deliveryAssignment.model.js';
import User from '../models/user.model.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { sha256 } from '../utils/hash.js';
import {
  FULFILLMENT_TASK_STATUS,
  DELIVERY_ASSIGNMENT_STATUS as S,
  POD_TYPE,
  RIDER_AVAILABILITY,
  RIDER_ACCEPT_TTL_SECONDS,
  RIDER_REJECT_CAP,
} from '../constants/enums.js';

/**
 * FulfillmentService — picking (dark store) + the FULL rider delivery state
 * machine (blueprint §3):
 *
 *   PENDING_ACCEPT -> ACCEPTED -> AT_HUB -> IN_TRANSIT -> ARRIVED -> DELIVERED
 *   PENDING_ACCEPT -> (reject / accept-timeout) -> reassign to next rider
 *   IN_TRANSIT | ARRIVED -> FAILED -> retry resets to PENDING_ACCEPT
 *
 * Deliberate gates:
 *   - /depart requires packageVerified (rider must scan/confirm the package)
 *   - /accept has a timeout (RIDER_ACCEPT_TTL_SECONDS); sweep auto-reassigns
 *   - rejected riders are excluded (capped list — RIDER_REJECT_CAP), beyond
 *     which the assignment escalates to needsManualAssignment
 */
class FulfillmentService {
  // ---------------- picking ----------------

  async createTask({ orderId, tenantId, hubId = null, itemsCount = 0 }) {
    return FulfillmentTask.create({
      orderId, tenantId, hubId: hubId || null, itemsCount,
      status: FULFILLMENT_TASK_STATUS.QUEUED,
    });
  }

  async startPick({ orderId, tenantId, pickerId }) {
    const task = await this.getTask({ orderId, tenantId });
    if (task.status !== FULFILLMENT_TASK_STATUS.QUEUED) {
      throw conflict(`Task is ${task.status}`, 'INVALID_TASK_TRANSITION');
    }
    task.status = FULFILLMENT_TASK_STATUS.PICKING;
    task.pickerId = pickerId || null;
    task.assignedAt = new Date();
    task.startedAt = new Date();
    await task.save();
    return task;
  }

  async completePick({ orderId, tenantId }) {
    const task = await this.getTask({ orderId, tenantId });
    if (task.status !== FULFILLMENT_TASK_STATUS.PICKING) {
      throw conflict(`Task is ${task.status}`, 'INVALID_TASK_TRANSITION');
    }
    task.status = FULFILLMENT_TASK_STATUS.PACKED;
    task.pickedAt = new Date();
    task.packedAt = new Date();
    await task.save();
    return task;
  }

  async failTask({ orderId, tenantId, reason }) {
    const task = await this.getTask({ orderId, tenantId });
    task.status = FULFILLMENT_TASK_STATUS.FAILED;
    task.failedAt = new Date();
    task.failureReason = reason || null;
    await task.save();
    return task;
  }

  async getTask({ orderId, tenantId }) {
    const task = await FulfillmentTask.findOne({ orderId, tenantId });
    if (!task) throw notFound('Fulfillment task not found', 'TASK_NOT_FOUND');
    return task;
  }

  // ---------------- rider assignment ----------------

  /**
   * Create (or re-create) the assignment for an order and offer it to the
   * nearest available rider: PENDING_ACCEPT with a 45s accept deadline.
   * Reuse the row on retry (riderId cleared, rejected list preserved).
   */
  async assignRider({ orderId, tenantId, hubId = null }) {
    let assignment = await DeliveryAssignment.findOne({ orderId, tenantId });

    const rider = await this.findCandidateRider({ tenantId, hubId, excludeIds: assignment?.rejectedRiderIds || [] });

    const now = new Date();
    const patch = {
      status: S.PENDING_ACCEPT,
      riderId: rider?._id || null,
      assignedAt: now,
      pendingAcceptExpiresAt: new Date(now.getTime() + RIDER_ACCEPT_TTL_SECONDS * 1000),
      needsManualAssignment: !rider,
      acceptedAt: null, atHubAt: null, inTransitAt: null, arrivedAt: null,
      completedAt: null, failedAt: null, cancelledAt: null, failureReason: null,
      packageVerified: false,
    };

    if (assignment) {
      Object.assign(assignment, patch);
      await assignment.save();
    } else {
      assignment = await DeliveryAssignment.create({ orderId, tenantId, hubId: hubId || null, ...patch });
    }

    if (rider) {
      await this.setRiderAvailability(rider._id, RIDER_AVAILABILITY.BUSY);
    }
    return assignment;
  }

  async findCandidateRider({ tenantId, hubId = null, excludeIds = [] }) {
    const base = {
      tenantId,
      role: 'rider',
      status: 'active',
      'rider.availability': RIDER_AVAILABILITY.AVAILABLE,
    };
    if (excludeIds.length) base._id = { $nin: excludeIds };
    const sort = { 'rider.rating': -1, createdAt: 1 };
    // hub affinity is a PREFERENCE, not a hard filter — prefer riders based at
    // this hub, fall back to any available rider so the order never stalls
    if (hubId) {
      const preferred = await User.findOne({ ...base, 'rider.currentHubId': hubId }).sort(sort).lean();
      if (preferred) return preferred;
    }
    return User.findOne(base).sort(sort).lean();
  }

  /** Rider accepts the assignment. */
  async acceptAssignment({ orderId, tenantId, riderId }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.PENDING_ACCEPT) {
      throw conflict(`Assignment is ${assignment.status} — cannot accept now`, 'INVALID_ASSIGNMENT_STATE');
    }
    if (assignment.riderId && String(assignment.riderId) !== String(riderId)) {
      throw conflict('This assignment is offered to another rider', 'ASSIGNMENT_NOT_YOURS');
    }
    if (assignment.pendingAcceptExpiresAt && assignment.pendingAcceptExpiresAt < new Date()) {
      // accept timeout raced us — the sweep will reassign; treat as stale
      throw conflict('Accept window expired — assignment will be reassigned', 'ASSIGNMENT_EXPIRED');
    }
    assignment.status = S.ACCEPTED;
    assignment.riderId = riderId || assignment.riderId;
    assignment.acceptedAt = new Date();
    assignment.pendingAcceptExpiresAt = null;
    await assignment.save();
    await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.BUSY);
    return assignment;
  }

  /** Rider rejects; we immediately try the next rider (same PENDING_ACCEPT row). */
  async rejectAssignment({ orderId, tenantId, riderId, reason = null }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.PENDING_ACCEPT) {
      throw conflict(`Assignment is ${assignment.status}`, 'INVALID_ASSIGNMENT_STATE');
    }
    if (assignment.riderId && String(assignment.riderId) === String(riderId)) {
      assignment.rejectedRiderIds = [...(assignment.rejectedRiderIds || []), assignment.riderId];
      assignment.rejectCount = (assignment.rejectCount || 0) + 1;
    }
    // this rider freed up
    if (assignment.riderId) {
      await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.AVAILABLE);
    }

    if (assignment.rejectCount >= RIDER_REJECT_CAP) {
      assignment.needsManualAssignment = true;
      assignment.riderId = null;
      assignment.pendingAcceptExpiresAt = null;
      await assignment.save();
      return assignment;
    }

    const next = await this.findCandidateRider({
      tenantId, hubId: assignment.hubId || null, excludeIds: assignment.rejectedRiderIds || [],
    });
    assignment.riderId = next?._id || null;
    assignment.pendingAcceptExpiresAt = new Date(Date.now() + RIDER_ACCEPT_TTL_SECONDS * 1000);
    assignment.needsManualAssignment = !next;
    if (next) await this.setRiderAvailability(next._id, RIDER_AVAILABILITY.BUSY);
    await assignment.save();
    return assignment;
  }

  /** Accept-timeout sweep: PENDING_ACCEPT past deadline -> next rider / manual. */
  async sweepExpiredAssignments({ limit = 50 }) {
    const stale = await DeliveryAssignment.find({
      status: S.PENDING_ACCEPT,
      needsManualAssignment: false,
      pendingAcceptExpiresAt: { $lte: new Date() },
    }).limit(limit);

    let reassigned = 0;
    let escalated = 0;
    for (const assignment of stale) {
      if (assignment.riderId) {
        await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.AVAILABLE);
      }
      if ((assignment.rejectCount || 0) >= RIDER_REJECT_CAP) {
        assignment.needsManualAssignment = true;
        assignment.riderId = null;
        await assignment.save();
        escalated += 1;
        continue;
      }
      const next = await this.findCandidateRider({
        tenantId: assignment.tenantId, hubId: assignment.hubId || null, excludeIds: assignment.rejectedRiderIds || [],
      });
      if (!next) {
        assignment.needsManualAssignment = true;
        assignment.riderId = null;
        await assignment.save();
        escalated += 1;
        continue;
      }
      assignment.riderId = next._id;
      assignment.pendingAcceptExpiresAt = new Date(Date.now() + RIDER_ACCEPT_TTL_SECONDS * 1000);
      await assignment.save();
      await this.setRiderAvailability(next._id, RIDER_AVAILABILITY.BUSY);
      reassigned += 1;
    }
    return { scanned: stale.length, reassigned, escalated };
  }

  // ---------------- rider leg transitions ----------------

  async markAtHub({ orderId, tenantId }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.ACCEPTED) {
      throw conflict(`Assignment is ${assignment.status} — must ACCEPTED first`, 'INVALID_ASSIGNMENT_STATE');
    }
    assignment.status = S.AT_HUB;
    assignment.atHubAt = new Date();
    await assignment.save();
    return assignment;
  }

  /** Depart the hub: package must be verified (barcode/order-ID scan match). */
  async departHub({ orderId, tenantId, packageVerified = false }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.AT_HUB) {
      throw conflict(`Assignment is ${assignment.status} — must be AT_HUB`, 'INVALID_ASSIGNMENT_STATE');
    }
    if (!packageVerified) {
      throw badRequest('Package verification required before departure', 'PACKAGE_NOT_VERIFIED');
    }
    assignment.status = S.IN_TRANSIT;
    assignment.packageVerified = true;
    assignment.inTransitAt = new Date();
    await assignment.save();
    return assignment;
  }

  async markArrived({ orderId, tenantId }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.IN_TRANSIT) {
      throw conflict(`Assignment is ${assignment.status} — must be IN_TRANSIT`, 'INVALID_ASSIGNMENT_STATE');
    }
    assignment.status = S.ARRIVED;
    assignment.arrivedAt = new Date();
    await assignment.save();
    return assignment;
  }

  /** Capture POD + complete: ARRIVED -> DELIVERED. OTP stored hashed. */
  async completeDelivery({ orderId, tenantId, podType, podValue = null, actorId = null }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (assignment.status !== S.ARRIVED) {
      throw conflict(`Assignment is ${assignment.status} — must be ARRIVED`, 'INVALID_ASSIGNMENT_STATE');
    }
    if (podType === POD_TYPE.OTP) {
      if (!podValue) throw badRequest('OTP value required for OTP POD', 'POD_REQUIRED');
      const otp = String(podValue).trim();
      if (!/^\d{4}$/.test(otp)) throw badRequest('OTP must be 4 digits', 'POD_INVALID');
      assignment.podReference = sha256(otp); // never store plaintext OTPs
    } else {
      if (!podValue) throw badRequest('POD reference (photo/signature URL) required', 'POD_REQUIRED');
      assignment.podReference = podValue;
    }
    assignment.podType = podType;
    assignment.status = S.DELIVERED;
    assignment.completedAt = new Date();
    await assignment.save();
    await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.AVAILABLE);
    return assignment;
  }

  /** Fail the delivery: IN_TRANSIT | ARRIVED -> FAILED (saga decides retry/cancel). */
  async failDelivery({ orderId, tenantId, reason = null }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if (![S.IN_TRANSIT, S.ARRIVED].includes(assignment.status)) {
      throw conflict(`Assignment is ${assignment.status} — cannot fail from here`, 'INVALID_ASSIGNMENT_STATE');
    }
    assignment.status = S.FAILED;
    assignment.failedAt = new Date();
    assignment.failureReason = reason || null;
    await assignment.save();
    if (assignment.riderId) {
      await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.AVAILABLE);
    }
    return assignment;
  }

  async getAssignment({ orderId, tenantId }) {
    const assignment = await DeliveryAssignment.findOne({ orderId, tenantId });
    if (!assignment) throw notFound('Delivery assignment not found', 'ASSIGNMENT_NOT_FOUND');
    return assignment;
  }

  /**
   * Ops shortcut: walk the assignment through the machine to ARRIVED without
   * requiring rider-app calls (used by the ops deliver endpoint). Honors
   * every precondition so the machine stays honest.
   */
  async forceArrived({ orderId, tenantId }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    if ([S.DELIVERED, S.FAILED, S.CANCELLED].includes(assignment.status)) {
      throw conflict(`Assignment is ${assignment.status} — cannot force arrive`, 'INVALID_ASSIGNMENT_STATE');
    }
    if (assignment.status === S.PENDING_ACCEPT) {
      assignment.status = S.ACCEPTED;
      assignment.acceptedAt = new Date();
      assignment.pendingAcceptExpiresAt = null;
      await assignment.save();
      await this.setRiderAvailability(assignment.riderId, RIDER_AVAILABILITY.BUSY);
    }
    if (assignment.status === S.ACCEPTED) {
      assignment.status = S.AT_HUB;
      assignment.atHubAt = new Date();
      await assignment.save();
    }
    if (assignment.status === S.AT_HUB) {
      assignment.status = S.IN_TRANSIT;
      assignment.packageVerified = true;
      assignment.inTransitAt = new Date();
      await assignment.save();
    }
    if (assignment.status === S.IN_TRANSIT) {
      assignment.status = S.ARRIVED;
      assignment.arrivedAt = new Date();
      await assignment.save();
    }
    return assignment;
  }

  /** Rider ops: list deliveries by status (rider app home). */
  async listForRider({ tenantId, riderId, status = null }) {
    const q = { tenantId, riderId };
    if (status) q.status = status;
    return DeliveryAssignment.find(q).sort({ assignedAt: -1 }).lean();
  }

  async setRiderAvailability(riderId, availability) {
    if (!riderId) return;
    await User.updateOne(
      { _id: riderId },
      {
        $set: {
          'rider.availability': availability,
          'rider.lastSeenAt': new Date(),
          'rider.activeDeliveryCount': availability === 'busy' ? 1 : 0,
        },
      }
    );
  }

  /** Order status mirror + optional POD OTP generation for the customer. */
  async generatePodOtp() {
    const { generateNumericCode } = await import('../utils/hash.js');
    return generateNumericCode(4);
  }

  async verifyPodOtp({ orderId, tenantId, otp }) {
    const assignment = await this.getAssignment({ orderId, tenantId });
    return assignment.podReference === sha256(String(otp).trim());
  }
}

export default new FulfillmentService();
