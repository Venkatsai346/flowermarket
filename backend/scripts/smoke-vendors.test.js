/**
 * smoke-vendors.test.js — Phase 17 vendor payable integrity, end to end.
 *
 * DUAL MODE (same as smoke-ledger.test.js):
 *   1. MONGODB_URI set → real MongoDB (CI).
 *   2. no URI → mongodb-memory-server.
 *   3. neither + REQUIRE_DB unset → SKIPS with exit 0.
 *
 * Proves the vendor payable IS a real ledger account:
 *
 *   vendor_payable:{v}  ==  Σ unsettled lines (book view)
 *                         + pending/unposted adjustments
 *                         + surviving carry-forward (book view)
 *                         + absorbed-but-unposted openings
 *
 *   where a line's "book view" is exactly what the sale journal credited:
 *   netPayable + gstOnCommission + tcs + tds − sellerGst + shipping.
 *
 *   §1  balanced across the whole line lifecycle (accrued → eligible → held →
 *       released → draft batched → submitted → paid)
 *   §2  pre-payout refund: line reversed, journal drained, balanced, payable 0
 *   §3  post-payout refund (clawback): negative line → carry batch → cancel
 *       (line consumed) → debt absorbed by the next cycle → recovered TO THE
 *       PAISE, zero residue
 *   §4  DEBT-LOSS REGRESSIONS (Phase 17 bug fixes): a batch that absorbed a
 *       carry exits without a live journal (cancel / provider failure / bank
 *       reversal) — the debt is re-parked as carry, never lost
 *   §5  adjustments: pending, applied to a draft, applied to a posted batch
 *   §6  drift → detected to the paise → signed backfill → balanced → no-op
 *   §7  VENDOR_BACKFILL replay is refused (VENDOR_BACKFILL_NOT_REPLAYABLE)
 *   §8  trial balance + audit chain hold with vendor journals mixed in
 */

