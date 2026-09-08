/**
 * returnWindow unit test — the delivery clock shared by RETURNS and PAYOUTS.
 *
 * Regression cover for the bug this module exists to prevent: returns.service
 * used to measure the customer's window from `paymentSummary.paidAt`, which
 * charged them for transit time and desynchronised the return gate from the
 * payout gate. Both now resolve the stamp through utils/returnWindow.js.
 *
 * Every case here is a pure function call — no DB, no network, no real clock.
 *
 * Run: node scripts/return-window.test.js
 */
import assert from 'node:assert/strict';
import {
  returnWindow,
  payoutEligibilityAt,
  deliveryStampFor,
  windowHoursFor,
  DELIVERY_STAMP_SOURCE,
  RETURN_WINDOW_DAYS,
  INSTANT_CLAIM_WINDOW_HOURS,
} from '../src/utils/returnWindow.js';
import { RETURN_CLAIM_TYPE } from '../src/constants/enums.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

const HOURS = 3600000;
const DAYS = 86400000;

// A realistic florist order: paid Friday evening for a Monday-morning slot,
// delivered Monday 10:00, some later save touched updatedAt on Wednesday.
const delivered = new Date('2026-09-07T10:00:00Z');
const paid = new Date('2026-09-04T18:00:00Z');
const updated = new Date('2026-09-09T10:00:00Z');
const order = {
  status: 'delivered',
  deliveredAt: delivered,
  paymentSummary: { paidAt: paid },
  updatedAt: updated,
};

// ---------------------------------------------------------------------------
// 1. the window is measured from DELIVERY, not payment
// ---------------------------------------------------------------------------
{
  // Thursday 10:00 — 72h after delivery, but 162h after payment.
  const now = new Date('2026-09-10T10:00:00Z');
  const w = returnWindow(order, { now });

  assert.equal(w.measuredFrom, DELIVERY_STAMP_SOURCE.DELIVERED_AT, 'must read the stamped delivery moment');
  assert.equal(w.hoursSince, 72, '72h since delivery');
  assert.equal(w.windowExpired, false, 'inside the 7-day window');
  assert.equal(w.hoursRemaining, 96, '96h of the 168h window left');
  assert.equal(w.windowEndsAt.getTime(), delivered.getTime() + RETURN_WINDOW_DAYS * DAYS);
  ok('pickup window runs from deliveredAt, not paidAt');

  // The regression, stated as a number: measured from paidAt this order would
  // be 136h old — 32h from expiry — instead of 72h old with 96h left.
  const fromPaid = (now.getTime() - paid.getTime()) / HOURS;
  assert.equal(Math.round(fromPaid), 136, 'the old clock would have read 136h');
  assert.equal(Math.round(fromPaid - w.hoursSince), 64, 'the transit time the customer was being charged for');
  ok('the old paidAt clock would have stolen 64h of this customer\'s window');
}

// ---------------------------------------------------------------------------
// 2. instant claims are reachable for slotted delivery
// ---------------------------------------------------------------------------
{
  // Delivered 6h ago — the perishable-damaged-on-arrival case.
  const now = new Date(delivered.getTime() + 6 * HOURS);
  const w = returnWindow(order, { claimType: RETURN_CLAIM_TYPE.INSTANT_CLAIM, now });
  assert.equal(w.windowHours, INSTANT_CLAIM_WINDOW_HOURS);
  assert.equal(w.windowExpired, false, 'a 6h-old delivery can still instant-claim');
  ok('instant claim is reachable shortly after delivery');

  // Under the OLD clock, paid 64h before delivery, this same claim was already
  // 70h old and dead on arrival — the exact failure the fix removes.
  const oldHoursSince = (now.getTime() - paid.getTime()) / HOURS;
  assert.ok(oldHoursSince > INSTANT_CLAIM_WINDOW_HOURS, 'the old clock would have refused it');
  ok('the old clock would have refused that instant claim outright');
}

{
  // 25h after delivery — outside the 24h instant window, inside the 7-day one.
  const now = new Date(delivered.getTime() + 25 * HOURS);
  assert.equal(returnWindow(order, { claimType: RETURN_CLAIM_TYPE.INSTANT_CLAIM, now }).windowExpired, true);
  assert.equal(returnWindow(order, { claimType: RETURN_CLAIM_TYPE.PICKUP_QC, now }).windowExpired, false);
  ok('instant (24h) and pickup (7d) windows expire independently');
}

// ---------------------------------------------------------------------------
// 3. expiry boundary is exclusive at exactly the window edge
// ---------------------------------------------------------------------------
{
  const edge = new Date(delivered.getTime() + RETURN_WINDOW_DAYS * DAYS);
  assert.equal(returnWindow(order, { now: edge }).windowExpired, false, 'exactly at the edge is still inside');
  assert.equal(returnWindow(order, { now: new Date(edge.getTime() + 1) }).windowExpired, true, 'one ms past is expired');
  assert.equal(returnWindow(order, { now: edge }).hoursRemaining, 0, 'no time left at the edge');
  ok('expiry boundary: inside at the edge, expired one millisecond after');
}

