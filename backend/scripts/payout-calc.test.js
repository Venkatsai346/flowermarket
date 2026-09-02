/**
 * payout-calc.test.js — PURE vendor-payout arithmetic (Phase 6.3 / M4).
 *
 *   node scripts/payout-calc.test.js
 *
 * No database. The worked example from the Phase 6 blueprint is asserted to
 * the paisa here, because a vendor payout is exactly the number a seller will
 * check by hand — and if they can check it, so can a test.
 */

import { computeLineFinancials, DEFAULT_POLICY } from '../src/services/payout.service.js';
import { assertTransition, canTransition, PAYOUT_TRANSITIONS } from '../src/utils/payoutStateMachine.js';
import { toPaise, fromPaise, sumPaise } from '../src/utils/money.js';
import { PAYOUT_STATE } from '../src/constants/enums.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const eqRs = (name, actualPaise, expectedRupees) =>
  check(name, actualPaise === toPaise(expectedRupees), `expected ₹${expectedRupees}, got ₹${fromPaise(actualPaise)}`);
const section = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------------------
section('1. THE worked example — 10 bouquets @ ₹590 (18% GST), 10% commission');
// ---------------------------------------------------------------------------
{
  const r = computeLineFinancials({
    lineTotalPaise: toPaise(5000),   // 10 × ₹500 ex-GST
    discountPaise: 0,
    sellerGstPaise: toPaise(900),    // 18%
    commissionRateBps: 1000,         // 10%
    commissionGstBps: 1800,          // 18% GST on our commission service
    tcsRateBps: 50,                  // 0.50% TCS u/s 52 (from statutoryrates)
    tdsRateBps: 10,                  // 0.10% TDS u/s 194-O
  });

  eqRs('gross the customer paid = ₹5900.00', r.grossPaise, 5900);
  eqRs('taxable value = ₹5000.00', r.taxableValuePaise, 5000);
  eqRs("seller's GST (they deposit it) = ₹900.00", r.sellerGstPaise, 900);
  eqRs('commission @10% of taxable = ₹500.00', r.commissionPaise, 500);
  eqRs('GST on commission @18% = ₹90.00', r.gstOnCommissionPaise, 90);
  eqRs('TCS @0.50% of taxable = ₹25.00', r.tcsPaise, 25);
  eqRs('TDS @0.10% of gross = ₹5.90', r.tdsPaise, 5.9);
  eqRs('★ NET PAYABLE TO VENDOR = ₹5279.10', r.netPayablePaise, 5279.1);

  // the identity the ledger journal depends on
  eq('net + commission + gstOnComm + tcs + tds === gross',
    sumPaise(r.netPayablePaise, r.commissionPaise, r.gstOnCommissionPaise, r.tcsPaise, r.tdsPaise),
    r.grossPaise);
}

// ---------------------------------------------------------------------------
section('2. discounts, nil-rated goods and disabled deductions');
// ---------------------------------------------------------------------------
{
  const r = computeLineFinancials({
    lineTotalPaise: toPaise(5000), discountPaise: toPaise(500),
    sellerGstPaise: toPaise(810), commissionRateBps: 1000,
    commissionGstBps: 1800, tcsRateBps: 50, tdsRateBps: 10,
  });
  eqRs('commission is charged on the DISCOUNTED value (₹4500)', r.commissionPaise, 450);
  eqRs('gross = 4500 + 810 = ₹5310', r.grossPaise, 5310);
  eq('identity still holds with a discount',
    sumPaise(r.netPayablePaise, r.commissionPaise, r.gstOnCommissionPaise, r.tcsPaise, r.tdsPaise),
    r.grossPaise);
}
{
  // fresh flowers: nil-rated, so there is no seller GST at all
  const r = computeLineFinancials({
    lineTotalPaise: toPaise(1000), sellerGstPaise: 0,
    commissionRateBps: 800, commissionGstBps: 1800, tcsRateBps: 50, tdsRateBps: 10,
  });
  eqRs('nil-rated line: gross === taxable = ₹1000', r.grossPaise, 1000);
  eqRs('commission @8% = ₹80', r.commissionPaise, 80);
  eqRs('GST on commission still applies = ₹14.40', r.gstOnCommissionPaise, 14.4);
  eqRs('net = 1000 − 80 − 14.40 − 5 − 1 = ₹899.60', r.netPayablePaise, 899.6);
}
{
  const r = computeLineFinancials({
    lineTotalPaise: toPaise(1000), sellerGstPaise: toPaise(180),
    commissionRateBps: 1000, tcsRateBps: 50, tdsRateBps: 10,
    deductions: { commission: true, gstOnCommission: false, tcs: false, tds: false },
  });
  eq('disabled deductions really are zero', r.gstOnCommissionPaise + r.tcsPaise + r.tdsPaise, 0);
  eqRs('only commission is withheld', r.netPayablePaise, 1080);
}

