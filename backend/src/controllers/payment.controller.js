import crypto from 'node:crypto';
import Payment from '../models/payment.model.js';
import paymentService from '../services/payment.service.js';
import paymentProvider from '../services/paymentProvider.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { badRequest, unauthorized } from '../utils/ApiError.js';

/**
 * PaymentController — webhooks (raw body, signature-verified) + ops reads.
 *
 * The Razorpay webhook route is mounted in app.js with express.raw() BEFORE
 * express.json(), because signature verification needs the exact raw bytes.
 */
class PaymentController {
  /**
   * Razorpay webhook. Verifies HMAC-SHA256(rawBody, webhookSecret) against
   * `x-razorpay-signature`, then handles `payment.captured`:
   *   find Payment by gatewayPaymentId (fallback gatewayOrderId) ->
   *   paymentService.confirmSuccess -> orderService.confirmPayment (saga
   *   finalizes idempotently).
   */
  webhookRazorpay = asyncHandler(async (req, res) => {
    const rawBody = req.body; // Buffer (express.raw)
    const signature = req.headers['x-razorpay-signature'] || '';

    // 1. VERIFY BEFORE PARSING — untrusted bytes never reach state logic
    const verified = paymentProvider.verifyWebhook('razorpay', rawBody, signature);
    if (!verified.ok) {
      throw unauthorized('Webhook signature verification failed', 'WEBHOOK_SIGNATURE_INVALID');
    }

    // 2. route through the single event pipeline (dedupe + amount check +
    //    state machine + audit) — see paymentService.applyWebhookEvent
    const event = JSON.parse(rawBody.toString('utf8') || '{}');
    const { event: eventName, id: eventId, payload } = event;
    const entity = payload?.payment?.entity || payload?.order?.entity || {};
    const result = await paymentService.applyWebhookEvent({
      provider: 'razorpay',
      eventId: eventId || `rzp_${rawBody.length}_${eventName}`,
      eventType: eventName,
      gatewayPaymentId: entity.id || null,
      gatewayOrderId: entity.order_id || entity.receipt || null,
      amountPaise: entity.amount ?? null,
      currency: entity.currency || null,
      raw: event,
    });
    // always ack 200 (except bad signature): 4xx makes the gateway storm
    // retries on states only an operator can fix (mismatches, unknowns)
    return res.status(200).json(success({ result: result.status }, { message: `Webhook ${result.status}` }));
  });

  /**
   * Mock webhook — lets devs/tests exercise the async capture path without
   * real Razorpay keys: POST { gatewayOrderId } (or gatewayPaymentId) and the
   * payment is confirmed exactly like a real webhook would.
   */
  webhookMock = asyncHandler(async (req, res) => {
    // raw body route -> same contract as Razorpay: raw bytes + HMAC signature
    const rawBody = req.body;
    const signature = req.headers['x-mock-signature'] || '';
    const verified = paymentProvider.verifyWebhook('mock', rawBody, signature);
    if (!verified.ok) {
      throw unauthorized('Webhook signature verification failed', 'WEBHOOK_SIGNATURE_INVALID');
    }
    const parsed = JSON.parse(rawBody.toString('utf8') || '{}');
    const { gatewayOrderId, gatewayPaymentId, amountPaise, eventId } = parsed;

    // the deterministic decline hook (amounts ending in paise '13') needs the
    // recorded amount, so resolve the payment here and choose the event type
    const payment = gatewayPaymentId
      ? await Payment.findOne({ gatewayPaymentId }).lean()
      : null;
    const target = payment || (gatewayOrderId
      ? await Payment.findOne({ gatewayOrderId }).lean()
      : null);

    let eventType = 'payment.captured';
    let eventAmount = amountPaise;
    if (target && eventAmount == null && String(Math.round(target.amount * 100)).endsWith('13')) {
      eventType = 'payment.failed';
      eventAmount = null; // failure carries no capture amount
    }

    const result = await paymentService.applyWebhookEvent({
      provider: 'mock',
      eventId: eventId || `mock_${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 24)}`,
      eventType,
      gatewayPaymentId: gatewayPaymentId || (target?.gatewayPaymentId || null),
      gatewayOrderId: gatewayOrderId || (target?.gatewayOrderId || null),
      amountPaise: eventAmount ?? null,
      currency: target?.currency || null,
      raw: { mockWebhook: true, ...parsed },
    });
    if (!target && result.status === 'ignored') {
      throw badRequest('No payment found for the given gateway refs', 'PAYMENT_NOT_FOUND');
    }
    return res.status(200).json(
      success({ result: result.status, orderId: result.order?.order?.id || null }, { message: `Mock webhook ${result.status}` }),
    );
  });

  // ---------------- ops reads ----------------
  listPayments = asyncHandler(async (req, res) => {
    const result = await paymentService.listPayments({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Payments fetched', meta: result.meta }));
  });

  getPayment = asyncHandler(async (req, res) => {
    const detail = await paymentService.getPayment({ paymentId: req.params.id });
    res.status(200).json(success(detail, { message: 'Payment fetched' }));
  });
}

export default new PaymentController();
