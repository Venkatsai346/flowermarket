/**
 * money.test.js — PURE unit tests for the Phase 6.1 money core.
 *
 * No database, no network: this file runs anywhere, in milliseconds, and is
 * the regression gate for the arithmetic that every rupee in the platform
 * depends on.
 *
 *   node scripts/money.test.js
 *
 * Style matches the existing smoke suites: hand-rolled assertions, numbered
 * checks, loud summary, non-zero exit on failure.
 */

import {
  toPaise, fromPaise, sumPaise, allocatePaise, splitTaxPaise, applyBps, roundMoney,
} from '../src/utils/money.js';
import ledgerPostingService from '../src/services/ledgerPosting.service.js';
import { ledgerAccounts } from '../src/services/ledger.service.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('1. toPaise / fromPaise — the float boundary');
// ---------------------------------------------------------------------------

eq('₹19.99 → 1999 paise (no float artefact)', toPaise(19.99), 1999);
eq('₹0.1 + ₹0.2 style input rounds correctly', toPaise(0.1 + 0.2), 30);
eq('₹1234.565 → 123457 (half-up on the scaled value)', toPaise(1234.565), 123457);
eq('₹0 → 0', toPaise(0), 0);
eq('negative rupees survive', toPaise(-12.34), -1234);
eq('round-trip 590 → 59000 → 590', fromPaise(toPaise(590)), 590);
eq('round-trip of an odd amount', fromPaise(toPaise(100.01)), 100.01);
check('toPaise rejects garbage', (() => {
  try { toPaise('abc'); return false; } catch { return true; }
})());

// the classic float failure the paise representation exists to prevent
const floatSum = roundMoney(0.1 + 0.2 + 0.3 - 0.6);
const paiseSum = sumPaise(toPaise(0.1), toPaise(0.2), toPaise(0.3), -toPaise(0.6));
eq('float pipeline rounds 0.1+0.2+0.3−0.6 to 0', floatSum, 0);
eq('paise pipeline is exactly 0', paiseSum, 0);

// ---------------------------------------------------------------------------
section('2. allocatePaise — the invariant that protects every split');
// ---------------------------------------------------------------------------

eq('sum of a 3-way split of 100 equals 100',
  sumPaise(...allocatePaise(100, [1, 1, 1])), 100);
check('3-way split of 100 is [34,33,33] (deterministic, largest-remainder first)',
  JSON.stringify(allocatePaise(100, [1, 1, 1])) === JSON.stringify([34, 33, 33]),
  JSON.stringify(allocatePaise(100, [1, 1, 1])));

eq('weighted split respects the weights',
  JSON.stringify(allocatePaise(1000, [700, 300])), JSON.stringify([700, 300]));

eq('zero-weight lines take no share',
  JSON.stringify(allocatePaise(500, [100, 0, 100])), JSON.stringify([250, 0, 250]));

eq('negative total (a refund reversal) keeps its sign',
  sumPaise(...allocatePaise(-100, [1, 1, 1])), -100);
check('negative split has no mixed signs',
  allocatePaise(-100, [1, 1, 1]).every((p) => p <= 0),
  JSON.stringify(allocatePaise(-100, [1, 1, 1])));

eq('all-zero weights put the whole amount on the first slot (nothing is lost)',
  sumPaise(...allocatePaise(77, [0, 0, 0])), 77);
eq('empty weights → empty result', allocatePaise(100, []).length, 0);
eq('zero total → all zeroes', sumPaise(...allocatePaise(0, [5, 5])), 0);

check('deterministic: same input twice gives the same split',
  JSON.stringify(allocatePaise(1000, [333, 333, 334])) === JSON.stringify(allocatePaise(1000, [333, 333, 334])));

// ---- the fuzz invariant: 10 000 random cases, never lose or invent a paisa ----
let fuzzFailures = 0;
let worstSpread = 0;
for (let i = 0; i < 10000; i += 1) {
  const total = Math.floor(Math.random() * 2_000_000) - 500_000; // −₹5k … ₹15k
  const n = 1 + Math.floor(Math.random() * 12);
  const weights = Array.from({ length: n }, () => Math.floor(Math.random() * 100000));
  const parts = allocatePaise(total, weights);
  const sum = sumPaise(...parts);
  if (sum !== total) fuzzFailures += 1;
  if (parts.some((p) => (total >= 0 ? p < 0 : p > 0))) fuzzFailures += 1;
  const spread = parts.length ? Math.max(...parts) - Math.min(...parts) : 0;
  worstSpread = Math.max(worstSpread, spread);
}
eq('fuzz: 10 000 random allocations all sum exactly and never flip sign', fuzzFailures, 0);

// ---------------------------------------------------------------------------
section('3. splitTaxPaise — CGST + SGST must equal the tax, always');
// ---------------------------------------------------------------------------

eq('even tax splits evenly', JSON.stringify(splitTaxPaise(9000)), JSON.stringify([4500, 4500]));
eq('odd tax: the extra paisa goes to SGST', JSON.stringify(splitTaxPaise(477)), JSON.stringify([238, 239]));
eq('1 paisa of tax', JSON.stringify(splitTaxPaise(1)), JSON.stringify([0, 1]));
eq('zero tax (nil-rated supply)', JSON.stringify(splitTaxPaise(0)), JSON.stringify([0, 0]));

