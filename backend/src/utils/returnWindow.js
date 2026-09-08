/**
 * returnWindow.js — PURE delivery-clock and return-eligibility arithmetic.
 *
 * No database, no config, no I/O, and the clock is injectable (`now`) — so
 * `scripts/return-window.test.js` can prove the window properties without any
 * infrastructure. Same discipline as money.js / gst.js / ranking.js.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Two subsystems need "when was this order actually delivered?":
 *
 *   1. RETURNS  — the customer's 7-day pickup window and 24-hour instant-claim
 *                 window both start at delivery.
 *   2. PAYOUTS  — a vendor line becomes payable at `deliveredAt +
 *                 returnWindowDays`, because paying before the return window
 *                 closes means buying back your own goods.
 *
 * They must read the SAME stamp or the two gates disagree: read the payment
 * time instead of the delivery time and the platform can pay a vendor while the
 * customer still has a live return window (returns.service used to do exactly
 * this — it assigned `paidAt` to a variable named `deliveredAt`).
 *
 * So the stamp resolution lives here, once, and both callers import it.
 *
 * ── THE STAMP, AND WHY THE FALLBACK ORDER MATTERS ───────────────────────────
 * `order.deliveredAt` is stamped ONCE by order.service.transition() the first
 * time an order reaches DELIVERED. It must be a top-level schema path or
 * mongoose strict mode silently drops it (see the comment on Order.deliveredAt).
 * The fallbacks are ordered by trustworthiness:
 *
 *   deliveredAt  the stamped moment — authoritative
 *   paidAt       better than nothing for rows delivered before the stamp
 *                existed; WRONG for the common case (it charges the customer
 *                for transit time)
 *   updatedAt    drifts on any later save — last resort only
 *
 * `measuredFrom` is returned alongside the value so an operator (or a test) can
 * see which one was used. A return window silently measured from `updated_at`
 * is a support ticket, not a statistic.
 */

import { RETURN_CLAIM_TYPE } from '../constants/enums.js';

/** Standard pickup-and-QC return window (days after delivery). */
export const RETURN_WINDOW_DAYS = 7;
/** Instant-claim window (hours after delivery) for perishables. */
export const INSTANT_CLAIM_WINDOW_HOURS = 24;

/** Which stamp a delivery clock was measured from. */
export const DELIVERY_STAMP_SOURCE = Object.freeze({
  DELIVERED_AT: 'delivered_at',
  PAID_AT: 'paid_at',
  UPDATED_AT: 'updated_at',
  NONE: 'none',
});

/**
 * Resolve the delivery stamp for an order-shaped object.
 *
 * Accepts a Mongoose doc or a lean/plain object — it only reads three fields,
 * so it works on `{ status, deliveredAt, paymentSummary, updatedAt }`.
 *
 * ── `allowPaidAtFallback`, and why the two callers disagree ─────────────────
 * Both gates prefer the stamped `deliveredAt`. They differ on what to do when a
 * legacy row has none, and the difference is deliberate:
 *
 *   RETURNS  (allowPaidAtFallback: true, the default) want the most ACCURATE
 *            available stamp. paidAt is closer to the truth than updatedAt, and
 *            under-crediting a customer's window is the worse failure.
 *
 *   PAYOUTS  (allowPaidAtFallback: false) want the CONSERVATIVE stamp. paidAt
 *            is EARLIER than the real delivery, so falling back to it would
 *            open the return-risk gate sooner — paying a vendor before the
 *            customer's window has actually closed. updatedAt is later, i.e.
 *            slower to pay, which is the safe direction for cash leaving the
 *            building.
 *
 * @returns {{ at: Date|null, source: string }}
 */
export function deliveryStampFor(order, { allowPaidAtFallback = true } = {}) {
  if (!order) return { at: null, source: DELIVERY_STAMP_SOURCE.NONE };
  if (order.deliveredAt) {
    return { at: new Date(order.deliveredAt), source: DELIVERY_STAMP_SOURCE.DELIVERED_AT };
  }
  if (allowPaidAtFallback) {
    const paidAt = order.paymentSummary?.paidAt;
    if (paidAt) return { at: new Date(paidAt), source: DELIVERY_STAMP_SOURCE.PAID_AT };
  }
  if (order.updatedAt) {
    return { at: new Date(order.updatedAt), source: DELIVERY_STAMP_SOURCE.UPDATED_AT };
  }
  return { at: null, source: DELIVERY_STAMP_SOURCE.NONE };
}

