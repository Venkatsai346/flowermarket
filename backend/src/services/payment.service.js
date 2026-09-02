import Payment from '../models/payment.model.js';
import PaymentTransaction from '../models/paymentTransaction.model.js';
import paymentProvider from './paymentProvider.service.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import { generateOpaqueToken } from '../utils/hash.js';
import {
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_TYPE,
  PAYMENT_TRANSACTION_STATUS,
} from '../constants/enums.js';

/**
 * PaymentService — charges, refunds, idempotency & reconciliation.
 *
 * IDEMPOTENCY (the doc's "everywhere money moves" rule):
 *  - charge(): if a Payment with the same idempotencyKey exists, return it
 *    (dedupe) instead of charging again.
 *  - PaymentTransaction rows are also keyed by idempotencyKey (unique index).
 */
class PaymentService {
  /**
   * Charge an order. Creates Payment + CHARGE transaction, calls the provider,
   * marks success/failure. Idempotent on idempotencyKey.
   * @returns {{ payment, transaction, chargeResult }}
   */
  async charge({ tenantId, userId, orderId, amount, method = 'upi', idempotencyKey, provider = 'mock' }) {
    const value = roundMoney(amount);

    // ---- idempotency: same key already charged? ----
    const existing = await Payment.findOne({ idempotencyKey });
    if (existing) {
      return { payment: existing, transaction: null, chargeResult: { success: existing.status === PAYMENT_STATUS.SUCCESS, idempotent: true } };
    }

    const payment = await Payment.create({
      tenantId, userId, orderId, amount: value, method, provider,
      idempotencyKey, status: PAYMENT_STATUS.PENDING,
    });
    const txn = await PaymentTransaction.create({
      paymentId: payment._id, orderId, tenantId,
      type: PAYMENT_TRANSACTION_TYPE.CHARGE,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      amount: value, idempotencyKey: `${idempotencyKey}:charge`,
    });

    const chargeResult = await paymentProvider.charge({
      idempotencyKey, amount: value, method, paymentId: payment._id, orderRef: orderId,
    });

    // ---- async gateway (razorpay): payment stays PENDING until the webhook
    //      confirms. The saga leaves the order in PAYMENT_PENDING. ----
    if (chargeResult.pending) {
      payment.status = PAYMENT_STATUS.PENDING;
      payment.gatewayOrderId = chargeResult.gatewayOrderId || null;
      payment.provider = chargeResult.provider || payment.provider;
      await payment.save();
      await txn.save();
      return { payment, transaction: txn, chargeResult };
    }

    if (chargeResult.success) {
      payment.status = PAYMENT_STATUS.SUCCESS;
      payment.gatewayOrderId = chargeResult.gatewayOrderId || null;
      payment.gatewayPaymentId = chargeResult.gatewayPaymentId || null;
      payment.paidAt = new Date();
      txn.status = PAYMENT_TRANSACTION_STATUS.SUCCESS;
      txn.gatewayRef = chargeResult.gatewayPaymentId || chargeResult.gatewayOrderId || null;
      txn.rawGatewayResponse = chargeResult.raw || null;
      txn.completedAt = new Date();
    } else {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failedAt = new Date();
      payment.failureReason = 'Payment declined by gateway';
      txn.status = PAYMENT_TRANSACTION_STATUS.FAILED;
      txn.failureReason = 'Payment declined by gateway';
      txn.rawGatewayResponse = chargeResult.raw || null;
      txn.completedAt = new Date();
    }
    await payment.save();
    await txn.save();

    return { payment, transaction: txn, chargeResult };
  }

  /** Confirm a payment from an async provider webhook/callback. */
  async confirmSuccess({ paymentId, gatewayPaymentId = null, raw = null }) {
    const payment = await Payment.findById(paymentId);
    if (!payment) throw notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    if (payment.status === PAYMENT_STATUS.SUCCESS) return payment; // idempotent
    payment.status = PAYMENT_STATUS.SUCCESS;
    payment.gatewayPaymentId = gatewayPaymentId || payment.gatewayPaymentId;
    payment.paidAt = new Date();
    await payment.save();
    await PaymentTransaction.updateMany(
      { paymentId: payment._id, type: PAYMENT_TRANSACTION_TYPE.CHARGE },
      { $set: { status: PAYMENT_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(), rawGatewayResponse: raw || undefined } }
    );
    return payment;
  }

  /** Mark a payment failed (webhook / reconcile path). */
  async markFailed({ paymentId, reason = 'Payment failed', gatewayPaymentId = null }) {
    const payment = await Payment.findById(paymentId);
    if (!payment) throw notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    if (payment.status !== PAYMENT_STATUS.PENDING) return payment; // only pending can fail
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failedAt = new Date();
    payment.failureReason = reason;
    if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
    await payment.save();
    await PaymentTransaction.updateMany(
      { paymentId: payment._id, status: PAYMENT_TRANSACTION_STATUS.PENDING },
      { $set: { status: PAYMENT_TRANSACTION_STATUS.FAILED, failureReason: reason, completedAt: new Date() } }
    );
    return payment;
  }

  /** Find the payment for a gateway order id (webhook lookup). */
  async findByGatewayOrderId({ gatewayOrderId, tenantId = null }) {
    const q = { gatewayOrderId };
    if (tenantId) q.tenantId = tenantId;
    const payment = await Payment.findOne(q);
    if (!payment) throw notFound('Payment not found for gateway order', 'PAYMENT_NOT_FOUND');
    return payment;
  }

  /** Find the payment for a gateway payment id (webhook lookup). */
  async findByGatewayPaymentId({ gatewayPaymentId, tenantId = null }) {
    const q = { gatewayPaymentId };
    if (tenantId) q.tenantId = tenantId;
    const payment = await Payment.findOne(q);
    if (!payment) throw notFound('Payment not found for gateway payment', 'PAYMENT_NOT_FOUND');
    return payment;
  }

  /**
   * Reconciliation sweep: payments stuck PENDING past `olderThanMinutes` are
   * treated as failed (and the orchestrator compensates the order). Returns
   * the list of payments that transitioned to FAILED.
   */
  async reconcilePending({ olderThanMinutes = 15, limit = 50 }) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const stale = await Payment.find({ status: PAYMENT_STATUS.PENDING, createdAt: { $lte: cutoff } })
      .sort({ createdAt: 1 }).limit(limit);

    const failed = [];
    for (const payment of stale) {
      // in production: poll the gateway for the authoritative state here
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failedAt = new Date();
      payment.failureReason = 'Reconciled: no gateway confirmation within threshold';
      await payment.save();
      await PaymentTransaction.updateMany(
        { paymentId: payment._id, status: PAYMENT_TRANSACTION_STATUS.PENDING },
        { $set: { status: PAYMENT_TRANSACTION_STATUS.FAILED, failureReason: payment.failureReason, completedAt: new Date() } }
      );
      failed.push(payment);
    }
    return { scanned: stale.length, failed };
  }

  async getPayment({ paymentId }) {
    const payment = await Payment.findById(paymentId);
    if (!payment) throw notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    const transactions = await PaymentTransaction.find({ paymentId: payment._id }).sort({ createdAt: 1 }).lean();
    return { payment, transactions };
  }

  async listPayments({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (query.status) q.status = query.status;
    if (query.orderId) q.orderId = query.orderId;
    const [docs, total] = await Promise.all([
      Payment.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Payment.countDocuments(q),
    ]);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  newIdempotencyKey(prefix = 'pay') {
    return `${prefix}_${generateOpaqueToken(12)}`;
  }
}

export default new PaymentService();
