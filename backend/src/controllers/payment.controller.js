import paymentService from '../services/payment.service.js';
import paymentProvider from '../services/paymentProvider.service.js';
import orderService from '../services/order.service.js';
import { ORDER_CANCELLATION_REASON } from '../constants/enums.js';
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
    const event = JSON.parse(rawBody.toString('utf8') || '{}');

    const verified = paymentProvider.verifyWebhook('razorpay', rawBody, signature);
    if (!verified.ok) {
      throw unauthorized('Webhook signature verification failed', 'WEBHOOK_SIGNATURE_INVALID');
    }

    const { event: eventName, payload } = event;
    if (eventName === 'payment.captured' || eventName === 'payment.authorized' || eventName === 'order.paid') {
      const paymentEntity = payload?.payment?.entity || payload?.order?.entity || {};
      const gatewayPaymentId = paymentEntity.id || null;
      const gatewayOrderId = paymentEntity.order_id || paymentEntity.receipt || null;

      const payment = gatewayPaymentId
        ? await paymentService.findByGatewayPaymentId({ gatewayPaymentId }).catch(() => null)
        : null;
      const paymentByOrder = !payment && gatewayOrderId
        ? await paymentService.findByGatewayOrderId({ gatewayOrderId }).catch(() => null)
        : null;
      const target = payment || paymentByOrder;

      if (!target) {
        // unknown order id — maybe a different tenant's payment; ack anyway
        return res.status(200).json(success(null, { message: 'Webhook received (unknown payment)' }));
      }

      await paymentService.confirmSuccess({
        paymentId: target._id,
        gatewayPaymentId: gatewayPaymentId || null,
        raw: event,
      });
      const order = await orderService.confirmPayment({ paymentId: target._id });
      return res.status(200).json(success({ orderId: order.order?.id || order.order?._id, status: order.order?.status }, { message: 'Payment confirmed' }));
    }

    // payment.failed — the customer's attempt failed at the gateway: mark the
    // payment failed and cancel the PAYMENT_PENDING order (compensation A).
    // Idempotent: cancelOrder is safe on an already-CANCELLED order.
    if (eventName === 'payment.failed') {
      const entity = payload?.payment?.entity || {};
      const gatewayPaymentId = entity.id || null;
      const gatewayOrderId = entity.order_id || null;
      const payment = gatewayPaymentId
        ? await paymentService.findByGatewayPaymentId({ gatewayPaymentId }).catch(() => null)
        : null;
      const target = payment || (gatewayOrderId
        ? await paymentService.findByGatewayOrderId({ gatewayOrderId }).catch(() => null)
        : null);
      if (target) {
        await paymentService.markFailed({
          paymentId: target._id,
          reason: entity.error_description || 'Payment failed at gateway',
          gatewayPaymentId: gatewayPaymentId || null,
        });
        try {
          await orderService.cancelOrder({
            tenantId: target.tenantId, orderId: target.orderId,
            reason: ORDER_CANCELLATION_REASON.PAYMENT_FAILED,
            actorType: 'system', refund: false,
          });
        } catch { /* already cancelled / not cancel-able — ack anyway */ }
      }
      return res.status(200).json(success(null, { message: 'Payment failure recorded' }));
    }

    // other events — ack, no action
    return res.status(200).json(success(null, { message: 'Webhook received' }));
  });

  /**
   * Mock webhook — lets devs/tests exercise the async capture path without
   * real Razorpay keys: POST { gatewayOrderId } (or gatewayPaymentId) and the
   * payment is confirmed exactly like a real webhook would.
   */
  webhookMock = asyncHandler(async (req, res) => {
    // raw body route -> parse the buffer like a real gateway payload
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body || '{}')
      : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}')
      : (req.body || {});
    const { gatewayOrderId, gatewayPaymentId, amountPaise } = parsed;
    const payment = gatewayPaymentId
      ? await paymentService.findByGatewayPaymentId({ gatewayPaymentId }).catch(() => null)
      : null;
    const target = payment || (gatewayOrderId
      ? await paymentService.findByGatewayOrderId({ gatewayOrderId }).catch(() => null)
      : null);
    if (!target) throw badRequest('No payment found for the given gateway refs', 'PAYMENT_NOT_FOUND');

    // honor the deterministic decline hook so the async path is testable
    if (amountPaise == null && String(Math.round(target.amount * 100)).endsWith('13')) {
      await paymentService.markFailed({ paymentId: target._id, reason: 'Declined (mock webhook)' });
      return res.status(200).json(success({ status: 'failed' }, { message: 'Mock payment failed' }));
    }

    await paymentService.confirmSuccess({
      paymentId: target._id,
      gatewayPaymentId: gatewayPaymentId || `mpay_webhook_${target._id}`,
      raw: { mockWebhook: true },
    });
    const order = await orderService.confirmPayment({ paymentId: target._id });
    return res.status(200).json(success({ orderId: order.order?.id || order.order?._id, status: order.order?.status }, { message: 'Mock payment confirmed' }));
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