// ---------------------------------------------------------------------------
// 4. the payout gate reads the SAME clock — and stays conservative
// ---------------------------------------------------------------------------
{
  const p = payoutEligibilityAt(order, { windowDays: RETURN_WINDOW_DAYS, perishable: false });
  assert.equal(p.deliveredAt.getTime(), delivered.getTime(), 'payout reads deliveredAt too');
  assert.equal(p.eligibleAt.getTime(), delivered.getTime() + RETURN_WINDOW_DAYS * DAYS);
  assert.equal(p.measuredFrom, DELIVERY_STAMP_SOURCE.DELIVERED_AT);
  ok('payout eligibility is deliveredAt + returnWindowDays');

  // The two gates must agree on the moment the window closes: the customer can
  // return up to eligibleAt, and the vendor is paid from eligibleAt.
  const w = returnWindow(order, { now: delivered });
  assert.equal(w.windowEndsAt.getTime(), p.eligibleAt.getTime(), 'return deadline === payout eligibility');
  ok('the return deadline and the payout gate open at the same instant');
}

{
  // Perishables: a 1-day window, because cut flowers do not keep.
  const p = payoutEligibilityAt(order, { windowDays: 7, perishable: true, perishableWindowDays: 1 });
  assert.equal(p.windowDays, 1);
  assert.equal(p.eligibleAt.getTime(), delivered.getTime() + DAYS);
  ok('perishable lines get the 1-day window');
}

// ---------------------------------------------------------------------------
// 5. legacy rows with no deliveredAt: the two callers diverge ON PURPOSE
// ---------------------------------------------------------------------------
{
  const legacy = { status: 'delivered', paymentSummary: { paidAt: paid }, updatedAt: updated };

  const r = returnWindow(legacy, { now: updated });
  assert.equal(r.measuredFrom, DELIVERY_STAMP_SOURCE.PAID_AT, 'returns take the most accurate stamp');

  const p = payoutEligibilityAt(legacy, { windowDays: 7, now: updated });
  assert.equal(p.measuredFrom, DELIVERY_STAMP_SOURCE.UPDATED_AT, 'payouts take the conservative stamp');

  // paidAt is EARLIER than updatedAt, so the conservative choice pays LATER.
  assert.ok(p.eligibleAt.getTime() > legacy.paymentSummary.paidAt.getTime() + 7 * DAYS);
  ok('legacy rows: returns use paidAt, payouts refuse to pay early off it');
}

// ---------------------------------------------------------------------------
// 6. a missing stamp is reported, never guessed
// ---------------------------------------------------------------------------
{
  const w = returnWindow({ status: 'delivered' }, { now: new Date() });
  assert.equal(w.stampMissing, true);
  assert.equal(w.windowExpired, false, 'a missing timestamp must not read as expired');
  assert.equal(w.deliveredAt, null);
  assert.equal(w.windowEndsAt, null);
  ok('no stamp → stampMissing:true and NOT expired (a human looks at it)');

  const p = payoutEligibilityAt({ status: 'confirmed' }, { windowDays: 7 });
  assert.equal(p.eligibleAt, null, 'undelivered → eligibility unknown, not "now"');
  assert.equal(p.measuredFrom, DELIVERY_STAMP_SOURCE.NONE);
  ok('undelivered order → payout eligibility is null, never immediate');
}

// ---------------------------------------------------------------------------
// 7. stamp precedence and shape tolerance
// ---------------------------------------------------------------------------
{
  assert.equal(deliveryStampFor(order).source, DELIVERY_STAMP_SOURCE.DELIVERED_AT);
  assert.equal(deliveryStampFor({ paymentSummary: { paidAt: paid } }).source, DELIVERY_STAMP_SOURCE.PAID_AT);
  assert.equal(deliveryStampFor({ updatedAt: updated }).source, DELIVERY_STAMP_SOURCE.UPDATED_AT);
  assert.equal(deliveryStampFor(null).source, DELIVERY_STAMP_SOURCE.NONE);
  assert.equal(deliveryStampFor({}).source, DELIVERY_STAMP_SOURCE.NONE);
  ok('stamp precedence: deliveredAt → paidAt → updatedAt → none');

  // ISO strings (lean rows, JSON over the wire) resolve exactly like Dates.
  const iso = { deliveredAt: delivered.toISOString() };
  assert.equal(deliveryStampFor(iso).at.getTime(), delivered.getTime());
  ok('accepts ISO strings as well as Date objects (lean/JSON rows)');

  // A falsy-but-present deliveredAt must not be mistaken for a stamp.
  assert.equal(deliveryStampFor({ deliveredAt: null, updatedAt: updated }).source, DELIVERY_STAMP_SOURCE.UPDATED_AT);
  ok('an explicit null deliveredAt falls through rather than becoming epoch 0');
}

// ---------------------------------------------------------------------------
// 8. windowHoursFor is the single mapping the callers share
// ---------------------------------------------------------------------------
{
  assert.equal(windowHoursFor(RETURN_CLAIM_TYPE.INSTANT_CLAIM), INSTANT_CLAIM_WINDOW_HOURS);
  assert.equal(windowHoursFor(RETURN_CLAIM_TYPE.PICKUP_QC), RETURN_WINDOW_DAYS * 24);
  assert.equal(RETURN_WINDOW_DAYS, 7);
  assert.equal(INSTANT_CLAIM_WINDOW_HOURS, 24);
  ok('windowHoursFor maps claim type → hours (7d / 24h)');
}

// ---------------------------------------------------------------------------
// 9. the clock is injectable and the function is pure
// ---------------------------------------------------------------------------
{
  const now = new Date('2026-09-10T10:00:00Z');
  const a = returnWindow(order, { now });
  const b = returnWindow(order, { now });
  assert.deepEqual(a, b, 'same inputs → identical output');
  // numeric epoch and Date are interchangeable
  assert.deepEqual(returnWindow(order, { now: now.getTime() }), a);
  ok('pure: identical output for identical inputs, Date or epoch clock');
}

console.log(`\nRETURN WINDOW: all ${pass} scenarios passed ✔`);
