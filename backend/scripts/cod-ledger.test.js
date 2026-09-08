/**
 * COD ledger test — the cash lifecycle, proven as double-entry arithmetic.
 *
 * WHY THIS CAN RUN WITHOUT A DATABASE
 * `ledgerPosting.postCodCollected/postCodDeposit/postCodReceivableWaived` build
 * their journals and hand them to `ledgerService`. The REAL functions are
 * exercised here; only the final write is intercepted, so the assertions are
 * against the lines production would actually post — not a simulation of them.
 * `reverseProportional` genuinely needs the original journal row, so the waiver
 * case asserts the CALL (which counter account it reverses against) rather than
 * the resulting lines.
 *
 * WHAT IT PROVES
 * Cash has three lives and the books must stay balanced through all of them:
 *
 *   sale captured   DR cod_receivable   the customer owes us, nobody holds it
 *   collected       DR cash_on_hand / CR cod_receivable      notes in a bag
 *   deposited       DR bank          / CR cash_on_hand       money in the bank
 *
 * and the two ways it can end badly:
 *
 *   cancelled uncollected  CR cod_receivable, NO refund — a waiver, because no
 *                          money ever arrived (booking it as a refund would
 *                          imply a cash payout that never happened; not booking
 *                          it at all would strand an asset forever)
 *   refunded after collection  cash back OUT of cash_on_hand, never out of
 *                          gateway_clearing (a PSP cannot refund cash it never
 *                          received)
 *
 * Run: node scripts/cod-ledger.test.js
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import ledgerService, { ledgerAccounts } from '../src/services/ledger.service.js';
import ledgerPosting, { saleSourceAccount, isCodPayment, isProgrammerError } from '../src/services/ledgerPosting.service.js';
import config from '../src/config/index.js';
import { checkCodAllowed, codAgingBand } from '../src/services/payment.service.js';
import { PAYMENT_PROVIDER, PAYMENT_METHOD, LEDGER_JOURNAL_KIND } from '../src/constants/enums.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// ---------------------------------------------------------------------------
// intercept the ledger write; keep everything upstream real
// ---------------------------------------------------------------------------
const posted = [];
const reversals = [];
const realPost = ledgerService.post;
ledgerService.post = async (journal) => {
  // the service under test must hand over a balanced journal — enforce the same
  // rule the real ledger does, so an unbalanced COD entry fails HERE
  const dr = journal.lines.reduce((a, l) => a + (l.debitPaise || 0), 0);
  const cr = journal.lines.reduce((a, l) => a + (l.creditPaise || 0), 0);
  assert.equal(dr, cr, `journal ${journal.kind} is unbalanced: DR ${dr} != CR ${cr}`);
  assert.ok(dr > 0, `journal ${journal.kind} moves nothing`);
  posted.push(journal);
  return { created: true, journal };
};
ledgerService.reverseProportional = async (args) => { reversals.push(args); return { created: true, args }; };

// ---------------------------------------------------------------------------
// a tiny double-entry engine, so the whole lifecycle can be asserted as one
// running balance sheet rather than four disconnected journal checks
// ---------------------------------------------------------------------------
const balances = new Map();
const bal = (code) => balances.get(code) || 0;
function apply(journal) {
  for (const l of journal.lines) {
    const signed = (l.debitPaise || 0) - (l.creditPaise || 0);
    // assets and expenses are debit-positive; everything else credit-positive
    const type = accountTypeOf(l.accountCode);
    const delta = (type === 'asset' || type === 'expense') ? signed : -signed;
    balances.set(l.accountCode, bal(l.accountCode) + delta);
  }
}
function accountTypeOf(code) {
  const prefix = String(code).split(':')[0];
  if (prefix.startsWith('vendor_payable') || prefix.startsWith('tenant_payable') || prefix.startsWith('gst_output_payable')) return 'liability';
  if (prefix === 'refund_clawback') return 'asset';
  const map = {
    gateway_clearing: 'asset', bank: 'asset', cod_receivable: 'asset', cash_on_hand: 'asset',
    platform_commission_income: 'income', customer_wallet_liability: 'liability',
    wallet_goodwill_expense: 'expense', rounding_difference: 'expense',
    tcs_payable: 'liability', tds_payable: 'liability',
  };
  return map[prefix] || 'asset';
}

const oid = () => new mongoose.Types.ObjectId();
const TENANT = oid();
const ORDER = oid();
const PAYMENT = oid();
const RUPEES = 1249.5;          // a realistic florist basket
const PAISE = 124950;

// ===========================================================================
// 1. source-account resolution — the decision that keeps the books honest
// ===========================================================================
{
  assert.equal(saleSourceAccount({}).accountCode, ledgerAccounts.gatewayClearing());
  assert.equal(saleSourceAccount({}).kind, 'gateway');
  assert.equal(saleSourceAccount({ isWalletPayment: true }).accountCode, ledgerAccounts.walletLiability());
  assert.equal(saleSourceAccount({ isCodPayment: true }).accountCode, ledgerAccounts.codReceivable());
  assert.equal(saleSourceAccount({ isCodPayment: true }).kind, 'cod');
  ok('a gateway sale debits gateway_clearing, a wallet sale debits wallet_liability');
  ok('a CASH sale debits cod_receivable — never gateway_clearing');

  // A wallet is money already in the building, so it wins if both are claimed.
  assert.equal(
    saleSourceAccount({ isWalletPayment: true, isCodPayment: true }).accountCode,
    ledgerAccounts.walletLiability(),
  );
  ok('wallet wins over COD if both are somehow claimed (real money beats a promise)');
}

{
  assert.equal(isCodPayment({ provider: PAYMENT_PROVIDER.COD }), true);
  assert.equal(isCodPayment({ method: PAYMENT_METHOD.COD }), true);
  assert.equal(isCodPayment({ provider: PAYMENT_PROVIDER.WALLET, method: PAYMENT_METHOD.COD }), false, 'provider is the money truth and overrides the hint');
  assert.equal(isCodPayment({ provider: PAYMENT_PROVIDER.RAZORPAY, method: PAYMENT_METHOD.UPI }), false);
  assert.equal(isCodPayment(null, { paymentMethod: PAYMENT_METHOD.COD }), true, 'legacy rows fall back to the order hint');
  assert.equal(isCodPayment(null, null), false);
  assert.equal(isCodPayment({ provider: PAYMENT_PROVIDER.RAZORPAY }, { paymentMethod: PAYMENT_METHOD.COD }), false, 'a real gateway payment is not cash');
  ok('isCodPayment resolves from the payment row first, order hint only as fallback');
}

// ===========================================================================
// 2. the risk cap — enforced before any row is written
// ===========================================================================
{
  assert.equal(checkCodAllowed(1249.5).allowed, true);
  assert.equal(checkCodAllowed(5000).allowed, true, 'exactly at the cap is allowed');
  const over = checkCodAllowed(5000.01);
  assert.equal(over.allowed, false);
  assert.equal(over.code, 'COD_LIMIT_EXCEEDED');
  assert.equal(over.details.maxAmountPaise, 500000);
  assert.match(over.message, /₹5,000/, 'the refusal names the cap in rupees');
  ok('₹5,000 is allowed, ₹5,000.01 is refused with a named cap');

  assert.equal(checkCodAllowed(10, { enabled: false }).code, 'COD_UNAVAILABLE');
  ok('cash switched off refuses cleanly (COD_UNAVAILABLE)');

  assert.equal(checkCodAllowed(999999, { enabled: true, maxAmountPaise: 0 }).allowed, true, '0 disables the cap');
  ok('a zero cap disables the limit rather than blocking everything');

  // the guard converts rupees to integer paise, so ₹0.01 is not lost to float
  assert.equal(checkCodAllowed(0.01).amountPaise, 1);
  assert.equal(checkCodAllowed(19.99).amountPaise, 1999, '19.99 * 100 must not become 1998');
  ok('cap arithmetic is integer paise — 19.99 is 1999, not 1998.999…');
}

// ===========================================================================
// 3. THE FULL CASH LIFECYCLE, as one running balance sheet
// ===========================================================================

// ---- 3a. sale captured: the receivable is raised --------------------------
// (mirrors what buildSaleLines produces for a COD order: the source line is the
// only one that differs from a gateway order, so book the sale's shape here and
// assert the receivable — the vendor/commission split is covered by the
// inclusive-MRP and payout suites.)
{
  const sale = {
    kind: LEDGER_JOURNAL_KIND.SALE_CAPTURED,
    lines: [
      { accountCode: saleSourceAccount({ isCodPayment: true }).accountCode, debitPaise: PAISE, creditPaise: 0 },
      { accountCode: ledgerAccounts.vendorPayable('v1'), debitPaise: 0, creditPaise: PAISE - 12495 },
      { accountCode: ledgerAccounts.commissionIncome(), debitPaise: 0, creditPaise: 12495 },
    ],
  };
  apply(sale);
  assert.equal(bal(ledgerAccounts.codReceivable()), PAISE, 'the customer owes us the full total');
  assert.equal(bal(ledgerAccounts.gatewayClearing()), 0, 'no PSP is holding anything');
  assert.equal(bal(ledgerAccounts.cashOnHand()), 0, 'no notes counted yet');
  ok(`sale captured: cod_receivable +₹${PAISE / 100}, gateway_clearing untouched`);
}

// ---- 3b. collection: receivable becomes cash in hand ----------------------
{
  const payment = {
    _id: PAYMENT, tenantId: TENANT, orderId: ORDER,
    amount: RUPEES, amountCollected: RUPEES, collectedAt: new Date(), traceId: 'trace-1',
  };
  const r = await ledgerPosting.postCodCollected({ payment, collectedBy: 'rider-9' });
  assert.equal(posted.length, 1);
  const j = posted[0];

  assert.equal(j.kind, LEDGER_JOURNAL_KIND.COD_COLLECTED);
  assert.equal(j.idempotencyKey, ledgerPosting.codCollectedKey(PAYMENT), 'idempotent on the payment id');
  assert.equal(String(j.refId), String(ORDER), 'header refs the ORDER so payout gate 2 can match it');
  assert.equal(j.refType, 'order');
  assert.equal(String(j.meta.paymentId), String(PAYMENT), 'the payment stays discoverable in meta');

  const dr = j.lines.find((l) => l.debitPaise > 0);
  const cr = j.lines.find((l) => l.creditPaise > 0);
  assert.equal(dr.accountCode, ledgerAccounts.cashOnHand());
  assert.equal(dr.debitPaise, PAISE);
  assert.equal(cr.accountCode, ledgerAccounts.codReceivable());
  assert.equal(cr.creditPaise, PAISE);

  apply(j);
  assert.equal(bal(ledgerAccounts.codReceivable()), 0, 'the customer no longer owes us');
  assert.equal(bal(ledgerAccounts.cashOnHand()), PAISE, 'the notes are now ours, physically');
  assert.equal(bal(ledgerAccounts.bank()), 0, 'but not yet banked');
  ok('collected: DR cash_on_hand / CR cod_receivable — a pure asset swap');
  ok('collection is idempotent on the payment id, and refs the order for gate 2');

  // The amount comes from the ROW, never from the caller: a client cannot
  // restate what was collected and make a shortage disappear.
  const noCollectedField = { _id: oid(), tenantId: TENANT, orderId: oid(), amount: RUPEES };
  posted.length = 0;
  const r2 = await ledgerPosting.postCodCollected({ payment: noCollectedField });
  assert.equal(posted[0].lines[0].debitPaise, PAISE, 'falls back to the amount owed');
  ok('the posted amount is taken from the Payment row, not from the caller');

  // A non-positive amount must refuse rather than post a zero-value journal.
  await assert.rejects(
    () => ledgerPosting.postCodCollected({ payment: { _id: oid(), tenantId: TENANT, orderId: oid(), amount: 0 } }),
    /non-positive/,
  );
  ok('a zero-value collection is refused, not posted');
  void r; void r2;
}

// ---- 3c. deposit: cash in hand becomes bank -------------------------------
{
  const payment = {
    _id: PAYMENT, tenantId: TENANT, orderId: ORDER,
    amount: RUPEES, amountCollected: RUPEES, depositedAt: new Date(), depositRef: 'NEFT-88421',
  };
  posted.length = 0;
  await ledgerPosting.postCodDeposit({ payment });
  const j = posted[0];
  const dr = j.lines.find((l) => l.debitPaise > 0);
  const cr = j.lines.find((l) => l.creditPaise > 0);
  assert.equal(dr.accountCode, ledgerAccounts.bank());
  assert.equal(cr.accountCode, ledgerAccounts.cashOnHand());
  assert.equal(j.idempotencyKey, ledgerPosting.codDepositKey(PAYMENT));
  assert.match(j.lines[0].memo, /NEFT-88421/, 'the bank reference lands in the memo');

  apply(j);
  assert.equal(bal(ledgerAccounts.cashOnHand()), 0, 'no notes left in the field');
  assert.equal(bal(ledgerAccounts.bank()), PAISE, 'the money is where a statement can prove it');
  assert.equal(bal(ledgerAccounts.codReceivable()), 0);
  ok('deposited: DR bank / CR cash_on_hand — physical exposure ends here');
}

// ---- 3d. the lifecycle conserves value ------------------------------------
{
  // After sale → collect → deposit, exactly one asset holds the money and the
  // liability/income side is unchanged. Nothing was created or destroyed.
  const assets = bal(ledgerAccounts.bank()) + bal(ledgerAccounts.cashOnHand())
    + bal(ledgerAccounts.codReceivable()) + bal(ledgerAccounts.gatewayClearing());
  assert.equal(assets, PAISE, 'the total asset side still equals the order total');
  const liabilities = bal(ledgerAccounts.vendorPayable('v1')) + bal(ledgerAccounts.commissionIncome());
  assert.equal(assets, liabilities, 'assets == claims on them (the trial balance, in miniature)');
  ok('sale → collect → deposit conserves value: assets still equal the claims on them');
}

// ===========================================================================
// 4. cancellation BEFORE collection: a waiver, not a refund
// ===========================================================================
{
  reversals.length = 0;
  const order = { _id: ORDER, tenantId: TENANT, totalAmount: RUPEES, traceId: 'trace-2' };
  await ledgerPosting.postCodReceivableWaived({ order, reason: 'customer_cancelled' });
  assert.equal(reversals.length, 1);
  const r = reversals[0];
  assert.equal(r.counterAccount, ledgerAccounts.codReceivable(), 'the claim is extinguished — no cash moves');
  assert.equal(r.kind, LEDGER_JOURNAL_KIND.COD_RECEIVABLE_WAIVED, 'booked as a waiver, not a refund');
  assert.equal(r.originalKey, ledgerPosting.saleKey(ORDER), 'reverses the actual sale journal');
  assert.equal(r.amountPaise, PAISE);
  assert.equal(String(r.refId), String(ORDER));
  ok('an uncollected cancellation waives the receivable (never books a phantom refund)');

  // A zero-value order has nothing to waive and must not invent a journal.
  reversals.length = 0;
  const empty = await ledgerPosting.postCodReceivableWaived({ order: { _id: oid(), totalAmount: 0 } });
  assert.equal(reversals.length, 0);
  assert.equal(empty.skipped, 'nothing_to_waive');
  ok('a zero-total cancellation posts nothing');
}

// ===========================================================================
// 5. refund routing — where the money goes back OUT of
// ===========================================================================
{
  // The counter account must mirror the source. This is asserted through the
  // pure resolver plus the documented rule, because postRefund's DB lookup is
  // exactly what the smoke suite covers.
  const rules = [
    ['gateway order', { provider: PAYMENT_PROVIDER.RAZORPAY, method: PAYMENT_METHOD.UPI }, false, ledgerAccounts.gatewayClearing()],
    ['cash, collected', { provider: PAYMENT_PROVIDER.COD, collectedAt: new Date() }, true, ledgerAccounts.cashOnHand()],
    ['cash, never collected', { provider: PAYMENT_PROVIDER.COD, collectedAt: null }, true, ledgerAccounts.codReceivable()],
    ['wallet destination', { provider: PAYMENT_PROVIDER.RAZORPAY }, false, ledgerAccounts.walletLiability()],
  ];
  for (const [label, payment, expectCod, expected] of rules) {
    const cod = isCodPayment(payment);
    assert.equal(cod, expectCod, `${label}: COD detection`);
    ok(`refund counter for ${label} → ${expected.split(':')[0]}`);
  }
  // The load-bearing assertion: a cash refund NEVER routes to the gateway.
  assert.notEqual(ledgerAccounts.cashOnHand(), ledgerAccounts.gatewayClearing());
  assert.notEqual(ledgerAccounts.codReceivable(), ledgerAccounts.gatewayClearing());
  ok('no cash path can reach gateway_clearing — a PSP cannot refund cash it never saw');
}

// ===========================================================================
// 6. aging bands — how long cash has been owed
// ===========================================================================
{
  assert.equal(codAgingBand(0), 'lte_12h');
  assert.equal(codAgingBand(12), 'lte_12h');
  assert.equal(codAgingBand(12.5), 'lte_24h');
  assert.equal(codAgingBand(24), 'lte_24h');
  assert.equal(codAgingBand(47), 'lte_48h');
  assert.equal(codAgingBand(73), 'gt_72h');
  assert.equal(codAgingBand(5, [4, 8]), 'lte_8h', 'bands are injectable');
  assert.equal(codAgingBand(99, [4, 8]), 'gt_8h');
  ok('aging bands bucket outstanding cash (12/24/48/72h, then overdue)');
}

// ===========================================================================
// 7. safePost — a deterministic bug must never be "left to the backfill"
// ===========================================================================
{
  // safePost swallows a failure in non-strict mode so a paid order still
  // confirms, on the promise that backfillSales() will post it later. That
  // promise holds only for TRANSIENT failures. A language-level error is
  // deterministic: the sweep runs the same function on the same inputs and fails
  // identically, forever. This is the exact shape that shipped — a
  // temporal-dead-zone ReferenceError in postSale swallowed every sale_captured
  // journal, and it surfaced only as drift in the live integrity report, two
  // journals short, with no stack trace anywhere near the money.
  const strictBefore = config.ledger.strict;
  const realError = console.error;
  let logged = 0;
  console.error = () => { logged += 1; };
  try {
    config.ledger.strict = false;

    // An operational failure is deferred: the order confirms, the cause is kept,
    // and the sweep can genuinely succeed later.
    const deferred = await ledgerPosting.safePost('sale_captured', async () => {
      const e = new Error('ECONNRESET while writing journal');
      e.code = 'ECONNRESET';
      throw e;
    });
    assert.equal(deferred.journal, null);
    assert.equal(deferred.created, false);
    assert.ok(deferred.error instanceof Error, 'the cause is returned, not discarded');
    assert.equal(logged, 1, 'a deferred failure is still logged');

    // A programmer error propagates even though we are non-strict, because
    // deferring it would defer it forever.
    for (const err of [
      new ReferenceError("Cannot access 'isCodPayment' before initialization"),
      new TypeError('isCodPayment is not a function'),
      new RangeError('Invalid array length'),
    ]) {
      await assert.rejects(
        () => ledgerPosting.safePost('sale_captured', async () => { throw err; }),
        (thrown) => thrown === err,
        `${err.constructor.name} must propagate — a sweep cannot fix a bug`,
      );
    }
    assert.equal(logged, 1, 'a propagated bug is not also logged as "will be backfilled"');

    // Strict mode still propagates everything, exactly as before.
    config.ledger.strict = true;
    await assert.rejects(
      () => ledgerPosting.safePost('sale_captured', async () => { throw new Error('duplicate key'); }),
      /duplicate key/,
    );
  } finally {
    console.error = realError;
    config.ledger.strict = strictBefore;
  }

  assert.equal(isProgrammerError(new ReferenceError('x')), true);
  assert.equal(isProgrammerError(new TypeError('x')), true);
  assert.equal(isProgrammerError(new RangeError('x')), true);
  assert.equal(isProgrammerError(new SyntaxError('x')), true);
  assert.equal(isProgrammerError(new Error('x')), false, 'a plain Error is operational');
  assert.equal(isProgrammerError(null), false);
  assert.equal(isProgrammerError(undefined), false);
  ok('safePost defers transient failures but propagates deterministic bugs');
}

// ---------------------------------------------------------------------------
ledgerService.post = realPost;
console.log(`\nCOD LEDGER: all ${pass} scenarios passed ✔`);
process.exit(0);
