/**
 * smoke-gstpayable.test.js — Phase 19 GST output payable integrity, end to end.
 *
 * DUAL MODE (same as smoke-ledger.test.js):
 *   1. MONGODB_URI set → real MongoDB (CI).
 *   2. no URI → mongodb-memory-server.
 *   3. neither + REQUIRE_DB unset → SKIPS with exit 0.
 *
 * Proves the GST output payables ARE real ledger accounts:
 *
 *   gst_output_payable:{v}  =  Σ sale credits  (item tax, paid orders)
 *                            − Σ refund debits (the journal's proportional
 *                                             reversal of the sale credit)
 *                            − Σ payout drains (batch.sellerGstPaise of
 *                                             LIVE batches — PROCESSING/PAID)
 *
 *   gst_output_payable:platform = Σ batch.gstOnCommissionPaise (live batches)
 *
 *   §1  a sale credits the seller's GST
 *   §2  a paid payout drains it (and books the platform's commission GST)
 *   §3  full and partial pre-payout refunds (the journal's proportional
 *       reversal, matched to the paise from domain facts)
 *   §4  post-payout refund + clawback + the offsetting payout
 *   §5  a bank reversal unwinds the drain
 *   §6  drift → detected to the paise → signed backfill → balanced
 *   §7  GST_BACKFILL replay is refused (never guessed)
 *   §8  trial balance + audit chain hold with GST journals mixed in
 */