import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo, stopHermeticMongoSync } from './lib/hermeticMongo.js';
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
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  const uri = mongod.getUri('flower_market_vendors_test');
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
      console.error(`\n❌ smoke-vendors: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-vendors needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_vendors_test node scripts/smoke-vendors.test.js\n');
    process.exit(0);
  }

  console.log(`\n🏪 Phase 17 vendor-payable smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: payoutService } = await import('../src/services/payout.service.js');
  const { default: domainEventService } = await import('../src/services/domainEvent.service.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: VendorPayoutAccount } = await import('../src/models/vendorPayoutAccount.model.js');
  const { default: PayoutBatch } = await import('../src/models/payoutBatch.model.js');
  const { default: PayoutLineItem } = await import('../src/models/payoutLineItem.model.js');
  const { default: PayoutAdjustment } = await import('../src/models/payoutAdjustment.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: LedgerJournal } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntry } = await import('../src/models/ledgerEntry.model.js');
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const {
    PAYOUT_STATE, PAYOUT_LINE_STATE, LEDGER_JOURNAL_KIND, DOMAIN_EVENT_TYPE,
    REFUND_DESTINATION, REFUND_REASON, REFUND_TRANSACTION_STATUS,
  } = await import('../src/constants/enums.js');
  const { toPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const d = (days) => new Date(Date.now() - days * 86400000);
  const TENANT = oid();
  const ACTOR = oid();

  await ledgerService.ensureChartOfAccounts();

  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Integrity Greens', slug: `integrity-greens-${Date.now()}`,
    status: 'active', commissionRateBps: 1000,
  });
  const acct = await VendorPayoutAccount.create({
    vendorId: vendor._id, method: 'bank', accountHolderName: 'Integrity Greens',
    accountNumberEnc: Buffer.from('99887766554').toString('base64'),
    ifsc: 'SBIN0009876', maskedAccount: '****5544', fingerprint: 'fp-ig', isDefault: true, status: 'active',
  });
  acct.kyc.status = 'approved';
  acct.verification.status = 'verified';
  await acct.save();

  const vCode = ledgerAccounts.vendorPayable(vendor._id);
  const payable = async () => (await ledgerService.balance(vCode)).balancePaise;
  const rec = async (opts = {}) => payoutService.reconcileVendor({ vendorId: vendor._id, ...opts });
  const line = (orderNumber) => PayoutLineItem.findOne({ orderNumber, reversalOfLineId: null });
  const view = (l) => payoutService.lineLedgerViewPaise(l);

  async function makeOrder({ lineTotal, deliveredDaysAgo = 30 }) {
    const deliveredAt = d(deliveredDaysAgo);
    const order = await Order.create({
      tenantId: TENANT, userId: oid(), orderNumber: `FM-VQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: 0, totalAmount: lineTotal, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: TENANT, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendor._id, skuSnapshot: { title: 'Integrity Item' },
      priceAtOrder: { sellingPrice: lineTotal }, qty: 1, lineTotal, taxAmount: 0, discountAllocated: 0,
    });
    await ledgerPosting.postSaleCaptured({ order });
    return order;
  }

  const bookView = (grossPaise, gstPaise, commissionPaise) => grossPaise - gstPaise - commissionPaise;

  // ==========================================================================
  section('§1 balanced across the whole line lifecycle');
  // ==========================================================================
  const o1 = await makeOrder({ lineTotal: 2000 });
  eq('sale posted: payable = book view', await payable(), bookView(toPaise(2000), 0, Math.round(toPaise(2000) * 1000 / 10000)));
  let r = await rec();
  // before accrual the vendor has a ledger balance but NO lines yet — the
  // pre-payout-system state. The invariant must flag it (a backfill candidate).
  check('pre-line state is flagged as drift', r.balanced === false, JSON.stringify(r));
  eq('…and the difference is exactly the sale (book view)', r.differencePaise, -bookView(toPaise(2000), 0, Math.round(toPaise(2000) * 1000 / 10000)));

  await payoutService.accrueForOrder({ orderId: o1._id });
  r = await rec();
  check('balanced once the line exists (ACCRUED)', r.balanced, JSON.stringify(r));
  const l1 = await line(o1.orderNumber);
  eq('book view = drain (net + withholdings − gst)', view(l1), l1.grossPaise - l1.sellerGstPaise - l1.commissionPaise);

  await payoutService.markEligible({});
  eq('line ELIGIBLE', (await line(o1.orderNumber)).state, PAYOUT_LINE_STATE.ELIGIBLE);
  check('balanced (ELIGIBLE)', (await rec()).balanced);

  await payoutService.holdLines({ lineIds: [l1._id], reason: 'dispute', actorId: ACTOR });
  check('balanced (HELD)', (await rec()).balanced, JSON.stringify(await rec()));
  await payoutService.releaseLines({ lineIds: [l1._id], actorId: ACTOR });

  const cyc1 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(31), to: d(20) });
  check('draft batch created', cyc1.created === true);
  eq('line BATCHED', (await line(o1.orderNumber)).state, PAYOUT_LINE_STATE.BATCHED);
  r = await rec();
  check('balanced (BATCHED in DRAFT — journal not live)', r.balanced, JSON.stringify(r));

  await payoutService.submitForApproval({ batchId: cyc1.batch._id });
  await payoutService.approve({ batchId: cyc1.batch._id, actorId: ACTOR });
  await payoutService.submit({ batchId: cyc1.batch._id, actorId: ACTOR });
  eq('batch PAID', (await PayoutBatch.findById(cyc1.batch._id)).state, PAYOUT_STATE.PAID);
  r = await rec();
  check('balanced (journal live — line drained)', r.balanced, JSON.stringify(r));
  eq('payable back to 0', await payable(), 0);

  // ==========================================================================
  section('§2 pre-payout refund: line reversed, journal drained, payable 0');
  // ==========================================================================
  const o2 = await makeOrder({ lineTotal: 3000, deliveredDaysAgo: 20 });
  await payoutService.accrueForOrder({ orderId: o2._id });
  await payoutService.markEligible({});
  check('balanced (line ELIGIBLE)', (await rec()).balanced);

  const rt2 = await RefundTransaction.create({
    tenantId: TENANT, orderId: o2._id, userId: oid(),
    amount: o2.totalAmount, reason: REFUND_REASON.ORDER_CANCELLED, destination: REFUND_DESTINATION.WALLET,
    idempotencyKey: `refund_v2_${Date.now()}`, status: REFUND_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(),
  });
  await ledgerPosting.postRefund({ refundTransaction: rt2 });
  await payoutService.reverseForRefund({ refundTransaction: rt2 });
  eq('line REVERSED', (await line(o2.orderNumber)).state, PAYOUT_LINE_STATE.REVERSED);
  r = await rec();
  check('balanced (refunded before payout)', r.balanced, JSON.stringify(r));
  eq('payable = 0 (sale CR fully drained by the refund)', await payable(), 0);

  // ==========================================================================
  section('§3 post-payout refund: the clawback debt is recovered to the paise');
  // ==========================================================================
  const o3 = await makeOrder({ lineTotal: 2000 });
  await payoutService.accrueForOrder({ orderId: o3._id });
  await payoutService.markEligible({});
  // window chosen so eligibleAt (d(30) − 7d = d(23)) falls inside [d(27), d(16))
  const cyc3 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(27), to: d(16) });
  eq('a fresh draft batch for o3', cyc3.created === true && cyc3.batch.state, 'draft');
  await payoutService.submitForApproval({ batchId: cyc3.batch._id });
  await payoutService.approve({ batchId: cyc3.batch._id, actorId: ACTOR });
  await payoutService.submit({ batchId: cyc3.batch._id, actorId: ACTOR });
  eq('o3 paid', (await PayoutBatch.findById(cyc3.batch._id)).state, PAYOUT_STATE.PAID);
  eq('payable 0 after payout', await payable(), 0);

  const l3 = await line(o3.orderNumber);
  const rt3 = await RefundTransaction.create({
    tenantId: TENANT, orderId: o3._id, userId: oid(),
    amount: o3.totalAmount, reason: REFUND_REASON.RETURN_QC_PASSED, destination: REFUND_DESTINATION.WALLET,
    idempotencyKey: `refund_v3_${Date.now()}`, status: REFUND_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(),
  });
  await ledgerPosting.postRefund({ refundTransaction: rt3 });
  const claw = await payoutService.reverseForRefund({ refundTransaction: rt3 });
  eq('clawback negative line created', claw.clawedBack, 1);
  const neg = await PayoutLineItem.findOne({ refundTransactionId: rt3._id, reversalOfLineId: { $ne: null } });
  r = await rec();
  check('balanced (negative line open — the debt is booked)', r.balanced, JSON.stringify(r));
  eq('payable = the debt in book units (negative)', await payable(), view(neg));
  check('debt exceeds the cash net (withholdings make it bigger)', view(neg) < neg.netPayablePaise);

  // the negative-only cycle → net zero, carry recorded in BOTH faces
  const cycCarry = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(2), to: new Date(Date.now() + 86400000) });
  const carryBatch = cycCarry.batch;
  eq('cycle nets to zero', carryBatch.netPaise, 0);
  eq('carry (cash units) = the negative line net', carryBatch.carryForwardPaise, neg.netPayablePaise);
  eq('carry (book units) = the negative line book view', carryBatch.carryLedgerViewPaise, view(neg));
  check('balanced (debt parked in the carry batch)', (await rec()).balanced, JSON.stringify(await rec()));

  await payoutService.cancel({ batchId: carryBatch._id, reason: 'debt carried, nothing to pay', actorId: ACTOR });
  eq('consumed negative line is PAID', (await PayoutLineItem.findById(neg._id)).state, PAYOUT_LINE_STATE.PAID);
  check('balanced (carry survives the cancel)', (await rec()).balanced, JSON.stringify(await rec()));

  // the vendor earns again — the debt reduces the next payout, to the paise
  const o4 = await makeOrder({ lineTotal: 3000, deliveredDaysAgo: 20 });
  await payoutService.accrueForOrder({ orderId: o4._id });
  await payoutService.markEligible({});
  const cyc4 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(16), to: d(9) });
  const batch4 = cyc4.batch;
  eq('opening (cash) = the carried debt', batch4.openingBalancePaise, carryBatch.carryForwardPaise);
  eq('opening (book) = the carried debt in book units', batch4.openingLedgerViewPaise, carryBatch.carryLedgerViewPaise);
  eq('old carry zeroed on absorption', (await PayoutBatch.findById(carryBatch._id)).carryForwardPaise, 0);
  const l4 = await line(o4.orderNumber);
  eq('payout reduced by the debt (cash)', batch4.netPaise, l4.netPayablePaise + batch4.openingBalancePaise);
  check('balanced (debt absorbed into a live batch)', (await rec()).balanced, JSON.stringify(await rec()));

  await payoutService.submitForApproval({ batchId: batch4._id });
  await payoutService.approve({ batchId: batch4._id, actorId: ACTOR });
  await payoutService.submit({ batchId: batch4._id, actorId: ACTOR });
  eq('reduced payout paid', (await PayoutBatch.findById(batch4._id)).state, PAYOUT_STATE.PAID);
  check('balanced after the reduced payout', (await rec()).balanced, JSON.stringify(await rec()));
  eq('★ the debt is recovered TO THE PAISE — zero residue', await payable(), 0);

  // ==========================================================================
  section('§4 DEBT-LOSS REGRESSIONS — an absorbed carry must not die with its batch');
  // ==========================================================================
  // NOTE: compute is idempotent per (vendor, window) — every submit below
  // needs its own distinct window. o5 delivered d(26) → eligible d(19);
  // o6 delivered d(24) → eligible d(17) (inside every window below).
  const W5 = { from: d(20), to: d(16) };
  const W6 = { from: d(18), to: d(14) };
  const W7 = { from: d(20), to: d(15) };
  const W8 = { from: d(19), to: d(14) };
  const W9 = { from: d(25), to: d(16) };

  // setup: a fresh paid sale, then a post-payout refund (the debt), then a
  // normal batch that ABSORBS the debt
  const o5 = await makeOrder({ lineTotal: 2000, deliveredDaysAgo: 26 });
  await payoutService.accrueForOrder({ orderId: o5._id });
  await payoutService.markEligible({});
  const cyc5 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...W5 });
  check('fresh draft for o5', cyc5.created === true && cyc5.batch.state, 'draft');
  await payoutService.submitForApproval({ batchId: cyc5.batch._id });
  await payoutService.approve({ batchId: cyc5.batch._id, actorId: ACTOR });
  await payoutService.submit({ batchId: cyc5.batch._id, actorId: ACTOR });
  const l5 = await line(o5.orderNumber);
  const rt5 = await RefundTransaction.create({
    tenantId: TENANT, orderId: o5._id, userId: oid(),
    amount: o5.totalAmount, reason: REFUND_REASON.RETURN_QC_PASSED, destination: REFUND_DESTINATION.WALLET,
    idempotencyKey: `refund_v5_${Date.now()}`, status: REFUND_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(),
  });
  await ledgerPosting.postRefund({ refundTransaction: rt5 });
  await payoutService.reverseForRefund({ refundTransaction: rt5 });
  const neg5 = await PayoutLineItem.findOne({ refundTransactionId: rt5._id, reversalOfLineId: { $ne: null } });
  const debtCash = neg5.netPayablePaise;
  const debtBook = view(neg5);
  check('balanced before absorption', (await rec()).balanced);

  // the debt becomes carry-forward (negative-only cycle, distinct window from §3's)
  const Wc4 = { from: d(2), to: new Date(Date.now() + 2 * 86400000) };
  const cycC4 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...Wc4 });
  const carry4 = cycC4.batch;
  eq('carry (cash) = the debt', carry4.carryForwardPaise, debtCash);
  eq('carry (book) = the debt in book units', carry4.carryLedgerViewPaise, debtBook);
  eq('negative line pinned to the carry batch', (await PayoutLineItem.findById(neg5._id)).state, PAYOUT_LINE_STATE.BATCHED);
  check('balanced (debt in the carry batch)', (await rec()).balanced, JSON.stringify(await rec()));

  const o6 = await makeOrder({ lineTotal: 3000, deliveredDaysAgo: 24 });
  await payoutService.accrueForOrder({ orderId: o6._id });
  await payoutService.markEligible({});
  const cyc6 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...W6 });
  const batch6 = cyc6.batch;
  check('balanced (debt absorbed, batch not yet submitted)', (await rec()).balanced, JSON.stringify(await rec()));

  // 4a. operator CANCELS the batch before submission — the debt must survive
  await payoutService.cancel({ batchId: batch6._id, reason: 'wrong window', actorId: ACTOR });
  const batch6b = await PayoutBatch.findById(batch6._id);
  eq('debt re-parked as carry (cash)', batch6b.carryForwardPaise, debtCash);
  eq('debt re-parked as carry (book)', batch6b.carryLedgerViewPaise, debtBook);
  eq('opening cleared (the carry is now the only view of it)', batch6b.openingLedgerViewPaise, 0);
  check('balanced after cancel-with-debt (no loss)', (await rec()).balanced, JSON.stringify(await rec()));
  eq('o6 line released for the next cycle', (await line(o6.orderNumber)).state, PAYOUT_LINE_STATE.ELIGIBLE);

  // 4b. the next batch absorbs the re-parked debt, is put in PROCESSING with
  //     its journal (white-box, exactly as submit() would), then the provider
  //     REJECTS it (markFailed unwinds) — the debt must survive again
  const cyc7 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...W7 });
  const batch7 = cyc7.batch;
  eq('debt absorbed again (cash)', batch7.openingBalancePaise, debtCash);
  eq('debt absorbed again (book)', batch7.openingLedgerViewPaise, debtBook);
  check('balanced (absorbed, draft)', (await rec()).balanced);
  await payoutService.submitForApproval({ batchId: batch7._id });
  await payoutService.approve({ batchId: batch7._id, actorId: ACTOR });
  const doc7 = await PayoutBatch.findById(batch7._id);
  await payoutService.transition(doc7, PAYOUT_STATE.QUEUED, { note: 'queued for disbursement' });
  await payoutService.transition(doc7, PAYOUT_STATE.PROCESSING, { note: 'submitting to provider' });
  doc7.submittedAt = new Date();
  await doc7.save();
  await domainEventService.append({
    tenantId: doc7.tenantId, kind: DOMAIN_EVENT_TYPE.PAYOUT_INITIATED,
    aggregateType: 'payout_batch', aggregateId: doc7._id,
    idempotencyKey: `payout_initiated:payout_batch:${doc7._id}`,
    occurredAt: doc7.submittedAt, refType: 'payout_batch', refId: doc7._id,
    payload: { batchNumber: doc7.batchNumber, vendorId: doc7.vendorId, netPaise: doc7.netPaise },
  });
  await payoutService.postPayoutJournal(doc7);
  check('journal posted at submission', !!(await LedgerJournal.findOne({ idempotencyKey: `payout_initiated:payout_batch:${batch7._id}` })));
  check('balanced (journal live — lines drained)', (await rec()).balanced, JSON.stringify(await rec()));
  await payoutService.markFailed({ batch: await PayoutBatch.findById(batch7._id), reason: 'provider rejected', actorId: ACTOR });
  const b7b = await PayoutBatch.findById(batch7._id);
  eq('failed: debt re-parked (cash)', b7b.carryForwardPaise, debtCash);
  eq('failed: debt re-parked (book)', b7b.carryLedgerViewPaise, debtBook);
  check('balanced after provider rejection + unwind', (await rec()).balanced, JSON.stringify(await rec()));

  // 4c. once more: submit for real, then the BANK REVERSES — the debt survives
  const cyc8 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...W8 });
  const batch8 = cyc8.batch;
  eq('debt absorbed again (book)', batch8.openingLedgerViewPaise, debtBook);
  await payoutService.submitForApproval({ batchId: batch8._id });
  await payoutService.approve({ batchId: batch8._id, actorId: ACTOR });
  await payoutService.submit({ batchId: batch8._id, actorId: ACTOR });
  check('balanced (live again)', (await rec()).balanced);
  await payoutService.markReversed({ batch: await PayoutBatch.findById(batch8._id), reason: 'closed account', actorId: ACTOR });
  const b8b = await PayoutBatch.findById(batch8._id);
  eq('reversed: debt re-parked (cash)', b8b.carryForwardPaise, debtCash);
  eq('reversed: debt re-parked (book)', b8b.carryLedgerViewPaise, debtBook);
  check('balanced after bank reversal + unwind', (await rec()).balanced, JSON.stringify(await rec()));

  // 4d. finally: o6's line + the re-parked debt are paid out and fully recovered
  const cyc9 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...W9 });
  const batch9 = cyc9.batch;
  await payoutService.submitForApproval({ batchId: batch9._id });
  await payoutService.approve({ batchId: batch9._id, actorId: ACTOR });
  await payoutService.submit({ batchId: batch9._id, actorId: ACTOR });
  eq('paid', (await PayoutBatch.findById(batch9._id)).state, PAYOUT_STATE.PAID);
  check('balanced (final)', (await rec()).balanced, JSON.stringify(await rec()));
  eq('★ zero residue after cancel → fail → reverse → pay', await payable(), 0);

  // ==========================================================================
  section('§5 adjustments: pending, applied to a draft, posted');
  // ==========================================================================
  check('balanced before adjustments', (await rec()).balanced);
  await payoutService.addAdjustment({ vendorId: vendor._id, amountPaise: 5000, reasonCode: 'goodwill', note: 'hermetic', actorId: ACTOR });
  r = await rec();
  eq('pending adjustment counted in the owed', r.adjustmentsPaise, 5000);
  check('balanced (the adjustment journal is posted at creation)', r.balanced, JSON.stringify(r));

  const o7 = await makeOrder({ lineTotal: 3000, deliveredDaysAgo: 20 });
  await payoutService.accrueForOrder({ orderId: o7._id });
  await payoutService.markEligible({});
  const cycA = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(15), to: d(9) });
  const batchA = cycA.batch;
  const adjRow = await PayoutAdjustment.findOne({ vendorId: vendor._id, appliedInBatchId: batchA._id });
  check('adjustment pinned to the draft batch', !!adjRow);
  r = await rec();
  check('balanced (adjustment in a draft batch = still owed, once)', r.balanced, JSON.stringify(r));

  await payoutService.submitForApproval({ batchId: batchA._id });
  await payoutService.approve({ batchId: batchA._id, actorId: ACTOR });
  await payoutService.submit({ batchId: batchA._id, actorId: ACTOR });
  eq('paid', (await PayoutBatch.findById(batchA._id)).state, PAYOUT_STATE.PAID);
  r = await rec();
  check('balanced (adjustment posted — now in the journal)', r.balanced, JSON.stringify(r));
  eq('payable 0 (adjustment + sale fully drained)', await payable(), 0);

  // ==========================================================================
  section('§6 drift → detected to the paise → signed backfill → balanced');
  // ==========================================================================
  const o8 = await makeOrder({ lineTotal: 2000, deliveredDaysAgo: 20 });
  await payoutService.accrueForOrder({ orderId: o8._id });
  await payoutService.markEligible({});
  check('balanced (fresh sale line open)', (await rec()).balanced);

  // white-box: the sale journal vanished (crash window / pre-Phase-17 history)
  // while the payout line survives — the books under-state what is owed
  const driftPaise = view(await line(o8.orderNumber));
  const saleJ = await LedgerJournal.findOne({ idempotencyKey: `sale_captured:order:${o8._id}` });
  await LedgerEntry.deleteMany({ journalId: saleJ._id });
  await LedgerJournal.deleteOne({ _id: saleJ._id });
  // roll the materialized view back too (it is a cache — deleting the
  // journal does not touch it, and a real pre-ledger gap would show the
  // same shape: lines owe money the books never recorded)
  const { default: AccountBalance } = await import('../src/models/accountBalance.model.js');
  await AccountBalance.updateOne({ accountCode: vCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  r = await rec();
  eq('drift detected to the paise', r.differencePaise, driftPaise);
  check('not balanced', r.balanced === false);

  const rp = await rec({ repair: true });
  check('repair posted a backfill', rp.repaired && rp.repaired.posted === true, JSON.stringify(rp));
  eq('balanced after backfill (post-repair state reported)', rp.balanced, true);

  const backfills = await LedgerJournal.find({ kind: LEDGER_JOURNAL_KIND.VENDOR_BACKFILL, refId: vendor._id });
  eq('exactly one backfill journal', backfills.length, 1);
  const bf = backfills[0];
  const dr = bf.lines.find((l) => l.accountCode === ledgerAccounts.gatewayClearing() && l.debitPaise > 0);
  const cr = bf.lines.find((l) => l.accountCode === vCode && l.creditPaise > 0);
  check('signed correctly (books under-stated → DR clearing / CR vendor_payable)', !!dr && !!cr && dr.debitPaise === driftPaise && cr.creditPaise === driftPaise, JSON.stringify(bf.lines));
  const evBf = await domainEventService.findEventByKey(bf.idempotencyKey);
  check('backfill event posted with the difference', !!evBf && evBf.kind === DOMAIN_EVENT_TYPE.VENDOR_BACKFILL && evBf.payload.differencePaise === driftPaise);

  const noOp = await rec({ repair: true });
  check('second repair is a no-op', noOp.repaired === null && noOp.balanced === true);

  // ==========================================================================
  section('§7 VENDOR_BACKFILL replay is refused — never guessed');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: bf._id });
  await LedgerJournal.deleteOne({ _id: bf._id });
  await AccountBalance.updateOne({ accountCode: vCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  const drift = await domainEventService.findDrift();
  check('missing backfill flagged by findDrift', drift.missingJournals.some((m) => m.kind === DOMAIN_EVENT_TYPE.VENDOR_BACKFILL), JSON.stringify(drift.missingJournals.map((m) => m.kind)));
  const healed = await domainEventService.replay({ limit: 50 });
  eq('backfill NOT re-posted', healed.journalsReposted, 0);
  check('failure reports VENDOR_BACKFILL_NOT_REPLAYABLE', healed.failed.some((f) => String(f.reason || '').includes('VENDOR_BACKFILL_NOT_REPLAYABLE')), JSON.stringify(healed.failed));

  // re-post manually via the service (the operator path) so the rest of the
  // suite can prove the trial balance with the journal present
  await payoutService.postVendorBackfill({ vendorId: vendor._id, differencePaise: driftPaise, note: 'hermetic re-post' });

  // ==========================================================================
  section('§8 trial balance + audit chain hold with vendor journals mixed in');
  // ==========================================================================
  const tb = await ledgerService.trialBalance();
  check('trial balance: DR = CR', tb.balanced, `DR ${tb.totalDebitPaise} vs CR ${tb.totalCreditPaise}`);
  const chains = await domainEventService.verifyChains({ tenantId: TENANT });
  check('audit chain verifies (no breaks)', (chains.breaks || []).length === 0, JSON.stringify(chains.breaks || []));
  const all = await payoutService.reconcileVendors({});
  check('platform reconcile: no drifted vendor', all.ok === true, JSON.stringify(all.driftedSample));

  // ==========================================================================
  console.log(`\n${'='.repeat(56)}`);
  if (failed === 0) console.log(`✅ VENDOR-PAYABLE SMOKE: ALL ${passed} CHECKS PASSED (${mode})`);
  else {
    console.log(`❌ VENDOR-PAYABLE SMOKE: ${failed}/${passed + failed} FAILED (${mode})`);
    failures.forEach((f) => console.log(`   ✗ ${f}`));
  }
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 smoke-vendors crashed:', err);
  stopHermeticMongoSync(mongod);
  process.exit(1);
});
