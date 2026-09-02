import orderService from '../services/order.service.js';
import fulfillmentService from '../services/fulfillment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import User from '../models/user.model.js';

/**
 * RiderController — the rider-app API surface (blueprint §3).
 *
 * Every action maps 1:1 onto the explicit DeliveryAssignment state machine:
 *   PENDING_ACCEPT -> ACCEPTED -> AT_HUB -> IN_TRANSIT -> ARRIVED -> DELIVERED
 *
 * `:id` is the DeliveryAssignment id (the rider's delivery leg). All actions
 * verify the assignment belongs to the authenticated rider.
 */
class RiderController {
  async resolveAssignment({ assignmentId, tenantId, riderId }) {
    const assignment = await (await import('../models/deliveryAssignment.model.js')).default.findOne({ _id: assignmentId, tenantId });
    if (!assignment) throw notFound('Delivery assignment not found', 'ASSIGNMENT_NOT_FOUND');
    if (assignment.riderId && String(assignment.riderId) !== String(riderId)) {
      throw badRequest('This delivery is not assigned to you', 'NOT_YOUR_ASSIGNMENT');
    }
    return assignment;
  }

  /** GET /rider/deliveries?status=in_transit — my deliveries. */
  list = asyncHandler(async (req, res) => {
    const result = await fulfillmentService.listForRider({
      tenantId: req.tenantId, riderId: req.auth.userId, status: req.query.status || null,
    });
    res.status(200).json(success(result, { message: 'Deliveries fetched' }));
  });

  /** POST /rider/deliveries/:id/accept — PENDING_ACCEPT -> ACCEPTED */
  accept = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId,
      action: 'accept', riderId: req.auth.userId, body: {}, req,
    });
    res.status(200).json(success({ id: assignment.id, status: 'accepted' }, { message: 'Delivery accepted' }));
  });

  /** POST /rider/deliveries/:id/reject — reassign to next rider. */
  reject = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    const result = await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId,
      action: 'reject', riderId: req.auth.userId, body: { reason: req.body.reason || null }, req,
    });
    res.status(200).json(success({ id: assignment.id, status: 'reassigned', assignment: result.assignment }, { message: 'Delivery rejected — reassigned' }));
  });

  /** POST /rider/deliveries/:id/arrive-hub — ACCEPTED -> AT_HUB */
  arriveHub = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId, action: 'arrive-hub', riderId: req.auth.userId, body: {}, req,
    });
    res.status(200).json(success({ id: assignment.id, status: 'at_hub' }, { message: 'Arrived at hub — verify package before departing' }));
  });

  /** POST /rider/deliveries/:id/depart {package_verified} — AT_HUB -> IN_TRANSIT + order OUT_FOR_DELIVERY */
  depart = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    const order = await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId,
      action: 'depart', riderId: req.auth.userId,
      body: { packageVerified: req.body.package_verified === true }, req,
    });
    res.status(200).json(success({ id: assignment.id, status: order.status }, { message: 'Departed hub — customer notified' }));
  });

  /** POST /rider/deliveries/:id/arrive — IN_TRANSIT -> ARRIVED */
  arrive = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId, action: 'arrive', riderId: req.auth.userId, body: {}, req,
    });
    res.status(200).json(success({ id: assignment.id, status: 'arrived' }, { message: 'Arrived at customer — collect POD' }));
  });

  /** POST /rider/deliveries/:id/complete {pod_type, pod_reference} — ARRIVED -> DELIVERED */
  complete = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    const order = await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId,
      action: 'complete', riderId: req.auth.userId,
      body: { podType: req.body.pod_type, podValue: req.body.pod_reference || null }, req,
    });
    res.status(200).json(success({ id: assignment.id, status: order.status }, { message: 'Delivered — POD captured' }));
  });

  /** POST /rider/deliveries/:id/fail {fail_reason} — IN_TRANSIT|ARRIVED -> FAILED */
  fail = asyncHandler(async (req, res) => {
    const assignment = await this.resolveAssignment({ assignmentId: req.params.id, tenantId: req.tenantId, riderId: req.auth.userId });
    const order = await orderService.riderFlow({
      tenantId: req.tenantId, orderId: assignment.orderId,
      action: 'fail', riderId: req.auth.userId,
      body: { reason: req.body.fail_reason || null }, req,
    });
    res.status(200).json(success({ id: assignment.id, status: order.order?.status || order.status }, { message: 'Delivery failure recorded — saga will retry or cancel' }));
  });

  /** POST /rider/availability {status} — set available/busy/offline. */
  setAvailability = asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['available', 'busy', 'offline'].includes(status)) {
      throw badRequest('Invalid availability', 'INVALID_AVAILABILITY');
    }
    const user = await User.findById(req.auth.userId);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    user.rider.availability = status;
    user.rider.lastSeenAt = new Date();
    if (status === 'offline') user.rider.activeDeliveryCount = 0;
    await user.save();
    res.status(200).json(success({ riderId: user.id, availability: user.rider.availability }, { message: `Availability → ${status}` }));
  });
}

export default new RiderController();
