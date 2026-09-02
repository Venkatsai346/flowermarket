import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import OrderStatusHistory from '../models/orderStatusHistory.model.js';
import CartItem from '../models/cartItem.model.js';
import Address from '../models/address.model.js';
import SlotReservation from '../models/slotReservation.model.js';
import cartService from './cart.service.js';
import slotService from './slot.service.js';
import paymentService from './payment.service.js';
import inventoryService from './inventory.service.js';
import fulfillmentService from './fulfillment.service.js';
import refundService from './refund.service.js';
import pricingPolicyService from './pricingPolicy.service.js';
import slotForecastingService from './slotForecasting.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import ledgerPostingService from './ledgerPosting.service.js';
import payoutService from './payout.service.js';
import nextOrderNumber from '../utils/orderNumber.js';
import { assertTransition, cancellationAllowed } from '../utils/orderStateMachine.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { notFound, badRequest, conflict, unauthorized } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import {
  ORDER_STATUS,
  ORDER_CANCELLATION_REASON,
  SLOT_RESERVATION_STATUS,
  REFUND_REASON,
  AUDIT_ACTOR_TYPE,
  DELIVERY_ASSIGNMENT_STATUS,
} from '../constants/enums.js';

const MAX_DELIVERY_RETRIES = 2;

/**
 * OrderService — the SAGA ORCHESTRATOR (doc §4).
 *
 * The doc is explicit: with cart/inventory/payment/slot/fulfillment in play,
 * an explicit central orchestrator is easier to debug than choreography.
 * Every cross-service step here has a compensating action on failure:
 *
 *   create (CREATED) -> charge -> hard-commit inventory -> confirm slot
 *   -> create fulfillment task (CONFIRMED)
 *
 *   charge fail      -> release slot, CANCELLED (payment_failed)
 *   inventory fail   -> refund, release slot, CANCELLED (stock_unavailable)
 *   cancel (reverse) -> restore inventory, release slot, refund, CANCELLED
 */
class OrderService {
  /**
   * The main checkout saga entry point.
   */
  async checkout({ tenantId, userId, slotReservationId, addressId, paymentMethod = 'upi', idempotencyKey = null, confirmPriceChanges = false, source = 'app', req = null }) {
    // ---- 1. cart revalidation (stale-cart problem) ----
    const revalidated = await cartService.revalidate({ tenantId, userId });
    if (revalidated.itemCount === 0) throw badRequest('Cart is empty', 'CART_EMPTY');
    if (revalidated.changed && !confirmPriceChanges) {
      throw conflict('Prices or stock changed since you added items — please confirm', 'PRICE_CHANGED', { diffs: revalidated.diffs });
    }
    // customer confirmed the diff (or nothing changed): snap cart to LIVE prices
    await cartService.applyLivePrices({ tenantId, userId });

    // ---- 2. slot reservation (must be this user's live HELD hold) ----
    const hold = await this.findMyHold({ tenantId, userId, slotReservationId });
    if (!hold || hold.status !== SLOT_RESERVATION_STATUS.HELD || hold.expiresAt < new Date()) {
      throw conflict('Slot hold is invalid or expired — please reserve again', 'RESERVATION_INVALID');
    }

    // ---- 3. address snapshot (ownership) ----
    const address = await Address.findOne({ _id: addressId, tenantId, userId });
    if (!address) throw notFound('Address not found', 'ADDRESS_NOT_FOUND');

    // ---- 4. create order + items ----
    const { cart, items } = await cartService.getCart({ tenantId, userId });
    const order = await this.createOrderDoc({
      tenantId, userId, cart, items, hold, address, paymentMethod, source,
    });

    // ---- 5. charge (idempotent) ----
    const key = idempotencyKey || paymentService.newIdempotencyKey();
    await this.transition(order, ORDER_STATUS.PAYMENT_PENDING, { actorType: AUDIT_ACTOR_TYPE.SYSTEM, note: 'charge initiated', req });

    const { payment, chargeResult } = await paymentService.charge({
      tenantId, userId, orderId: order._id, amount: order.totalAmount,
      method: paymentMethod, idempotencyKey: key,
    });
    order.paymentSummary.paymentId = payment._id;
    order.paymentSummary.status = payment.status;
    if (payment.paidAt) order.paymentSummary.paidAt = payment.paidAt;
    await order.save();

    // ---- async gateway (razorpay): order created, awaiting client payment.
    //      The webhook (payment.captured) confirms -> confirmPayment(). ----
    if (chargeResult.pending) {
      return {
        ...(await this.detail({ tenantId, orderId: order._id })),
        paymentPending: true,
        gatewayOrderId: chargeResult.gatewayOrderId || null,
        provider: chargeResult.provider || 'razorpay',
      };
    }

    if (!chargeResult.success) {
      // ---- compensation A: payment failed ----
      await this.compensateFailedCharge(order, hold, ORDER_CANCELLATION_REASON.PAYMENT_FAILED, req);
      throw conflict('Payment failed', 'PAYMENT_FAILED', { orderId: order._id, paymentStatus: payment.status });
    }

    // ---- 6-8: hard-commit inventory -> confirm slot -> CONFIRMED ----
    await this.finalizeOrderAfterPayment({ order, hold, items, payment, userId, req });

    return this.detail({ tenantId, orderId: order._id });
  }

