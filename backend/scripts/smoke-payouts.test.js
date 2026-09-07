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

import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
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
  async function makeOrder({ lineTotal, tax, deliveredDaysAgo = 30, vendorId = null }) {
    const deliveredAt = new Date(Date.now() - deliveredDaysAgo * 86400000);
    const order = await Order.create({
      tenantId: tenant._id, userId: oid(), orderNumber: `FM-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: tax, totalAmount: lineTotal + tax, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: tenant._id, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendorId || vendor._id, skuSnapshot: { title: 'Red Rose Bouquet' },
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
  // A different vendor: its sale journal must not add to the main vendor's
  // payable, or the section-6 ledger assertions (exact payable of the batched
  // order) would see ₹900 that never belongs to that batch.
  const vendor2 = await Vendor.create({
    userId: oid(), businessName: 'Jasmine Co', slug: `jc-${Date.now()}`,
    commissionRateBps: 1000, status: 'active',
  });
  const fresh = await makeOrder({ lineTotal: 1000, tax: 0, deliveredDaysAgo: 1, vendorId: vendor2._id });
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
  const ambOrder = await makeOrder({ lineTotal: 2000, tax: 0, deliveredDaysAgo: 8 }); // eligibleAt = now − 1d, inside the ±2d cycle window
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
  section('11. cash gate: settlement is a first-class chained event (Phase 12)');
  // -------------------------------------------------------------------------
  const { default: domainEvents } = await import('../src/services/domainEvent.service.js');
  const { default: DomainEvent } = await import('../src/models/domainEvent.model.js');
  const { default: LedgerJournalM } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntryM } = await import('../src/models/ledgerEntry.model.js');

  // order2: settled long ago (section 10 did order1); order3: fresh, unsettled
  const order2 = await makeOrder({ lineTotal: 2000, tax: 0 });
  await payoutService.accrueForOrder({ orderId: order2._id });
  await payoutService.upsertPolicy({ scope: 'platform', payload: { requirePspSettlement: true } });

  const order3 = await makeOrder({ lineTotal: 3000, tax: 540 });
  await payoutService.accrueForOrder({ orderId: order3._id });

  const sweepBlocked = await payoutService.markEligible({});
  const line3a = await PayoutLineItem.findOne({ orderId: order3._id });
  eq('★ cash gate ON: an unsettled order is NOT eligible', line3a.state, PAYOUT_LINE_STATE.ACCRUED);
  check('the sweep reports blocked lines', sweepBlocked.blocked >= 1, JSON.stringify(sweepBlocked));

  const ing3 = await payoutService.ingestPspSettlements({ rows: [{ orderNumber: order3.orderNumber, utr: 'UTR3' }] });
  eq('settling that one order posts one journal', ing3.posted, 1);
  const sweep3 = await payoutService.markEligible({});
  const line3b = await PayoutLineItem.findOne({ orderId: order3._id });
  eq('★ once the cash is ingested, the line becomes eligible', line3b.state, PAYOUT_LINE_STATE.ELIGIBLE);
  void sweep3;

  // the settlement sits on the tamper-evident chain
  const ev3 = await DomainEvent.findOne({ idempotencyKey: `psp_settled:order:${order3._id}` }).lean();
  check('psp_settled event exists and is hashed', Boolean(ev3) && typeof ev3.hash === 'string');
  const chain = await domainEvents.verifyChains({ tenantId: tenant._id });
  check('chain verifies with settlement events on it', chain.ok === true, JSON.stringify(chain.breaks));

  // crash window: the journal+entries vanish, the event survives → replay rebuilds
  // (a pre-commit crash never $inc'd the balances — repair models that)
  const j3 = await LedgerJournalM.findOne({ idempotencyKey: `psp_settled:order:${order3._id}` }).lean();
  await LedgerEntryM.deleteMany({ journalId: j3._id });
  await LedgerJournalM.deleteOne({ _id: j3._id });
  await ledgerService.verifyBalances({ repair: true });
  const drift = await domainEvents.findDrift({});
  check('drift names the missing settlement journal', drift.missingJournals.some((m) => m.kind === 'psp_settled'), JSON.stringify(drift.missingJournals));
  const rep1 = await domainEvents.replay({ limit: 50 });
  check('replay re-posted a journal', rep1.journalsReposted >= 1, JSON.stringify(rep1));
  const j3b = await LedgerJournalM.findOne({ idempotencyKey: `psp_settled:order:${order3._id}` }).lean();
  eq('★ settlement journal rebuilt to the exact paise', j3b ? j3b.totalPaise : null, j3.totalPaise);

  // the other direction: the event vanishes, the journal survives → restore
  await DomainEvent.deleteOne({ idempotencyKey: `psp_settled:order:${order3._id}` });
  const drift2 = await domainEvents.findDrift({});
  check('drift names the missing settlement event', drift2.missingEvents.some((m) => m.kind === 'psp_settled'), JSON.stringify(drift2.missingEvents));
  const rep2 = await domainEvents.replay({ limit: 50 });
  check('replay restored the settlement event', rep2.eventsRestored >= 1, JSON.stringify(rep2));

  // the cash-gate summary
  const sum = await payoutService.settlementSummary({});
  check('summary counts the settled orders', sum.settledOrders >= 2, JSON.stringify(sum));
  check('summary reports the gate ON', sum.policy.requirePspSettlement === true, JSON.stringify(sum.policy));
  check('summary: clearing never went negative', sum.gatewayClearingPaise >= 0, String(sum.gatewayClearingPaise));
  check('summary: unsettled order2 still queued', sum.unsettledOrders >= 1, `unsettled=${sum.unsettledOrders}`);

  // switch the gate back off for the final integrity
  await payoutService.upsertPolicy({ scope: 'platform', payload: { requirePspSettlement: false } });

  // -------------------------------------------------------------------------
  section('13. statutory deposits — TCS/TDS paid to the government (Phase 13)');
  // -------------------------------------------------------------------------
  const { default: statutory } = await import('../src/services/statutory.service.js');
  const { default: StatutoryDepositM } = await import('../src/models/statutoryDeposit.model.js');

  const tcs0 = (await ledgerService.balance(ledgerAccounts.tcsPayable())).balancePaise;
  const tds0 = (await ledgerService.balance(ledgerAccounts.tdsPayable())).balancePaise;
  // two paid batches: section 6 (₹25 TCS / ₹5.90 TDS) + the ambiguous one that
  // reconciliation resolved as PAID (₹2000 sale → ₹10 TCS / ₹2 TDS)
  eq('TCS liability carried from the paid batches = ₹35', tcs0, toPaise(35));
  eq('TDS liability carried from the paid batches = ₹7.90', tds0, toPaise(7.9));

  // over-deposit guard: you cannot pay the government more than you withheld
  let over = null;
  try { await statutory.deposit({ statute: 'tcs', amountPaise: tcs0 + 1, utr: 'CHAVS-000', tenantId: tenant._id }); } catch (e) { over = e; }
  check('★ depositing more than withheld is rejected', over?.code === 'STATUTORY_OVER_DEPOSIT', over?.code || 'no error');
  eq('and nothing moved', (await ledgerService.balance(ledgerAccounts.tcsPayable())).balancePaise, tcs0);
  const bank0 = (await ledgerService.balance(ledgerAccounts.bank())).balancePaise;

  // deposit the TCS in full — the liability clears, the bank pays out
  const dep1 = await statutory.deposit({ statute: 'tcs', amountPaise: tcs0, utr: 'CHAVS-1001', reference: 'GSTR-8 / CHAVS 2026-08', tenantId: tenant._id });
  eq('TCS payable cleared to zero', (await ledgerService.balance(ledgerAccounts.tcsPayable())).balancePaise, 0);
  eq('bank paid out exactly ₹25', (await ledgerService.balance(ledgerAccounts.bank())).balancePaise, bank0 - tcs0);
  const ev1 = await DomainEvent.findOne({ idempotencyKey: `statutory_deposit:${dep1._id}` }).lean();
  check('the deposit event is chained', Boolean(ev1) && typeof ev1.hash === 'string');

  // operator correction: revert — the liability returns, zero-net on the bank
  const rev1 = await statutory.revert({ depositId: dep1._id, reason: 'wrong UTR recorded — redone' });
  eq('revert restores the TCS liability', (await ledgerService.balance(ledgerAccounts.tcsPayable())).balancePaise, tcs0);
  eq('revert is zero-net on the bank', (await ledgerService.balance(ledgerAccounts.bank())).balancePaise, bank0);
  check('the revert carries its reason on the trail', rev1.status === 'reverted' && String(rev1.revertReason).length >= 3);
  let doubleRevert = null;
  try { await statutory.revert({ depositId: dep1._id, reason: 'again' }); } catch (e) { doubleRevert = e; }
  check('double revert is refused', doubleRevert?.code === 'STATUTORY_ALREADY_REVERTED', doubleRevert?.code);

  // re-deposit TCS + clear the whole TDS liability
  const dep2 = await statutory.deposit({ statute: 'tcs', amountPaise: tcs0, utr: 'CHAVS-1002', tenantId: tenant._id });
  const dep3 = await statutory.deposit({ statute: 'tds', amountPaise: tds0, utr: '26Q-0007', tenantId: tenant._id });
  eq('TDS payable cleared to zero', (await ledgerService.balance(ledgerAccounts.tdsPayable())).balancePaise, 0);
  void dep3;

  // crash window on the TDS deposit journal → replay re-posts it exactly
  const tdsJournal = await LedgerJournalM.findOne({ kind: 'statutory_deposit', 'meta.statute': 'tds' }).lean();
  await LedgerEntryM.deleteMany({ journalId: tdsJournal._id });
  await LedgerJournalM.deleteOne({ _id: tdsJournal._id });
  await ledgerService.verifyBalances({ repair: true }); // a pre-commit crash never $inc'd
  const driftS = await domainEvents.findDrift({});
  check('drift names the missing deposit journal', driftS.missingJournals.some((m) => m.kind === 'statutory_deposit'), JSON.stringify(driftS.missingJournals.map((m) => m.kind)));
  await domainEvents.replay({ limit: 50 });
  const tdsJournal2 = await LedgerJournalM.findOne({ kind: 'statutory_deposit', 'meta.statute': 'tds' }).lean();
  eq('★ replay re-posts the TDS deposit to the exact paise', tdsJournal2 ? tdsJournal2.totalPaise : null, tds0);

  // the other direction: delete the TCS (CHAVS-1002) event → restored from its journal
  await DomainEvent.deleteOne({ kind: 'statutory_deposit', 'payload.utr': 'CHAVS-1002' });
  const driftS2 = await domainEvents.findDrift({});
  check('drift names the missing deposit event', driftS2.missingEvents.some((m) => m.kind === 'statutory_deposit'), JSON.stringify(driftS2.missingEvents.map((m) => m.kind)));
  await domainEvents.replay({ limit: 50 });
  const evBack = await DomainEvent.findOne({ kind: 'statutory_deposit', 'payload.utr': 'CHAVS-1002' }).lean();
  check('replay restored the deposit event', Boolean(evBack));
  void dep2;

  // the statutory picture
  const sumS = await statutory.summary({});
  check('summary: TCS fully deposited (net of the revert)', sumS.tcs.outstandingPaise === 0 && sumS.tcs.netDepositedPaise === tcs0 && sumS.tcs.revertedPaise === tcs0, JSON.stringify(sumS.tcs));
  check('summary: TDS deposited, nothing owed', sumS.tds.outstandingPaise === 0 && sumS.tds.netDepositedPaise === tds0, JSON.stringify(sumS.tds));
  check('summary lists the deposits with their UTRs', sumS.recentDeposits.length >= 3 && sumS.recentDeposits.every((d) => d.utr), JSON.stringify(sumS.recentDeposits.map((d) => d.utr)));
  eq('exactly three deposits recorded', await StatutoryDepositM.countDocuments({}), 3);

  const tbS = await ledgerService.trialBalance();
  check('★ trial balance still balances after deposits + revert + replay', tbS.balanced, `diff ${tbS.differencePaise}`);

  // -------------------------------------------------------------------------
  section('15. bank statement — the egress truth (Phase 14)');
  // -------------------------------------------------------------------------
  const { default: bankStatement } = await import('../src/services/bankStatement.service.js');
  const { default: BankStatementLineM } = await import('../src/models/bankStatementLine.model.js');
  const { DOMAIN_EVENT_TYPE } = await import('../src/constants/enums.js');
  const domainEventService = domainEvents; // same service, section-11 name

  // section 6's batch is PAID with a UTR; the bank statement is the only
  // record that can later say the money came BACK
  const paidBatch = await PayoutBatch.findById(batch._id);
  check('the paid batch carries a UTR', Boolean(paidBatch.utr), paidBatch.state);
  const vendorPayableBeforeReturn = (await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id))).balancePaise;
  const bankBeforeReturn = (await ledgerService.balance(ledgerAccounts.bank())).balancePaise;

  // 1) the bank confirms the payment (debit with the batch's UTR)
  const stmt1 = await bankStatement.ingest({
    statementRef: 'BS-2026-09-07',
    lines: [{ utr: paidBatch.utr, amountPaise: -paidBatch.netPaise, description: 'payout out' }],
    tenantId: tenant._id,
  });
  eq('the debit line is confirmed against the paid batch', stmt1.confirmed, 1);
  eq('confirmed does not change the batch', (await PayoutBatch.findById(batch._id)).state, PAYOUT_STATE.PAID);

  // 2) days later: the bank RETURNS the money (credit, same UTR)
  const stmt2 = await bankStatement.ingest({
    statementRef: 'BS-2026-09-20',
    lines: [{ utr: paidBatch.utr, amountPaise: paidBatch.netPaise, description: 'NSF return' }],
    tenantId: tenant._id,
  });
  eq('★ the credit line is matched as a bank return', stmt2.returned, 1);
  const reversedBatch = await PayoutBatch.findById(batch._id);
  eq('the batch is REVERSED', reversedBatch.state, PAYOUT_STATE.REVERSED);
  check('the return reason is on the batch', /bank return per statement/.test(reversedBatch.failureReason || ''), reversedBatch.failureReason);
  // the unwind mirrors the ORIGINAL journal — assert against its real lines
  const origJ = await LedgerJournalM.findOne({ idempotencyKey: `payout_initiated:payout_batch:${batch._id}` }).lean();
  const drainLine = origJ.lines.find((l) => l.accountCode === ledgerAccounts.vendorPayable(vendor._id) && l.debitPaise);
  eq('the vendor payable is restored by the exact drained amount', (await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id))).balancePaise, vendorPayableBeforeReturn + drainLine.debitPaise);
  eq('the bank is made whole', (await ledgerService.balance(ledgerAccounts.bank())).balancePaise, bankBeforeReturn + paidBatch.netPaise);
  const freedLine = await PayoutLineItem.findOne({ orderId: order1._id });
  eq('★ the line is back in the eligible pool', freedLine.state, PAYOUT_LINE_STATE.ELIGIBLE);
  const revEvent = await DomainEvent.findOne({ idempotencyKey: `payout_reversed:payout_batch:${batch._id}` }).lean();
  check('the reversal fact is chained', Boolean(revEvent) && typeof revEvent.hash === 'string');

  // 3) a statement line nobody matches stays in the queue — never guessed
  const stmt3 = await bankStatement.ingest({
    statementRef: 'BS-2026-09-20b',
    lines: [
      { utr: 'NO-SUCH-UTR-1', amountPaise: 12345, description: 'unknown credit' },
      { utr: 'NO-SUCH-UTR-2', amountPaise: -999, description: 'unknown debit' },
    ],
    tenantId: tenant._id,
  });
  eq('both unknown lines are queued, not guessed', stmt3.queued, 2);

  // 4) the ambiguous-submission case: provider silent, the BANK says it moved
  //    (white-box: put a real approved batch in PROCESSING with fact+journal,
  //    exactly as submit() would, then let the statement decide)
  const acct2 = await VendorPayoutAccount.create({
    vendorId: vendor2._id, method: 'bank', accountHolderName: 'Jasmine Co',
    accountNumberEnc: Buffer.from('22334455667').toString('base64'),
    ifsc: 'ICIC0009876', maskedAccount: '****5667', fingerprint: 'fp-jc', isDefault: true, status: 'active',
  });
  acct2.kyc.status = 'approved';
  acct2.verification.status = 'verified';
  await acct2.save();
  const stmtOrder = await makeOrder({ lineTotal: 4000, tax: 0, vendorId: vendor2._id });
  await payoutService.accrueForOrder({ orderId: stmtOrder._id });
  await payoutService.markEligible({}); // the 30-day-old line becomes eligible
  const stmtCyc = await payoutService.computeCycleForVendor({ vendorId: vendor2._id, from, to });
  const inFlight = stmtCyc.batch;
  await payoutService.submitForApproval({ batchId: inFlight._id });
  await payoutService.approve({ batchId: inFlight._id, actorId: approver1 });
  const doc = await PayoutBatch.findById(inFlight._id);
  await payoutService.transition(doc, PAYOUT_STATE.QUEUED, { note: 'queued for disbursement' });
  await payoutService.transition(doc, PAYOUT_STATE.PROCESSING, { note: 'submitting (provider silent)' });
  doc.submittedAt = new Date();
  doc.utr = 'BANKONLY-UTR-77';
  await doc.save();
  await domainEventService.append({
    tenantId: doc.tenantId, kind: DOMAIN_EVENT_TYPE.PAYOUT_INITIATED,
    aggregateType: 'payout_batch', aggregateId: doc._id,
    idempotencyKey: `payout_initiated:payout_batch:${doc._id}`,
    occurredAt: doc.submittedAt, refType: 'payout_batch', refId: doc._id,
    payload: { batchNumber: doc.batchNumber, vendorId: doc.vendorId, netPaise: doc.netPaise },
  });
  await payoutService.postPayoutJournal(doc);

  const stmt4 = await bankStatement.ingest({
    statementRef: 'BS-2026-09-21',
    lines: [{ utr: 'BANKONLY-UTR-77', amountPaise: -doc.netPaise, description: 'the money moved' }],
    tenantId: tenant._id,
  });
  eq('the bank confirms an in-flight payment', stmt4.confirmed, 1);
  const settled = await PayoutBatch.findById(inFlight._id);
  eq('★ the batch is PAID on the bank\u2019s word', settled.state, PAYOUT_STATE.PAID);

  // 5) re-ingesting the same statement is a no-op (never double-reverses)
  const stmt5 = await bankStatement.ingest({
    statementRef: 'BS-2026-09-20',
    lines: [{ utr: paidBatch.utr, amountPaise: paidBatch.netPaise }],
    tenantId: tenant._id,
  });
  eq('re-ingest creates no new lines', stmt5.newLines, 0);
  eq('…and reverses nothing again', stmt5.returned, 0);
  eq('the batch is still exactly once reversed', (await PayoutBatch.findById(batch._id)).state, PAYOUT_STATE.REVERSED);

  // 6) the ingestion fact is on the chain. (The §12–13 event-restore scars
  //    are expected broken_links — a deliberate rebuild re-links the chain
  //    and leaves its own fact, so the verifier goes clean again.)
  const ingEvent = await DomainEvent.findOne({ idempotencyKey: 'bank_statement_ingested:BS-2026-09-07' }).lean();
  check('the ingestion fact is chained', Boolean(ingEvent) && ingEvent.payload.queued === 0 && ingEvent.payload.confirmed === 1);
  const chainScar = await domainEvents.verifyChains({ tenantId: tenant._id });
  check('the restore scars from §12–13 are visible as broken_links', chainScar.breaks.length >= 2 && chainScar.breaks.every((b) => b.type === 'broken_link'), JSON.stringify(chainScar.breaks.map((b) => b.type)));
  const rebuild = await domainEvents.rebuildChain({ tenantId: tenant._id });
  check('a deliberate rebuild re-links the chain', (rebuild.relinked || 0) > 0, JSON.stringify(rebuild));
  const chainS = await domainEvents.verifyChains({ tenantId: tenant._id });
  check('★ chain verifies clean after the rebuild (fact on the chain)', chainS.ok === true && Boolean(await DomainEvent.findOne({ kind: 'chain_rebuilt' })), JSON.stringify(chainS.breaks));

  // 7) the reconciliation picture
  const stmtSum = await bankStatement.summary({});
  check('summary: confirmed + returned + queued counts', stmtSum.confirmed >= 2 && stmtSum.returned === 1 && stmtSum.unmatched === 2, JSON.stringify({ c: stmtSum.confirmed, r: stmtSum.returned, u: stmtSum.unmatched }));
  check('summary: the queue shows the unknown lines', stmtSum.queued.length === 2 && stmtSum.queued.every((q) => q.utr.startsWith('NO-SUCH-UTR')), JSON.stringify(stmtSum.queued.map((q) => q.utr)));
  eq('statement lines are immutable records (1+1+2+1, re-ingest adds none)', await BankStatementLineM.countDocuments({}), 5);

  const tbB = await ledgerService.trialBalance();
  check('★ trial balance still balances after confirm + return + settle', tbB.balanced, `diff ${tbB.differencePaise}`);

  // -------------------------------------------------------------------------
  section('16. final integrity');
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
