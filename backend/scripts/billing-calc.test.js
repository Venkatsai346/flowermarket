/**
 * billing-calc.test.js — PURE billing arithmetic (invoice totals, delinquency,
 * standing transitions, invoice-paid journal splits).
 *
 *   node scripts/billing-calc.test.js
 *
 * No database. The platform's own money — fee + commission + GST — is exactly
 * what finance will check by hand, so every branch of the hardening is locked
 * here: signed adjustments, GST, the single-grace delinquency predicate, the
 * zero-delinquents standing rule, and the journal split (including the
 * oversized-credit and pre-GST legs).
 */

import assert from 'node:assert/strict';
import {
  isInvoiceDelinquent,
  standingFor,
  computeInvoiceTotals,
} from '../src/services/billing.service.js';
import { splitInvoicePaise } from '../src/services/ledgerPosting.service.js';

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  PASS  ${label}`); };

// ---------------- computeInvoiceTotals ----------------
{
  // standard: Pro fee + commission + 18% GST
  const t = computeInvoiceTotals({ fee: 999, commission: 2000, adjustmentSigned: 0, gstBps: 1800 });
  assert.equal(t.taxable, 2999);
  assert.equal(t.gst, 539.82);
  assert.equal(t.total, 3538.82);
  ok('totals: 999 + 2000 + 18% GST = 3538.82');
}
{
  // trial: fee waived, commission still taxable
  const t = computeInvoiceTotals({ fee: 0, commission: 500, adjustmentSigned: 0, gstBps: 1800 });
  assert.equal(t.taxable, 500);
  assert.equal(t.gst, 90);
  assert.equal(t.total, 590);
  ok('totals: trial commission taxed, fee waived');
}
{
  // upgrade pro-rata: GST applies to the adjustment too
  const t = computeInvoiceTotals({ fee: 999, commission: 100, adjustmentSigned: 200, gstBps: 1800 });
  assert.equal(t.taxable, 1299);
  assert.equal(t.gst, 233.82);
  assert.equal(t.total, 1532.82);
  ok('totals: upgrade adjustment increases taxable + GST (no double count)');
}
{
  // downgrade pro-rata: a CREDIT shrinks the taxable value (never below zero)
  const t = computeInvoiceTotals({ fee: 999, commission: 100, adjustmentSigned: -200, gstBps: 1800 });
  assert.equal(t.taxable, 899);
  assert.equal(t.gst, 161.82);
  assert.equal(t.total, 1060.82);
  ok('totals: downgrade credit shrinks taxable + GST');
}
{
  // oversized credit: floored at zero, never negative
  const t = computeInvoiceTotals({ fee: 999, commission: 100, adjustmentSigned: -5000, gstBps: 1800 });
  assert.equal(t.taxable, 0);
  assert.equal(t.gst, 0);
  assert.equal(t.total, 0);
  ok('totals: oversized credit floors at zero (auto-pay, no journal)');
}
{
  // GST disabled by config: clean pre-GST totals
  const t = computeInvoiceTotals({ fee: 999, commission: 2000, adjustmentSigned: 0, gstBps: 0 });
  assert.deepEqual(t, { taxable: 2999, gst: 0, total: 2999 });
  ok('totals: gstBps 0 disables the GST leg');
}

// ---------------- isInvoiceDelinquent ----------------
{
  const past = new Date(Date.now() - 86400000);
  const future = new Date(Date.now() + 86400000);
  assert.equal(isInvoiceDelinquent({ status: 'overdue', dueAt: future }), true);
  assert.equal(isInvoiceDelinquent({ status: 'open', dueAt: past }), true);
  assert.equal(isInvoiceDelinquent({ status: 'open', dueAt: future }), false);
  assert.equal(isInvoiceDelinquent({ status: 'open', dueAt: null }), false);
  assert.equal(isInvoiceDelinquent({ status: 'paid', dueAt: past }), false);
  assert.equal(isInvoiceDelinquent({ status: 'void', dueAt: past }), false);
  assert.equal(isInvoiceDelinquent({ status: 'draft', dueAt: past }), false);
  assert.equal(isInvoiceDelinquent(null), false);
  ok('delinquency: overdue always; open only past dueAt (single grace)');
}

// ---------------- standingFor ----------------
{
  assert.equal(standingFor({ currentStatus: 'active', delinquentCount: 2 }), 'past_due');
  assert.equal(standingFor({ currentStatus: 'trial', delinquentCount: 1 }), 'past_due');
  assert.equal(standingFor({ currentStatus: 'past_due', delinquentCount: 0 }), 'active');
  assert.equal(standingFor({ currentStatus: 'active', delinquentCount: 0 }), 'active');
  // the closed loophole: one remaining delinquent keeps the block
  assert.equal(standingFor({ currentStatus: 'past_due', delinquentCount: 1 }), 'past_due');
  assert.equal(standingFor({ currentStatus: 'past_due', delinquentCount: 3 }), 'past_due');
  // cancelled is terminal in both directions
  assert.equal(standingFor({ currentStatus: 'cancelled', delinquentCount: 5 }), 'cancelled');
  assert.equal(standingFor({ currentStatus: 'cancelled', delinquentCount: 0 }), 'cancelled');
  ok('standing: debt→past_due, zero debt→active, cancelled terminal');
}

// ---------------- splitInvoicePaise ----------------
{
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 999 },
      { type: 'commission', amount: 2000 },
      { type: 'gst', amount: 539.82 },
    ],
    total: 3538.82,
  });
  assert.equal(s.totalPaise, 353882);
  assert.equal(s.subscriptionPaise, 99900);
  assert.equal(s.commissionPaise, 200000);
  assert.equal(s.gstPaise, 53982);
  assert.equal(s.adjustmentSignedPaise, 0);
  assert.equal(s.subscriptionPaise + s.commissionPaise + s.gstPaise, s.totalPaise);
  ok('split: standard invoice legs sum to the total exactly');
}
{
  // upgrade: signed adjustment derived from the total, attributed to fee leg
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 999 },
      { type: 'commission', amount: 100 },
      { type: 'adjustment', amount: 200 },
      { type: 'gst', amount: 233.82 },
    ],
    total: 1532.82,
  });
  assert.equal(s.adjustmentSignedPaise, 20000);
  assert.equal(s.subscriptionPaise, 119900);
  assert.equal(s.commissionPaise, 10000);
  assert.equal(s.subscriptionPaise + s.commissionPaise + s.gstPaise, s.totalPaise);
  ok('split: upgrade adjustment derived + attributed to the fee leg');
}
{
  // downgrade: credit shrinks the fee leg, commission untouched
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 999 },
      { type: 'commission', amount: 100 },
      { type: 'adjustment', amount: 200 },
      { type: 'gst', amount: 161.82 },
    ],
    total: 1060.82,
  });
  assert.equal(s.adjustmentSignedPaise, -20000);
  assert.equal(s.subscriptionPaise, 79900);
  assert.equal(s.commissionPaise, 10000);
  assert.equal(s.subscriptionPaise + s.commissionPaise + s.gstPaise, s.totalPaise);
  ok('split: downgrade credit shrinks only the fee leg');
}
{
  // oversized credit: fee leg floors at zero, commission absorbs the rest
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 999 },
      { type: 'commission', amount: 10000 },
      { type: 'adjustment', amount: 5000 },
      { type: 'gst', amount: 1079.82 },
    ],
    total: 7078.82,
  });
  assert.equal(s.adjustmentSignedPaise, -500000);
  assert.equal(s.subscriptionPaise, 0);
  assert.equal(s.commissionPaise, 599900);
  assert.ok(s.subscriptionPaise >= 0 && s.commissionPaise >= 0 && s.gstPaise >= 0);
  assert.equal(s.subscriptionPaise + s.commissionPaise + s.gstPaise, s.totalPaise);
  ok('split: oversized credit never drives a leg negative');
}
{
  // pre-GST invoice (no GST line): identical split with gst 0
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 999 },
      { type: 'commission', amount: 2000 },
    ],
    total: 2999,
  });
  assert.equal(s.gstPaise, 0);
  assert.equal(s.subscriptionPaise, 99900);
  assert.equal(s.commissionPaise, 200000);
  assert.equal(s.subscriptionPaise + s.commissionPaise + s.gstPaise, s.totalPaise);
  ok('split: pre-GST invoices backfill cleanly');
}
{
  // zero-value: every leg zero (the poster skips the journal)
  const s = splitInvoicePaise({
    lineItems: [
      { type: 'subscription', amount: 0 },
      { type: 'commission', amount: 0 },
    ],
    total: 0,
  });
  assert.deepEqual(
    [s.totalPaise, s.subscriptionPaise, s.commissionPaise, s.gstPaise],
    [0, 0, 0, 0]
  );
  ok('split: zero-value invoice has no legs (no journal)');
}

console.log(`\nBILLING CALC: all ${passed} scenarios passed ✔\n`);
