/**
 * smoke-statutory.test.js — Phase 18 statutory payable integrity, end to end.
 *
 * DUAL MODE (same as smoke-ledger.test.js):
 *   1. MONGODB_URI set → real MongoDB (CI).
 *   2. no URI → mongodb-memory-server.
 *   3. neither + REQUIRE_DB unset → SKIPS with exit 0.
 *
 * Proves the TCS/TDS payables ARE real ledger accounts:
 *
 *   {statute}_payable  ==  withheld (Σ batch.{tcs,tds}Paise of batches whose
 *                          payout journal is live — PROCESSING/PAID)
 *                       −  net deposits (recorded − reverted)
 *
 * A REVERSED or FAILED batch booked the withholding AND posted the mirror
 * unwind, so it nets to zero and is not "withheld".
 *
 *   §1  a paid payout books the withholdings (TCS u/s 52, TDS u/s 194-O)
 *   §2  a deposit reduces the liability; over-deposit is refused
 *   §3  a revert restores it
 *   §4  a bank reversal unwinds the withheld amount
 *   §5  a provider failure unwinds it too
 *   §6  drift → detected to the paise → signed backfill (DR bank / CR
 *       payable when under-stated) → balanced → zero-diff refused
 *   §7  STATUTORY_BACKFILL replay is refused (never guessed)
 *   §8  trial balance + audit chain hold with statutory journals mixed in
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
  const uri = mongod.getUri('flower_market_statutory_test');
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
      console.error(`\n❌ smoke-statutory: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-statutory needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_statutory_test node scripts/smoke-statutory.test.js\n');
    process.exit(0);
  }

  console.log(`\n🏛  Phase 18 statutory-payable smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: payoutService } = await import('../src/services/payout.service.js');
  const { default: statutoryService } = await import('../src/services/statutory.service.js');
  const { default: domainEventService } = await import('../src/services/domainEvent.service.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: VendorPayoutAccount } = await import('../src/models/vendorPayoutAccount.model.js');
  const { default: StatutoryRate } = await import('../src/models/statutoryRate.model.js');
  const { default: StatutoryDeposit } = await import('../src/models/statutoryDeposit.model.js');
  const { default: PayoutBatch } = await import('../src/models/payoutBatch.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: LedgerJournal } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntry } = await import('../src/models/ledgerEntry.model.js');
  const { default: AccountBalance } = await import('../src/models/accountBalance.model.js');
  const {
    PAYOUT_STATE, LEDGER_JOURNAL_KIND, DOMAIN_EVENT_TYPE, STATUTORY_RATE_KIND,
  } = await import('../src/constants/enums.js');
  const { toPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const d = (days) => new Date(Date.now() - days * 86400000);
  const TENANT = oid();
  const ACTOR = oid();

  await ledgerService.ensureChartOfAccounts();

  // effective-dated statutory rates: TCS 1.0% (s.52) on net taxable,
  // TDS 0.5% (s.194-O) on gross sales
  await StatutoryRate.create([
    { kind: STATUTORY_RATE_KIND.TCS_GST_52, rateBps: 100, appliesTo: 'net_taxable', effectiveFrom: d(365), notificationRef: 'hermetic-tcs' },
    { kind: STATUTORY_RATE_KIND.TDS_194O, rateBps: 50, appliesTo: 'gross_sales', effectiveFrom: d(365), notificationRef: 'hermetic-tds' },
  ]);

  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Statutory Greens', slug: `statutory-greens-${Date.now()}`,
    status: 'active', commissionRateBps: 1000,
  });
  const acct = await VendorPayoutAccount.create({
    vendorId: vendor._id, method: 'bank', accountHolderName: 'Statutory Greens',
    accountNumberEnc: Buffer.from('99887766554').toString('base64'),
    ifsc: 'SBIN0009876', maskedAccount: '****5544', fingerprint: 'fp-sg', isDefault: true, status: 'active',
  });
  acct.kyc.status = 'approved';
  acct.verification.status = 'verified';
  await acct.save();

  const tcsCode = ledgerAccounts.tcsPayable();
  const tdsCode = ledgerAccounts.tdsPayable();
  const tcsBal = async () => (await ledgerService.balance(tcsCode)).balancePaise;
  const tdsBal = async () => (await ledgerService.balance(tdsCode)).balancePaise;
  const rec = async (opts = {}) => statutoryService.reconcile(opts);

  async function makeOrder({ lineTotal, deliveredDaysAgo = 30 }) {
    const deliveredAt = d(deliveredDaysAgo);
    const order = await Order.create({
      tenantId: TENANT, userId: oid(), orderNumber: `FM-SQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: 0, totalAmount: lineTotal, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: TENANT, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendor._id, skuSnapshot: { title: 'Statutory Item' },
      priceAtOrder: { sellingPrice: lineTotal }, qty: 1, lineTotal, taxAmount: 0, discountAllocated: 0,
    });
    await ledgerPosting.postSaleCaptured({ order });
    return order;
  }

  const TCS = (taxablePaise) => Math.round(taxablePaise * 100 / 10000); // 1.0%
  const TDS = (grossPaise) => Math.round(grossPaise * 50 / 10000);     // 0.5%

  // white-box: push an APPROVED batch to PROCESSING with its live journal,
  // without the mock provider auto-paying (so we can unwind it on purpose)
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
    eq('draft created for the window', cyc.created, true);
    await payoutService.submitForApproval({ batchId: cyc.batch._id });
    await payoutService.approve({ batchId: cyc.batch._id, actorId: ACTOR });
    await payoutService.submit({ batchId: cyc.batch._id, actorId: ACTOR });
    return cyc;
  };

  // ==========================================================================
  section('§1 a paid payout books the withholdings (TCS s.52 / TDS s.194-O)');
  // ==========================================================================
  const o1 = await makeOrder({ lineTotal: 2000 });
  await payoutService.accrueForOrder({ orderId: o1._id });
  await payoutService.markEligible({});
  // taxable 200000 → TCS 2000, TDS 1000
  const cyc1 = await payCycle({ from: d(31), to: d(20) });
  eq('batch PAID', (await PayoutBatch.findById(cyc1.batch._id)).state, PAYOUT_STATE.PAID);
  eq('batch aggregated TCS', cyc1.batch.tcsPaise, TCS(toPaise(2000)));
  eq('batch aggregated TDS', cyc1.batch.tdsPaise, TDS(toPaise(2000)));
  eq('tcs_payable = the withheld TCS', await tcsBal(), TCS(toPaise(2000)));
  eq('tds_payable = the withheld TDS', await tdsBal(), TDS(toPaise(2000)));

  let r = await rec({ statute: 'tcs' });
  eq('tcs: expected = withheld', r.expectedPaise, TCS(toPaise(2000)));
  eq('tcs: books = withheld', r.booksPaise, TCS(toPaise(2000)));
  check('tcs balanced', r.balanced, JSON.stringify(r));
  r = await rec();
  check('platform: both statutes balanced', r.ok === true && r.drifted === 0, JSON.stringify(r));

  // ==========================================================================
  section('§2 a deposit reduces the liability; over-deposit is refused');
  // ==========================================================================
  const dep1 = await statutoryService.deposit({ statute: 'tcs', amountPaise: 800, utr: 'UTR-HERM-TCS-1', tenantId: TENANT, actorId: ACTOR });
  check('deposit recorded', dep1.status === 'recorded', JSON.stringify(dep1));
  eq('tcs books reduced by the deposit', await tcsBal(), TCS(toPaise(2000)) - 800);
  r = await rec({ statute: 'tcs' });
  eq('tcs: expected = withheld − deposited', r.expectedPaise, TCS(toPaise(2000)) - 800);
  check('tcs balanced after deposit', r.balanced, JSON.stringify(r));

  let over = null;
  try { await statutoryService.deposit({ statute: 'tcs', amountPaise: 5000, utr: 'UTR-HERM-TCS-OVER' }); }
  catch (e) { over = e; }
  check('over-deposit refused (409)', over && over.code === 'STATUTORY_OVER_DEPOSIT' && over.status === 409, over ? `${over.code} ${over.status}` : 'no error');

  // ==========================================================================
  section('§3 a revert restores the liability');
  // ==========================================================================
  const rev1 = await statutoryService.revert({ depositId: dep1._id, reason: 'duplicate UTR entry', actorId: ACTOR });
  eq('deposit reverted', rev1.status, 'reverted');
  eq('tcs books restored', await tcsBal(), TCS(toPaise(2000)));
  r = await rec({ statute: 'tcs' });
  eq('tcs: net deposited back to 0', r.netDepositedPaise, 0);
  check('tcs balanced after revert', r.balanced, JSON.stringify(r));
  eq('tds untouched throughout', await tdsBal(), TDS(toPaise(2000)));

  // ==========================================================================
  section('§4 a bank reversal unwinds the withheld amount');
  // ==========================================================================
  const o2 = await makeOrder({ lineTotal: 3000 });
  await payoutService.accrueForOrder({ orderId: o2._id });
  await payoutService.markEligible({});
  const cyc2 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(27), to: d(16) });
  await payoutService.submitForApproval({ batchId: cyc2.batch._id });
  await payoutService.approve({ batchId: cyc2.batch._id, actorId: ACTOR });
  await toProcessing(cyc2.batch._id);
  eq('tcs books include the in-flight withholding', await tcsBal(), TCS(toPaise(2000)) + TCS(toPaise(3000)));
  check('balanced while PROCESSING (journal live)', (await rec({ statute: 'tcs' })).balanced);

  // bank reversal is a post-PAID event (the money moved, then came back)
  await payoutService.markPaid({ batch: await PayoutBatch.findById(cyc2.batch._id), utr: 'UTR-HERM-REVSRC' });
  await payoutService.markReversed({ batch: await PayoutBatch.findById(cyc2.batch._id), reason: 'bank reversed the payout' });
  eq('tcs books unwound', await tcsBal(), TCS(toPaise(2000)));
  r = await rec({ statute: 'tcs' });
  eq('tcs: expected excludes the reversed batch', r.expectedPaise, TCS(toPaise(2000)));
  check('tcs balanced after bank reversal', r.balanced, JSON.stringify(r));
  check('tds balanced after bank reversal', (await rec({ statute: 'tds' })).balanced);

  // ==========================================================================
  section('§5 a provider failure unwinds it too');
  // ==========================================================================
  // delivered d(28) → eligible d(21): a window that includes o3 but EXCLUDES
  // the o2 line released by the §4 reversal (eligible d(23)), so this batch
  // carries exactly o3's withholding
  const o3 = await makeOrder({ lineTotal: 4000, deliveredDaysAgo: 28 });
  await payoutService.accrueForOrder({ orderId: o3._id });
  await payoutService.markEligible({});
  const cyc3 = await payoutService.computeCycleForVendor({ vendorId: vendor._id, from: d(22), to: d(16) });
  await payoutService.submitForApproval({ batchId: cyc3.batch._id });
  await payoutService.approve({ batchId: cyc3.batch._id, actorId: ACTOR });
  await toProcessing(cyc3.batch._id);
  eq('tcs books include the in-flight withholding', await tcsBal(), TCS(toPaise(2000)) + TCS(toPaise(4000)));

  await payoutService.markFailed({ batch: await PayoutBatch.findById(cyc3.batch._id), reason: 'provider rejected', actorId: ACTOR });
  eq('tcs books unwound', await tcsBal(), TCS(toPaise(2000)));
  check('tcs balanced after provider failure', (await rec({ statute: 'tcs' })).balanced);
  check('tds balanced after provider failure', (await rec({ statute: 'tds' })).balanced);

  // ==========================================================================
  section('§6 drift → detected to the paise → signed backfill → balanced');
  // ==========================================================================
  // white-box: the withholding was never booked (a pre-ledger gap — the
  // payout happened before the journal existed). The books under-state the
  // liability by exactly the withheld amount; no journal and no event were
  // ever involved, so nothing is replayable.
  const driftPaise = TCS(toPaise(2000));
  await AccountBalance.updateOne({ accountCode: tcsCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  r = await rec({ statute: 'tcs' });
  eq('tcs drift detected to the paise', r.differencePaise, driftPaise);
  check('tcs not balanced', r.balanced === false);
  check('tds still balanced (the gap is statute-specific)', (await rec({ statute: 'tds' })).balanced);
  r = await rec();
  eq('platform: exactly one statute drifted', r.drifted, 1);

  const rep = await statutoryService.postStatutoryBackfill({ statute: 'tcs', differencePaise: r.statutes.find((s) => s.statute === 'tcs').differencePaise, note: 'hermetic repair' });
  check('backfill posted', rep.posted === true, JSON.stringify(rep));
  r = await rec({ statute: 'tcs' });
  check('tcs balanced after backfill', r.balanced, JSON.stringify(r));

  const bfDocs = await LedgerJournal.find({ kind: LEDGER_JOURNAL_KIND.STATUTORY_BACKFILL });
  const bf = bfDocs.find((j) => j.meta?.statute === 'tcs');
  eq('exactly one statutory backfill journal', bfDocs.length, 1);
  const drB = bf.lines.find((l) => l.accountCode === ledgerAccounts.bank() && l.debitPaise > 0);
  const crB = bf.lines.find((l) => l.accountCode === tcsCode && l.creditPaise > 0);
  check('signed correctly (under-stated → DR bank / CR tcs_payable)', !!drB && !!crB && drB.debitPaise === driftPaise && crB.creditPaise === driftPaise, JSON.stringify(bf?.lines));
  const evBf = await domainEventService.findEventByKey(bf.idempotencyKey);
  check('backfill event posted with the difference (same key as the journal)', !!evBf && evBf.kind === DOMAIN_EVENT_TYPE.STATUTORY_BACKFILL && evBf.payload.differencePaise === driftPaise);

  // a second repair finds no difference — posting a zero backfill is refused
  let empty = null;
  try { await statutoryService.postStatutoryBackfill({ statute: 'tcs', differencePaise: 0 }); }
  catch (e) { empty = e; }
  check('zero-difference backfill refused', empty && empty.code === 'STATUTORY_BACKFILL_EMPTY', empty ? empty.code : 'no error');

  // ==========================================================================
  section('§7 STATUTORY_BACKFILL replay is refused — never guessed');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: bf._id });
  await LedgerJournal.deleteOne({ _id: bf._id });
  await AccountBalance.updateOne({ accountCode: tcsCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  await AccountBalance.updateOne({ accountCode: ledgerAccounts.bank() }, { $inc: { debitTotalPaise: -driftPaise, entryCount: -1 } });
  r = await rec({ statute: 'tcs' });
  eq('drift returns when the backfill journal is gone', r.differencePaise, driftPaise);

  const drift = await domainEventService.findDrift();
  check('missing backfill flagged by findDrift', drift.missingJournals.some((m) => m.kind === DOMAIN_EVENT_TYPE.STATUTORY_BACKFILL), JSON.stringify(drift.missingJournals.map((m) => m.kind)));
  const healed = await domainEventService.replay({ limit: 50 });
  eq('backfill NOT re-posted', healed.journalsReposted, 0);
  check('failure reports STATUTORY_BACKFILL_NOT_REPLAYABLE', healed.failed.some((f) => String(f.reason || '').includes('STATUTORY_BACKFILL_NOT_REPLAYABLE')), JSON.stringify(healed.failed));

  // the operator path: re-post the measured difference manually — under the
  // SAME idempotency key the missing event carries, so the event↔journal
  // pair is restored exactly (a fresh key would leave the old event orphaned)
  const missing = drift.missingJournals.find((m) => m.kind === DOMAIN_EVENT_TYPE.STATUTORY_BACKFILL);
  await statutoryService.postStatutoryBackfill({ statute: 'tcs', differencePaise: driftPaise, idempotencyKey: missing.idempotencyKey, note: 'hermetic re-post' });
  check('tcs balanced after manual re-post', (await rec({ statute: 'tcs' })).balanced);
  check('platform balanced', (await rec()).ok === true);
  const driftAfter = await domainEventService.findDrift();
  eq('no residual drift after the re-post', driftAfter.missingJournals.length, 0);

  // ==========================================================================
  section('§8 trial balance + audit chain hold with statutory journals mixed in');
  // ==========================================================================
  const tb = await ledgerService.trialBalance();
  check('trial balance: DR = CR', tb.balanced, `DR ${tb.totalDebitPaise} vs CR ${tb.totalCreditPaise}`);
  const chains = await domainEventService.verifyChains({ tenantId: TENANT });
  check('audit chain verifies (no breaks)', (chains.breaks || []).length === 0, JSON.stringify(chains.breaks || []));

  // ==========================================================================
  console.log('\n' + '='.repeat(56));
  if (failed > 0) {
    console.log(`❌ STATUTORY-PAYABLE SMOKE: ${failed} FAILED of ${passed + failed}`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ STATUTORY-PAYABLE SMOKE: ALL ${passed} CHECKS PASSED (${mode})`);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); }).finally(() => {
  if (mongod) mongod.stop().catch(() => {});
  mongoose.disconnect().catch(() => {});
});
