import mongoose from 'mongoose';
import Shipment, { SHIPMENT_STATUS } from '../models/shipment.model.js';
import ShipmentItem from '../models/shipmentItem.model.js';
import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import OrderStatusHistory from '../models/orderStatusHistory.model.js';
import Hub from '../models/hub.model.js';
import FulfillmentTask from '../models/fulfillmentTask.model.js';
import DeliveryAssignment from '../models/deliveryAssignment.model.js';
import Inventory from '../models/inventory.model.js';
import InventoryReservation from '../models/inventoryReservation.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import inventoryService from './inventory.service.js';
import auditService from './audit.service.js';
import refundService from './refund.service.js';
import config from '../config/index.js';
import { allocatePaise, fromPaise, roundMoney, toPaise } from '../utils/money.js';
import { sha256 } from '../utils/hash.js';
import { conflict, notFound } from '../utils/ApiError.js';
import { INVENTORY_RESERVATION_STATUS, ORDER_STATUS, PAYMENT_STATUS, REFUND_REASON } from '../constants/enums.js';

const orderStatusFor = (shipments) => {
  const active = shipments.filter((shipment) => shipment.status !== SHIPMENT_STATUS.CANCELLED);
  if (!active.length) return ORDER_STATUS.CANCELLED;
  if (active.every((shipment) => shipment.status === SHIPMENT_STATUS.DELIVERED)) return ORDER_STATUS.DELIVERED;
  if (active.some((shipment) => shipment.status === SHIPMENT_STATUS.DELIVERED)) return ORDER_STATUS.PARTIALLY_DELIVERED;
  if (active.some((shipment) => shipment.status === SHIPMENT_STATUS.DELIVERY_FAILED)) return ORDER_STATUS.DELIVERY_FAILED;
  if (active.some((shipment) => shipment.status === SHIPMENT_STATUS.OUT_FOR_DELIVERY)) return ORDER_STATUS.OUT_FOR_DELIVERY;
  if (active.every((shipment) => shipment.status === SHIPMENT_STATUS.PACKED)) return ORDER_STATUS.PACKED;
  if (active.some((shipment) => shipment.status === SHIPMENT_STATUS.PICKING)) return ORDER_STATUS.PICKING;
  return ORDER_STATUS.CONFIRMED;
};

