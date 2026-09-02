import RefundTransaction from '../models/refundTransaction.model.js';
import Payment from '../models/payment.model.js';
import Order from '../models/order.model.js';
import walletService from './wallet.service.js';
import paymentProvider from './paymentProvider.service.js';
import ledgerPostingService from './ledgerPosting.service.js';
import payoutService from './payout.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import { generateOpaqueToken } from '../utils/hash.js';
import {
  REFUND_DESTINATION,
  REFUND_TRANSACTION_STATUS,
  PAYMENT_STATUS,
  WALLET_TXN_REASON,
} from '../constants/enums.js';

/** Refunds above this amount go through the gateway (slower) instead of wallet. */
export const GATEWAY_REFUND_THRESHOLD = 2000;

/**
 * RefundService — the doc's "refund destination logic":
 *  - wallet by default (instant, low-risk, encourages repeat use)
 *  - gateway (ORIGINAL_METHOD) for larger amounts
 *  - idempotent on idempotencyKey (no double refunds)
 */
class RefundService {
  /**
   * @param {object} p
   * @param {string} p.tenantId @param {string} p.userId @param {string} p.orderId
   * @param {number} p.amount
   * @param {string} p.reason       REFUND_REASON
   * @param {string} [p.destination]  wallet | original_method
   * @param {string} [p.paymentId]    optional payment to mark refunded
   * @param {string} [p.returnRequestId]
   * @param {string} [p.initiatedBy]
   * @param {string} [p.idempotencyKey]
   */
  async initiate({ tenantId, userId, orderId, amount, reason, destination = null, paymentId = null, returnRequestId = null, initiatedBy = null, idempotencyKey = null, note = null, components = null }) {
    const value = roundMoney(amount);
    if (value <= 0) throw badRequest('Refund amount must be positive', 'INVALID_AMOUNT');
    const key = idempotencyKey || `refund_${generateOpaqueToken(12)}`;

    // ---- idempotency: same key already processed? ----
    const existing = await RefundTransaction.findOne({ idempotencyKey: key });
    if (existing) return existing;

    const order = await Order.findById(orderId);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');

    const dest = destination || (value > GATEWAY_REFUND_THRESHOLD ? REFUND_DESTINATION.ORIGINAL_METHOD : REFUND_DESTINATION.WALLET);

    // Phase 3.5: persist the component breakdown (finance/credit-note ready).
    // amount === refundItemAmount + refundTaxAmount + refundFeeAmount.
    const comps = {
      refundItemAmount: components?.refundItemAmount != null ? roundMoney(components.refundItemAmount) : value,
      refundTaxAmount: components?.refundTaxAmount != null ? roundMoney(components.refundTaxAmount) : 0,
      refundFeeAmount: components?.refundFeeAmount != null ? roundMoney(components.refundFeeAmount) : 0,
    };

    const txn = await RefundTransaction.create({
      tenantId, orderId, userId, paymentId, returnRequestId,
      amount: value, currency: order.currency || 'INR',
      reason, destination: dest, status: REFUND_TRANSACTION_STATUS.PENDING,
      idempotencyKey: key, initiatedBy,
      ...comps,
    });

    try {
      if (dest === REFUND_DESTINATION.WALLET) {
        const { txn: walletTxn } = await walletService.credit({
          tenantId, userId, amount: value,
          reason: WALLET_TXN_REASON.REFUND, refType: 'refund', refId: txn._id,
          note: note || `Refund for order ${order.orderNumber}`,
        });
        txn.walletTxnId = walletTxn._id;
        txn.status = REFUND_TRANSACTION_STATUS.SUCCESS;
        txn.completedAt = new Date();
        txn.gatewayRef = `wallet_${walletTxn._id}`;
      } else {
        const payment = paymentId ? await Payment.findById(paymentId) : null;
        const gatewayResult = await paymentProvider.refund({
          idempotencyKey: key,
          amount: value,
          gatewayPaymentId: payment?.gatewayPaymentId || null,
        });
        if (!gatewayResult.success) throw new Error(gatewayResult.error || 'Gateway refund failed');
        txn.gatewayRef = gatewayResult.gatewayRef || null;
        txn.rawGatewayResponse = gatewayResult.raw || null;
        txn.status = REFUND_TRANSACTION_STATUS.SUCCESS;
        txn.completedAt = new Date();
      }

      await txn.save();
      await this.syncPaymentRefundState({ tenantId, orderId, paymentId });

      // ---- Phase 6.1: reverse a proportional slice of the sale journal ----
      //      We reverse what the sale actually credited (vendor payable,
      //      commission, GST) rather than recomputing it, so a refund can never
      //      touch an account the order didn't, nor exceed what was captured.
      //      Orders predating the ledger have no sale journal — that is not an
      //      error, the backfill sweep posts them and the reversal follows.
      await ledgerPostingService.safePost('refund_issued', () =>
        ledgerPostingService.postRefund({ refundTransaction: txn })
      );

      // ---- Phase 6.3: the vendor no longer earned this ----
      //      Unpaid lines are simply cancelled; already-paid ones produce a
      //      NEGATIVE line that offsets the vendor's next cycle (and may push
      //      it negative, which the carry-forward rule then handles).
      await ledgerPostingService.safePost('payout_reversal', () =>
        payoutService.reverseForRefund({ refundTransaction: txn })
      );

      return txn;
    } catch (err) {
      txn.status = REFUND_TRANSACTION_STATUS.FAILED;
      txn.failureReason = err?.message || String(err);
      await txn.save();
      throw conflict(`Refund failed: ${txn.failureReason}`, 'REFUND_FAILED');
    }
  }

  /** Keep the Payment + Order paymentSummary in sync with completed refunds. */
  async syncPaymentRefundState({ tenantId, orderId, paymentId }) {
    const [order, payment] = await Promise.all([
      Order.findById(orderId),
      paymentId ? Payment.findById(paymentId) : null,
    ]);
    if (!order) return;

    const refunds = await RefundTransaction.find({
      orderId,
      status: REFUND_TRANSACTION_STATUS.SUCCESS,
    }).lean();
    const refunded = moneySum(...refunds.map((r) => r.amount));

    if (payment) {
      payment.refundedAmount = refunded;
      payment.status = refunded >= payment.amount
        ? PAYMENT_STATUS.REFUNDED
        : (refunded > 0 ? PAYMENT_STATUS.PARTIALLY_REFUNDED : payment.status);
      await payment.save();
    }
    order.paymentSummary.refundedAmount = refunded;
    order.paymentSummary.status = order.paymentSummary.status === 'refunded' ? 'refunded' : (refunded > 0 ? 'partially_refunded' : order.paymentSummary.status);
    if (refunded >= order.totalAmount) order.paymentSummary.status = 'refunded';
    await order.save();
  }

  async list({ tenantId, query = {}, isAdmin = false, userId = null }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (!isAdmin) q.userId = userId;
    if (query.status) q.status = query.status;
    if (query.orderId) q.orderId = query.orderId;
    const [docs, total] = await Promise.all([
      RefundTransaction.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      RefundTransaction.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async getById({ refundId, tenantId, isAdmin = false, userId = null }) {
    const q = { _id: refundId, tenantId };
    if (!isAdmin) q.userId = userId;
    const txn = await RefundTransaction.findOne(q);
    if (!txn) throw notFound('Refund transaction not found', 'REFUND_NOT_FOUND');
    return txn;
  }
}

export default new RefundService();
