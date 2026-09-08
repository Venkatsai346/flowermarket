/**
 * smoke-bank.test.js — Phase 20 bank cash position integrity, end to end.
 *
 * DUAL MODE (same as smoke-ledger.test.js):
 *   1. MONGODB_URI set → real MongoDB (CI).
 *   2. no URI → mongodb-memory-server.
 *   3. neither + REQUIRE_DB unset → SKIPS with exit 0.
 *
 * Proves the settlement bank IS a real ledger account:
 *
 *   books(bank) =  Σ psp_settled (signed — final once posted; the PSP nets
 *                 refunds in as negative settlement rows)
 *               −  Σ batch.netPaise over LIVE batches (PROCESSING / PAID —
 *                 the payout journal credits the bank at submission)
 *               −  Σ statutory deposits (recorded, not reverted)
 *               +  bank_backfill journals (self-corrections, excluded)
 *
 *   §1  PSP settlement moves captured cash into the bank
 *   §2  a live payout drains the bank (net of commission + platform GST + TCS)
 *   §3  a bank reversal unwinds the drain (REVERSED batches net to zero)
 *   §4  a statutory deposit leaves the bank (and its revert restores it)
 *   §5  a refund of a settled order never touches the bank
 *   §6  drift → detected to the paise → signed backfill → balanced
 *   §7  BANK_BACKFILL replay is refused (never guessed)
 *   §8  an unmatched statement line keeps the check red until explained
 *   §9  trial balance + audit chain hold with bank journals mixed in
 */