  /**
   * Shared post-payment finalization (synchronous success path AND the
   * razorpay webhook path). Idempotent: a second call on an already-CONFIRMED
   * order is a no-op.
   *
   *   commit inventory (real stock race) -> confirm slot -> queue picking ->
   *   CONFIRMED -> cart checked out -> events
   */
  async finalizeOrderAfterPayment({ order, hold, items, payment, userId, req = null }) {
    if (order.status === ORDER_STATUS.CONFIRMED) return order; // webhook replay
    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      throw conflict(`Order is ${order.status} — cannot finalize`, 'INVALID_ORDER_STATE');
    }

    const tenantId = order.tenantId;
    const commitItems = items.map((i) => ({ listingId: i.tenantProductId, qty: i.qty }));
    const { committed, failed } = await inventoryService.commitForOrder({ tenantId, items: commitItems });

    if (failed.length > 0) {
      // ---- compensation B: stock lost the race ----
      await inventoryService.restoreForOrder({ tenantId, items: committed });
      await refundService.initiate({
        tenantId, userId, orderId: order._id, amount: order.totalAmount,
        reason: REFUND_REASON.ORDER_CANCELLED, paymentId: payment._id, initiatedBy: userId,
        components: this.fullOrderRefundComponents(order),
      });
      await slotService.release({ reservationId: hold._id, tenantId, reason: 'stock_unavailable' });
      await this.markCancelled(order, {
        reason: ORDER_CANCELLATION_REASON.STOCK_UNAVAILABLE,
        cancelledBy: userId, actorType: AUDIT_ACTOR_TYPE.SYSTEM, req,
        refundTransactionId: order.cancellation?.refundTransactionId || null,
      });
      throw conflict('Some items are no longer in stock — order cancelled & refunded', 'STOCK_UNAVAILABLE', { orderId: order._id, failed });
    }

    const reservationId = hold?._id || order.slotReservationId;
    if (!reservationId) {
      throw conflict('No slot reservation linked to this order', 'RESERVATION_MISSING');
    }
    await slotService.confirm({ reservationId, tenantId, orderId: order._id });
    order.slotReservationId = reservationId;
    await fulfillmentService.createTask({
      orderId: order._id, tenantId,
      hubId: order.slotSnapshot?.hubId || null,
      itemsCount: order.itemsCount,
    });

    await this.transition(order, ORDER_STATUS.CONFIRMED, {
      actorType: AUDIT_ACTOR_TYPE.SYSTEM, note: 'payment captured, inventory committed', req,
    });
    if (order.cartId) {
      await cartService.markCheckedOut({ cartId: order.cartId, orderId: order._id });
    }

