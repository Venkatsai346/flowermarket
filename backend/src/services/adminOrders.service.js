/**
 * AdminOrdersService — admin order list/detail + CSV (Phase 4).
 *
 * Transitions are NOT here — they live in the saga (orderService). This is
 * the read side: richer filters than the ops list, and a full admin detail
 * (items + immutable charge breakdown + timeline + payment + refunds +
 * returns + delivery assignment).
 */

import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import OrderStatusHistory from '../models/orderStatusHistory.model.js';
import OrderChargeBreakdown from '../models/orderChargeBreakdown.model.js';
import Payment from '../models/payment.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import ReturnRequest from '../models/returnRequest.model.js';
import DeliveryAssignment from '../models/deliveryAssignment.model.js';
import FulfillmentTask from '../models/fulfillmentTask.model.js';
import { serializeList } from '../utils/serialize.js';
import { notFound } from '../utils/ApiError.js';

const VALID_STATUSES = new Set([
  'created', 'payment_pending', 'confirmed', 'picking', 'packed', 'out_for_delivery',
  'delivered', 'delivery_failed', 'cancelled',
  'return_requested', 'return_approved', 'return_rejected', 'return_picked_up',
  'qc_passed', 'qc_failed', 'refund_initiated', 'refunded', 'refund_rejected',
]);

export class AdminOrdersService {
  /** Admin order list with rich filters. */
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };

    if (query.status) {
      if (!VALID_STATUSES.has(query.status)) throw new (await import('../utils/ApiError.js')).badRequest('Invalid status filter', 'INVALID_STATUS');
      q.status = query.status;
    }
    if (query.search) q.orderNumber = new RegExp(query.search, 'i');
    if (query.paymentMethod) q.paymentMethod = query.paymentMethod;
    if (query.hubId) q['slotSnapshot.hubId'] = query.hubId;
    if (query.minTotal != null || query.maxTotal != null) {
      q.totalAmount = {};
      if (query.minTotal != null) q.totalAmount.$gte = Number(query.minTotal);
      if (query.maxTotal != null) q.totalAmount.$lte = Number(query.maxTotal);
    }
    if (query.from || query.to) {
      q.createdAt = {};
      if (query.from) q.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) q.createdAt.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000);
    }

    const [docs, total] = await Promise.all([
      Order.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(q),
    ]);

    // batch fetch orderNumbers for the list (already in docs) — light enrich
    const userIds = [...new Set(docs.map((d) => d.userId).filter(Boolean))];

    return {
      items: serializeList(docs).map((d) => ({
        ...d,
        userId: d.userId,
        customerName: d.addressSnapshot?.name || null,
        hub: d.slotSnapshot?.hubId ? { id: d.slotSnapshot.hubId } : null,
        _userIds: userIds,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total },
    };
  }

  /** Full admin order detail. */
  async detail({ tenantId, orderId }) {
    const order = await Order.findOne({ _id: orderId, tenantId }).lean();
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');

    const [items, history, breakdown, payments, refunds, returns, assignment, task] = await Promise.all([
      OrderItem.find({ orderId: order._id, tenantId }).lean(),
      OrderStatusHistory.find({ orderId: order._id, tenantId }).sort({ createdAt: 1 }).lean(),
      OrderChargeBreakdown.findOne({ orderId: order._id, tenantId }).lean(),
      Payment.find({ orderId: order._id, tenantId }).lean(),
      RefundTransaction.find({ orderId: order._id, tenantId }).lean(),
      ReturnRequest.find({ orderId: order._id, tenantId }).lean(),
      DeliveryAssignment.findOne({ orderId: order._id, tenantId }).lean(),
      FulfillmentTask.findOne({ orderId: order._id, tenantId }).lean(),
    ]);

    return {
      order: { ...order, id: order._id },
      items: serializeList(items),
      timeline: serializeList(history),
      chargeBreakdown: breakdown ? { ...breakdown, id: breakdown._id } : null,
      payments: serializeList(payments),
      refunds: serializeList(refunds),
      returns: serializeList(returns),
      delivery: assignment ? { ...assignment, id: assignment._id } : null,
      fulfillmentTask: task ? { ...task, id: task._id } : null,
    };
  }

  /** CSV of the filtered order list. */
  async csv({ tenantId, query = {} }) {
    const { items } = await this.list({ tenantId, query: { ...query, page: 1, limit: 200 } });
    return items.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '',
      customerName: o.customerName || '',
      itemsCount: o.itemsCount,
      itemsSubtotal: o.itemsSubtotal,
      deliveryFee: o.deliveryFee,
      discount: o.discount,
      taxAmount: o.taxAmount,
      totalAmount: o.totalAmount,
      paymentMethod: o.paymentMethod,
      pincode: o.addressSnapshot?.pincode || '',
      hubId: o.slotSnapshot?.hubId || '',
      slot: o.slotSnapshot ? `${o.slotSnapshot.date} ${o.slotSnapshot.startTime}` : '',
    }));
  }
}

export default new AdminOrdersService();
