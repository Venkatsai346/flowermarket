import RefundTransaction from '../models/refundTransaction.model.js';
import Payment from '../models/payment.model.js';
import Order from '../models/order.model.js';
import walletService from './wallet.service.js';
import paymentProvider from './paymentProvider.service.js';
import ledgerPostingService from './ledgerPosting.service.js';
import payoutService from './payout.service.js';
import domainEventService from './domainEvent.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import { generateOpaqueToken } from '../utils/hash.js';
import {
  REFUND_DESTINATION,
  REFUND_TRANSACTION_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  WALLET_TXN_REASON,
  DOMAIN_EVENT_TYPE,
  LEDGER_JOURNAL_KIND,
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

    // A wallet payment never crossed a gateway, so its money can only come
    // back through the wallet. The payment row is the source of truth (the
    // order's `paymentMethod` is only a hint at this point).
    let isWalletPayment = order.paymentMethod === PAYMENT_METHOD.WALLET;
    if (paymentId) {
      const payment = await Payment.findById(paymentId).lean();
      if (payment) {
        isWalletPayment = payment.provider === PAYMENT_PROVIDER.WALLET
          || payment.method === PAYMENT_METHOD.WALLET;
      }
    }

    const dest = isWalletPayment
      ? REFUND_DESTINATION.WALLET
      : destination || (value > GATEWAY_REFUND_THRESHOLD ? REFUND_DESTINATION.ORIGINAL_METHOD : REFUND_DESTINATION.WALLET);

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
      traceId: order.traceId || null,
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

      // ---- Phase 10: record the refund FACT in the audit backbone first ----
      //      (event before journal, so a crash-window is visible + replayable)
      //      Awaits: the journal below must land on the chain AFTER this fact.
      await domainEventService.append({
        tenantId, traceId: txn.traceId, kind: DOMAIN_EVENT_TYPE.REFUND_ISSUED,
        aggregateType: 'refund', aggregateId: txn._id,
        idempotencyKey: `${LEDGER_JOURNAL_KIND.REFUND_ISSUED}:refund:${txn._id}`,
        occurredAt: txn.completedAt,
        refType: 'order', refId: orderId,
        payload: { orderId, orderNumber: order.orderNumber, amountPaise: Math.round(value * 100), destination: dest },
      });

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

  /**
   * Reconcile in-flight GATEWAY refunds. Refunds are async on real gateways
   * (Razorpay processes after the call returns), so a PENDING row with a
   * gatewayRef asks the gateway for the authoritative outcome:
   *   processed → SUCCESS + payment state re-synced (wallet/gateway refunds
   *   above threshold flow back this way even if our process died mid-init)
   *   failed    → FAILED with the gateway's reason
   * Wallet refunds are synchronous and never pending — they are skipped.
   */
  async reconcileRefunds({ olderThanMinutes = 10, limit = 50 }) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const pending = await RefundTransaction.find({
      status: REFUND_TRANSACTION_STATUS.PENDING,
      destination: REFUND_DESTINATION.ORIGINAL_METHOD,
      gatewayRef: { $ne: null },
      initiatedAt: { $lte: cutoff },
    }).sort({ initiatedAt: 1 }).limit(limit);

    const resolved = [];
    for (const txn of pending) {
      let remote = null;
      try {
        remote = await paymentProvider.fetchRefundStatus({ gatewayRef: txn.gatewayRef });
      } catch (e) {
        // transient — try again next sweep
        // eslint-disable-next-line no-console
        console.error(`[refunds] reconcile fetch failed for ${txn._id}:`, e?.message);
        continue;
      }
      if (remote?.state === 'processed') {
        txn.status = REFUND_TRANSACTION_STATUS.SUCCESS;
        txn.completedAt = new Date();
        txn.rawGatewayResponse = { ...(txn.rawGatewayResponse || {}), reconciled: true, source: remote.raw || null };
        await txn.save();

        // ---- Phase 10: record the refund FACT now that the gateway attests
        //      it. Covers the crash window "gateway refund created, process
        //      died before initiate() finished" — the row sat PENDING with a
        //      gatewayRef and never got its event. Idempotent: the same
        //      idempotencyKey as the initiate() path, so a refund that was
        //      already recorded is a no-op. The JOURNAL is deliberately not
        //      posted here — if it is missing, the nightly integrity report
        //      sees the event without its journal and the replay re-derives
        //      it (postRefund, which only runs for SUCCESS refunds).
        // Awaits: without it the reconcile report could claim a resolution
        // whose fact is still in flight (idempotent under the same key).
        await domainEventService.append({
          tenantId: txn.tenantId, traceId: txn.traceId, kind: DOMAIN_EVENT_TYPE.REFUND_ISSUED,
          aggregateType: 'refund', aggregateId: txn._id,
          idempotencyKey: `${LEDGER_JOURNAL_KIND.REFUND_ISSUED}:refund:${txn._id}`,
          occurredAt: txn.completedAt,
          refType: 'order', refId: txn.orderId,
          payload: { orderId: txn.orderId, amountPaise: Math.round(moneySum(txn.amount) * 100), destination: txn.destination, reconciled: true },
        });

        await this.syncPaymentRefundState({ tenantId: txn.tenantId, orderId: txn.orderId, paymentId: txn.paymentId });
        resolved.push({ refundId: txn._id, state: 'success' });
      } else if (remote?.state === 'failed') {
        txn.status = REFUND_TRANSACTION_STATUS.FAILED;
        txn.failureReason = 'Gateway reported refund failed (reconciled)';
        await txn.save();
        resolved.push({ refundId: txn._id, state: 'failed' });
      }
      // pending → leave for the next sweep
    }
    return { scanned: pending.length, resolved };
  }
}

export default new RefundService();
