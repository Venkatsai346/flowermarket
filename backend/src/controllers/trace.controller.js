import Order from '../models/order.model.js';
import OrderStatusHistory from '../models/orderStatusHistory.model.js';
import Payment from '../models/payment.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import PaymentWebhookEvent from '../models/paymentWebhookEvent.model.js';
import DomainEvent from '../models/domainEvent.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { notFound } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';

/**
 * TraceController — "follow the money" (Phase 10).
 *
 * Given a traceId, reconstruct the full causal chain for one transaction
 * across every subsystem, in time order:
 *
 *   order created → payment → [gateway webhook] → sale journal
 *   → refund journal? → payout batch journal? → cancellation?
 *
 * Every aggregate carries the same traceId (stamped at creation and adopted
 * by the async webhook), so the chain is a set of indexed `traceId` lookups —
 * no joins, no guessing. This is the operator's answer to "what actually
 * happened to this rupee, end to end?"
 */
class TraceController {
  getTrace = asyncHandler(async (req, res) => {
    const traceId = String(req.params.traceId || '').trim();
    const tenantId = req.tenantId; // route is tenant-scoped

    // The order is the anchor (it is where the trace is minted). A trace with
    // no order (e.g. a wallet top-up) still resolves via the other lookups.
    const orders = await Order.find({ traceId, ...(tenantId ? { tenantId } : {}) }).lean();
    const orderIds = orders.map((o) => o._id);

    const [
      statuses, payments, journals, batches, webhooks, events,
    ] = await Promise.all([
      orderIds.length ? OrderStatusHistory.find({ orderId: { $in: orderIds } }).sort({ createdAt: 1 }).lean() : [],
      Payment.find({ traceId, ...(tenantId ? { tenantId } : {}) }).lean(),
      LedgerJournal.find({ traceId, ...(tenantId ? { tenantId } : {}) }).sort({ occurredAt: 1 }).lean(),
      PayoutBatch.find({ traceId, ...(tenantId ? { tenantId } : {}) }).lean(),
      PaymentWebhookEvent.find({ traceId, ...(tenantId ? { tenantId } : {}) }).sort({ createdAt: 1 }).lean(),
      DomainEvent.find({ traceId, ...(tenantId ? { tenantId } : {}) }).sort({ occurredAt: 1, createdAt: 1 }).lean(),
    ]);

    if (!orders.length && !payments.length && !journals.length && !events.length && !webhooks.length) {
      throw notFound(`No trace found for ${traceId}`, 'TRACE_NOT_FOUND');
    }

    const chain = [
      ...orders.map((o) => ({ at: o.createdAt, kind: 'order.created', summary: `Order ${o.orderNumber} — ${o.totalAmount} INR`, ref: o._id })),
      // the order row already represents the initial 'created' transition
      ...statuses.filter((s) => s.toStatus !== 'created').map((s) => ({ at: s.createdAt, kind: `order.${s.toStatus}`, summary: `${s.fromStatus || '—'} → ${s.toStatus}${s.note ? ` (${s.note})` : ''}`, ref: s.orderId })),
      ...payments.map((p) => ({ at: p.createdAt, kind: 'payment.created', summary: `Payment ${p.status} — ${p.amount} INR via ${p.provider}`, ref: p._id })),
      ...webhooks.map((w) => ({ at: w.createdAt, kind: `webhook.${w.eventType}`, summary: `Gateway ${w.eventType} — ${w.status}${w.note ? ` (${w.note})` : ''}`, ref: w.eventId })),
      ...journals.map((j) => ({ at: j.occurredAt || j.postedAt, kind: `journal.${j.kind}`, summary: `${j.kind} journal — ${j.totalPaise} paise`, ref: j.idempotencyKey })),
      ...batches.map((b) => ({ at: b.createdAt, kind: 'payout.batch', summary: `Payout ${b.batchNumber} — ${b.state} (${b.netPaise} paise)`, ref: b._id })),
      ...events.map((e) => ({ at: e.occurredAt || e.createdAt, kind: `event.${e.kind}`, summary: `${e.kind} (${e.aggregateType}/${e.aggregateId})`, ref: e.idempotencyKey })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.status(200).json(success({
      traceId,
      orderCount: orders.length,
      paymentCount: payments.length,
      journalCount: journals.length,
      eventCount: events.length,
      webhookCount: webhooks.length,
      payoutCount: batches.length,
      chain,
      orders: serializeList(orders).map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, total: o.totalAmount })),
    }, { message: 'Trace chain reconstructed' }));
  });
}

export default new TraceController();
