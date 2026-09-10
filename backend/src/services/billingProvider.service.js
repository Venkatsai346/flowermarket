/**
 * BillingProvider — invoice payment adapter (Phase 5).
 *
 * Same contract as PaymentProvider (order payments), applied to platform
 * invoices — a store owner paying their subscription goes through the SAME
 * gateway discipline as a customer paying for flowers:
 *
 *   mock/console (default) -> synchronous success. Deterministic: an amount
 *     whose paise ends in '13' declines, so failure paths stay testable.
 *     Returns a gateway ref so the paid invoice always carries provenance.
 *   razorpay (when RAZORPAY_KEY_ID/SECRET are set) -> REAL async flow:
 *     1. charge() creates a Razorpay Order (auto-capture) and returns
 *        { success:false, pending:true, gatewayOrderId, keyId, amountPaise }.
 *        The console completes it via Checkout.js; NOTHING is marked paid here.
 *     2. Razorpay calls POST /api/v1/marketplace/billing/webhook/razorpay with
 *        the raw body + x-razorpay-signature; verifyWebhook() checks the HMAC
 *        and the handler confirms the parked invoice (confirmInvoicePayment).
 *
 * The rest of the codebase only ever calls charge()/verifyWebhook() and never
 * depends on which provider is configured.
 */

import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import config from '../config/index.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class BillingProvider {
  get isRazorpay() {
    return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
  }

  client() {
    if (!this.isRazorpay) throw new Error('Razorpay billing adapter: configure RAZORPAY_KEY_ID/SECRET before use');
    return new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
  }

  /**
   * @returns {Promise<{success:boolean, pending:boolean, ref?:string,
   *   gatewayOrderId?:string, keyId?:string, amountPaise?:number,
   *   currency?:string, provider:string}>}
   */
  async charge({ invoiceId, amount, currency = 'INR' }) {
    if (this.isRazorpay) {
      return this.razorpayCreateOrder({ invoiceId, amount, currency });
    }

    // ---- mock/console provider (default; tests + demo) ----
    const provider = config.marketplace.billingProvider || 'mock';
    const amountPaise = Math.round(Number(amount || 0) * 100);
    const declined = String(amountPaise).endsWith('13'); // deterministic failure hook
    await delay(25); // simulate network latency
    // eslint-disable-next-line no-console
    console.log(`[billing:${provider}] invoice ${invoiceId} charge ${currency} ${amount} → ${declined ? 'DECLINED' : 'captured'}`);
    return {
      success: !declined,
      pending: false,
      ref: declined ? null : `mock_inv_${invoiceId}`,
      provider,
    };
  }

  async razorpayCreateOrder({ invoiceId, amount, currency }) {
    const rzp = this.client();
    const order = await rzp.orders.create({
      amount: Math.round(Number(amount || 0) * 100), // paise
      currency: currency || 'INR',
      receipt: `inv_${String(invoiceId).slice(0, 24)}`,
      notes: { kind: 'platform_invoice', invoiceId: String(invoiceId) },
      payment_capture: 1,
    });
    return {
      success: false,
      pending: true, // awaiting client payment + webhook
      gatewayOrderId: order.id,
      keyId: config.razorpay.keyId,
      amountPaise: Math.round(Number(amount || 0) * 100),
      currency: currency || 'INR',
      provider: 'razorpay',
      raw: order,
    };
  }

  /**
   * Webhook signature verification — identical algorithm to order payments.
   * HMAC-SHA256(rawBody, secret) compared constant-time against the header.
   * `rawBody` MUST be the exact request bytes (mounted with express.raw()).
   *   razorpay: RAZORPAY_WEBHOOK_SECRET, header `x-razorpay-signature`
   *   mock:     payments.mockWebhookSecret, header `x-mock-signature`
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
}

export default new BillingProvider();