let splitFailures = 0;
for (let t = 0; t < 5000; t += 1) {
  const [c, s] = splitTaxPaise(t);
  if (c + s !== t) splitFailures += 1;
}
eq('exhaustive: CGST+SGST === tax for 0…4999 paise', splitFailures, 0);

// ---------------------------------------------------------------------------
section('4. applyBps — commission / TCS / TDS');
// ---------------------------------------------------------------------------

eq('10% of ₹5000 = ₹500', applyBps(toPaise(5000), 1000), toPaise(500));
eq('1% (100 bps) of ₹5900 = ₹59', applyBps(toPaise(5900), 100), toPaise(59));
eq('0.5% TCS of ₹5000 taxable = ₹25', applyBps(toPaise(5000), 50), toPaise(25));
eq('0.1% TDS of ₹5900 gross = ₹5.90', applyBps(toPaise(5900), 10), toPaise(5.9));
eq('0 bps = 0', applyBps(toPaise(999), 0), 0);
eq('symmetric for negatives (refund reversal)', applyBps(-toPaise(5000), 1000), -toPaise(500));

// ---------------------------------------------------------------------------
section('5. buildSaleLines — the sale journal balances by construction');
// ---------------------------------------------------------------------------

const VENDOR_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TENANT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

/** Mirrors what the Phase 3.5 pricing engine persists on Order/OrderItem. */
function buildFixture({ withVendor = true, discount = 0 } = {}) {
  const lineTotal = 5000;          // 10 × ₹500
  const taxAmount = 900;           // 18% (legacy exclusive pipeline)
  const deliveryFee = 49;
  const order = {
    _id: 'cccccccccccccccccccccccc',
    tenantId: TENANT_ID,
    orderNumber: 'FM-260902-00001',
    deliveryFee,
    totalAmount: roundMoney(lineTotal + taxAmount - discount + deliveryFee),
    paymentMethod: 'upi',
    paymentSummary: { paidAt: new Date() },
  };
  const items = [{
    _id: 'dddddddddddddddddddddddd',
    lineTotal,
    taxAmount,
    discountAllocated: discount,
    vendorId: withVendor ? VENDOR_ID : null,
    skuSnapshot: { title: 'Red Rose Bouquet' },
    hsnCode: '0603',
  }];
  return { order, items };
}

const vendorCache = new Map([[VENDOR_ID, 1000]]); // 10% commission

{
  const { order, items } = buildFixture();
  const { lines } = await ledgerPostingService.buildSaleLines({ order, items, vendorCache });

  const debits = sumPaise(...lines.map((l) => l.debitPaise || 0));
  const credits = sumPaise(...lines.map((l) => l.creditPaise || 0));
  const byAccount = Object.fromEntries(
    lines.map((l) => [l.accountCode, (l.creditPaise || 0) - (l.debitPaise || 0)])
  );

  eq('journal balances (debits === credits)', debits, credits);
  eq('debit side is exactly what the customer paid', debits, toPaise(order.totalAmount));
  eq('vendor payable = net ₹5000 − 10% commission = ₹4500',
    byAccount[ledgerAccounts.vendorPayable(VENDOR_ID)], toPaise(4500));
  eq('platform commission income = ₹500',
    byAccount[ledgerAccounts.commissionIncome()], toPaise(500));
  eq('GST output payable (vendor-scoped) = ₹900',
    byAccount[ledgerAccounts.gstOutputPayable(VENDOR_ID)], toPaise(900));
  eq('delivery fee credited to the store = ₹49',
    byAccount[ledgerAccounts.tenantPayable(TENANT_ID)], toPaise(49));
  check('no rounding-difference line needed on clean numbers',
    byAccount[ledgerAccounts.roundingDifference()] === undefined);
}

{
  // store's own inventory: no per-order commission (billed monthly — see the
  // service header), so the whole net goes to the store payable
  const { order, items } = buildFixture({ withVendor: false });
  const { lines } = await ledgerPostingService.buildSaleLines({ order, items, vendorCache });
  const byAccount = {};
  for (const l of lines) {
    byAccount[l.accountCode] = (byAccount[l.accountCode] || 0) + ((l.creditPaise || 0) - (l.debitPaise || 0));
  }
  eq('store-owned line: no commission accrued',
    byAccount[ledgerAccounts.commissionIncome()] || 0, 0);
  eq('store payable = net ₹5000 + delivery ₹49',
    byAccount[ledgerAccounts.tenantPayable(TENANT_ID)], toPaise(5049));
  eq('still balances',
    sumPaise(...lines.map((l) => l.debitPaise || 0)),
    sumPaise(...lines.map((l) => l.creditPaise || 0)));
}