import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
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
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  const uri = mongod.getUri('flower_market_gstpayable_test');
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
      console.error(`\n❌ smoke-gstpayable: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-gstpayable needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_gstpayable_test node scripts/smoke-gstpayable.test.js\n');
    process.exit(0);
  }

  console.log(`\n🏷  Phase 19 GST-output-payable smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: payoutService } = await import('../src/services/payout.service.js');
  const { default: domainEventService } = await import('../src/services/domainEvent.service.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: VendorPayoutAccount } = await import('../src/models/vendorPayoutAccount.model.js');
  const { default: PayoutBatch } = await import('../src/models/payoutBatch.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: LedgerJournal } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntry } = await import('../src/models/ledgerEntry.model.js');
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const { default: AccountBalance } = await import('../src/models/accountBalance.model.js');
  const {
    PAYOUT_STATE, LEDGER_JOURNAL_KIND, DOMAIN_EVENT_TYPE,
    REFUND_DESTINATION, REFUND_REASON, REFUND_TRANSACTION_STATUS,
  } = await import('../src/constants/enums.js');
  const { toPaise, fromPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const d = (days) => new Date(Date.now() - days * 86400000);
  const TENANT = oid();
  const ACTOR = oid();

  await ledgerService.ensureChartOfAccounts();

  const vendor = await Vendor.create({
    userId: oid(), businessName: 'GST Greens', slug: `gst-greens-${Date.now()}`,
    status: 'active', commissionRateBps: 1000,
  });
  const acct = await VendorPayoutAccount.create({
    vendorId: vendor._id, method: 'bank', accountHolderName: 'GST Greens',
    accountNumberEnc: Buffer.from('99887766554').toString('base64'),
    ifsc: 'SBIN0009876', maskedAccount: '****5544', fingerprint: 'fp-gg', isDefault: true, status: 'active',
  });
  acct.kyc.status = 'approved';
  acct.verification.status = 'verified';
  await acct.save();

  const vGstCode = ledgerAccounts.gstOutputPayable(vendor._id);
  const pGstCode = ledgerAccounts.gstOutputPayable('platform');
  const vBal = async () => (await ledgerService.balance(vGstCode)).balancePaise;
  const pBal = async () => (await ledgerService.balance(pGstCode)).balancePaise;
  const vRec = async () => payoutService.reconcileVendorGst({ vendorId: vendor._id });
  const pRec = async () => payoutService.reconcilePlatformGst();
  const allBalanced = async () => {
    const [v, p] = [await vRec(), await pRec()];
    return v.balanced && p.balanced;
  };

  // ₹1,000 goods + ₹120 GST (12%) on a vendor line: total ₹1,120 (default).
  // Model money fields are RUPEES — the ledger converts to paise.
  async function makeOrder({ deliveredDaysAgo = 30, lineTotal = 1000, tax = 120 }) {
    const deliveredAt = d(deliveredDaysAgo);
    const order = await Order.create({
      tenantId: TENANT, userId: oid(), orderNumber: `FM-GQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: tax, totalAmount: lineTotal + tax, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: TENANT, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendor._id, skuSnapshot: { title: 'GST Item' },
      priceAtOrder: { sellingPrice: lineTotal }, qty: 1, lineTotal, taxAmount: tax, discountAllocated: 0,
    });
    await ledgerPosting.postSaleCaptured({ order });
    return order;
  }

  async function refundOrder(order, rupees) {
    const rt = await RefundTransaction.create({
      tenantId: TENANT, orderId: order._id, userId: oid(),
      amount: rupees, reason: REFUND_REASON.ORDER_CANCELLED, destination: REFUND_DESTINATION.WALLET,
      idempotencyKey: `refund_gq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      status: REFUND_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(),
    });
    await ledgerPosting.postRefund({ refundTransaction: rt });
    await payoutService.reverseForRefund({ refundTransaction: rt });
    return rt;
  }

  // white-box: push an APPROVED batch to PROCESSING with its live journal
  async function toProcessing(batchId) {
    const doc = await PayoutBatch.findById(batchId);
    if (doc.state === PAYOUT_STATE.APPROVED) {
      await payoutService.transition(doc, PAYOUT_STATE.QUEUED, { note: 'queued for provider' });
    }
    await payoutService.transition(doc, PAYOUT_STATE.PROCESSING, { note: 'submitting to provider' });
    doc.submittedAt = new Date();
    await doc.save();
    await domainEventService.append({
      tenantId: doc.tenantId, kind: DOMAIN_EVENT_TYPE.PAYOUT_INITIATED,
      aggregateType: 'payout_batch', aggregateId: doc._id,
      idempotencyKey: `payout_initiated:payout_batch:${doc._id}`,
      occurredAt: doc.submittedAt, refType: 'payout_batch', refId: doc._id,
      payload: { batchNumber: doc.batchNumber, vendorId: doc.vendorId, netPaise: doc.netPaise },
    });
    await payoutService.postPayoutJournal(doc);
    return doc;
  }

  const payCycle = async (window) => {
    const cyc = await payoutService.computeCycleForVendor({ vendorId: vendor._id, ...window });
    check('draft created for the window', cyc.created === true);
    await payoutService.submitForApproval({ batchId: cyc.batch._id });
    await payoutService.approve({ batchId: cyc.batch._id, actorId: ACTOR });
    await payoutService.submit({ batchId: cyc.batch._id, actorId: ACTOR });
    return cyc;
  };

  // ==========================================================================
  section('§1 a sale credits the seller GST');
  // ==========================================================================
  const o1 = await makeOrder({});
  await payoutService.accrueForOrder({ orderId: o1._id });
  await payoutService.markEligible({});
  eq('gst_output_payable:{v} = the item tax', await vBal(), 12000);
  let r = await vRec();
  eq('sale credits = item tax', r.saleCreditsPaise, 12000);
  eq('vendor GST balanced pre-payout', r.balanced, true);
  r = await pRec();
  eq('platform GST 0 before any payout', r.expectedPaise, 0);
  check('platform GST balanced pre-payout', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§2 a paid payout drains it (and books the commission GST)');
  // ==========================================================================
  const cyc1 = await payCycle({ from: d(31), to: d(20) });
  eq('batch PAID', (await PayoutBatch.findById(cyc1.batch._id)).state, PAYOUT_STATE.PAID);
  eq('batch aggregated the seller GST', cyc1.batch.sellerGstPaise, 12000);
  eq('vendor GST drained', await vBal(), 0);
  r = await vRec();
  eq('expected = sale − live drain', r.expectedPaise, 12000 - 12000);
  check('vendor GST balanced post-payout', r.balanced, JSON.stringify(r));
  r = await pRec();
  eq('platform GST = commission GST (18% of ₹100)', r.expectedPaise, 1800);
  eq('platform GST books', await pBal(), 1800);
  check('platform GST balanced post-payout', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§3 full + partial pre-payout refunds (proportional, to the paise)');
  // ==========================================================================
  const o2 = await makeOrder({});
  await payoutService.accrueForOrder({ orderId: o2._id });
  await payoutService.markEligible({});
  await refundOrder(o2, fromPaise(112000)); // full refund
  eq('vendor GST back to 0 after full refund', await vBal(), 0);
  r = await vRec();
  eq('refund debit = the full item tax', r.refundDebitsPaise, 12000);
  check('vendor GST balanced after full refund', r.balanced, JSON.stringify(r));

  const o3 = await makeOrder({});
  await payoutService.accrueForOrder({ orderId: o3._id });
  await payoutService.markEligible({});
  await refundOrder(o3, fromPaise(56000)); // exactly half of ₹1,120
  eq('vendor GST halved by the partial refund', await vBal(), 6000);
  r = await vRec();
  eq('partial refund debit = 6,000 (proportional, to the paise)', r.refundDebitsPaise, 18000);
  eq('expected = 24,000 sale − 18,000 refunds − 12,000 drain', r.expectedPaise, 6000);
  check('vendor GST balanced after partial refund', r.balanced, JSON.stringify(r));
  check('platform GST still balanced', (await pRec()).balanced);

  // ==========================================================================
  section('§4 post-payout refund + clawback + the offsetting payout');
  // ==========================================================================
  const o4 = await makeOrder({});
  await payoutService.accrueForOrder({ orderId: o4._id });
  await payoutService.markEligible({});
  const cyc4 = await payCycle({ from: d(27), to: d(15) });
  check('balanced after the second payout', await allBalanced());

  await refundOrder(o4, fromPaise(112000)); // full refund AFTER the payout
  check('clawback posted: books = o3 half-refund 6,000 − o4 net 12,000', await vBal() === -6000, `books=${await vBal()}`);
  check('still balanced — the debt is owed to the books', await allBalanced());

  // a BIGGER new sale whose payout absorbs the clawback — positive net cash
  // (a zero-net batch is refused at submit) and a positive GST drain
  const o5 = await makeOrder({ deliveredDaysAgo: 7, lineTotal: 2000, tax: 240 });
  await payoutService.accrueForOrder({ orderId: o5._id });
  await payoutService.markEligible({});
  const cyc5 = await payCycle({ from: d(1), to: new Date(Date.now() + 2 * 86400000) });
  eq('absorbing batch: seller GST = 24,000 − 12,000 clawback', (await PayoutBatch.findById(cyc5.batch._id)).sellerGstPaise, 12000);
  eq('vendor GST books', await vBal(), 6000);
  r = await vRec();
  eq('expected = 72,000 − 30,000 − 36,000', r.expectedPaise, 6000);
  check('vendor GST balanced after absorption', r.balanced, JSON.stringify(r));
  check('platform GST balanced after absorption', (await pRec()).balanced);

  // ==========================================================================
  section('§5 a bank reversal unwinds the drain');
  // ==========================================================================
  // reverse the o4 batch (white-box: it is already PAID)
  await payoutService.markReversed({ batch: await PayoutBatch.findById(cyc4.batch._id), reason: 'bank reversed the payout' });
  eq('vendor GST credit restored by the mirror', await vBal(), 6000 + 12000);
  r = await vRec();
  eq('expected excludes the reversed batch', r.expectedPaise, 72000 - 30000 - 24000);
  check('vendor GST balanced after bank reversal', r.balanced, JSON.stringify(r));
  r = await pRec();
  eq('platform GST mirror: the reversed batch un-books its commission GST', r.expectedPaise, 3600);
  check('platform GST balanced after bank reversal', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§6 drift → detected to the paise → signed backfill → balanced');
  // ==========================================================================
  const driftPaise = 6000;
  await AccountBalance.updateOne({ accountCode: vGstCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  r = await vRec();
  eq('vendor GST drift detected to the paise', r.differencePaise, driftPaise);
  check('vendor GST not balanced', r.balanced === false);
  check('platform GST still balanced', (await pRec()).balanced);
  const all = await payoutService.reconcileGst({});
  eq('platform: exactly one owner drifted', all.drifted, 1);

  const rep = await payoutService.postGstBackfill({ scope: 'vendor', vendorId: vendor._id, differencePaise: r.differencePaise, note: 'hermetic repair' });
  check('backfill posted', rep.posted === true, JSON.stringify(rep));
  r = await vRec();
  check('vendor GST balanced after backfill', r.balanced, JSON.stringify(r));

  const bfDocs = await LedgerJournal.find({ kind: LEDGER_JOURNAL_KIND.GST_BACKFILL });
  const bf = bfDocs.find((j) => j.meta?.vendorId === String(vendor._id));
  eq('exactly one GST backfill journal', bfDocs.length, 1);
  const drB = bf.lines.find((l) => l.accountCode === ledgerAccounts.gatewayClearing() && l.debitPaise > 0);
  const crB = bf.lines.find((l) => l.accountCode === vGstCode && l.creditPaise > 0);
  check('signed correctly (under-stated → DR clearing / CR seller GST)', !!drB && !!crB && drB.debitPaise === driftPaise && crB.creditPaise === driftPaise, JSON.stringify(bf?.lines));
  const evBf = await domainEventService.findEventByKey(bf.idempotencyKey);
  check('backfill event posted with the difference (same key as the journal)', !!evBf && evBf.kind === DOMAIN_EVENT_TYPE.GST_BACKFILL && evBf.payload.differencePaise === driftPaise);

  let empty = null;
  try { await payoutService.postGstBackfill({ scope: 'vendor', vendorId: vendor._id, differencePaise: 0 }); }
  catch (e) { empty = e; }
  check('zero-difference backfill refused', empty && empty.code === 'GST_BACKFILL_EMPTY', empty ? String(empty.code) : 'no error');

  // ==========================================================================
  section('§7 GST_BACKFILL replay is refused — never guessed');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: bf._id });
  await LedgerJournal.deleteOne({ _id: bf._id });
  await AccountBalance.updateOne({ accountCode: vGstCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  await AccountBalance.updateOne({ accountCode: ledgerAccounts.gatewayClearing() }, { $inc: { debitTotalPaise: -driftPaise, entryCount: -1 } });
  r = await vRec();
  eq('drift returns when the backfill journal is gone', r.differencePaise, driftPaise);

  const drift = await domainEventService.findDrift();
  check('missing backfill flagged by findDrift', drift.missingJournals.some((m) => m.kind === DOMAIN_EVENT_TYPE.GST_BACKFILL), JSON.stringify(drift.missingJournals.map((m) => m.kind)));
  const healed = await domainEventService.replay({ limit: 50 });
  eq('backfill NOT re-posted', healed.journalsReposted, 0);
  check('failure reports GST_BACKFILL_NOT_REPLAYABLE', healed.failed.some((f) => String(f.reason || '').includes('GST_BACKFILL_NOT_REPLAYABLE')), JSON.stringify(healed.failed));

  // the operator path: re-post under the SAME key the missing event carries
  const missing = drift.missingJournals.find((m) => m.kind === DOMAIN_EVENT_TYPE.GST_BACKFILL);
  await payoutService.postGstBackfill({ scope: 'vendor', vendorId: vendor._id, differencePaise: driftPaise, idempotencyKey: missing.idempotencyKey, note: 'hermetic re-post' });
  check('vendor GST balanced after manual re-post', (await vRec()).balanced);
  check('platform GST balanced after manual re-post', (await pRec()).balanced);
  const driftAfter = await domainEventService.findDrift();
  eq('no residual drift after the re-post', driftAfter.missingJournals.length, 0);

  // ==========================================================================
  section('§8 trial balance + audit chain hold with GST journals mixed in');
  // ==========================================================================
  const tb = await ledgerService.trialBalance();
  check('trial balance: DR = CR', tb.balanced, `DR ${tb.totalDebitPaise} vs CR ${tb.totalCreditPaise}`);
  const chains = await domainEventService.verifyChains({ tenantId: TENANT });
  check('audit chain verifies (no breaks)', (chains.breaks || []).length === 0, JSON.stringify(chains.breaks || []));

  // ==========================================================================
  console.log('\n' + '='.repeat(56));
  if (failed > 0) {
    console.log(`❌ GST-OUTPUT-PAYABLE SMOKE: ${failed} FAILED of ${passed + failed}`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ GST-OUTPUT-PAYABLE SMOKE: ALL ${passed} CHECKS PASSED (${mode})`);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); }).finally(() => {
  if (mongod) mongod.stop().catch(() => {});
  mongoose.disconnect().catch(() => {});
});
