import orderService from '../services/order.service.js';
import slotService from '../services/slot.service.js';
import returnsService from '../services/returns.service.js';
import refundService from '../services/refund.service.js';
import fulfillmentService from '../services/fulfillment.service.js';
import slotForecastingService from '../services/slotForecasting.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

/**
 * OpsController — warehouse + logistics + ops (PICKER / RIDER / ADMIN).
 * Order status transitions all flow through the saga (orderService) so the
 * state machine + status history stay consistent.
 */
class OpsController {
  // ---------------- order ops (ADMIN) ----------------
  listAll = asyncHandler(async (req, res) => {
    const result = await orderService.listAll({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Orders fetched', meta: result.meta }));
  });

  // ---------------- picking (PICKER / ADMIN) ----------------
  startPicking = asyncHandler(async (req, res) => {
    const order = await orderService.startPicking({
      tenantId: req.tenantId, orderId: req.params.id, pickerId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Picking started' }));
  });

  markPacked = asyncHandler(async (req, res) => {
    const order = await orderService.markPacked({
      tenantId: req.tenantId, orderId: req.params.id, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Picked & packed' }));
  });

  // ---------------- delivery (RIDER / ADMIN) ----------------
  dispatch = asyncHandler(async (req, res) => {
    const order = await orderService.dispatch({
      tenantId: req.tenantId, orderId: req.params.id, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Rider assigned — out for delivery' }));
  });

  deliver = asyncHandler(async (req, res) => {
    const order = await orderService.deliver({
      tenantId: req.tenantId, orderId: req.params.id,
      podType: req.body.podType, podValue: req.body.podValue || null,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Delivered — POD captured' }));
  });

  deliveryFailed = asyncHandler(async (req, res) => {
    const order = await orderService.deliveryFailed({
      tenantId: req.tenantId, orderId: req.params.id,
      reason: req.body.reason || null, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Delivery failure recorded' }));
  });

  retryDelivery = asyncHandler(async (req, res) => {
    const order = await orderService.retryDelivery({
      tenantId: req.tenantId, orderId: req.params.id, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(order, { message: 'Delivery retry dispatched' }));
  });

  // ---------------- slot ops (ADMIN) ----------------
  generateSlots = asyncHandler(async (req, res) => {
    const result = await slotService.generateForDates({
      tenantId: req.tenantId,
      hubId: req.body.hubId || null,
      fromDate: req.body.fromDate,
      toDate: req.body.toDate,
      capacity: req.body.capacity || null,
      overwrite: req.body.overwrite === true,
      // forecast=true runs the nightly batch: capacity comes from the
      // forecasting model (historical volume + fulfillment-time feedback +
      // physical picker/rider limits), not a flat number
      forecast: req.body.forecast === true,
    });
    res.status(201).json(created(result, { message: req.body.forecast ? 'Slots generated with forecast capacity' : 'Delivery slots generated' }));
  });

  slotUtilization = asyncHandler(async (req, res) => {
    const result = await slotService.utilization({
      tenantId: req.tenantId,
      hubId: req.query.hubId || null,
      date: req.query.date || null,
    });
    res.status(200).json(success(result, { message: 'Slot utilization' }));
  });

  // ---------------- returns ops (ADMIN) ----------------
  listReturns = asyncHandler(async (req, res) => {
    const result = await returnsService.list({
      tenantId: req.tenantId, query: req.query, isAdmin: true,
    });
    res.status(200).json(success(result.items, { message: 'Returns fetched', meta: result.meta }));
  });

  // ---------------- refunds ops (ADMIN) ----------------
  listRefunds = asyncHandler(async (req, res) => {
    const result = await refundService.list({
      tenantId: req.tenantId, query: req.query, isAdmin: true,
    });
    res.status(200).json(success(result.items, { message: 'Refunds fetched', meta: result.meta }));
  });

  adminRefund = asyncHandler(async (req, res) => {
    const txn = await refundService.initiate({
      tenantId: req.tenantId,
      userId: req.body.userId || null,
      orderId: req.body.orderId,
      amount: req.body.amount,
      reason: req.body.reason,
      destination: req.body.destination || null,
      paymentId: req.body.paymentId || null,
      initiatedBy: req.auth.userId,
      idempotencyKey: req.body.idempotencyKey || null,
      note: req.body.note || null,
    });
    res.status(201).json(created(txn, { message: `Refund ${txn.status} via ${txn.destination}` }));
  });

  // ---------------- slot forecasting (Phase 3.5) ----------------
  forecastHub = asyncHandler(async (req, res) => {
    const result = await slotForecastingService.forecastHubDay({
      tenantId: req.tenantId,
      hubId: req.body.hubId,
      date: req.body.date,
      pickerCount: req.body.pickerCount || null,
      riderCount: req.body.riderCount || null,
      dryRun: req.body.dryRun === true,
    });
    res.status(200).json(success(result, { message: 'Slot forecast computed' }));
  });

  forecastUpcoming = asyncHandler(async (req, res) => {
    const result = await slotForecastingService.forecastUpcoming({
      tenantId: req.tenantId,
      days: Number(req.query.days) || 7,
      pickerCount: req.query.pickers ? Number(req.query.pickers) : null,
      riderCount: req.query.riders ? Number(req.query.riders) : null,
      dryRun: req.query.dryRun === 'true',
    });
    res.status(200).json(success(result, { message: 'Nightly forecast run complete' }));
  });

  fulfillmentHistory = asyncHandler(async (req, res) => {
    const result = await slotForecastingService.historyStats({
      tenantId: req.tenantId, hubId: req.query.hubId || null,
    });
    res.status(200).json(success(result, { message: 'Fulfillment time history' }));
  });

  sweepExpiredAssignments = asyncHandler(async (req, res) => {
    const result = await fulfillmentService.sweepExpiredAssignments({ limit: Number(req.query.limit) || 50 });
    res.status(200).json(success(result, { message: 'Expired rider assignments swept' }));
  });

  // ---------------- misc ops ----------------
  reconcilePayments = asyncHandler(async (req, res) => {
    const { default: paymentService } = await import('../services/payment.service.js');
    const result = await paymentService.reconcilePending({ limit: Number(req.query.limit) || 50 });
    res.status(200).json(success(result, { message: 'Payment reconciliation sweep complete' }));
  });

  sweepExpiredHolds = asyncHandler(async (req, res) => {
    const result = await slotService.sweepExpiredHolds({ limit: Number(req.query.limit) || 100 });
    res.status(200).json(success(result, { message: 'Expired slot holds swept' }));
  });
}

export default new OpsController();
