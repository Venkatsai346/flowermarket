import Payment from '../models/payment.model.js';
import PaymentTransaction from '../models/paymentTransaction.model.js';
import WalletTransaction from '../models/walletTransaction.model.js';
import PaymentWebhookEvent, { PAYMENT_WEBHOOK_EVENT_STATUS } from '../models/paymentWebhookEvent.model.js';
import { webhookEvents } from '../observability/registry.js';
import paymentProvider from './paymentProvider.service.js';
import walletService from './wallet.service.js';
import domainEventService from './domainEvent.service.js';
import { Types } from 'mongoose';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import { generateOpaqueToken } from '../utils/hash.js';
import {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_TRANSACTION_TYPE,
  PAYMENT_TRANSACTION_STATUS,
  WALLET_TXN_REASON,
  ORDER_CANCELLATION_REASON,
  DOMAIN_EVENT_TYPE,
} from '../constants/enums.js';

/**
 * PaymentService — charges, refunds, idempotency & reconciliation.
 *
 * IDEMPOTENCY (the doc's "everywhere money moves" rule):
 *  - charge(): if a Payment with the same idempotencyKey exists, return it
 *    (dedupe) instead of charging again.
 *  - PaymentTransaction rows are also keyed by idempotencyKey (unique index).
 *
 * WALLET PAYMENTS (the internal money movement):
 *  - `method === 'wallet'` moves money from the customer's wallet liability,
 *    so the Payment's `provider` is `wallet` and no external gateway is called.
 *  - The debit is keyed to the Payment (`refType: 'order_payment'`,
 *    `refId: payment._id`) so a retry after an ambiguous crash can *heal* the
 *    existing Payment instead of debiting twice: if the wallet transaction
 *    already exists we finalise success; if not we safely attempt the debit on
 *    the existing Payment (never creating a second Payment for the same key).
 */
