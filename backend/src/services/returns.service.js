import ReturnRequest from '../models/returnRequest.model.js';
import ReturnItem from '../models/returnItem.model.js';
import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import refundService from './refund.service.js';
import refundCalculator from './refundCalculator.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import {
  RETURN_CLAIM_TYPE,
  RETURN_REQUEST_STATUS,
  RETURN_QC_STATUS,
  REFUND_REASON,
  ORDER_STATUS,
} from '../constants/enums.js';

/** Standard return window (days after delivery). */
export const RETURN_WINDOW_DAYS = 7;
/** Instant-claim window (hours after delivery) for perishables. */
export const INSTANT_CLAIM_WINDOW_HOURS = 24;
/** Fraud guard: max auto-approved instant claims per customer per month. */
export const INSTANT_CLAIM_MONTHLY_LIMIT = 3;

/**
 * ReturnsService — the two flows from the doc:
 *   A) PICKUP_QC: eligibility -> APPROVED -> pickup -> QC -> refund
 *   B) INSTANT_CLAIM: auto-eligible perishable claim -> instant refund (no pickup)
 */
class ReturnsService {
  async checkEligibility({ orderId, userId, items, claimType }) {
    const order = await Order.findById(orderId);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    if (String(order.userId) !== String(userId)) throw badRequest('Not your order', 'FORBIDDEN');
    if (order.status !== ORDER_STATUS.DELIVERED) {
      return { isEligible: false, windowExpired: false, nonReturnableItems: false, claimLimitReached: false, reason: 'Order is not delivered yet' };
    }

    const deliveredAt = order.paymentSummary?.paidAt || order.updatedAt;
    const hoursSince = (Date.now() - new Date(deliveredAt).getTime()) / 3600000;
    const daysSince = hoursSince / 24;

    const windowHours = claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM ? INSTANT_CLAIM_WINDOW_HOURS : RETURN_WINDOW_DAYS * 24;
    const windowExpired = hoursSince > windowHours;
    if (windowExpired) {
      return { isEligible: false, windowExpired: true, nonReturnableItems: false, claimLimitReached: false, reason: `Return window expired (${claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM ? `${INSTANT_CLAIM_WINDOW_HOURS}h` : `${RETURN_WINDOW_DAYS}d`})` };
    }

    // ---- item-level checks ----
    const orderItems = await OrderItem.find({ orderId, _id: { $in: items.map((i) => i.orderItemId) } }).lean();
    if (orderItems.length !== items.length) throw badRequest('One or more items are not part of this order', 'INVALID_ITEMS');

    const nonReturnable = orderItems.some((oi) => {
      const req = items.find((i) => String(i.orderItemId) === String(oi._id));
      const alreadyReturned = oi.returnedQty || 0;
      if (req.qty <= 0 || req.qty > oi.qty - alreadyReturned) return true; // over-request
      if (claimType === RETURN_CLAIM_TYPE.PICKUP_QC && !oi.isReturnable) return true;
      return false;
    });
    if (nonReturnable) {
      return { isEligible: false, windowExpired: false, nonReturnableItems: true, claimLimitReached: false, reason: 'Items are not returnable or qty exceeds delivered qty' };
    }

    // ---- fraud guard: instant-claim monthly limit ----
    let claimLimitReached = false;
    if (claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM) {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const claimsThisMonth = await ReturnRequest.countDocuments({
        userId,
        claimType: RETURN_CLAIM_TYPE.INSTANT_CLAIM,
        status: { $in: [RETURN_REQUEST_STATUS.APPROVED, RETURN_REQUEST_STATUS.REFUND_INITIATED, RETURN_REQUEST_STATUS.REFUNDED] },
        createdAt: { $gte: monthStart },
      });
      claimLimitReached = claimsThisMonth >= INSTANT_CLAIM_MONTHLY_LIMIT;
      if (claimLimitReached) {
        return { isEligible: false, windowExpired: false, nonReturnableItems: false, claimLimitReached: true, reason: 'Instant-claim limit reached for this month — contact support' };
      }
    }

    return { isEligible: true, windowExpired: false, nonReturnableItems: false, claimLimitReached: false, order, orderItems };
  }