    // ---- Phase 6.1: recognise the money in the double-entry ledger ----
    //      DR gateway_clearing / CR vendor+store payable, commission, GST.
    //      Idempotent on the order id, so a webhook replay posts nothing new.
    //      Never blocks confirmation in non-strict mode: the order is already
    //      paid and stocked, and `ledgerPosting.backfillSales()` re-posts
    //      exactly (see services/ledgerPosting.service.js header).
    await ledgerPostingService.safePost('sale_captured', () =>
      ledgerPostingService.postSaleCaptured({ order, postedBy: userId || order.userId })
    );

    // ---- Phase 6.3: accrue the vendors' entitlement ----
    //      Creates one PayoutLineItem per VENDOR item with every deduction
    //      frozen at today's rates. Nothing becomes payable until the return
    //      window closes — accrual only records what was earned. Idempotent on
    //      orderItemId, and non-blocking for the same reason the ledger post is.
    await ledgerPostingService.safePost('payout_accrual', () =>
      payoutService.accrueForOrder({ orderId: order._id, actorId: userId || order.userId })
    );

    await auditService.record({
      action: 'create', entityType: 'order', entityId: order._id,
      tenantId, actorId: userId || order.userId, actorType: 'tenant',
      after: { orderNumber: order.orderNumber, total: order.totalAmount, status: order.status }, req,
    });
    await catalogEventService.publish({
      eventType: 'order_confirmed', entityType: 'order', entityId: order._id,
      tenantId, payload: { orderId: order._id, orderNumber: order.orderNumber, total: order.totalAmount },
    });
    return order;
  }

  /**
   * Called by the payment webhook when the gateway confirms capture.
   * Finds the order via the payment, finalizes the saga (idempotent).
   */
  async confirmPayment({ paymentId, req = null }) {
    const payment = await (await import('../models/payment.model.js')).default.findById(paymentId);
    if (!payment) throw notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    const order = await Order.findById(payment.orderId);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');

    if (order.status === ORDER_STATUS.CONFIRMED) {
      return this.detail({ tenantId: order.tenantId, orderId: order._id });
    }
    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      // already moved past pending (e.g. cancelled by reconcile) — nothing to do
      return this.detail({ tenantId: order.tenantId, orderId: order._id });
    }

    const hold = order.slotReservationId
      ? await SlotReservation.findOne({ _id: order.slotReservationId, tenantId: order.tenantId }).lean()
      : null;
    const items = await CartItem.find({ cartId: order.cartId }).lean();
    if (!items.length) {
      // cart already cleared — fall back to order items (webhook raced a retry)
      const oi = await (await import('../models/orderItem.model.js')).default.find({ orderId: order._id }).lean();
      const listingMap = await Promise.all(oi.map(async (x) => {
        const cartItem = await CartItem.findOne({ cartId: order.cartId, tenantProductId: x.tenantProductId }).lean();
        return cartItem || { tenantProductId: x.tenantProductId, productMasterId: x.productMasterId, qty: x.qty, priceSnapshot: x.priceAtOrder, titleSnapshot: x.skuSnapshot?.title, lineTotal: x.lineTotal, isReturnable: x.isReturnable };
      }));
      items.push(...listingMap.filter(Boolean));
    }

    await this.finalizeOrderAfterPayment({ order, hold, items, payment, userId: order.userId, req });
    return this.detail({ tenantId: order.tenantId, orderId: order._id });
  }

  // ---------------- reads ----------------

  async getOrder({ tenantId, orderId, userId = null }) {
    const q = { _id: orderId, tenantId };
    if (userId) q.userId = userId;
    const order = await Order.findOne(q);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    return order;
  }

  async detail({ tenantId, orderId, userId = null }) {
    const order = await this.getOrder({ tenantId, orderId, userId });
    const [items, timeline] = await Promise.all([
      OrderItem.find({ orderId: order._id }).lean(),
      OrderStatusHistory.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
    ]);
    return { order, items: serializeList(items), timeline: serializeList(timeline) };
  }

  async listMine({ tenantId, userId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId, userId };
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      Order.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async listAll({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (query.status) q.status = query.status;
    if (query.search) q.orderNumber = new RegExp(query.search, 'i');
    const [docs, total] = await Promise.all([
      Order.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async timeline({ tenantId, orderId, userId = null }) {
    const order = await this.getOrder({ tenantId, orderId, userId });
    const history = await OrderStatusHistory.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
    return { orderId, status: order.status, history: serializeList(history) };
  }

  // ---------------- fulfillment transitions ----------------

  /**
   * Rider flow (blueprint §3). Unlike the ops dispatch (which just creates the
   * assignment), this is the full explicit machine driven by the rider app:
   *   PENDING_ACCEPT -> ACCEPTED -> AT_HUB -> IN_TRANSIT -> ARRIVED -> DELIVERED
   */
  async riderFlow({ tenantId, orderId, action, riderId, body = {}, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    const { packageVerified, podType, podValue, reason } = body;

    switch (action) {
      case 'accept': {
        await fulfillmentService.acceptAssignment({ orderId, tenantId, riderId });
        return this.detail({ tenantId, orderId });
      }
      case 'reject': {
        const assignment = await fulfillmentService.rejectAssignment({ orderId, tenantId, riderId, reason });
        return { assignment };
      }
      case 'arrive-hub': {
        await fulfillmentService.markAtHub({ orderId, tenantId });
        return this.detail({ tenantId, orderId });
      }
      case 'depart': {
        // AT_HUB -> IN_TRANSIT + Order -> OUT_FOR_DELIVERY (customer notified)
        await fulfillmentService.departHub({ orderId, tenantId, packageVerified: packageVerified === true });
        const result = await this.transition(order, ORDER_STATUS.OUT_FOR_DELIVERY, {
          actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId: riderId, note: 'rider departed hub with verified package', req,
        });
        await catalogEventService.publish({
          eventType: 'order_out_for_delivery', entityType: 'order', entityId: order._id,
          tenantId, payload: { orderId: order._id, riderId },
        });
        return result;
      }
      case 'arrive': {
        await fulfillmentService.markArrived({ orderId, tenantId });
        await catalogEventService.publish({
          eventType: 'rider_arrived', entityType: 'order', entityId: order._id,
          tenantId, payload: { orderId: order._id },
        });
        return this.detail({ tenantId, orderId });
      }
      case 'complete': {
        await fulfillmentService.completeDelivery({ orderId, tenantId, podType, podValue, actorId: riderId });
        const result = await this.transition(order, ORDER_STATUS.DELIVERED, {
          actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId: riderId, note: `delivered (POD: ${podType})`, req,
        });
        // closing the loop for slot forecasting: real fulfillment timings
        await this.recordFulfillmentTiming({ tenantId, orderId });
        await catalogEventService.publish({
          eventType: 'order_delivered', entityType: 'order', entityId: order._id,
          tenantId, payload: { orderId: order._id, podType },
        });
        return result;
      }
      case 'fail': {
        // saga decides: retry (reassign) or cancel after max retries
        await fulfillmentService.failDelivery({ orderId, tenantId, reason });
        const retries = (order.deliveryRetryCount || 0) + 1;
        order.deliveryRetryCount = retries;
        await order.save();
        if (retries >= MAX_DELIVERY_RETRIES) {
          return this.cancelOrder({
            tenantId, orderId, reason: ORDER_CANCELLATION_REASON.DELIVERY_FAILED_MAX_RETRIES,
            reasonText: reason || 'Delivery failed after max retries',
            actorId: riderId, actorType: AUDIT_ACTOR_TYPE.ADMIN, req,
          });
        }
        const res = await this.transition(order, ORDER_STATUS.DELIVERY_FAILED, {
          actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId: riderId,
          note: `delivery failed (attempt ${retries}/${MAX_DELIVERY_RETRIES})`, req,
        });
        // reassign to the next rider for the retry
        await fulfillmentService.assignRider({ orderId, tenantId, hubId: order.slotSnapshot?.hubId || null });
        return res;
      }
      default:
        throw badRequest(`Unknown rider action: ${action}`, 'INVALID_RIDER_ACTION');
    }
  }

  /** Record real pick/pack/delivery durations for the forecasting loop. */
  async recordFulfillmentTiming({ tenantId, orderId }) {
    try {
      const order = await Order.findById(orderId);
      const task = await (await import('../models/fulfillmentTask.model.js')).default.findOne({ orderId });
      const assignment = await (await import('../models/deliveryAssignment.model.js')).default.findOne({ orderId });
      const start = task?.startedAt;
      const packed = task?.packedAt;
      const delivered = assignment?.completedAt || order?.updatedAt;
      const now = new Date();
      await slotForecastingService.recordFulfillmentTime({
        orderId,
        tenantId,
        hubId: order.slotSnapshot?.hubId || null,
        slotId: order.slotSnapshot?.slotId || null,
        slotType: order.slotSnapshot?.windowType || 'normal',
        weekday: now.getUTCDay(),
        pickSeconds: start && packed ? Math.round((packed - start) / 1000) : null,
        packSeconds: start && packed ? Math.round((packed - start) / 1000) : null,
        deliverySeconds: packed && delivered ? Math.round((delivered - packed) / 1000) : null,
      });
    } catch (err) {
      // timing capture must never break the delivery completion
      // eslint-disable-next-line no-console
      console.warn('[order] timing log skipped:', err?.message);
    }
  }

  async startPicking({ tenantId, orderId, pickerId, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.PICKING, { context: 'startPicking' });
    await fulfillmentService.startPick({ orderId, tenantId, pickerId });
    return this.transition(order, ORDER_STATUS.PICKING, { actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId: pickerId, note: 'picking started', req });
  }

  async markPacked({ tenantId, orderId, actorId = null, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.PACKED, { context: 'markPacked' });
    await fulfillmentService.completePick({ orderId, tenantId });
    return this.transition(order, ORDER_STATUS.PACKED, { actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId, note: 'picked & packed', req });
  }

  async dispatch({ tenantId, orderId, actorId = null, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.OUT_FOR_DELIVERY, { context: 'dispatch' });
    const assignment = await fulfillmentService.assignRider({
      orderId, tenantId, hubId: order.slotSnapshot?.hubId || null,
    });
    const result = await this.transition(order, ORDER_STATUS.OUT_FOR_DELIVERY, {
      actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId, note: 'rider assigned (PENDING_ACCEPT), out for delivery', req,
    });
    // mongoose toJSON only serializes schema paths — merge the assignment into
    // a plain object so the API can hand the rider their assignment id
    const out = result.toObject();
    out.deliveryAssignment = assignment.toObject();
    return out;
  }

  /** Deliver with POD (OTP/photo/signature) — ops path. */
  async deliver({ tenantId, orderId, podType, podValue = null, actorId = null, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.DELIVERED, { context: 'deliver' });
    // ops shortcut: ensure assignment is ARRIVED before POD capture
    const assignment = await fulfillmentService.getAssignment({ orderId, tenantId }).catch(() => null);
    if (assignment) {
      if (assignment.status === DELIVERY_ASSIGNMENT_STATUS.FAILED || assignment.status === DELIVERY_ASSIGNMENT_STATUS.CANCELLED) {
        throw conflict(`Assignment is ${assignment.status}`, 'INVALID_ASSIGNMENT_STATE');
      }
      await fulfillmentService.forceArrived({ orderId, tenantId });
    }
    await fulfillmentService.completeDelivery({ orderId, tenantId, podType, podValue, actorId });
    order.paymentSummary.status = 'success';
    await order.save();
    const result = await this.transition(order, ORDER_STATUS.DELIVERED, {
      actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId, note: `delivered (POD: ${podType})`, req,
    });
    await this.recordFulfillmentTiming({ tenantId, orderId });
    await catalogEventService.publish({
      eventType: 'order_delivered', entityType: 'order', entityId: order._id,
      tenantId, payload: { orderId: order._id, podType },
    });
    return result;
  }

  /** Delivery failure — retry or cancel after max retries. */
  async deliveryFailed({ tenantId, orderId, reason = null, actorId = null, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.DELIVERY_FAILED, { context: 'deliveryFailed' });
    await fulfillmentService.failDelivery({ orderId, tenantId, reason });
    const retries = (order.deliveryRetryCount || 0) + 1;
    order.deliveryRetryCount = retries;
    await order.save();

    if (retries >= MAX_DELIVERY_RETRIES) {
      await this.cancelOrder({
        tenantId, orderId, reason: ORDER_CANCELLATION_REASON.DELIVERY_FAILED_MAX_RETRIES,
        reasonText: reason || 'Delivery failed after max retries',
        actorId, actorType: AUDIT_ACTOR_TYPE.ADMIN, req,
      });
      return this.detail({ tenantId, orderId });
    }
    return this.transition(order, ORDER_STATUS.DELIVERY_FAILED, {
      actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId,
      note: `delivery failed (attempt ${retries}/${MAX_DELIVERY_RETRIES})`, req,
    });
  }

  /** Retry delivery after a failure. */
  async retryDelivery({ tenantId, orderId, actorId = null, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    assertTransition(order.status, ORDER_STATUS.OUT_FOR_DELIVERY, { context: 'retryDelivery' });
    await fulfillmentService.assignRider({ orderId, tenantId });
    return this.transition(order, ORDER_STATUS.OUT_FOR_DELIVERY, { actorType: AUDIT_ACTOR_TYPE.ADMIN, actorId, note: 'delivery retry dispatched', req });
  }

  // ---------------- cancellation (the reverse saga) ----------------

  async cancelOrder({ tenantId, orderId, reason = ORDER_CANCELLATION_REASON.CUSTOMER_REQUESTED, reasonText = null, actorId = null, actorType = AUDIT_ACTOR_TYPE.CUSTOMER, refund = true, req = null }) {
    const order = await this.getOrder({ tenantId, orderId });
    if (!cancellationAllowed(order.status)) {
      throw conflict(`Order cannot be cancelled in state ${order.status}`, 'CANCELLATION_NOT_ALLOWED');
    }

    // 1. restore inventory (reverse the hard commit)
    const items = await OrderItem.find({ orderId: order._id }).lean();
    await inventoryService.restoreForOrder({
      tenantId,
      items: items.map((i) => ({ listingId: i.tenantProductId, qty: i.qty })),
    });

    // 2. release the slot hold
    if (order.slotReservationId) {
      await slotService.release({ reservationId: order.slotReservationId, tenantId, reason: 'order_cancelled' }).catch(() => {});
    }

    // 3. refund if paid (component-based per blueprint §5: item + tax + fee)
    let refundTransactionId = null;
    if (refund && order.paymentSummary?.paymentId && ['success', 'partially_refunded', 'refunded'].includes(order.paymentSummary.status)) {
      const paidAmount = order.totalAmount - order.paymentSummary.refundedAmount;
      if (paidAmount > 0) {
        const components = this.fullOrderRefundComponents(order);
        const refundTxn = await refundService.initiate({
          tenantId, userId: order.userId, orderId: order._id, amount: paidAmount,
          reason: REFUND_REASON.ORDER_CANCELLED,
          paymentId: order.paymentSummary.paymentId,
          initiatedBy: actorId,
          components,
        });
        refundTransactionId = refundTxn._id;
      }
    }

    await this.markCancelled(order, { reason, reasonText, cancelledBy: actorId, actorType, refundTransactionId, req });
    await auditService.record({
      action: 'status_change', entityType: 'order', entityId: order._id,
      tenantId, actorId, actorType,
      before: { status: 'active' }, after: { status: 'cancelled' },
      meta: { reason, reasonText }, req,
    });
    await catalogEventService.publish({
      eventType: 'order_cancelled', entityType: 'order', entityId: order._id,
      tenantId, payload: { orderId: order._id, reason, refundTransactionId },
    });
    return this.detail({ tenantId, orderId });
  }

  // ---------------- internals ----------------

  /**
   * Component split for a FULL refund (cancellation / compensation):
   *   item = itemsSubtotal − discount + tax     (what the customer paid for goods)
   *   tax  = taxAmount                          (credit-note line)
   *   fee  = deliveryFee
   * `amount` (grand total) === item + tax + fee — components always add up.
   */
  fullOrderRefundComponents(order) {
    const item = roundMoney(order.itemsSubtotal - order.discount + order.taxAmount);
    return {
      refundItemAmount: item,
      refundTaxAmount: order.taxAmount || 0,
      refundFeeAmount: order.deliveryFee || 0,
    };
  }

  async findMyHold({ tenantId, userId, slotReservationId }) {
    const { default: SlotReservation } = await import('../models/slotReservation.model.js');
    return SlotReservation.findOne({ _id: slotReservationId, tenantId, userId });
  }

  async createOrderDoc({ tenantId, userId, cart, items, hold, address, paymentMethod, source }) {
    const { default: DeliverySlot } = await import('../models/deliverySlot.model.js');
    const slotDoc = await DeliverySlot.findById(hold.slotId);

    // ---- Phase 3.5: compute charges from POLICY (delivery fee / tax /
    //      discount), not a hardcoded 49. The result is an immutable
    //      breakdown persisted separately + per-item amounts on OrderItem. ----
    // Resolve the category per line — GST is a CATEGORY-level legal
    // classification, so the per-line TaxPolicy lookup needs it.
    const { default: ProductMaster } = await import('../models/productMaster.model.js');
    const masters = await ProductMaster.find({ _id: { $in: items.map((i) => i.productMasterId).filter(Boolean) } })
      .select('_id categoryId vendorId').lean();
    const categoryByMaster = new Map(masters.map((m) => [String(m._id), m.categoryId]));
    const vendorByMaster = new Map(masters.map((m) => [String(m._id), m.vendorId || null]));

    const charges = await pricingPolicyService.computeOrderCharges({
      tenantId,
      cartSubtotal: cart.subtotal,
      items: items.map((i) => ({
        tenantProductId: i.tenantProductId,
        productMasterId: i.productMasterId,
        qty: i.qty,
        priceSnapshot: i.priceSnapshot || { sellingPrice: 0 },
        categoryId: i.productMasterId ? (categoryByMaster.get(String(i.productMasterId)) || null) : null,
      })),
      slotType: slotDoc?.windowType || 'normal',
      zoneDistanceKm: null, // zone pricing: pass hub->address distance when available
      couponCode: cart.couponCode || null,
      userId,
    });

    // resolve category per line for tax lookup (computeOrderCharges already
    // used the category; here we just mirror the breakdown onto the items)
    const lineByListing = new Map(charges.lineItems.map((l) => [String(l.tenantProductId), l]));

    const totalAmount = charges.grandTotal;
    const order = await Order.create({
      tenantId, userId,
      orderNumber: await nextOrderNumber({ tenantId }),
      status: ORDER_STATUS.CREATED,
      source,
      itemsCount: items.reduce((a, i) => a + i.qty, 0),
      itemsSubtotal: charges.itemSubtotal,
      deliveryFee: charges.deliveryFee,
      discount: charges.discountTotal,
      taxAmount: charges.taxTotal,
      totalAmount,
      currency: 'INR',
      cartId: cart._id,
      couponCode: cart.couponCode || null,
      slotReservationId: hold._id,
      slotSnapshot: slotDoc ? {
        slotId: slotDoc._id,
        date: slotDoc.date,
        startTime: slotDoc.startTime,
        endTime: slotDoc.endTime,
        displayLabel: slotDoc.displayLabel || null,
        hubId: slotDoc.hubId || null,
        windowType: slotDoc.windowType || 'normal',
      } : null,
      addressSnapshot: {
        addressId: address._id,
        name: address.name || null,
        phone: address.phone || null,
        line1: address.line1,
        line2: address.line2 || null,
        landmark: address.landmark || null,
        city: address.city || null,
        state: address.state || null,
        pincode: address.pincode,
        coordinates: address.coordinates || null,
      },
      paymentMethod,
    });

    await OrderItem.insertMany(
      items.map((i) => {
        const line = lineByListing.get(String(i.tenantProductId)) || {
          taxAmount: 0, discountAllocated: 0, taxPolicyId: null, hsnCode: null,
        };
        return {
          orderId: order._id,
          tenantId,
          tenantProductId: i.tenantProductId,
          productMasterId: i.productMasterId,
          variantId: i.variantId || null,
          vendorId: i.productMasterId ? (vendorByMaster.get(String(i.productMasterId)) || null) : null,
          skuSnapshot: { skuGlobal: null, title: i.titleSnapshot || 'Item', imageUrl: i.imageUrlSnapshot || null, unit: i.unitSnapshot || null },
          priceAtOrder: { mrp: i.priceSnapshot?.mrp ?? null, sellingPrice: i.priceSnapshot?.sellingPrice ?? 0, currency: i.priceSnapshot?.currency || 'INR' },
          qty: i.qty,
          lineTotal: line.lineTotal ?? i.lineTotal ?? 0,
          taxAmount: line.taxAmount ?? 0,
          discountAllocated: line.discountAllocated ?? 0,
          taxPolicyId: line.taxPolicyId || null,
          hsnCode: line.hsnCode || null,
          isReturnable: i.isReturnable !== false,
        };
      })
    );

    // ---- persist the immutable charge breakdown ----
    const breakdown = await pricingPolicyService.persistChargeBreakdown({
      orderId: order._id, tenantId, charges: { ...charges, couponCode: cart.couponCode || null }, createdBy: userId,
    });
    order.chargeBreakdownId = breakdown._id;
    await order.save();

    // ---- record coupon usage (dedupe on couponId+orderId) ----
    if (charges.discountPolicyId) {
      await pricingPolicyService.recordCouponUsage({
        couponId: charges.discountPolicyId, tenantId, userId, orderId: order._id,
        discountAmount: charges.discountTotal, couponCode: cart.couponCode || null,
      });
    }

    await OrderStatusHistory.create({
      orderId: order._id, tenantId,
      fromStatus: null, toStatus: ORDER_STATUS.CREATED,
      actorType: AUDIT_ACTOR_TYPE.SYSTEM, note: 'order created',
    });
    return order;
  }

  async compensateFailedCharge(order, hold, reason, req) {
    await slotService.release({ reservationId: hold._id, tenantId: order.tenantId, reason: 'payment_failed' }).catch(() => {});
    await this.markCancelled(order, { reason, cancelledBy: order.userId, actorType: AUDIT_ACTOR_TYPE.SYSTEM, req });
  }

  async markCancelled(order, { reason, reasonText = null, cancelledBy = null, actorType = AUDIT_ACTOR_TYPE.SYSTEM, refundTransactionId = null, req = null }) {
    const fromStatus = order.status;
    order.status = ORDER_STATUS.CANCELLED;
    order.cancellation = {
      reason: reason || ORDER_CANCELLATION_REASON.ADMIN_FORCE,
      reasonText: reasonText || null,
      cancelledBy: cancelledBy || null,
      cancelledAt: new Date(),
      refundStatus: refundTransactionId ? 'success' : (order.paymentSummary?.status === 'failed' || order.paymentSummary?.status === 'pending' ? 'not_applicable' : 'pending'),
      refundTransactionId: refundTransactionId || order.cancellation?.refundTransactionId || null,
    };
    await order.save();
    await OrderStatusHistory.create({
      orderId: order._id, tenantId: order.tenantId,
      fromStatus, toStatus: ORDER_STATUS.CANCELLED,
      actorType, actorId: cancelledBy, note: reason || null,
    });
  }

  /** Validate + apply a status transition and record history. */
  async transition(order, toStatus, { actorType = AUDIT_ACTOR_TYPE.SYSTEM, actorId = null, note = null, req = null, skipHistory = false } = {}) {
    assertTransition(order.status, toStatus);
    const from = order.status;
    order.status = toStatus;
    order.version += 1;
    await order.save();
    if (!skipHistory) {
      await OrderStatusHistory.create({
        orderId: order._id, tenantId: order.tenantId,
        fromStatus: from, toStatus,
        actorType, actorId, note,
      });
    }
    return order;
  }
}

export default new OrderService();
