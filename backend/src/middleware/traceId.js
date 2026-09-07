import crypto from 'node:crypto';

/**
 * traceId — end-to-end correlation for "follow the money" (Phase 10).
 *
 * Every request carries a `traceId` that is stamped onto the domain
 * aggregates it creates (Order → Payment → LedgerJournal → DomainEvent →
 * PayoutBatch → audit) and echoed back in the `x-trace-id` response header.
 *
 * INBOUND ADOPTION: if the caller sends a well-formed `x-trace-id` we adopt
 * it. This is how the async loops close:
 *   - the storefront's checkout request mints the trace; the gateway
 *     webhook that later captures the payment is processed under the
 *     PAYMENT's stored traceId (see payment.controller), so the capture
 *     lands on the same chain as the original tap;
 *   - payout provider webhooks adopt the batch's traceId the same way.
 *
 * Format guard: 8..64 chars of [A-Za-z0-9:_-] — anything else is ignored
 * (the header is attacker input; we never echo arbitrary bytes).
 */
const VALID = /^[A-Za-z0-9:_-]{8,64}$/;

export default function traceId(req, res, next) {
  const inbound = String(req.headers['x-trace-id'] || '').trim();
  req.traceId = VALID.test(inbound) ? inbound : `tr_${crypto.randomBytes(8).toString('hex')}`;
  res.setHeader('x-trace-id', req.traceId);
  next();
}