  /**
   * Create a return request.
   * PICKUP_QC -> APPROVED (schedules pickup).
   * INSTANT_CLAIM -> auto-approve + initiate refund (wallet) immediately.
   */
  async create({ tenantId, userId, orderId, items, reason, reasonCode = null, claimType, customerNote = null, actorId = null }) {
    if (![RETURN_CLAIM_TYPE.PICKUP_QC, RETURN_CLAIM_TYPE.INSTANT_CLAIM].includes(claimType)) {
      throw badRequest('Invalid claim type', 'INVALID_CLAIM_TYPE');
    }
    if (!items?.length) throw badRequest('At least one item is required', 'ITEMS_REQUIRED');

    const eligibility = await this.checkEligibility({ orderId, userId, items, claimType });
    if (!eligibility.isEligible) {
      return { eligible: false, eligibility };
    }

    const { order, orderItems } = eligibility;

    // ---- Phase 3.5: correct refund = item (price − discount + tax) + fee
    //      share per TenantRefundPolicy (blueprint §5). A lookup against the
    //      persisted OrderItem breakdown, never a recomputation. ----
    const allOrderItems = await OrderItem.find({ orderId }).lean();
    const comps = await refundCalculator.compute({
      tenantId, orderId,
      returnedOrderItems: allOrderItems.map((oi) => {
        const req = items.find((i) => String(i.orderItemId) === String(oi._id));
        return {
          qty: oi.qty,
          priceAtOrder: oi.priceAtOrder,
          taxPerUnit: oi.qty ? (oi.taxAmount || 0) / oi.qty : 0,
          discountAllocatedPerUnit: oi.qty ? (oi.discountAllocated || 0) / oi.qty : 0,
          returnedQtyTotal: req ? req.qty : 0,
        };
      }),
      deliveryFee: order.deliveryFee || 0,
      orderGrandTotal: order.totalAmount || 0,
    });
    const amount = comps.totalRefund;

    const rr = await ReturnRequest.create({
      tenantId, orderId, userId,
      claimType, reason, reasonCode,
      status: claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM ? RETURN_REQUEST_STATUS.APPROVED : RETURN_REQUEST_STATUS.APPROVED,
      refundAmount: roundMoney(amount),
      eligibility: {
        isEligible: true, windowExpired: false, nonReturnableItems: false, claimLimitReached: false,
      },
      autoApproved: claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM,
      review: { reviewedBy: claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM ? null : actorId || null, reviewedAt: new Date() },
    });

    await ReturnItem.insertMany(
      orderItems.map((oi) => {
        const req = items.find((i) => String(i.orderItemId) === String(oi._id));
        const netPerUnit = roundMoney(
          (oi.priceAtOrder?.sellingPrice || 0)
          - (oi.qty ? (oi.discountAllocated || 0) / oi.qty : 0)
          + (oi.qty ? (oi.taxAmount || 0) / oi.qty : 0)
        );
        return {
          returnRequestId: rr._id, orderItemId: oi._id, orderId,
          tenantProductId: oi.tenantProductId,
          qty: req.qty,
          refundAmount: roundMoney(netPerUnit * req.qty),
          qcStatus: RETURN_QC_STATUS.PENDING,
        };
      })
    );

    // ---- bump the order to the return sub-machine ----
    await this.syncOrderStatus(order, RETURN_REQUEST_STATUS.APPROVED);

    if (claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM) {
      // Flow B: straight to refund (no pickup, no QC) — component-based
      const refund = await refundService.initiate({
        tenantId, userId, orderId, amount: rr.refundAmount,
        reason: REFUND_REASON.INSTANT_CLAIM_APPROVED,
        returnRequestId: rr._id, paymentId: order.paymentSummary?.paymentId || null,
        initiatedBy: actorId,
        components: { refundItemAmount: comps.refundItemAmount, refundTaxAmount: comps.refundTaxAmount, refundFeeAmount: comps.refundFeeAmount },
      });
      rr.status = refund.status === 'success' ? RETURN_REQUEST_STATUS.REFUNDED : RETURN_REQUEST_STATUS.REFUND_INITIATED;
      rr.refundTransactionId = refund._id;
      await rr.save();
      await this.syncOrderStatus(order, rr.status);
      await this.markItemsReturned({ returnRequestId: rr._id, orderItems });
    }

    return { eligible: true, returnRequest: rr, items: await ReturnItem.find({ returnRequestId: rr._id }).lean() };
  }