// ---------------------------------------------------------------------------
section('3. reversals are the exact negative of the original');
// ---------------------------------------------------------------------------
{
  const args = {
    lineTotalPaise: toPaise(5000), sellerGstPaise: toPaise(900),
    commissionRateBps: 1000, commissionGstBps: 1800, tcsRateBps: 50, tdsRateBps: 10,
  };
  const fwd = computeLineFinancials(args);
  const rev = computeLineFinancials({ ...args, sign: -1 });
  eq('every field negates exactly',
    Object.keys(fwd).filter((k) => k.endsWith('Paise')).every((k) => fwd[k] === -rev[k]), true);
  eq('a line and its reversal sum to zero', sumPaise(fwd.netPayablePaise, rev.netPayablePaise), 0);
}

// ---------------------------------------------------------------------------
section('4. guards');
// ---------------------------------------------------------------------------
{
  let threw = null;
  try {
    computeLineFinancials({ lineTotalPaise: toPaise(100), discountPaise: toPaise(200), commissionRateBps: 0 });
  } catch (e) { threw = e; }
  eq('a discount larger than the line is refused', threw?.code, 'PAYOUT_NEGATIVE_LINE');

  const zero = computeLineFinancials({ lineTotalPaise: 0, sellerGstPaise: 0, commissionRateBps: 1000 });
  eq('a zero line produces a zero payout', zero.netPayablePaise, 0);
}

// ---------------------------------------------------------------------------
section('5. paisa-exactness across a whole cycle (fuzz)');
// ---------------------------------------------------------------------------
{
  let identityBreaks = 0;
  let negatives = 0;
  for (let i = 0; i < 20000; i += 1) {
    const lineTotal = Math.floor(Math.random() * 2_000_00) + 1;
    const discount = Math.floor(Math.random() * lineTotal);
    const gstRate = [0, 500, 1200, 1800][Math.floor(Math.random() * 4)];
    const taxable = lineTotal - discount;
    const gst = Math.round((taxable * gstRate) / 10000);
    const r = computeLineFinancials({
      lineTotalPaise: lineTotal, discountPaise: discount, sellerGstPaise: gst,
      commissionRateBps: Math.floor(Math.random() * 3000),
      commissionGstBps: 1800, tcsRateBps: 50, tdsRateBps: 10,
    });
    if (sumPaise(r.netPayablePaise, r.commissionPaise, r.gstOnCommissionPaise, r.tcsPaise, r.tdsPaise) !== r.grossPaise) {
      identityBreaks += 1;
    }
    // a >100% commission is the only way net can go negative; flag anything else
    if (r.netPayablePaise < 0 && r.commissionPaise <= r.taxableValuePaise) negatives += 1;
  }
  eq('20 000 random lines: deductions always sum back to gross', identityBreaks, 0);
  eq('20 000 random lines: no unexplained negative payout', negatives, 0);
}