{
  // a coupon discount reduces the seller's net, not the tax that was charged
  const { order, items } = buildFixture({ discount: 250 });
  const { lines } = await ledgerPostingService.buildSaleLines({ order, items, vendorCache });
  const byAccount = {};
  for (const l of lines) {
    byAccount[l.accountCode] = (byAccount[l.accountCode] || 0) + ((l.creditPaise || 0) - (l.debitPaise || 0));
  }
  eq('discounted net ₹4750 − 10% = ₹4275 to the vendor',
    byAccount[ledgerAccounts.vendorPayable(VENDOR_ID)], toPaise(4275));
  eq('commission on the discounted net = ₹475',
    byAccount[ledgerAccounts.commissionIncome()], toPaise(475));
  eq('balances with a discount applied',
    sumPaise(...lines.map((l) => l.debitPaise || 0)),
    sumPaise(...lines.map((l) => l.creditPaise || 0)));
}

{
  // an order whose parts genuinely don't add up must be rejected, not silently
  // absorbed — the tolerance is only for sub-rupee legacy float artefacts
  const { order, items } = buildFixture();
  order.totalAmount = roundMoney(order.totalAmount + 25); // ₹25 unexplained
  let threw = null;
  try {
    await ledgerPostingService.buildSaleLines({ order, items, vendorCache });
  } catch (err) { threw = err; }
  check('a ₹25 mismatch throws LEDGER_ORDER_TOTAL_MISMATCH',
    threw?.code === 'LEDGER_ORDER_TOTAL_MISMATCH', threw?.code || 'no error thrown');
}

{
  // a 1-paisa artefact is parked on the rounding account, keeping the journal
  // balanced while staying visible in reporting
  const { order, items } = buildFixture();
  order.totalAmount = roundMoney(order.totalAmount + 0.01);
  const { lines } = await ledgerPostingService.buildSaleLines({ order, items, vendorCache });
  const rounding = lines.find((l) => l.accountCode === ledgerAccounts.roundingDifference());
  check('1 paisa artefact lands on rounding_difference', Boolean(rounding));
  eq('rounding line carries exactly 1 paisa', rounding?.creditPaise, 1);
  eq('journal still balances',
    sumPaise(...lines.map((l) => l.debitPaise || 0)),
    sumPaise(...lines.map((l) => l.creditPaise || 0)));
}

{
  // a discount larger than the line is a data bug, not a negative payable
  const { order, items } = buildFixture();
  items[0].discountAllocated = 6000;
  order.totalAmount = roundMoney(5000 + 900 - 6000 + 49);
  let threw = null;
  try {
    await ledgerPostingService.buildSaleLines({ order, items, vendorCache });
  } catch (err) { threw = err; }
  check('over-discounted line throws LEDGER_NEGATIVE_LINE',
    threw?.code === 'LEDGER_NEGATIVE_LINE', threw?.code || 'no error thrown');
}

// ---------------------------------------------------------------------------
section('6. multi-vendor order — every seller gets exactly their share');
// ---------------------------------------------------------------------------

{
  const V1 = '111111111111111111111111';
  const V2 = '222222222222222222222222';
  const cache = new Map([[V1, 1000], [V2, 250]]); // 10% and 2.5%
  const order = {
    _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
    tenantId: TENANT_ID,
    orderNumber: 'FM-260902-00002',
    deliveryFee: 0,
    totalAmount: roundMoney(333.33 + 666.67 + 60 + 120),
    paymentSummary: {},
  };
  const items = [
    { _id: '333333333333333333333333', lineTotal: 333.33, taxAmount: 60, discountAllocated: 0, vendorId: V1, skuSnapshot: { title: 'A' } },
    { _id: '444444444444444444444444', lineTotal: 666.67, taxAmount: 120, discountAllocated: 0, vendorId: V2, skuSnapshot: { title: 'B' } },
  ];
  const { lines } = await ledgerPostingService.buildSaleLines({ order, items, vendorCache: cache });
  const byAccount = {};
  for (const l of lines) {
    byAccount[l.accountCode] = (byAccount[l.accountCode] || 0) + ((l.creditPaise || 0) - (l.debitPaise || 0));
  }
  eq('vendor 1 payable = ₹333.33 − 10% = ₹300.00 (33333 − 3333 paise)',
    byAccount[ledgerAccounts.vendorPayable(V1)], 30000);
  eq('vendor 2 payable = ₹666.67 − 2.5% = ₹650.00 (66667 − 1667 paise)',
    byAccount[ledgerAccounts.vendorPayable(V2)], 65000);
  eq('commission income = ₹33.33 + ₹16.67 = ₹50.00',
    byAccount[ledgerAccounts.commissionIncome()], 5000);
  eq('each vendor gets their own GST liability account (V1)',
    byAccount[ledgerAccounts.gstOutputPayable(V1)], toPaise(60));
  eq('each vendor gets their own GST liability account (V2)',
    byAccount[ledgerAccounts.gstOutputPayable(V2)], toPaise(120));
  eq('multi-vendor journal balances to the paisa',
    sumPaise(...lines.map((l) => l.debitPaise || 0)),
    sumPaise(...lines.map((l) => l.creditPaise || 0)));
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`money core: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ all money-core invariants hold\n');