  /** Pickup scheduled (Flow A step 2). */
  async markPickedUp({ returnRequestId, tenantId, actorId = null }) {
    const rr = await this.getOwned({ returnRequestId, tenantId });
    if (![RETURN_REQUEST_STATUS.APPROVED].includes(rr.status)) {
      throw conflict(`Return is in state ${rr.status} — cannot mark picked up`, 'INVALID_RETURN_TRANSITION');
    }
    rr.status = RETURN_REQUEST_STATUS.PICKED_UP;
    rr.pickupScheduledAt = rr.pickupScheduledAt || new Date();
    rr.pickedUpAt = new Date();
    await rr.save();
    const order = await Order.findById(rr.orderId);
    await this.syncOrderStatus(order, RETURN_REQUEST_STATUS.PICKED_UP);
    return rr;
  }

  /** QC decision (Flow A step 3). */
  async qcDecision({ returnRequestId, tenantId, decision, note = null, actorId = null }) {
    const rr = await this.getOwned({ returnRequestId, tenantId });
    if (rr.status !== RETURN_REQUEST_STATUS.PICKED_UP) {
      throw conflict('QC decision only allowed after pickup', 'INVALID_RETURN_TRANSITION');
    }
    const order = await Order.findById(rr.orderId);

    if (decision === 'pass') {
      rr.status = RETURN_REQUEST_STATUS.QC_PASSED;
      rr.qcCompletedAt = new Date();
      rr.review = { reviewedBy: actorId, reviewedAt: new Date(), note };
      await rr.save();
      await ReturnItem.updateMany(
        { returnRequestId: rr._id },
        { $set: { qcStatus: RETURN_QC_STATUS.PASSED, qcNote: note || null } }
      );
      await this.syncOrderStatus(order, RETURN_REQUEST_STATUS.QC_PASSED);
      // initiate refund — recompute the component split (blueprint §5)
      const returnItems = await ReturnItem.find({ returnRequestId: rr._id }).lean();
      const orderItemsAll = await OrderItem.find({ orderId: rr.orderId }).lean();
      const comps = await refundCalculator.compute({
        tenantId: rr.tenantId, orderId: rr.orderId,
        returnedOrderItems: orderItemsAll.map((oi) => {
          const ri = returnItems.find((x) => String(x.orderItemId) === String(oi._id));
          return {
            qty: oi.qty,
            priceAtOrder: oi.priceAtOrder,
            taxPerUnit: oi.qty ? (oi.taxAmount || 0) / oi.qty : 0,
            discountAllocatedPerUnit: oi.qty ? (oi.discountAllocated || 0) / oi.qty : 0,
            returnedQtyTotal: ri ? ri.qty : 0,
          };
        }),
        deliveryFee: order.deliveryFee || 0,
        orderGrandTotal: order.totalAmount || 0,
      });
      const refund = await refundService.initiate({
        tenantId: rr.tenantId, userId: rr.userId, orderId: rr.orderId, amount: comps.totalRefund,
        reason: REFUND_REASON.RETURN_QC_PASSED,
        returnRequestId: rr._id, paymentId: order.paymentSummary?.paymentId || null,
        initiatedBy: actorId,
        components: { refundItemAmount: comps.refundItemAmount, refundTaxAmount: comps.refundTaxAmount, refundFeeAmount: comps.refundFeeAmount },
      });
      rr.status = refund.status === 'success' ? RETURN_REQUEST_STATUS.REFUNDED : RETURN_REQUEST_STATUS.REFUND_INITIATED;
      rr.refundTransactionId = refund._id;
      await rr.save();
      await this.syncOrderStatus(order, rr.status);
      const orderItems = await OrderItem.find({ orderId: rr.orderId, _id: { $in: (await ReturnItem.find({ returnRequestId: rr._id })).map((i) => i.orderItemId) } });
      await this.markItemsReturned({ returnRequestId: rr._id, orderItems });
      return rr;
    }

    rr.status = RETURN_REQUEST_STATUS.QC_FAILED;
    rr.qcCompletedAt = new Date();
    rr.review = { reviewedBy: actorId, reviewedAt: new Date(), note: note || 'QC failed' };
    await rr.save();
    await ReturnItem.updateMany(
      { returnRequestId: rr._id },
      { $set: { qcStatus: RETURN_QC_STATUS.FAILED, qcNote: note || null } }
    );
    await this.syncOrderStatus(order, RETURN_REQUEST_STATUS.QC_FAILED);
    return rr;
  }