// ---------------------------------------------------------------------------
section('6. the batch state machine');
// ---------------------------------------------------------------------------
check('draft → pending_approval', canTransition(PAYOUT_STATE.DRAFT, PAYOUT_STATE.PENDING_APPROVAL));
check('pending_approval → approved', canTransition(PAYOUT_STATE.PENDING_APPROVAL, PAYOUT_STATE.APPROVED));
check('approved → queued → processing',
  canTransition(PAYOUT_STATE.APPROVED, PAYOUT_STATE.QUEUED)
  && canTransition(PAYOUT_STATE.QUEUED, PAYOUT_STATE.PROCESSING));
check('processing → paid', canTransition(PAYOUT_STATE.PROCESSING, PAYOUT_STATE.PAID));
check('processing → failed', canTransition(PAYOUT_STATE.PROCESSING, PAYOUT_STATE.FAILED));
check('failed → queued (a clean rejection is safe to retry)',
  canTransition(PAYOUT_STATE.FAILED, PAYOUT_STATE.QUEUED));
check('paid → reversed (bank returned it)', canTransition(PAYOUT_STATE.PAID, PAYOUT_STATE.REVERSED));

check('★ processing CANNOT go back to queued — an in-flight payout is resolved by reconciliation, never by a retry',
  !canTransition(PAYOUT_STATE.PROCESSING, PAYOUT_STATE.QUEUED));
check('processing cannot be cancelled', !canTransition(PAYOUT_STATE.PROCESSING, PAYOUT_STATE.CANCELLED));
check('draft cannot skip straight to paid', !canTransition(PAYOUT_STATE.DRAFT, PAYOUT_STATE.PAID));
check('approved cannot skip queued', !canTransition(PAYOUT_STATE.APPROVED, PAYOUT_STATE.PROCESSING));
check('paid cannot be re-paid', !canTransition(PAYOUT_STATE.PAID, PAYOUT_STATE.PAID));
check('reversed is terminal', PAYOUT_TRANSITIONS[PAYOUT_STATE.REVERSED].length === 0);
check('cancelled is terminal', PAYOUT_TRANSITIONS[PAYOUT_STATE.CANCELLED].length === 0);

{
  let threw = null;
  try { assertTransition(PAYOUT_STATE.PAID, PAYOUT_STATE.QUEUED); } catch (e) { threw = e; }
  eq('an illegal transition throws INVALID_PAYOUT_TRANSITION', threw?.code, 'INVALID_PAYOUT_TRANSITION');
  check('the error lists what WAS allowed', Array.isArray(threw?.details?.allowed));
}

// every state must be reachable, or it is dead configuration
{
  const reachable = new Set([PAYOUT_STATE.DRAFT]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const from of [...reachable]) {
      for (const to of PAYOUT_TRANSITIONS[from] || []) {
        if (!reachable.has(to)) { reachable.add(to); grew = true; }
      }
    }
  }
  const all = Object.values(PAYOUT_STATE);
  const unreachable = all.filter((s) => !reachable.has(s));
  eq('every payout state is reachable from draft', unreachable.join(',') || 'none', 'none');
}

// ---------------------------------------------------------------------------
section('7. policy defaults are safe');
// ---------------------------------------------------------------------------
eq('return window defaults to 7 days', DEFAULT_POLICY.returnWindowDays, 7);
eq('perishables default to 1 day', DEFAULT_POLICY.perishableReturnWindowDays, 1);
check('a payout floor exists (no ₹3 bank transfers)', DEFAULT_POLICY.minPayoutPaise > 0);
check('dual approval kicks in on large batches', DEFAULT_POLICY.dualApprovalPaise > 0);
check('a per-batch ceiling limits the blast radius', DEFAULT_POLICY.maxBatchPaise > 0);
check('negative balances carry forward by default', DEFAULT_POLICY.negativeBalanceCarryForward === true);

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`payout engine: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ every payout identity holds\n');