/** Hours in a claim type's window. Instant claims are hours; pickups are days. */
export function windowHoursFor(claimType) {
  return claimType === RETURN_CLAIM_TYPE.INSTANT_CLAIM
    ? INSTANT_CLAIM_WINDOW_HOURS
    : RETURN_WINDOW_DAYS * 24;
}

/**
 * Compute the return window for an order.
 *
 * PURE: given the same order and `now`, always the same answer.
 *
 * An order with no resolvable delivery stamp is reported as `unknown` rather
 * than treated as expired — refusing a return because a timestamp is missing is
 * a worse failure than letting a human look at it, and `windowExpired: false`
 * with `stampMissing: true` is what makes that visible.
 *
 * @param {object} order      order-shaped ({ deliveredAt, paymentSummary, updatedAt })
 * @param {object} [opts]
 * @param {string} [opts.claimType]  RETURN_CLAIM_TYPE (default pickup_qc)
 * @param {Date|number} [opts.now]   injectable clock
 * @returns {{
 *   claimType: string, windowHours: number,
 *   deliveredAt: Date|null, measuredFrom: string, stampMissing: boolean,
 *   windowEndsAt: Date|null, hoursSince: number|null, hoursRemaining: number,
 *   windowExpired: boolean,
 * }}
 */
export function returnWindow(order, { claimType = RETURN_CLAIM_TYPE.PICKUP_QC, now = Date.now() } = {}) {
  // Customer-facing: use the most accurate stamp available (see deliveryStampFor).
  const { at, source } = deliveryStampFor(order, { allowPaidAtFallback: true });
  const windowHours = windowHoursFor(claimType);

  if (!at) {
    return {
      claimType,
      windowHours,
      deliveredAt: null,
      measuredFrom: source,
      stampMissing: true,
      windowEndsAt: null,
      hoursSince: null,
      hoursRemaining: 0,
      windowExpired: false,
    };
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const hoursSince = (nowMs - at.getTime()) / 3600000;
  return {
    claimType,
    windowHours,
    deliveredAt: at,
    measuredFrom: source,
    stampMissing: false,
    windowEndsAt: new Date(at.getTime() + windowHours * 3600000),
    hoursSince: Math.round(hoursSince * 100) / 100,
    hoursRemaining: Math.max(0, Math.round((windowHours - hoursSince) * 100) / 100),
    windowExpired: hoursSince > windowHours,
  };
}

/**
 * The PAYOUT side of the same clock: when a vendor line becomes eligible.
 *
 * `deliveredAt + windowDays`, or null when the order has no delivery stamp yet
 * (the sweep fills it in once the order is actually delivered). Perishables get
 * their own, much shorter window — that is the florist-specific rule.
 *
 * @param {object} order
 * @param {object} [opts]
 * @param {number} [opts.windowDays]          policy.returnWindowDays
 * @param {boolean} [opts.perishable]         use the perishable window instead
 * @param {number} [opts.perishableWindowDays] policy.perishableReturnWindowDays
 * @param {Date|number} [opts.now]            fallback stamp when none resolves
 * @returns {{ eligibleAt: Date|null, deliveredAt: Date|null, measuredFrom: string, windowDays: number }}
 */
export function payoutEligibilityAt(order, {
  windowDays = RETURN_WINDOW_DAYS,
  perishable = false,
  perishableWindowDays = 1,
  now = Date.now(),
} = {}) {
  const days = perishable ? perishableWindowDays : windowDays;
  // Cash-leaving-the-building: use the CONSERVATIVE stamp — never paidAt, which
  // would open the return-risk gate before the customer's window really closed.
  const { at, source } = deliveryStampFor(order, { allowPaidAtFallback: false });
  if (!at) {
    // Nothing delivered yet: eligibility is unknown, not "now". The sweep
    // re-checks once the order reaches DELIVERED.
    return { eligibleAt: null, deliveredAt: null, measuredFrom: source, windowDays: days };
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return {
    eligibleAt: new Date(at.getTime() + days * 86400000),
    deliveredAt: at,
    measuredFrom: source,
    windowDays: days,
    // exposed so an operator can see whether the line is waiting on the clock
    msUntilEligible: at.getTime() + days * 86400000 - nowMs,
  };
}

export default {
  RETURN_WINDOW_DAYS,
  INSTANT_CLAIM_WINDOW_HOURS,
  DELIVERY_STAMP_SOURCE,
  deliveryStampFor,
  windowHoursFor,
  returnWindow,
  payoutEligibilityAt,
};