import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongoSync } from './lib/hermeticMongo.js';
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
  const uri = mongod.getUri('flower_market_bank_test');
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
      console.error(`\n❌ smoke-bank: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-bank needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_bank_test node scripts/smoke-bank.test.js\n');
    process.exit(0);
  }

  console.log(`\n🏷  Phase 20 bank cash position smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: payoutService } = await import('../src/services/payout.service.js');
  const { default: statutoryService } = await import('../src/services/statutory.service.js');
  const { default: bankStatementService } = await import('../src/services/bankStatement.service.js');
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
  const { default: BankStatementLine } = await import('../src/models/bankStatementLine.model.js');
  const { default: StatutoryRate } = await import('../src/models/statutoryRate.model.js');
  const {
    PAYOUT_STATE, LEDGER_JOURNAL_KIND, DOMAIN_EVENT_TYPE,
    REFUND_DESTINATION, REFUND_REASON, REFUND_TRANSACTION_STATUS,
    STATUTORY_RATE_KIND,
  } = await import('../src/constants/enums.js');
  const { toPaise, fromPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const d = (days) => new Date(Date.now() - days * 86400000);
  const TENANT = oid();
  const ACTOR = oid();

  await ledgerService.ensureChartOfAccounts();

  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Bank Greens', slug: `bank-greens-${Date.now()}`,
    status: 'active', commissionRateBps: 1000,
  });
  const acct = await VendorPayoutAccount.create({
    vendorId: vendor._id, method: 'bank', accountHolderName: 'Bank Greens',
    accountNumberEnc: Buffer.from('99887766554').toString('base64'),
    ifsc: 'SBIN0009876', maskedAccount: '****5544', fingerprint: 'fp-bg', isDefault: true, status: 'active',
  });
  acct.kyc.status = 'approved';
  acct.verification.status = 'verified';
  await acct.save();

  // TCS at 0.5% (GST s.52) so the payout withholds into tcs_payable and the
  // §4 deposit has a real balance to draw down.
  await StatutoryRate.create({
    kind: STATUTORY_RATE_KIND.TCS_GST_52, rateBps: 50, appliesTo: 'net_taxable',
    effectiveFrom: d(4000), notificationRef: 'SMK-NOTICE',
  });

  const bankCode = ledgerAccounts.bank();
  const clearingCode = ledgerAccounts.gatewayClearing();
  const tcsCode = ledgerAccounts.tcsPayable();
  const bankBal = async () => (await ledgerService.balance(bankCode)).balancePaise;
  const rec = async () => payoutService.reconcileBank({});

  // ₹1,000 goods + ₹120 GST (12%): total ₹1,120. Model money = RUPEES.
  // Line financials: gross 112,000 · commission 10,000 (10%) · platform GST
  // 1,800 (18% of commission) · TCS 500 (0.5% of taxable) → net 99,700.
  async function makeOrder({ deliveredDaysAgo = 30, lineTotal = 1000, tax = 120, tag = 'bk' }) {
    const deliveredAt = d(deliveredDaysAgo);
    const order = await Order.create({
      tenantId: TENANT, userId: oid(), orderNumber: `FM-BQ-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'delivered', deliveredAt,
      itemsCount: 1, itemsSubtotal: lineTotal, deliveryFee: 0, discount: 0,
      taxAmount: tax, totalAmount: lineTotal + tax, currency: 'INR',
      paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: deliveredAt },
      addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    });
    await OrderItem.create({
      orderId: order._id, tenantId: TENANT, tenantProductId: oid(), productMasterId: oid(),
      vendorId: vendor._id, skuSnapshot: { title: 'Bank Item' },
      priceAtOrder: { sellingPrice: lineTotal }, qty: 1, lineTotal, taxAmount: tax, discountAllocated: 0,
    });
    await ledgerPosting.postSaleCaptured({ order });
    return order;
  }

  async function refundOrder(order, rupees) {
    const rt = await RefundTransaction.create({
      tenantId: TENANT, orderId: order._id, userId: oid(),
      amount: rupees, reason: REFUND_REASON.ORDER_CANCELLED, destination: REFUND_DESTINATION.ORIGINAL_METHOD,
      idempotencyKey: `refund_bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      status: REFUND_TRANSACTION_STATUS.SUCCESS, completedAt: new Date(),
    });
    await ledgerPosting.postRefund({ refundTransaction: rt });
    await payoutService.reverseForRefund({ refundTransaction: rt });
    return rt;
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
  section('§1 PSP settlement moves captured cash into the bank');
  // ==========================================================================
  const o1 = await makeOrder({ deliveredDaysAgo: 30, tag: 'o1' });
  const o4 = await makeOrder({ deliveredDaysAgo: 30, tag: 'o4' });
  const o2 = await makeOrder({ deliveredDaysAgo: 25, tag: 'o2' });
  const o3 = await makeOrder({ deliveredDaysAgo: 25, tag: 'o3' });
  for (const o of [o1, o4, o2, o3]) {
    // eslint-disable-next-line no-await-in-loop
    await payoutService.accrueForOrder({ orderId: o._id });
  }
  await payoutService.markEligible({});

  const settle = await payoutService.ingestPspSettlements({
    rows: [o1, o4, o2, o3].map((o, i) => ({ orderId: o._id, amount: o.totalAmount, settledAt: d(30 - i), utr: `SMK-STL-${i}` })),
    reference: 'SMK-SETTLE-1',
  });
  eq('all four settlements posted', settle.posted, 4);
  eq('bank books the settled cash', await bankBal(), 448000);
  let r = await rec();
  eq('settlement facts = 4 × 112,000', r.settlements.paise, 448000);
  eq('expected = settlements (no outflows yet)', r.expectedPaise, 448000);
  eq('books = expected', r.booksPaise, 448000);
  check('bank balanced after settlement', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§2 a live payout drains the bank (net of commission + GST + TCS)');
  // ==========================================================================
  const cyc1 = await payCycle({ from: d(31), to: d(20) });
  const b1 = await PayoutBatch.findById(cyc1.batch._id);
  eq('batch1 PAID (o1 + o4)', b1.state, PAYOUT_STATE.PAID);
  eq('batch1 withheld TCS into tcs_payable', (await ledgerService.balance(tcsCode)).balancePaise, 1000);
  eq('batch1 net cash = 2 × (112,000 − 10,000 − 1,800 − 500)', b1.netPaise, 199400);
  eq('bank drained by the net', await bankBal(), 448000 - 199400);
  r = await rec();
  eq('live payout facts = batch1 net', r.payouts.paise, 199400);
  eq('expected = 448,000 − 199,400', r.expectedPaise, 248600);
  check('bank balanced after payout', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§3 a bank reversal unwinds the drain (REVERSED nets to zero)');
  // ==========================================================================
  const cyc2 = await payCycle({ from: d(27), to: d(15) });
  const b2 = await PayoutBatch.findById(cyc2.batch._id);
  eq('batch2 PAID (o2 + o3)', b2.state, PAYOUT_STATE.PAID);
  eq('bank drained again', await bankBal(), 248600 - 199400);
  check('balanced with two live batches', (await rec()).balanced);

  await payoutService.markReversed({ batch: b2, reason: 'bank reversed the payout' });
  eq('bank restored by the mirror', await bankBal(), 248600);
  r = await rec();
  eq('expected excludes the reversed batch', r.expectedPaise, 448000 - 199400);
  check('bank balanced after bank reversal', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§4 a statutory deposit leaves the bank (revert restores it)');
  // ==========================================================================
  const dep = await statutoryService.deposit({
    statute: 'tcs', amountPaise: 1000, utr: 'SMK-DEP-UTR-1', tenantId: TENANT, reference: 'CHAVS-SMK',
  });
  check('deposit recorded', dep.status === 'recorded', JSON.stringify(dep?.status));
  eq('bank debited the deposit', await bankBal(), 248600 - 1000);
  r = await rec();
  eq('deposit facts = 1,000', r.deposits.paise, 1000);
  eq('expected = 448,000 − 199,400 − 1,000', r.expectedPaise, 247600);
  check('bank balanced after deposit', r.balanced, JSON.stringify(r));

  await statutoryService.revert({ depositId: dep._id, reason: 'wrong amount — smoke correction' });
  eq('revert credits the bank back', await bankBal(), 248600);
  r = await rec();
  eq('net deposits = 0 after the revert', r.deposits.paise, 0);
  check('bank balanced after revert', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§5 a refund of a settled order never touches the bank');
  // ==========================================================================
  const before = await bankBal();
  await refundOrder(o4, fromPaise(112000)); // full refund, money back via the gateway
  eq('bank untouched by the refund', await bankBal(), before);
  r = await rec();
  check('bank still balanced (refunds go through gateway_clearing)', r.balanced, JSON.stringify(r));

  // ==========================================================================
  section('§6 drift → detected to the paise → signed backfill → balanced');
  // ==========================================================================
  const driftPaise = 60000;
  await AccountBalance.updateOne({ accountCode: bankCode }, { $inc: { creditTotalPaise: driftPaise, entryCount: 1 } });
  r = await rec();
  eq('bank drift detected to the paise', r.differencePaise, driftPaise);
  eq('books short of the facts', r.booksPaise, 248600 - driftPaise);
  check('bank not balanced', r.balanced === false);
  check('statement side still clean', r.statement.unmatchedLines === 0);

  const rep = await payoutService.postBankBackfill({ differencePaise: r.differencePaise, note: 'hermetic repair' });
  check('backfill posted', rep.posted === true, JSON.stringify(rep));
  r = await rec();
  check('bank balanced after backfill', r.balanced, JSON.stringify(r));

  const bfDocs = await LedgerJournal.find({ kind: LEDGER_JOURNAL_KIND.BANK_BACKFILL });
  eq('exactly one bank backfill journal', bfDocs.length, 1);
  const bf = bfDocs[0];
  const drB = bf.lines.find((l) => l.accountCode === bankCode && l.debitPaise > 0);
  const crB = bf.lines.find((l) => l.accountCode === clearingCode && l.creditPaise > 0);
  check('signed correctly (under-stated → DR bank / CR clearing)', !!drB && !!crB && drB.debitPaise === driftPaise && crB.creditPaise === driftPaise, JSON.stringify(bf?.lines));
  const evBf = await domainEventService.findEventByKey(bf.idempotencyKey);
  check('backfill event posted with the difference (same key as the journal)', !!evBf && evBf.kind === DOMAIN_EVENT_TYPE.BANK_BACKFILL && evBf.payload.differencePaise === driftPaise);

  let empty = null;
  try { await payoutService.postBankBackfill({ differencePaise: 0 }); }
  catch (e) { empty = e; }
  check('zero-difference backfill refused', empty && empty.code === 'BANK_BACKFILL_EMPTY', empty ? String(empty.code) : 'no error');

  // ==========================================================================
  section('§7 BANK_BACKFILL replay is refused — never guessed');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: bf._id });
  await LedgerJournal.deleteOne({ _id: bf._id });
  await AccountBalance.updateOne({ accountCode: bankCode }, { $inc: { debitTotalPaise: -driftPaise, entryCount: -1 } });
  await AccountBalance.updateOne({ accountCode: clearingCode }, { $inc: { creditTotalPaise: -driftPaise, entryCount: -1 } });
  r = await rec();
  eq('drift returns when the backfill journal is gone', r.differencePaise, driftPaise);

  const drift = await domainEventService.findDrift();
  check('missing backfill flagged by findDrift', drift.missingJournals.some((m) => m.kind === DOMAIN_EVENT_TYPE.BANK_BACKFILL), JSON.stringify(drift.missingJournals.map((m) => m.kind)));
  const healed = await domainEventService.replay({ limit: 50 });
  eq('backfill NOT re-posted', healed.journalsReposted, 0);
  check('failure reports BANK_BACKFILL_NOT_REPLAYABLE', healed.failed.some((f) => String(f.reason || '').includes('BANK_BACKFILL_NOT_REPLAYABLE')), JSON.stringify(healed.failed));

  // the operator path: re-post under the SAME key the missing event carries
  const missing = drift.missingJournals.find((m) => m.kind === DOMAIN_EVENT_TYPE.BANK_BACKFILL);
  await payoutService.postBankBackfill({ differencePaise: driftPaise, idempotencyKey: missing.idempotencyKey, note: 'hermetic re-post' });
  r = await rec();
  check('bank balanced after manual re-post', r.balanced, JSON.stringify(r));
  const driftAfter = await domainEventService.findDrift();
  eq('no residual drift after the re-post', driftAfter.missingJournals.length, 0);

  // ==========================================================================
  section('§8 an unmatched statement line keeps the check red until explained');
  // ==========================================================================
  const ing = await bankStatementService.ingest({
    statementRef: 'SMK-BS-1',
    lines: [{ utr: 'RANDOM-UTR-9', amountPaise: -75000, description: 'unknown egress' }],
    actorId: ACTOR, tenantId: TENANT,
  });
  check('statement line ingested as unmatched', ing.queued === 1, JSON.stringify(ing));
  r = await rec();
  eq('unmatched line counted', r.statement.unmatchedLines, 1);
  check('books still balanced', r.balanced === true);
  check('but the CHECK is red (money moved with no known batch)', r.ok === false);
  await BankStatementLine.deleteOne({ statementRef: 'SMK-BS-1', lineNo: 1 });
  r = await rec();
  check('explained away → check green again', r.ok === true, JSON.stringify(r));

  // ==========================================================================
  section('§9 trial balance + audit chain hold with bank journals mixed in');
  // ==========================================================================
  const tb = await ledgerService.trialBalance();
  check('trial balance: DR = CR', tb.balanced, `DR ${tb.totalDebitPaise} vs CR ${tb.totalCreditPaise}`);
  const chains = await domainEventService.verifyChains({ tenantId: TENANT });
  check('audit chain verifies (no breaks)', (chains.breaks || []).length === 0, JSON.stringify(chains.breaks || []));

  // ==========================================================================
  console.log('\n' + '='.repeat(56));
  if (failed > 0) {
    console.log(`❌ BANK-CASH-POSITION SMOKE: ${failed} FAILED of ${passed + failed}`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ BANK-CASH-POSITION SMOKE: ALL ${passed} CHECKS PASSED (${mode})`);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); }).finally(() => {
  stopHermeticMongoSync(mongod);
  mongoose.disconnect().catch(() => {});
});
