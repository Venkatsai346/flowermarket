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
   * Mock gateway state — an in-process stand-in for the REAL gateway's
   * system of record. The webhook handler records captures HERE (as a real
   * gateway would have them on its side), and reconciliation reads them via
   * fetchPaymentStatus(). This is what makes "the webhook was lost, recover
   * from the source of truth" testable in-process.
   * Keyed by gatewayOrderId: { captured, gatewayPaymentId, amountPaise }
   */
  mockGateway = new Map();
  mockGatewaySet(orderId, state) { this.mockGateway.set(orderId, state); return this; }

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

    if (this._forcePending || config.payments.mockPending) {
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
  /**
   * Webhook signature verification. HMAC-SHA256(rawBody, secret) compared
   * constant-time against the signature header. `rawBody` MUST be the exact
   * request bytes (webhook routes are mounted with express.raw()).
   *   razorpay: secret = RAZORPAY_WEBHOOK_SECRET, header `x-razorpay-signature`
   *   mock:     same algorithm with the mock secret, header `x-mock-signature`
   *             (dev/test exercises the identical verification path)
   */
  verifyWebhook(provider, rawBody, signature, secret = null) {
    if (provider !== 'razorpay' && provider !== 'mock') {
      return { ok: false, error: `webhook verification for ${provider} not implemented` };
    }
    const s = secret || (provider === 'razorpay' ? config.razorpay.webhookSecret : config.payments.mockWebhookSecret);
    if (!s) return { ok: false, error: `${provider} webhook secret not configured` };
    if (!rawBody || !signature) return { ok: false, error: 'missing raw body or signature' };

    const expected = crypto.createHmac('sha256', s).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length) return { ok: false, error: 'signature mismatch' };
    return { ok: crypto.timingSafeEqual(a, b) };
  }

  /**
   * Authoritative gateway state for a charge (reconciliation source of truth).
   * - mock: reads the in-process mock gateway map.
   * - razorpay: fetches the order from the API; if paid, resolves the payment
   *   via the payments collection scoped to that order.
   * @returns {Promise<{state:'captured'|'failed'|'pending', gatewayPaymentId?:string, raw?:object}|null>}
   *          null = gateway knows nothing about this order.
   */
  async fetchPaymentStatus({ gatewayOrderId = null, gatewayPaymentId = null, provider = null }) {
    const prov = provider || (this.isRazorpay ? 'razorpay' : 'mock');
    if (prov === 'mock') {
      const st = gatewayOrderId ? this.mockGateway.get(gatewayOrderId) : null;
      if (!st) return null;
      if (st.captured) return { state: 'captured', gatewayPaymentId: st.gatewayPaymentId || null, raw: st };
      if (st.failed) return { state: 'failed', raw: st };
      return { state: 'pending', raw: st };
    }
    if (prov === 'razorpay') {
      const rzp = this.client();
      try {
        if (gatewayPaymentId) {
          const p = await rzp.payments.fetch(gatewayPaymentId);
          if (p.status === 'captured') return { state: 'captured', gatewayPaymentId: p.id, raw: p };
          if (p.status === 'failed') return { state: 'failed', gatewayPaymentId: p.id, raw: p };
          return { state: 'pending', raw: p };
        }
        if (!gatewayOrderId) return null;
        const order = await rzp.orders.fetch(gatewayOrderId);
        if (order.status === 'paid') {
          const page = await rzp.payments.all({ order_id: gatewayOrderId, count: 1 });
          const pay = (page?.items || [])[0] || null;
          return { state: 'captured', gatewayPaymentId: pay?.id || null, raw: { order, payment: pay } };
        }
        if (order.status === 'failed') return { state: 'failed', raw: order };
        return { state: 'pending', raw: order };
      } catch (err) {
        // 404 = gateway never saw it; anything else is transient — surface as pending
        if (err?.statusCode === 404 || /not found|Not Found/i.test(err?.message || '')) return null;
        throw err;
      }
    }
    return null;
  }

  /**
   * Authoritative state of a gateway refund (refunds are async on Razorpay).
   * @returns {Promise<{state:'processed'|'partial'|'failed'|'pending', raw?:object}>}
   */
  async fetchRefundStatus({ gatewayRef = null, provider = null }) {
    const prov = provider || (this.isRazorpay ? 'razorpay' : 'mock');
    if (prov === 'mock') return { state: 'processed', raw: { mock: true } };
    if (prov === 'razorpay') {
      const rzp = this.client();
      const r = await rzp.refunds.fetch(gatewayRef);
      const map = { processed: 'processed', pending: 'pending', failed: 'failed', refunded: 'processed' };
      return { state: map[r.status] || 'pending', raw: r };
    }
    return { state: 'pending', raw: null };
  }

  /** Mock gateway signature (same algorithm as Razorpay's) — for tests/dev. */
  signMockWebhook(body) {
    const secret = config.payments.mockWebhookSecret;
    return crypto.createHmac('sha256', secret).update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
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