class PaymentService {
  /**
   * Charge an order. Creates Payment + CHARGE transaction, calls the provider,
   * marks success/failure. Idempotent on idempotencyKey.
   * @returns {{ payment, transaction, chargeResult }}
   */
  async charge({ tenantId, userId, orderId, amount, method = 'upi', idempotencyKey, provider = 'mock', traceId = null }) {
    const value = roundMoney(amount);
    const isWallet = method === PAYMENT_METHOD.WALLET;

    // ---- idempotency: same key already charged? ----
    const existing = await Payment.findOne({ idempotencyKey });
    if (existing) {
      if (existing.status === PAYMENT_STATUS.SUCCESS) {
        return { payment: existing, transaction: null, chargeResult: { success: true, idempotent: true } };
      }
      // A wallet payment may be half-finished (created, debit crash). Heal it
      // rather than blindly returning failure and risking a second debit.
      if (isWallet || existing.provider === PAYMENT_PROVIDER.WALLET || existing.method === PAYMENT_METHOD.WALLET) {
        return this._walletChargeExisting(existing, { tenantId, userId, value });
      }
      return { payment: existing, transaction: null, chargeResult: { success: false, idempotent: true } };
    }

    let payment;
    try {
      payment = await Payment.create({
        tenantId, userId, orderId, amount: value, method,
        provider: isWallet ? PAYMENT_PROVIDER.WALLET : provider,
        idempotencyKey, status: PAYMENT_STATUS.PENDING, traceId,
      });
    } catch (err) {
      // Unique idempotencyKey race: two identical requests arrived together.
      // The other request created the Payment, so treat this as an idempotent
      // replay (for wallet: heal/retry on the existing row, never debit twice).
      if (err?.code === 11000) {
        const winner = await Payment.findOne({ idempotencyKey });
        if (!winner) throw err;
        if (winner.status === PAYMENT_STATUS.SUCCESS) {
          return { payment: winner, transaction: null, chargeResult: { success: true, idempotent: true } };
        }
        if (isWallet || winner.provider === PAYMENT_PROVIDER.WALLET || winner.method === PAYMENT_METHOD.WALLET) {
          return this._walletChargeExisting(winner, { tenantId, userId, value });
        }
        return { payment: winner, transaction: null, chargeResult: { success: false, idempotent: true } };
      }
      throw err;
    }
    const txn = await PaymentTransaction.create({
      paymentId: payment._id, orderId, tenantId,
      type: PAYMENT_TRANSACTION_TYPE.CHARGE,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      amount: value, idempotencyKey: `${idempotencyKey}:charge`,
    });

    // ---- internal wallet payment: no provider call, no async state. ----
    if (isWallet) {
      return this._walletCharge({ tenantId, userId, orderId, value, payment, transaction: txn });
    }

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

  /** Atomically claim the wallet debit for this Payment. Returns the token or null if another caller already owns it. */
  async _claimWalletCharge(paymentId) {
    // A claim can only be orphaned by a crashed producer; it has no wallet
    // transaction to show for itself, so after a short grace period it is safe
    // (and necessary) to take it over.
    const staleBefore = new Date(Date.now() - 5000);
    await Payment.updateOne(
      { _id: paymentId, walletClaimToken: { $ne: null }, walletClaimedAt: { $lt: staleBefore } },
      { $set: { walletClaimToken: null, walletClaimedAt: null } },
    ).catch(() => {});

    const token = generateOpaqueToken(12);
    const claimed = await Payment.updateOne(
      { _id: paymentId, status: PAYMENT_STATUS.PENDING, walletClaimToken: null },
      { $set: { walletClaimToken: token, walletClaimedAt: new Date() } },
    );
    return claimed.modifiedCount === 1 ? token : null;
  }

  /** Release the claim token (best effort — a stale token is ignored by future attempts). */
  async _clearWalletChargeClaim(paymentId, token) {
    return Payment.updateOne(
      { _id: paymentId, walletClaimToken: token },
      { $set: { walletClaimToken: null, walletClaimedAt: null } },
    ).catch(() => {});
  }

  /** Wait for a concurrent wallet producer to finish, so no other thread de-bits twice. */
  async _waitForWalletChargeClaim({ paymentId, token, timeoutMs = 2000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const walletTxn = await WalletTransaction.findOne({ refType: 'order_payment', refId: paymentId });
      if (walletTxn) return { walletTxn };
      const latest = await Payment.findById(paymentId).lean();
      if (!latest || latest.walletClaimToken !== token || latest.status !== PAYMENT_STATUS.PENDING) {
        return { walletTxn: null };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { walletTxn: null };
  }

  /** Finalise a successful wallet debit. Best-effort DB writes: the WalletTransaction already exists. */
  async _finaliseWalletSuccess({ payment, transaction, walletTxn, orderId }) {
    const walletRef = walletTxn.id ? String(walletTxn.id) : String(walletTxn._id);
    payment.status = PAYMENT_STATUS.SUCCESS;
    payment.provider = PAYMENT_PROVIDER.WALLET;
    payment.paidAt = new Date();
    payment.gatewayPaymentId = walletRef;
    try { await payment.save(); } catch { /* heal on retry; money already moved */ }

    if (transaction) {
      transaction.status = PAYMENT_TRANSACTION_STATUS.SUCCESS;
      transaction.gatewayRef = walletRef;
      transaction.rawGatewayResponse = {
        walletTransactionId: walletRef,
        balanceAfter: walletTxn.balanceAfter ?? null,
        method: PAYMENT_METHOD.WALLET,
      };
      transaction.completedAt = new Date();
      try { await transaction.save(); } catch { /* heal on retry */ }
    }

    return {
      payment, transaction,
      chargeResult: { success: true, provider: PAYMENT_PROVIDER.WALLET, walletTxnId: walletRef, amount: payment.amount },
    };
  }

  /**
   * Internal wallet charge. Debits the customer's wallet (versioned, so
   * concurrent spends never lost-update), then marks the Payment + CHARGE txn
   * successful. A failure is returned, never thrown, so the order saga can run
   * its normal compensation (release slot → cancel) for an unchanged refusal.
   *
   * Money safety: the Payment's `walletClaimToken` is an optimistic lock that
   * makes exactly one concurrent caller debit for a given Payment. If another
   * thread already owns the claim, this path defers to `_walletChargeExisting`
   * and never races the debit.
   */
  async _walletCharge({ tenantId, userId, orderId, value, payment, transaction }) {
    const token = await this._claimWalletCharge(payment._id);
    if (!token) {
      // Another request is already inside the debit path for this Payment.
      return this._walletChargeExisting(payment, { tenantId, userId, value });
    }

    let walletTxn = null;
    let debitError = null;
    try {
      const result = await walletService.debit({
        tenantId, userId, amount: value,
        reason: WALLET_TXN_REASON.ORDER_PAYMENT,
        refType: 'order_payment',
        refId: payment._id,
        note: `Order ${orderId}`,
      });
      walletTxn = result.txn;
    } catch (err) {
      debitError = err;
    }

    // Whatever happened, release the claim. If the debit succeeded the
    // WalletTransaction row already exists, so a concurrent retry heals from it
    // instead of attempting a second debit.
    await this._clearWalletChargeClaim(payment._id, token);

    if (debitError) {
      const message = debitError?.message || 'Wallet payment failed';
      const code = debitError?.code || 'WALLET_PAYMENT_FAILED';
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failedAt = new Date();
      payment.failureReason = message;
      payment.provider = PAYMENT_PROVIDER.WALLET;
      try { await payment.save(); } catch { /* failure is already in memory */ }

      if (transaction) {
        transaction.status = PAYMENT_TRANSACTION_STATUS.FAILED;
        transaction.failureReason = message;
        transaction.completedAt = new Date();
        try { await transaction.save(); } catch { /* failure is already in memory */ }
      }

      return {
        payment, transaction,
        chargeResult: { success: false, provider: PAYMENT_PROVIDER.WALLET, error: message, code, amount: value },
      };
    }

    return this._finaliseWalletSuccess({ payment, transaction, walletTxn, orderId });
  }

  /**
   * Recover an existing (PENDING or failed-by-half-finish) wallet Payment on
   * an idempotent retry.
   *
   * The expensive safety property: do NOT debit twice. If a wallet transaction
   * already exists for this Payment, the earlier attempt finished the debit and
   * we just complete the bookkeeping (finalise both Payment + CHARGE txn). If a
   * concurrent producer has the claim token, we wait for it to resolve first.
   * Only when no debit exists and no live claim is held do we safely retry the
   * debit against the same Payment.
   */
  async _walletChargeExisting(existing, { tenantId, userId, value }) {
    const idempotencyKey = existing.idempotencyKey;
    let transaction = await PaymentTransaction.findOne({
      paymentId: existing._id, type: PAYMENT_TRANSACTION_TYPE.CHARGE,
    });

    let walletTxn = await WalletTransaction.findOne({
      refType: 'order_payment', refId: existing._id,
    });

    // Always re-read the claim state from the DB: the in-memory `existing`
    // object may be stale if another request claimed between our read and now.
    const currentPayment = await Payment.findById(existing._id).lean();
    const claimToken = currentPayment?.walletClaimToken || null;
    const claimedAt = currentPayment?.walletClaimedAt ? new Date(currentPayment.walletClaimedAt).getTime() : 0;

    // If another request is actively producing the debit, wait for it to land —
    // it is cheaper and safer than racing a versioned wallet mutation.
    if (!walletTxn && claimToken && (Date.now() - claimedAt) < 5000) {
      const resolved = await this._waitForWalletChargeClaim({
        paymentId: existing._id, token: claimToken,
      });
      walletTxn = resolved.walletTxn || await WalletTransaction.findOne({
        refType: 'order_payment', refId: existing._id,
      });
    }

    if (walletTxn) {
      // The debit already happened — finish the bookkeeping, never debit again.
      existing.status = PAYMENT_STATUS.SUCCESS;
      existing.provider = PAYMENT_PROVIDER.WALLET;
      existing.paidAt = existing.paidAt || new Date();
      existing.gatewayPaymentId = existing.gatewayPaymentId || String(walletTxn._id);
      await existing.save();

      if (transaction) {
        transaction.status = PAYMENT_TRANSACTION_STATUS.SUCCESS;
        transaction.gatewayRef = transaction.gatewayRef || String(walletTxn._id);
        transaction.rawGatewayResponse = transaction.rawGatewayResponse || { walletTransactionId: String(walletTxn._id) };
        transaction.completedAt = transaction.completedAt || new Date();
        await transaction.save();
      }

      return {
        payment: existing, transaction,
        chargeResult: { success: true, provider: PAYMENT_PROVIDER.WALLET, walletTxnId: String(walletTxn._id), idempotent: true },
      };
    }

    // No debit happened yet. Attach a CHARGE txn if the first attempt did not
    // get to it, then run the (idempotent-by-ref) wallet debit path.
    if (!transaction) {
      try {
        transaction = await PaymentTransaction.create({
          paymentId: existing._id, orderId: existing.orderId, tenantId: existing.tenantId,
          type: PAYMENT_TRANSACTION_TYPE.CHARGE,
          status: PAYMENT_TRANSACTION_STATUS.PENDING,
          amount: value, idempotencyKey: `${idempotencyKey}:charge`,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        transaction = await PaymentTransaction.findOne({
          paymentId: existing._id, type: PAYMENT_TRANSACTION_TYPE.CHARGE,
        });
      }
    }

    return this._walletCharge({ tenantId, userId, orderId: existing.orderId, value, payment: existing, transaction });
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
    // audit backbone: the payment fact (no journal of its own — the sale
    // journal is the order's; this records the gateway's confirmation)
    domainEventService.append({
      tenantId: payment.tenantId, traceId: payment.traceId,
      kind: DOMAIN_EVENT_TYPE.PAYMENT_CONFIRMED,
      aggregateType: 'payment', aggregateId: payment._id,
      idempotencyKey: `payment_confirmed:${payment._id}`,
      occurredAt: payment.paidAt,
      refType: 'order', refId: payment.orderId,
      payload: { orderId: payment.orderId, amountPaise: Math.round(payment.amount * 100), provider: payment.provider, gatewayPaymentId: payment.gatewayPaymentId },
    });
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
    domainEventService.append({
      tenantId: payment.tenantId, traceId: payment.traceId,
      kind: DOMAIN_EVENT_TYPE.PAYMENT_FAILED,
      aggregateType: 'payment', aggregateId: payment._id,
      idempotencyKey: `payment_failed:${payment._id}`,
      occurredAt: payment.failedAt,
      refType: 'order', refId: payment.orderId,
      payload: { orderId: payment.orderId, reason, provider: payment.provider },
    });
    return payment;
  }

  /**
   * Apply a signature-verified gateway webhook event to the payment state
   * machine. This is the ONLY path from "gateway said something" to "our
   * money state changed" — both the Razorpay and mock webhooks funnel here.
   *
   * Guarantees:
   *  - EVENT-LEVEL IDEMPOTENCY: unique (provider, eventId) upsert; replays
   *    are recorded as `duplicate` and never re-enter the state machine
   *    (gateways retry deliveries — sometimes for days).
   *  - AMOUNT VERIFICATION: a captured event whose amount (paise) doesn't
   *    match the recorded Payment is NEVER confirmed — recorded as
   *    `mismatch` for operator review, and the ack still returns 200 so the
   *    gateway doesn't storm retries on a money-discrepancy it can't fix.
   *  - UNKNOWN PAYMENTS: ack'd as `ignored` (could be another tenant, a
   *    pre-commit arrival, or a stale event) — never 4xx a webhook.
   *  - AT-LEAST-ONCE RECOVERY: what the webhook misses, reconciliation
   *    fetches from the gateway (see reconcilePending).
   *
   * @returns {{status:'processed'|'duplicate'|'mismatch'|'ignored', payment?:object, order?:object}}
   */
  async applyWebhookEvent({
    provider,
    eventId,
    eventType,
    gatewayPaymentId = null,
    gatewayOrderId = null,
    amountPaise = null,
    currency = null,
    raw = null,
  }) {
    const finish = async (status, note = null, extra = null) => {
      try {
        if (firstArrival) {
          // First-writer-wins: only the FIRST delivery writes the terminal
          // disposition. A replay must never overwrite 'processed' with
          // 'duplicate' — that would hide the original outcome from the
          // operator. (Guarded on RECEIVED so even a race can't clobber it.)
          await PaymentWebhookEvent.updateOne(
            { provider, eventId, status: PAYMENT_WEBHOOK_EVENT_STATUS.RECEIVED },
            { $set: { status, note: note || null, processedAt: new Date(), lastSeenAt: new Date(), ...(extra || {}) } },
          );
        } else {
          // Replay: bookkeep the retry (count + last seen) WITHOUT altering
          // the audit verdict the first delivery already wrote.
          await PaymentWebhookEvent.updateOne(
            { provider, eventId },
            { $inc: { deliveries: 1 }, $set: { lastSeenAt: new Date() } },
          );
        }
      } catch { /* audit write must not break the webhook ack */ }
      webhookEvents.inc({ provider, result: status });
      return { status, ...(extra || {}) };
    };

    // ---- 1. event-level dedupe (the unique index makes the first win) ----
    let firstArrival = true;
    try {
      const up = await PaymentWebhookEvent.findOneAndUpdate(
        { provider, eventId },
        {
          $setOnInsert: {
            eventType, tenantId: null, paymentId: null, orderId: null,
            gatewayPaymentId, gatewayOrderId, amountPaise, currency,
            status: PAYMENT_WEBHOOK_EVENT_STATUS.RECEIVED, raw,
          },
        },
        { upsert: true, new: true },
      );
      if (!up || !up._id || up.status !== PAYMENT_WEBHOOK_EVENT_STATUS.RECEIVED) firstArrival = false;
    } catch (err) {
      if (err?.code === 11000) firstArrival = false; // concurrent duplicate
      else throw err;
    }
    if (!firstArrival) return finish('duplicate', 'replayed delivery — state machine not re-entered');

    // ---- 2. resolve our Payment (gatewayPaymentId first, then order ref) ----
    let payment = gatewayPaymentId
      ? await Payment.findOne({ gatewayPaymentId }).lean()
      : null;
    if (!payment && gatewayOrderId) payment = await Payment.findOne({ gatewayOrderId }).lean();
    if (!payment) return finish('ignored', 'no payment matches the gateway refs');

    const isCapture = ['payment.captured', 'payment.authorized', 'order.paid'].includes(eventType);
    const isFailure = eventType === 'payment.failed';
    if (!isCapture && !isFailure) return finish('ignored', `event type ${eventType} is not actionable`);

    // ---- 3. AMOUNT VERIFICATION (captures only — never confirm on trust) ----
    if (isCapture && amountPaise != null && Math.round(payment.amount * 100) !== Number(amountPaise)) {
      return finish(
        'mismatch',
        `gateway amount ${amountPaise}p ≠ recorded ${Math.round(payment.amount * 100)}p — payment left untouched for review`,
        { paymentId: payment._id, orderId: payment.orderId, traceId: payment.traceId || null },
      );
    }
    if (isCapture && currency && payment.currency && currency.toUpperCase() !== (payment.currency || 'INR').toUpperCase()) {
      return finish('mismatch', `gateway currency ${currency} ≠ recorded ${payment.currency}`, { paymentId: payment._id, orderId: payment.orderId, traceId: payment.traceId || null });
    }

    // ---- 4. state transition (each step is itself idempotent) ----
    const { default: orderService } = await import('./order.service.js');
    let order = null;
    if (isCapture) {
      await this.confirmSuccess({
        paymentId: payment._id,
        gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId,
        raw: raw || null,
      });
      // record the gateway-side capture so reconciliation can verify later
      if (provider === 'mock' && gatewayOrderId) {
        paymentProvider.mockGatewaySet(gatewayOrderId, { captured: true, gatewayPaymentId: gatewayPaymentId || null, amountPaise });
      }
      order = await orderService.confirmPayment({ paymentId: payment._id }).catch(() => null);
    } else {
      await this.markFailed({
        paymentId: payment._id,
        reason: (raw?.payload?.payment?.entity?.error_description) || 'Payment failed at gateway',
        gatewayPaymentId: gatewayPaymentId || null,
      });
      await orderService.cancelOrder({
        tenantId: payment.tenantId, orderId: payment.orderId,
        reason: ORDER_CANCELLATION_REASON.PAYMENT_FAILED,
        actorType: 'system', refund: false,
      }).catch(() => {}); // already cancelled / not cancel-able — settled
    }

    // the audit row adopts the PAYMENT's traceId, so the gateway's capture
    // lands on the same end-to-end chain as the original checkout request
    return finish(
      'processed',
      null,
      { paymentId: payment._id, orderId: payment.orderId, order: order || null, traceId: payment.traceId || null },
    );
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
    const cancelled = [];
    for (const payment of stale) {
      // A PENDING wallet Payment never waits on a gateway. It can only be a
      // half-finished synchronous debit (crash after the amount moved or
      // before it moved). Re-run the idempotent-by-ref debit path first: if a
      // WalletTransaction exists it heals the Payment to SUCCESS; otherwise it
      // safely attempts the debit (never twice). Only if that also fails do we
      // reconcile the Payment to FAILED.
      if (payment.provider === PAYMENT_PROVIDER.WALLET || payment.method === PAYMENT_METHOD.WALLET) {
        const healed = await this._walletChargeExisting(payment, {
          tenantId: payment.tenantId, userId: payment.userId, value: payment.amount,
        });
        if (healed.chargeResult?.success) continue;
        if (payment.status === PAYMENT_STATUS.FAILED) failed.push(payment);
      } else {
        // ASK THE GATEWAY FIRST — the webhook can be lost (network, downtime,
        // retry exhaustion) while the money actually moved. The gateway is the
        // source of truth; only when it confirms "nothing captured" do we fail.
        let remote = null;
        try {
          remote = await paymentProvider.fetchPaymentStatus({
            gatewayOrderId: payment.gatewayOrderId,
            gatewayPaymentId: payment.gatewayPaymentId,
            provider: payment.provider,
          });
        } catch (e) {
          // transient gateway error — leave the payment pending for the next sweep
          // eslint-disable-next-line no-console
          console.error(`[payments] reconcile fetch failed for ${payment._id}:`, e?.message);
          continue;
        }

        if (remote?.state === 'captured') {
          // webhook was lost — recover from the gateway's system of record
          await this.confirmSuccess({
            paymentId: payment._id,
            gatewayPaymentId: remote.gatewayPaymentId || payment.gatewayPaymentId,
            raw: { reconciled: true, source: 'gateway-poll', ...(remote.raw || {}) },
          });
          if (payment.provider === 'mock' && payment.gatewayOrderId) {
            paymentProvider.mockGatewaySet(payment.gatewayOrderId, {
              captured: true,
              gatewayPaymentId: remote.gatewayPaymentId || null,
            });
          }
          const { default: orderService } = await import('./order.service.js');
          await orderService.confirmPayment({ paymentId: payment._id }).catch(() => {});
          continue; // recovered — not a failure
        }

        payment.status = PAYMENT_STATUS.FAILED;
        payment.failedAt = new Date();
        payment.failureReason = remote
          ? `Reconciled: gateway reports ${remote.state}, no capture within threshold`
          : 'Reconciled: no gateway confirmation within threshold';
        await payment.save();
        await PaymentTransaction.updateMany(
          { paymentId: payment._id, status: PAYMENT_TRANSACTION_STATUS.PENDING },
          { $set: { status: PAYMENT_TRANSACTION_STATUS.FAILED, failureReason: payment.failureReason, completedAt: new Date() } }
        );
        failed.push(payment);
      }

      // Close the saga loop: a pending order whose payment could not be
      // recovered must not sit in PAYMENT_PENDING forever. Cancellation is
      // idempotent/guarded, so an already-CANCELLED order is skipped quietly.
      if (payment.status !== PAYMENT_STATUS.FAILED) continue;
      try {
        const { default: orderService } = await import('./order.service.js');
        await orderService.cancelOrder({
          tenantId: payment.tenantId, orderId: payment.orderId,
          reason: ORDER_CANCELLATION_REASON.PAYMENT_FAILED,
          actorType: 'system', refund: false,
        });
        cancelled.push(payment._id);
      } catch { /* already cancelled / not cancellable — state is already settled */ }
    }
    return { scanned: stale.length, failed, cancelled };
  }

  async getPayment({ paymentId }) {
    const payment = await Payment.findById(paymentId);
    if (!payment) throw notFound('Payment not found', 'PAYMENT_NOT_FOUND');
    const [transactions, events] = await Promise.all([
      PaymentTransaction.find({ paymentId: payment._id }).sort({ createdAt: 1 }).lean(),
      // the webhook audit trail for THIS payment (what the gateway told us)
      PaymentWebhookEvent.find({ paymentId: payment._id }).sort({ createdAt: 1 }).lean(),
    ]);
    return { payment, transactions, events };
  }

  /**
   * Webhook event audit trail (ops). The PaymentWebhookEvent rows are the
   * "who moved the money and why" log — every verified gateway event with
   * its disposition (processed/duplicate/mismatch/ignored), delivery count
   * and the raw payload. `mismatch` rows are the ones an operator pages on.
   */
  async listWebhookEvents({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = tenantId ? { tenantId } : {};
    if (query.status) q.status = query.status;
    if (query.provider) q.provider = query.provider;
    if (query.paymentId && Types.ObjectId.isValid(query.paymentId)) q.paymentId = new Types.ObjectId(query.paymentId);
    if (query.orderId && Types.ObjectId.isValid(query.orderId)) q.orderId = new Types.ObjectId(query.orderId);
    const [items, total] = await Promise.all([
      // list view: drop the (potentially large) raw payload — the payment
      // drawer (getPayment) is where operators peek at it
      PaymentWebhookEvent.find(q).select('-raw').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PaymentWebhookEvent.countDocuments(q),
    ]);
    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + items.length < total },
    };
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
