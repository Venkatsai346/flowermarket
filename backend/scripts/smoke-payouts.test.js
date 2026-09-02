/**
 * smoke-payouts.test.js — Phase 6.3 disbursement, end to end (M4 + M5).
 *
 * Dual mode, same contract as the other DB suites:
 *   MONGODB_URI set → real MongoDB (CI)
 *   otherwise       → mongodb-memory-server
 *   neither         → SKIP exit 0, unless REQUIRE_DB=true
 *
 * The arithmetic and the provider safety properties are proven without a
 * database by scripts/payout-calc.test.js (47) and
 * scripts/payout-provider.test.js (52). This suite proves what only a database
 * can: that the ledger, the line states and the batch lifecycle stay coherent
 * through the ugly paths — ambiguity, reversal, clawback.
 */

import mongoose from 'mongoose';
import config from '../src/config/index.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const section = (t) => console.log(`\n${t}`);

let mongod = null;

async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    return `real MongoDB (${process.env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')})`;
  }
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('flower_market_payout_test');
  config.mongoUri = uri;
  await mongoose.connect(uri, { autoIndex: true });
  return 'mongodb-memory-server';
}

async function main() {
  let mode;
  try {
    mode = await connect();
  } catch (err) {
    const msg = `no database available (${err.message.split('\n')[0]})`;
    if (process.env.REQUIRE_DB === 'true') {
      console.error(`\n❌ smoke-payouts: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-payouts needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_test node scripts/smoke-payouts.test.js');
    console.log('   (arithmetic: scripts/payout-calc.test.js · provider safety: scripts/payout-provider.test.js)\n');
    process.exit(0);
  }

  console.log(`\n💸 Phase 6.3 payout smoke — ${mode}`);
  config.payouts.provider = 'mock'; // deterministic outcomes

  const { default: payoutService } = await import('../src/services/payout.service.js');
  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: taxService } = await import('../src/services/tax.service.js');
  const { default: PayoutLineItem } = await import('../src/models/payoutLineItem.model.js');
  const { default: PayoutBatch } = await import('../src/models/payoutBatch.model.js');
  const { default: VendorPayoutAccount } = await import('../src/models/vendorPayoutAccount.model.js');
  const { default: PayoutStatusHistory } = await import('../src/models/payoutStatusHistory.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const { PAYOUT_STATE, PAYOUT_LINE_STATE, REFUND_REASON } = await import('../src/constants/enums.js');
  const { toPaise, fromPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  await ledgerService.ensureChartOfAccounts();
  await taxService.seedStatutoryRates();

  const tenant = await Tenant.create({ name: 'Bloom', slug: `bloom-p-${Date.now()}`, type: 'business', status: 'active' });
  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Rose Farms', slug: `rf-${Date.now()}`,
    commissionRateBps: 1000, status: 'active',
  });

  /** Build a confirmed, delivered order with one vendor line. */
  async function makeOrder({ lineTotal, tax, deliveredDaysAgo = 30 }) {
    const deliveredAt = new Date(Date.now() - deliveredDaysAgo * 86400000);
    const order = await Order.create({
      tenantId: tenant._id, userId: oid(), orderNumber: `FM-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: tax, totalAmount: lineTotal + tax, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: tenant._id, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendor._id, skuSnapshot: { title: 'Red Rose Bouquet' },
      priceAtOrder: { sellingPrice: lineTotal }, qty: 1, lineTotal, taxAmount: tax, discountAllocated: 0,
    });
    await ledgerPosting.postSaleCaptured({ order });
    return order;
  }

  // -------------------------------------------------------------------------
  section('1. accrual — the blueprint example, from a real order');
  // -------------------------------------------------------------------------
  const order1 = await makeOrder({ lineTotal: 5000, tax: 900 });
  const acc = await payoutService.accrueForOrder({ orderId: order1._id });
  eq('one payout line accrued', acc.created, 1);

  const line = await PayoutLineItem.findOne({ orderId: order1._id });
  eq('gross ₹5900', line.grossPaise, toPaise(5900));
  eq('commission ₹500', line.commissionPaise, toPaise(500));
  eq('GST on commission ₹90', line.gstOnCommissionPaise, toPaise(90));
  eq('TCS ₹25', line.tcsPaise, toPaise(25));
  eq('TDS ₹5.90', line.tdsPaise, toPaise(5.9));
  eq('★ net payable ₹5279.10', line.netPayablePaise, toPaise(5279.1));
  eq('starts as accrued, not payable', line.state, PAYOUT_LINE_STATE.ACCRUED);

  const again = await payoutService.accrueForOrder({ orderId: order1._id });
  eq('accrual is idempotent', again.created, 0);

  // -------------------------------------------------------------------------
  section('2. eligibility gate — the return window');
  // -------------------------------------------------------------------------
  const fresh = await makeOrder({ lineTotal: 1000, tax: 0, deliveredDaysAgo: 1 });
  await payoutService.accrueForOrder({ orderId: fresh._id });

  const sweep = await payoutService.markEligible({});
  check('the sweep ran', sweep.scanned >= 1, JSON.stringify(sweep));

  const oldLine = await PayoutLineItem.findOne({ orderId: order1._id });
  const freshLine = await PayoutLineItem.findOne({ orderId: fresh._id });
  eq('a 30-day-old delivery is eligible', oldLine.state, PAYOUT_LINE_STATE.ELIGIBLE);
  eq('★ a 1-day-old delivery is NOT (7-day window still open)', freshLine.state, PAYOUT_LINE_STATE.ACCRUED);

  // -------------------------------------------------------------------------
  section('3. cycle computation');
  // -------------------------------------------------------------------------
  const from = new Date(Date.now() - 365 * 86400000);
  const to = new Date(Date.now() + 86400000);
  const cyc = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from, to });
  check('a batch was created', cyc.created, JSON.stringify(cyc));
  const batch = cyc.batch;
  eq('batch net = ₹5279.10', batch.netPaise, toPaise(5279.1));
  eq('only the eligible line is in it', batch.lineItemCount, 1);
  check('batch number formatted PO-YYMM-seq', /^PO-\d{4}-\d{6}$/.test(batch.batchNumber), batch.batchNumber);
  eq('starts in draft — nothing moves without a human', batch.state, PAYOUT_STATE.DRAFT);

  const recompute = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from, to });
  check('★ recomputing the same cycle does NOT create a second batch', recompute.created === false);
  eq('same batch returned', String(recompute.batch._id), String(batch._id));

  const batched = await PayoutLineItem.findById(oldLine._id);
  eq('the line is pinned to the batch', batched.state, PAYOUT_LINE_STATE.BATCHED);

  // -------------------------------------------------------------------------
  section('4. safety rails before money can move');
  // -------------------------------------------------------------------------
  let noAcct = null;
  try { await payoutService.submitForApproval({ batchId: batch._id }); } catch (e) { noAcct = e; }
  eq('no payout account → refused', noAcct?.code, 'PAYOUT_NO_ACCOUNT');

  const account = await VendorPayoutAccount.create({
    vendorId: vendor._id, method: 'bank', accountHolderName: 'Rose Farms LLP',
    accountNumberEnc: Buffer.from('12345678901').toString('base64'),
    ifsc: 'HDFC0001234', maskedAccount: '****8901', fingerprint: 'fp1', isDefault: true, status: 'active',
  });

  let noKyc = null;
  try { await payoutService.submitForApproval({ batchId: batch._id }); } catch (e) { noKyc = e; }
  eq('KYC not approved → refused', noKyc?.code, 'PAYOUT_KYC_REQUIRED');

  account.kyc.status = 'approved';
  await account.save();
  let noBank = null;
  try { await payoutService.submitForApproval({ batchId: batch._id }); } catch (e) { noBank = e; }
  eq('bank not verified → refused', noBank?.code, 'PAYOUT_BANK_UNVERIFIED');

  account.verification.status = 'verified';
  account.frozenUntil = new Date(Date.now() + 3600000);
  await account.save();
  let frozen = null;
  try { await payoutService.submitForApproval({ batchId: batch._id }); } catch (e) { frozen = e; }
  eq('★ a recent bank-detail change freezes payouts', frozen?.code, 'PAYOUT_ACCOUNT_FROZEN');

  account.frozenUntil = null;
  await account.save();
  await payoutService.submitForApproval({ batchId: batch._id });
  const pending = await PayoutBatch.findById(batch._id);
  eq('now it reaches pending approval', pending.state, PAYOUT_STATE.PENDING_APPROVAL);

  // -------------------------------------------------------------------------
  section('5. approval requires a human (and sometimes two)');
  // -------------------------------------------------------------------------
  const approver1 = oid();
  const approver2 = oid();
  await payoutService.approve({ batchId: batch._id, actorId: approver1 });
  let dup = null;
  try { await payoutService.approve({ batchId: batch._id, actorId: approver1 }); } catch (e) { dup = e; }
  eq('the same person cannot approve twice', dup?.code, 'PAYOUT_ALREADY_APPROVED_BY_YOU');

  const approved = await PayoutBatch.findById(batch._id);
  eq('single approval is enough below the dual-approval threshold', approved.state, PAYOUT_STATE.APPROVED);

  // -------------------------------------------------------------------------
  section('6. submit → paid, and the ledger drains correctly');
  // -------------------------------------------------------------------------
  const payableBefore = await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id));
  const gstBefore = await ledgerService.balance(ledgerAccounts.gstOutputPayable(vendor._id));
  eq('vendor payable before payout = ₹4500', payableBefore.balancePaise, toPaise(4500));
  eq("vendor's GST held before payout = ₹900", gstBefore.balancePaise, toPaise(900));

  const submitted = await payoutService.submit({ batchId: batch._id, actorId: approver1 });
  const paid = await PayoutBatch.findById(batch._id);
  eq('batch is paid', paid.state, PAYOUT_STATE.PAID);
  check('a UTR was recorded', Boolean(paid.utr));

  const payableAfter = await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id));
  const gstAfter = await ledgerService.balance(ledgerAccounts.gstOutputPayable(vendor._id));
  const bank = await ledgerService.balance(ledgerAccounts.bank());
  const tcs = await ledgerService.balance(ledgerAccounts.tcsPayable());
  const tds = await ledgerService.balance(ledgerAccounts.tdsPayable());
  const platformGst = await ledgerService.balance(ledgerAccounts.gstOutputPayable('platform'));

  eq('vendor payable drained to zero', payableAfter.balancePaise, 0);
  eq("vendor's GST passed through to them", gstAfter.balancePaise, 0);
  eq('bank credited −₹5279.10 (money left)', bank.balancePaise, -toPaise(5279.1));
  eq('TCS liability booked ₹25', tcs.balancePaise, toPaise(25));
  eq('TDS liability booked ₹5.90', tds.balancePaise, toPaise(5.9));
  eq('GST on our commission booked ₹90', platformGst.balancePaise, toPaise(90));

  const paidLine = await PayoutLineItem.findById(oldLine._id);
  eq('the line is marked paid', paidLine.state, PAYOUT_LINE_STATE.PAID);

  const tb = await ledgerService.trialBalance();
  check('trial balance still balances after a payout', tb.balanced, `diff ${tb.differencePaise}`);

  const history = await PayoutStatusHistory.find({ payoutBatchId: batch._id }).sort({ createdAt: 1 }).lean();
  check('every transition is recorded', history.length >= 5, `${history.length} rows`);

  // -------------------------------------------------------------------------
  section('7. ★ the ambiguous submission — no double payment');
  // -------------------------------------------------------------------------
  // craft a batch whose net ends in 99 paise → the mock provider "times out"
  const ambOrder = await makeOrder({ lineTotal: 2000, tax: 0 });
  await payoutService.accrueForOrder({ orderId: ambOrder._id });
  await payoutService.markEligible({});
  const ambLine = await PayoutLineItem.findOne({ orderId: ambOrder._id });
  // force the net to end in .99 so the mock returns AMBIGUOUS
  ambLine.netPayablePaise = toPaise(1799.99);
  await ambLine.save();

  const ambCycle = await payoutService.computeCycleForVendor({
    vendorId: vendor._id,
    from: new Date(Date.now() - 2 * 86400000),
    to: new Date(Date.now() + 2 * 86400000),
  });
  const ambBatch = ambCycle.batch;
  if (ambBatch) {
    ambBatch.netPaise = toPaise(1799.99);
    ambBatch.state = PAYOUT_STATE.APPROVED;
    await ambBatch.save();

    const ambResult = await payoutService.submit({ batchId: ambBatch._id, actorId: approver1 });
    const stuck = await PayoutBatch.findById(ambBatch._id);
    eq('★ an ambiguous submission is reported as such', ambResult.ambiguous, true);
    eq('★ the batch STAYS in processing (not failed, not paid)', stuck.state, PAYOUT_STATE.PROCESSING);
    eq('★ it is flagged for reconciliation', stuck.needsReconciliation, true);

    const journalsBefore = await (await import('../src/models/ledgerJournal.model.js')).default
      .countDocuments({ refType: 'payout_batch', refId: ambBatch._id });

    const recon = await payoutService.reconcileInFlight({ olderThanMinutes: 0 });
    check('reconciliation resolved it', recon.resolvedPaid >= 1, JSON.stringify(recon));

    const resolved = await PayoutBatch.findById(ambBatch._id);
    eq('★ the money HAD moved — resolved to paid, never retried', resolved.state, PAYOUT_STATE.PAID);
    eq('reconciliation flag cleared', resolved.needsReconciliation, false);

    const journalsAfter = await (await import('../src/models/ledgerJournal.model.js')).default
      .countDocuments({ refType: 'payout_batch', refId: ambBatch._id });
    eq('★ NO second payout journal was posted (idempotency held)', journalsAfter, journalsBefore);
  } else {
    check('ambiguous scenario batch created', false, 'no batch to test with');
  }

  // -------------------------------------------------------------------------
  section('8. provider rejection unwinds the ledger and frees the lines');
  // -------------------------------------------------------------------------
  const failOrder = await makeOrder({ lineTotal: 500.13, tax: 0 });
  await payoutService.accrueForOrder({ orderId: failOrder._id });
  await payoutService.markEligible({});
  const failLine = await PayoutLineItem.findOne({ orderId: failOrder._id });
  failLine.netPayablePaise = toPaise(1000.13); // …13 → provider rejection
  failLine.state = PAYOUT_LINE_STATE.ELIGIBLE;
  await failLine.save();

  const failCycle = await payoutService.computeCycleForVendor({
    vendorId: vendor._id,
    from: new Date(Date.now() - 3 * 86400000),
    to: new Date(Date.now() + 3 * 86400000),
  });
  if (failCycle.batch) {
    const fb = failCycle.batch;
    fb.netPaise = toPaise(1000.13);
    fb.state = PAYOUT_STATE.APPROVED;
    await fb.save();

    const bankBefore = (await ledgerService.balance(ledgerAccounts.bank())).balancePaise;
    await payoutService.submit({ batchId: fb._id, actorId: approver1 });
    const failed = await PayoutBatch.findById(fb._id);
    eq('batch failed', failed.state, PAYOUT_STATE.FAILED);
    check('a reason was captured', Boolean(failed.failureReason));

    const bankAfter = (await ledgerService.balance(ledgerAccounts.bank())).balancePaise;
    eq('★ the ledger was unwound — bank is unchanged', bankAfter, bankBefore);

    const tb2 = await ledgerService.trialBalance();
    check('trial balance still balances after an unwind', tb2.balanced);

    check('a clean rejection is retryable (failed → queued is legal)',
      (await import('../src/utils/payoutStateMachine.js')).canTransition(PAYOUT_STATE.FAILED, PAYOUT_STATE.QUEUED));
  }

  // -------------------------------------------------------------------------
  section('9. refund clawback');
  // -------------------------------------------------------------------------
  const refund = await RefundTransaction.create({
    tenantId: tenant._id, orderId: order1._id, userId: oid(),
    amount: 590, reason: REFUND_REASON.RETURN_QC_PASSED, destination: 'wallet',
    idempotencyKey: `refund_po_${Date.now()}`, status: 'success', completedAt: new Date(),
  });
  const claw = await payoutService.reverseForRefund({ refundTransaction: refund });
  eq('★ an already-PAID line is clawed back, not cancelled', claw.clawedBack, 1);

  const negative = await PayoutLineItem.findOne({ refundTransactionId: refund._id, reversalOfLineId: { $ne: null } });
  check('a negative line was created', negative.netPayablePaise < 0, String(negative.netPayablePaise));
  eq('it is immediately eligible to offset the next cycle', negative.state, PAYOUT_LINE_STATE.ELIGIBLE);

  // -------------------------------------------------------------------------
  section('10. PSP settlement ingestion closes gate 2');
  // -------------------------------------------------------------------------
  const clearingBefore = (await ledgerService.balance(ledgerAccounts.gatewayClearing())).balancePaise;
  const ingest = await payoutService.ingestPspSettlements({
    rows: [{ orderNumber: order1.orderNumber, amount: order1.totalAmount, settledAt: new Date(), utr: 'UTRSETTLE1' }],
    reference: 'settlement-2026-09-02',
  });
  eq('one settlement posted', ingest.posted, 1);
  const clearingAfter = (await ledgerService.balance(ledgerAccounts.gatewayClearing())).balancePaise;
  eq('gateway clearing reduced by the settled amount',
    clearingBefore - clearingAfter, toPaise(order1.totalAmount));

  const ingestAgain = await payoutService.ingestPspSettlements({
    rows: [{ orderNumber: order1.orderNumber, amount: order1.totalAmount }],
  });
  eq('★ re-ingesting the same report posts nothing', ingestAgain.posted, 0);
  eq('and reports it as skipped', ingestAgain.skipped, 1);

  const unmatched = await payoutService.ingestPspSettlements({ rows: [{ orderNumber: 'FM-DOES-NOT-EXIST', amount: 10 }] });
  eq('an unmatched row is reported, never guessed', unmatched.unmatched.length, 1);

  // -------------------------------------------------------------------------
  section('11. final integrity');
  // -------------------------------------------------------------------------
  const finalTb = await ledgerService.trialBalance();
  check('★ trial balance across every journal', finalTb.balanced, `diff ${finalTb.differencePaise} paise`);
  const verify = await ledgerService.verifyBalances();
  check('★ no drift between entries and balances', verify.ok, JSON.stringify(verify.drifted.slice(0, 2)));

  const upcoming = await payoutService.upcoming({ vendorId: vendor._id });
  check('the vendor can see what is coming', typeof upcoming.eligible.amount === 'number');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`payout smoke: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
}

async function cleanup() {
  await mongoose.disconnect().catch(() => {});
  if (mongod) await mongod.stop().catch(() => {});
}

main()
  .then(async () => { await cleanup(); process.exit(failed ? 1 : 0); })
  .catch(async (err) => { console.error('\n❌ suite crashed:', err); await cleanup(); process.exit(1); });