  async list({ tenantId, userId = null, query = {}, isAdmin = false }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (!isAdmin) q.userId = userId;
    if (query.status) q.status = query.status;
    if (query.orderId) q.orderId = query.orderId;
    const [docs, total] = await Promise.all([
      ReturnRequest.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ReturnRequest.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async getOwned({ returnRequestId, tenantId }) {
    const rr = await ReturnRequest.findOne({ _id: returnRequestId, tenantId });
    if (!rr) throw notFound('Return request not found', 'RETURN_NOT_FOUND');
    return rr;
  }

  async detail({ returnRequestId, tenantId }) {
    const rr = await this.getOwned({ returnRequestId, tenantId });
    const items = await ReturnItem.find({ returnRequestId: rr._id }).lean();
    return { returnRequest: rr, items: serializeList(items) };
  }

  /** Update returnedQty on order items (prevents over-returning the same line). */
  async markItemsReturned({ returnRequestId, orderItems }) {
    const returnItems = await ReturnItem.find({ returnRequestId });
    for (const ri of returnItems) {
      const oi = orderItems.find((x) => String(x._id) === String(ri.orderItemId));
      if (oi) {
        await OrderItem.updateOne(
          { _id: oi._id },
          { $inc: { returnedQty: ri.qty }, $set: { updatedAt: new Date() } }
        );
      }
    }
  }

  /** Order-level status mirror for the customer timeline (doc §6 sub-machine). */
  async syncOrderStatus(order, returnStatus) {
    if (!order) return;
    const orderStateMap = {
      [RETURN_REQUEST_STATUS.APPROVED]: ORDER_STATUS.RETURN_APPROVED,
      [RETURN_REQUEST_STATUS.PICKED_UP]: ORDER_STATUS.RETURN_PICKED_UP,
      [RETURN_REQUEST_STATUS.QC_PASSED]: ORDER_STATUS.QC_PASSED,
      [RETURN_REQUEST_STATUS.QC_FAILED]: ORDER_STATUS.QC_FAILED,
      [RETURN_REQUEST_STATUS.REFUND_INITIATED]: ORDER_STATUS.REFUND_INITIATED,
      [RETURN_REQUEST_STATUS.REFUNDED]: ORDER_STATUS.REFUNDED,
    };
    const target = orderStateMap[returnStatus];
    if (target) {
      order.status = target;
      await order.save();
    }
  }
}

export default new ReturnsService();
