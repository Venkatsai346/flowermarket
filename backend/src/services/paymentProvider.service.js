import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import config from '../config/index.js';

/**
 * PaymentProvider — gateway abstraction (mirrors the SmsSender pattern).
 *
 * Providers:
 *   mock     -> deterministic dev/test gateway: charge succeeds unless
 *               amount ends in '13' (simulates decline); refunds succeed.
 *               Returns gateway refs so webhook reconciliation is exercisable.
 *   razorpay -> REAL production adapter. Uses the official `razorpay` SDK.
 *
 * Razorpay is an ASYNC capture flow:
 *   1. charge() creates a Razorpay Order (payment_capture=1) and returns
 *      { success:false, pending:true, gatewayOrderId, clientSecret }.
 *      The client completes payment; the webhook confirms.
 *   2. verifyWebhook() cryptographically verifies `x-razorpay-signature`
 *      (HMAC-SHA256 of the RAW body with the webhook secret) — the client
 *      must send the raw body (express.raw), not JSON-parsed.
 *   3. The webhook handler (payment.controller.handleWebhook) then calls
 *      paymentService.confirmSuccess(...) -> orderService.confirmPayment(...).
 *
 * The rest of the codebase only ever calls charge()/refund()/verifyWebhook()
 * and never depends on which provider is configured.
 */
class PaymentProvider {
  get isRazorpay() {
    return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
  }

  // test hook: force the async (pending) charge path without real keys, so
  // the webhook-confirm flow is exercisable in smoke tests.
  _forcePending = false;
  forcePending(v) { this._forcePending = v; return this; }

  /**
   * Create a charge.
   * - mock: synchronous success/decline (tests + demo).
   * - razorpay: creates a gateway order; payment happens client-side; returns
   *   { success:false, pending:true } so the saga leaves the order in
   *   PAYMENT_PENDING until the webhook confirms.
   */
  async charge({ idempotencyKey, amount, currency = 'INR', method = 'upi', orderRef = null, paymentId = null }) {
    if (this.isRazorpay) {
      return this.razorpayCreateOrder({ idempotencyKey, amount, currency, method, orderRef, paymentId });
    }

    // ---- mock provider ----
    const amountInPaise = Math.round(amount * 100);
    const declined = String(amountInPaise).endsWith('13'); // deterministic failure hook for tests
    await delay(25); // simulate network latency

    if (this._forcePending) {
      return {
        success: false,
        pending: true, // simulate the razorpay async flow (webhook will confirm)
        gatewayOrderId: `mord_test_${idempotencyKey.slice(0, 8)}`,
        provider: 'mock',
        raw: { mock: true, pending: true },
      };
    }

    return {
      success: !declined,
      pending: false,
      gatewayOrderId: declined ? null : `mord_${idempotencyKey.slice(0, 8)}`,
      gatewayPaymentId: declined ? null : `mpay_${idempotencyKey.slice(0, 8)}_${Date.now().toString(36)}`,
      provider: 'mock',
      raw: { mock: true, declined, amountInPaise },
    };
  }

  /**
   * Razorpay: create an order in the gateway (payment_capture=1 auto-captures
   * when the customer completes payment client-side).
   */
  async razorpayCreateOrder({ idempotencyKey, amount, currency, method, orderRef, paymentId }) {
    const rzp = this.client();
    const order = await rzp.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: currency || 'INR',
      receipt: `${idempotencyKey.slice(0, 30)}`, // unique per charge
      notes: {
        idempotencyKey,
        orderRef: orderRef ? String(orderRef) : '',
        paymentId: paymentId ? String(paymentId) : '',
      },
      payment_capture: 1,
    });
    return {
      success: false,
      pending: true, // awaiting client payment + webhook
      gatewayOrderId: order.id,
      clientSecret: order.receipt ? null : null, // kept for parity; checkout uses order id
      provider: 'razorpay',
      raw: order,
    };
  }

  /**
   * Refund a captured payment (or just create a refund in the gateway).
   * mock: instant success; razorpay: real refund via the SDK.
   */
  async refund({ idempotencyKey, amount, currency = 'INR', gatewayPaymentId = null, reason = null, gatewayOrderId = null }) {
    if (this.isRazorpay) {
      if (!gatewayPaymentId) throw new Error('gatewayPaymentId required for Razorpay refund');
      const rzp = this.client();
      const refund = await rzp.payments.refund(gatewayPaymentId, {
        amount: Math.round(amount * 100),
        notes: { idempotencyKey, reason: reason || 'order_refund' },
      });
      return {
        success: true,
        gatewayRef: refund.id || `rfnd_${idempotencyKey.slice(0, 8)}`,
        provider: 'razorpay',
        raw: refund,
      };
    }
    await delay(20);
    return {
      success: true,
      gatewayRef: `mref_${idempotencyKey.slice(0, 8)}`,
      provider: 'mock',
      raw: { mock: true, amount },
    };
  }

  /**
   * Webhook signature verification.
   * razorpay: HMAC-SHA256(rawBody, webhookSecret) compared constant-time
   * against the `x-razorpay-signature` header. `rawBody` MUST be the raw
   * request body (webhook routes are mounted with express.raw()).
   */
  verifyWebhook(provider, rawBody, signature, secret = null) {
    if (provider === 'mock') return { ok: true };
    if (provider !== 'razorpay') return { ok: false, error: `webhook verification for ${provider} not implemented` };
    const s = secret || config.razorpay.webhookSecret;
    if (!s) return { ok: false, error: 'RAZORPAY_WEBHOOK_SECRET not configured' };
    if (!rawBody || !signature) return { ok: false, error: 'missing raw body or signature' };

    const expected = crypto.createHmac('sha256', s).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length) return { ok: false, error: 'signature mismatch' };
    return { ok: crypto.timingSafeEqual(a, b) };
  }

  /** Lazily-built Razorpay SDK client (real keys). */
  client() {
    return new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default new PaymentProvider();