class ShipmentService {
  async createForOrder({ order, orderItems, allocation }) {
    const existing = await Shipment.find({ tenantId: order.tenantId, orderId: order._id }).sort({ sequence: 1 });
    if (existing.length) return existing;
    const plans = allocation.shipments?.length ? allocation.shipments : [{
      sequence: 1, fulfillmentHubId: allocation.primaryHubId,
      warehouseCode: allocation.hub?.code, warehouseName: allocation.hub?.name,
      distanceKm: allocation.hub?.distanceKm,
      promiseMinAt: allocation.promise?.minAt, promiseMaxAt: allocation.promise?.maxAt,
      listingIds: allocation.allocations.map((item) => item.listingId),
    }];
    const weights = plans.map((plan) => orderItems
      .filter((item) => String(item.fulfillmentAllocation?.warehouseId || '') === String(
        allocation.allocations.find((entry) => entry.fulfillmentHubId === plan.fulfillmentHubId)?.warehouseId || '',
      ) || plan.listingIds.includes(String(item.tenantProductId)))
      .reduce((sum, item) => sum + toPaise(item.lineTotal || 0), 0));
    const feeShares = allocatePaise(toPaise(order.deliveryFee || 0), weights);
    const shipments = [];
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const lines = orderItems.filter((item) => plan.listingIds.includes(String(item.tenantProductId)));
      const sequence = index + 1;
      // Sequential on purpose: shipment creation assigns stable sequence numbers and line ownership.
      // eslint-disable-next-line no-await-in-loop
      const shipment = await Shipment.create({
        tenantId: order.tenantId, orderId: order._id,
        shipmentNumber: `${order.orderNumber}-S${sequence}`, sequence,
        hubId: plan.fulfillmentHubId, warehouseCode: plan.warehouseCode || null,
        status: SHIPMENT_STATUS.PLANNED,
        itemsCount: lines.length, unitsCount: lines.reduce((sum, item) => sum + item.qty, 0),
        merchandiseTotal: lines.reduce((sum, item) => sum + item.lineTotal, 0),
        deliveryFee: fromPaise(feeShares[index] || 0),
        taxAmount: lines.reduce((sum, item) => sum + (item.taxAmount || 0), 0),
        discountAmount: lines.reduce((sum, item) => sum + (item.discountAllocated || 0), 0),
        promiseMinAt: plan.promiseMinAt || null, promiseMaxAt: plan.promiseMaxAt || null,
        distanceKm: plan.distanceKm ?? null,
        trackingCode: sha256(`${order.tenantId}:${order._id}:${sequence}`).slice(0, 24).toUpperCase(),
      });
      shipments.push(shipment);
      if (lines.length) {
        // Sequential on purpose: shipment item rows must exist before lines expose their shipment id.
        // eslint-disable-next-line no-await-in-loop
        await ShipmentItem.insertMany(lines.map((item) => ({
          tenantId: order.tenantId, orderId: order._id, shipmentId: shipment._id,
          orderItemId: item._id, tenantProductId: item.tenantProductId, qty: item.qty,
          lineTotal: item.lineTotal, taxAmount: item.taxAmount || 0,
          discountAmount: item.discountAllocated || 0,
        })));
        // Sequential on purpose: line ownership follows creation of durable shipment items.
        // eslint-disable-next-line no-await-in-loop
        await OrderItem.updateMany({ _id: { $in: lines.map((item) => item._id) } }, { $set: { shipmentId: shipment._id } });
      }
    }
    return shipments;
  }

  async queueForOrder({ tenantId, orderId }) {
    const shipments = await Shipment.find({ tenantId, orderId }).sort({ sequence: 1 });
    if (!shipments.length) throw notFound('No shipments found for order', 'SHIPMENTS_NOT_FOUND');
    for (const shipment of shipments) {
      // Sequential on purpose: each shipment gets exactly one task before it becomes queue-visible.
      // eslint-disable-next-line no-await-in-loop
      await FulfillmentTask.findOneAndUpdate(
        { tenantId, orderId, shipmentId: shipment._id },
        { $setOnInsert: { hubId: shipment.hubId, itemsCount: shipment.unitsCount, status: 'queued' } },
        { upsert: true, new: true },
      );
      shipment.status = SHIPMENT_STATUS.QUEUED;
      // Sequential on purpose: persist each shipment only after its task exists.
      // eslint-disable-next-line no-await-in-loop
      await shipment.save();
    }
    return shipments;
  }

  async reconcile({ tenantId, limit = 500, repair = false }) {
    const shipments = await Shipment.find({ tenantId }).sort({ updatedAt: -1 }).limit(limit).lean();
    const orderIds = [...new Set(shipments.map((shipment) => String(shipment.orderId)))];
    const shipmentIds = shipments.map((shipment) => shipment._id);
    const [orders, items, tasks] = await Promise.all([
      Order.find({ _id: { $in: orderIds }, tenantId }).select('status').lean(),
      ShipmentItem.find({ shipmentId: { $in: shipmentIds }, tenantId }).lean(),
      FulfillmentTask.find({ shipmentId: { $in: shipmentIds }, tenantId }).select('shipmentId').lean(),
    ]);
    const byOrder = new Map();
    shipments.forEach((shipment) => {
      const key = String(shipment.orderId);
      byOrder.set(key, [...(byOrder.get(key) || []), shipment]);
    });
    const taskCount = new Map();
    tasks.forEach((task) => taskCount.set(String(task.shipmentId), (taskCount.get(String(task.shipmentId)) || 0) + 1));
    const itemStats = new Map();
    items.forEach((item) => {
      const key = String(item.shipmentId);
      const stats = itemStats.get(key) || { itemsCount: 0, unitsCount: 0 };
      stats.itemsCount += 1; stats.unitsCount += item.qty;
      itemStats.set(key, stats);
    });
    const statusDrift = orders.filter((order) => order.status !== orderStatusFor(byOrder.get(String(order._id)) || []));
    const missingTasks = shipments.filter((shipment) => ![SHIPMENT_STATUS.PLANNED, SHIPMENT_STATUS.CANCELLED].includes(shipment.status)
      && taskCount.get(String(shipment._id)) !== 1);
    const itemCountDrift = shipments.filter((shipment) => {
      const stats = itemStats.get(String(shipment._id)) || { itemsCount: 0, unitsCount: 0 };
      return stats.itemsCount !== shipment.itemsCount || stats.unitsCount !== shipment.unitsCount;
    });
    const overdue = shipments.filter((shipment) => shipment.promiseMaxAt && new Date(shipment.promiseMaxAt) < new Date()
      && ![SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.CANCELLED].includes(shipment.status));
    const refundAttention = shipments.filter((shipment) => shipment.status === SHIPMENT_STATUS.CANCELLED
      && ['pending', 'failed'].includes(shipment.cancellation?.refundStatus));
    if (repair && statusDrift.length) {
      await Promise.all(statusDrift.map((order) => this.deriveOrderStatus({ tenantId, orderId: order._id })));
    }
    return {
      scanned: shipments.length, repairedOrderStatuses: repair ? statusDrift.length : 0,
      metrics: {
        orderStatusDrift: statusDrift.length, missingOrDuplicateTasks: missingTasks.length,
        itemCountDrift: itemCountDrift.length, overdue: overdue.length, refundAttention: refundAttention.length,
      },
      samples: {
        orderStatusDrift: statusDrift.slice(0, 20).map((row) => String(row._id)),
        missingOrDuplicateTasks: missingTasks.slice(0, 20).map((row) => String(row._id)),
        itemCountDrift: itemCountDrift.slice(0, 20).map((row) => String(row._id)),
        overdue: overdue.slice(0, 20).map((row) => String(row._id)),
        refundAttention: refundAttention.slice(0, 20).map((row) => String(row._id)),
      },
    };
  }

  async get({ tenantId, shipmentId }) {
    const shipment = await Shipment.findOne({ _id: shipmentId, tenantId });
    if (!shipment) throw notFound('Shipment not found', 'SHIPMENT_NOT_FOUND');
    return shipment;
  }

  async listForOrder({ tenantId, orderId }) {
    const shipments = await Shipment.find({ tenantId, orderId }).sort({ sequence: 1 }).lean();
    if (!shipments.length) return [];
    const ids = shipments.map((shipment) => shipment._id);
    const [items, hubs, tasks, assignments] = await Promise.all([
      ShipmentItem.find({ shipmentId: { $in: ids } }).lean(),
      Hub.find({ _id: { $in: shipments.map((shipment) => shipment.hubId) } }).select('name code').lean(),
      FulfillmentTask.find({ shipmentId: { $in: ids } }).lean(),
      DeliveryAssignment.find({ shipmentId: { $in: ids } }).lean(),
    ]);
    const by = (rows, key) => new Map(rows.map((row) => [String(row[key]), row]));
    const hubById = by(hubs, '_id'); const taskByShipment = by(tasks, 'shipmentId'); const assignmentByShipment = by(assignments, 'shipmentId');
    return shipments.map((shipment) => ({
      ...shipment, id: shipment._id,
      hub: hubById.get(String(shipment.hubId)) || null,
      items: items.filter((item) => String(item.shipmentId) === String(shipment._id)),
      task: taskByShipment.get(String(shipment._id)) || null,
      deliveryAssignment: assignmentByShipment.get(String(shipment._id)) || null,
    }));
  }

  async startPicking({ tenantId, shipmentId, pickerId }) {
    const shipment = await this.get({ tenantId, shipmentId });
    await FulfillmentTask.findOneAndUpdate(
      { tenantId, orderId: shipment.orderId, shipmentId, status: 'queued' },
      { $set: { status: 'picking', pickerId, assignedAt: new Date(), startedAt: new Date() } },
      { new: true },
    ).then((task) => {
      if (!task) throw conflict('Shipment task is not queued', 'INVALID_TASK_TRANSITION');
      return task;
    });
    return this.setStatus({ tenantId, shipmentId, from: [SHIPMENT_STATUS.PLANNED, SHIPMENT_STATUS.QUEUED], to: SHIPMENT_STATUS.PICKING, actorId: pickerId });
  }

  async markPacked({ tenantId, shipmentId, actorId = null }) {
    const shipment = await this.get({ tenantId, shipmentId });
    const task = await FulfillmentTask.findOneAndUpdate(
      { tenantId, orderId: shipment.orderId, shipmentId, status: 'picking' },
      { $set: { status: 'packed', pickedAt: new Date(), packedAt: new Date() } },
      { new: true },
    );
    if (!task) throw conflict('Shipment task is not being picked', 'INVALID_TASK_TRANSITION');
    return this.setStatus({ tenantId, shipmentId, from: SHIPMENT_STATUS.PICKING, to: SHIPMENT_STATUS.PACKED, actorId });
  }

  async markDispatched({ tenantId, shipmentId, actorId = null }) {
    return this.setStatus({
      tenantId, shipmentId, from: [SHIPMENT_STATUS.PACKED, SHIPMENT_STATUS.DELIVERY_FAILED],
      to: SHIPMENT_STATUS.OUT_FOR_DELIVERY, actorId,
    });
  }

  async markDelivered({ tenantId, shipmentId, actorId = null }) {
    return this.setStatus({
      tenantId, shipmentId, from: SHIPMENT_STATUS.OUT_FOR_DELIVERY,
      to: SHIPMENT_STATUS.DELIVERED, patch: { deliveredAt: new Date() }, actorId,
    });
  }

  async markDeliveryFailed({ tenantId, shipmentId, reason = null, actorId = null }) {
    return this.setStatus({
      tenantId, shipmentId, from: SHIPMENT_STATUS.OUT_FOR_DELIVERY,
      to: SHIPMENT_STATUS.DELIVERY_FAILED, patch: { cancellationReason: reason }, actorId,
    });
  }

  /**
   * Cancel one parcel before dispatch. Inventory restoration and cancellation
   * markers commit in one Mongo transaction; the external refund is replayable
   * through a stable idempotency key if the process dies after that commit.
   */
  async cancel({ tenantId, orderId, shipmentId, reason, actorId, enforceOwnership = true }) {
    const current = await Shipment.findOne({ _id: shipmentId, tenantId, orderId });
    if (!current) throw notFound('Shipment not found', 'SHIPMENT_NOT_FOUND');
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    if (enforceOwnership && String(order.userId) !== String(actorId)) throw notFound('Shipment not found', 'SHIPMENT_NOT_FOUND');
    if (order.paymentSummary?.status === PAYMENT_STATUS.AWAITING_COLLECTION) {
      throw conflict('Partial cancellation is not available for cash-on-delivery orders', 'PARTIAL_COD_CANCELLATION_UNAVAILABLE');
    }
    if (![PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED].includes(order.paymentSummary?.status)) {
      throw conflict('Shipment can only be cancelled after payment is confirmed', 'PAYMENT_NOT_SETTLED');
    }

    if (current.status !== SHIPMENT_STATUS.CANCELLED) {
      if (![SHIPMENT_STATUS.PLANNED, SHIPMENT_STATUS.QUEUED, SHIPMENT_STATUS.PICKING, SHIPMENT_STATUS.PACKED].includes(current.status)) {
        throw conflict(`Shipment cannot be cancelled in state ${current.status}`, 'SHIPMENT_CANCELLATION_NOT_ALLOWED');
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const shipment = await Shipment.findOne({
            _id: shipmentId, tenantId, orderId,
            status: { $in: [SHIPMENT_STATUS.PLANNED, SHIPMENT_STATUS.QUEUED, SHIPMENT_STATUS.PICKING, SHIPMENT_STATUS.PACKED] },
          }).session(session);
          if (!shipment) return;
          const lines = await ShipmentItem.find({ tenantId, shipmentId }).session(session);
          for (const line of lines) {
            // Sequential in one transaction: each reservation is locked before its inventory row is restored.
            // eslint-disable-next-line no-await-in-loop
            const reservation = await InventoryReservation.findOne({
              tenantId, orderId, tenantProductId: line.tenantProductId, warehouseId: shipment.hubId,
              status: INVENTORY_RESERVATION_STATUS.CONFIRMED,
            }).session(session);
            if (!reservation) throw conflict('Confirmed inventory reservation is missing', 'RESERVATION_MISSING');
            // Sequential in one transaction: restoration follows the matching confirmed reservation read.
            // eslint-disable-next-line no-await-in-loop
            const restored = await Inventory.updateOne(
              { _id: reservation.inventoryId, tenantId },
              { $inc: { qtyOnHand: line.qty }, $set: { lastUpdatedAt: new Date() } },
              { session },
            );
            if (restored.modifiedCount !== 1) throw conflict('Inventory row is missing', 'INVENTORY_NOT_FOUND');
            reservation.status = INVENTORY_RESERVATION_STATUS.RELEASED;
            reservation.releasedAt = new Date();
            reservation.releaseReason = 'shipment_cancelled';
            reservation.version += 1;
            reservation.transitions.push({ from: INVENTORY_RESERVATION_STATUS.CONFIRMED, to: INVENTORY_RESERVATION_STATUS.RELEASED, reason: 'shipment_cancelled', actorId });
            // Sequential in one transaction: mark the reservation released with its inventory restoration.
            // eslint-disable-next-line no-await-in-loop
            await reservation.save({ session });
          }
          const now = new Date();
          await Promise.all([
            ShipmentItem.updateMany({ tenantId, shipmentId }, [{ $set: { cancelledQty: '$qty' } }], { session }),
            OrderItem.updateMany({ tenantId, shipmentId }, [{ $set: { cancelledQty: '$qty', 'fulfillmentAllocation.status': 'released' } }], { session }),
            FulfillmentTask.updateMany({ tenantId, shipmentId }, { $set: { status: 'failed', failedAt: now, failureReason: 'shipment cancelled' } }, { session }),
          ]);
          shipment.status = SHIPMENT_STATUS.CANCELLED;
          shipment.cancelledAt = now;
          shipment.cancellationReason = reason || 'customer_requested';
          shipment.cancellation.inventoryRestoredAt = now;
          shipment.cancellation.refundStatus = 'pending';
          shipment.cancellation.requestedBy = actorId;
          shipment.version += 1;
          await shipment.save({ session });
        });
      } finally {
        await session.endSession();
      }
      const restoredLines = await ShipmentItem.find({ tenantId, shipmentId }).select('tenantProductId qty').lean();
      const listings = await TenantProduct.find({ _id: { $in: restoredLines.map((line) => line.tenantProductId) }, tenantId });
      await Promise.all(listings.map((listing) => inventoryService.refreshListingStock(listing)));
      await auditService.record({
        action: 'shipment_cancelled', entityType: 'shipment', entityId: shipmentId,
        tenantId, actorId, actorType: enforceOwnership ? 'customer' : 'admin',
        before: { status: current.status }, after: { status: SHIPMENT_STATUS.CANCELLED },
        meta: {
          reason: reason || 'customer_requested', hubId: current.hubId,
          restoredItems: restoredLines.map((line) => ({ tenantProductId: line.tenantProductId, qty: line.qty })),
        },
      });
    }

    const shipment = await Shipment.findOne({ _id: shipmentId, tenantId, orderId });
    const inclusive = config.tax.pricesInclusive !== false;
    const components = {
      refundItemAmount: roundMoney(shipment.merchandiseTotal - shipment.discountAmount - (inclusive ? shipment.taxAmount : 0)),
      refundTaxAmount: roundMoney(shipment.taxAmount),
      refundFeeAmount: roundMoney(shipment.deliveryFee),
    };
    const amount = roundMoney(components.refundItemAmount + components.refundTaxAmount + components.refundFeeAmount);
    if (shipment.cancellation?.refundStatus !== 'success' && amount > 0) {
      try {
        const refund = await refundService.initiate({
          tenantId, userId: order.userId, orderId, paymentId: order.paymentSummary?.paymentId,
          amount, reason: REFUND_REASON.ORDER_CANCELLED, initiatedBy: actorId,
          idempotencyKey: `shipment_cancel:${shipmentId}`, components,
          note: `Cancellation refund for ${shipment.shipmentNumber}`,
        });
        const refundStatus = refund.status === 'success' ? 'success' : (refund.status === 'failed' ? 'failed' : 'pending');
        await Shipment.updateOne(
          { _id: shipmentId, tenantId },
          { $set: { 'cancellation.refundStatus': refundStatus, 'cancellation.refundAmount': amount, 'cancellation.refundTransactionId': refund._id } },
        );
        if (refundStatus === 'failed') throw conflict('Shipment was cancelled but the refund needs operator attention', 'SHIPMENT_REFUND_FAILED');
      } catch (error) {
        await Shipment.updateOne(
          { _id: shipmentId, tenantId },
          { $set: { 'cancellation.refundStatus': 'failed', 'cancellation.refundAmount': amount } },
        );
        throw error;
      }
    }
    await this.deriveOrderStatus({ tenantId, orderId, actorId });
    return this.listForOrder({ tenantId, orderId });
  }

  async setStatus({ tenantId, shipmentId, from, to, patch = {}, actorId = null }) {
    const allowedFrom = Array.isArray(from) ? from : [from];
    const shipment = await Shipment.findOneAndUpdate(
      { _id: shipmentId, tenantId, status: { $in: allowedFrom } },
      { $set: { status: to, ...patch }, $inc: { version: 1 } },
      { new: true },
    );
    if (!shipment) throw conflict('Shipment state changed; refresh and retry', 'INVALID_SHIPMENT_TRANSITION');
    await this.deriveOrderStatus({ tenantId, orderId: shipment.orderId, actorId });
    return shipment;
  }

  async deriveOrderStatus({ tenantId, orderId, actorId = null }) {
    const shipments = await Shipment.find({ tenantId, orderId }).lean();
    if (!shipments.length) return null;
    const next = orderStatusFor(shipments);
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order || order.status === next || order.status === ORDER_STATUS.CANCELLED) return order;
    const previous = order.status;
    order.status = next;
    if (next === ORDER_STATUS.DELIVERED && !order.deliveredAt) order.deliveredAt = new Date();
    await order.save();
    await OrderStatusHistory.create({
      orderId, tenantId, fromStatus: previous, toStatus: next,
      actorId, actorType: actorId ? 'admin' : 'system', note: 'derived from shipment lifecycle',
    });
    return order;
  }
}

export { orderStatusFor };
export default new ShipmentService();
