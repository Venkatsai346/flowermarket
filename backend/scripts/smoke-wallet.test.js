/**
 * smoke-wallet.test.js — Phase 16 wallet-ledger integrity, end to end.
 *
 * DUAL MODE (same as smoke-ledger.test.js):
 *   1. MONGODB_URI set → real MongoDB (CI).
 *   2. no URI → mongodb-memory-server.
 *   3. neither + REQUIRE_DB unset → SKIPS with exit 0.
 *
 * Proves the wallet IS a real ledger account:
 *   §1  topup → WALLET_TOPUP journal (DR clearing / CR liability) + domain event
 *       sharing the journal's idempotency key, paise-exact, reconciliation balanced.
 *   §2  second topup (different user) → still balanced.
 *   §3  wallet order payment (wallet debit + sale journal) → balanced.
 *   §4  wallet refund (postRefund journal + credit without journal) → balanced.
 *   §5  goodwill credit → DR wallet_goodwill_expense / CR liability → balanced.
 *   §6  DRIFT: white-box balance edit → reconcile detects exact difference →
 *       repair posts a signed WALLET_BACKFILL journal + event → balanced.
 *   §7  SELF-HEAL: delete a topup journal → findDrift flags it → replay re-derives
 *       the exact paise from the WalletTransaction → balanced.
 *   §8  WALLET_BACKFILL is deliberately NOT re-derivable — replay of a backfill
 *       event must refuse with a clear error, never guess.
 *   §9  trial balance + audit-chain verification hold with wallet journals mixed in.
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
  const uri = mongod.getUri('flower_market_wallet_test');
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
      console.error(`\n❌ smoke-wallet: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-wallet needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_wallet_test node scripts/smoke-wallet.test.js\n');
    process.exit(0);
  }

  console.log(`\n👛 Phase 16 wallet-ledger smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: walletService } = await import('../src/services/wallet.service.js');
  const { default: domainEventService } = await import('../src/services/domainEvent.service.js');
  const { default: Wallet } = await import('../src/models/wallet.model.js');
  const { default: WalletTransaction } = await import('../src/models/walletTransaction.model.js');
  const { default: LedgerJournal } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntry } = await import('../src/models/ledgerEntry.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: Payment } = await import('../src/models/payment.model.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const {
    LEDGER_ACCOUNT, LEDGER_JOURNAL_KIND, DOMAIN_EVENT_TYPE,
    PAYMENT_STATUS, PAYMENT_METHOD, PAYMENT_PROVIDER, WALLET_TXN_REASON,
    ORDER_STATUS, REFUND_DESTINATION, REFUND_REASON, REFUND_TRANSACTION_STATUS,
  } = await import('../src/constants/enums.js');
  const { toPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const TENANT = oid();
  const USER_A = oid();
  const USER_B = oid();
  const VENDOR = oid();

  await Vendor.create({ tenantId: TENANT, userId: oid(), vendorName: 'Wallet Test Vendor', businessName: 'Wallet Test Vendor', slug: `wtv-${Date.now()}`, status: 'active' });
  await ledgerService.ensureChartOfAccounts();

  const liab = ledgerAccounts.walletLiability();
  const clearing = ledgerAccounts.gatewayClearing();
  const goodwill = ledgerAccounts.walletGoodwillExpense();
  eq('chart has wallet_goodwill_expense', ledgerAccounts.walletGoodwillExpense(), LEDGER_ACCOUNT.WALLET_GOODWILL_EXPENSE);

  // helpers -----------------------------------------------------------------
  const journalFor = async (walletTxnId) =>
    LedgerJournal.findOne({ tenantId: TENANT, idempotencyKey: `${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${walletTxnId}` });
  const line = async (journal, accountCode, which) =>
    (journal.lines.find((l) => l.accountCode === accountCode && (which === 'D' ? l.debitPaise > 0 : l.creditPaise > 0)) || null);
  const reconcile = () => walletService.ledgerReconcile({ tenantId: TENANT });

  // ==========================================================================
  section('§1 topup → journal + event, paise-exact, balanced');
  // ==========================================================================
  const t1 = await walletService.topup({ tenantId: TENANT, userId: USER_A, amount: '250.50' });
  eq('topup credited (rupees)', Number(t1.wallet.balance), 250.5);
  const j1 = await journalFor(t1.txn._id);
  check('WALLET_TOPUP journal posted', !!j1);
  eq('journal kind', j1.kind, LEDGER_JOURNAL_KIND.WALLET_TOPUP);
  eq('journal paise exact', j1.totalPaise, toPaise(250.5));
  eq('DR clearing paise', (await line(j1, clearing, 'D')).debitPaise, toPaise(250.5));
  eq('CR liability paise', (await line(j1, liab, 'C')).creditPaise, toPaise(250.5));
  eq('journal refId → wallet tx', String(j1.refId), String(t1.txn._id));
  check('journal entry rows exist', (await LedgerEntry.countDocuments({ journalId: j1._id })) === 2);

  const ev1 = await domainEventService.findEventByKey(`${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${t1.txn._id}`);
  check('WALLET_TOPUP domain event shares the journal idempotency key', !!ev1 && ev1.kind === DOMAIN_EVENT_TYPE.WALLET_TOPUP);
  eq('event aggregate = wallet tx', ev1 && ev1.aggregateId, String(t1.txn._id));
  eq('event payload paise', ev1 && ev1.payload.amountPaise, toPaise(250.5));
  eq('event counter = clearing', ev1 && ev1.payload.counter, clearing);

  const r1 = await reconcile();
  check('reconcile balanced after topup', r1.balanced, JSON.stringify(r1));
  eq('wallet total = ledger liability', r1.walletTotalPaise, r1.ledgerPaise);
  eq('liability = 250.50', r1.ledgerPaise, toPaise(250.5));

  // ==========================================================================
  section('§2 second topup (different user) → still balanced');
  // ==========================================================================
  const t2 = await walletService.topup({ tenantId: TENANT, userId: USER_B, amount: '1234.00' });
  eq('second user credited', Number(t2.wallet.balance), 1234);
  const r2 = await reconcile();
  check('reconcile balanced after 2 users', r2.balanced, JSON.stringify(r2));
  eq('liability = 250.50 + 1234.00', r2.ledgerPaise, toPaise(250.5) + toPaise(1234));

  // ==========================================================================
  section('§3 wallet order payment (debit + sale journal) → balanced');
  // ==========================================================================
  const payId = oid();
  const order = await Order.create({
    tenantId: TENANT, userId: USER_A, orderNumber: 'WM-001', status: 'confirmed',
    itemsCount: 1, itemsSubtotal: 100, deliveryFee: 0, discount: 0, taxAmount: 0, totalAmount: 100,
    currency: 'INR', paymentMethod: PAYMENT_METHOD.WALLET,
    paymentSummary: { status: 'success', paidAt: new Date(), paymentId: payId },
    addressSnapshot: { addressId: oid(), line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
  });
  await OrderItem.create({
    orderId: order._id, tenantId: TENANT, tenantProductId: oid(), productMasterId: oid(),
    vendorId: VENDOR, skuSnapshot: { title: 'Wallet Pay Item' },
    priceAtOrder: { sellingPrice: 100 }, qty: 1, lineTotal: 100, taxAmount: 0, discountAllocated: 0,
  });
  await Payment.create({
    _id: payId, tenantId: TENANT, orderId: order._id, userId: USER_A, amount: 100,
    method: PAYMENT_METHOD.WALLET, provider: PAYMENT_PROVIDER.WALLET,
    idempotencyKey: `pay-wm1-${Date.now()}`, status: PAYMENT_STATUS.CAPTURED, capturedAt: new Date(),
  });

  const d1 = await walletService.debit({ tenantId: TENANT, userId: USER_A, amount: '100.00', reason: WALLET_TXN_REASON.ORDER_PAYMENT, note: 'Order WM-001', refType: 'order', refId: order._id });
  eq('wallet debited to 150.50', Number(d1.wallet.balance), 150.5);
  const saleR = await ledgerPosting.postSaleCaptured({ order });
  check('sale journal posted (wallet payment → DR wallet_liability)', saleR.created === true);
  check('sale journal DRs wallet liability', (await line(saleR.journal, liab, 'D')) !== null);
  const r3 = await reconcile();
  check('reconcile balanced after wallet sale', r3.balanced, JSON.stringify(r3));
  eq('liability = 1484.50', r3.ledgerPaise, toPaise(250.5) + toPaise(1234) - toPaise(100));

  // ==========================================================================
  section('§4 wallet refund (postRefund journal, credit without journal) → balanced');
  // ==========================================================================
  const refundTxn = await RefundTransaction.create({
    tenantId: TENANT, orderId: order._id, userId: USER_A, amount: 40,
    reason: REFUND_REASON.ORDER_CANCELLED,
    destination: REFUND_DESTINATION.WALLET,
    status: REFUND_TRANSACTION_STATUS.SUCCESS,
    idempotencyKey: `refund:wm1-${Date.now()}`,
    initiatedBy: oid(), initiatedAt: new Date(), completedAt: new Date(),
  });
  const refundJ = await ledgerPosting.postRefund({ refundTransaction: refundTxn });
  check('refund journal posted (CR wallet_liability)', refundJ.created === true);
  check('refund journal CRs wallet liability', (await line(refundJ.journal, liab, 'C')) !== null);
  const c1 = await walletService.credit({ tenantId: TENANT, userId: USER_A, amount: '40.00', reason: WALLET_TXN_REASON.REFUND, note: 'Refund for WM-001', refType: 'refund', refId: refundTxn._id });
  eq('refunded to wallet (190.50)', Number(c1.wallet.balance), 190.5);
  check('refund credit posted NO new journal (no double count)', (await journalFor(c1.txn._id)) === null);
  const r4 = await reconcile();
  check('reconcile balanced after wallet refund', r4.balanced, JSON.stringify(r4));
  eq('liability = 1524.50', r4.ledgerPaise, toPaise(250.5) + toPaise(1234) - toPaise(100) + toPaise(40));

  // ==========================================================================
  section('§5 goodwill credit → DR wallet_goodwill_expense / CR liability');
  // ==========================================================================
  const c2 = await walletService.credit({ tenantId: TENANT, userId: USER_A, amount: '75.00', reason: WALLET_TXN_REASON.GOODWILL, note: 'Goodwill — wilted bouquet' });
  eq('goodwill credited (265.50)', Number(c2.wallet.balance), 265.5);
  const j5 = await journalFor(c2.txn._id);
  check('goodwill journal posted (WALLET_TOPUP kind)', !!j5 && j5.kind === LEDGER_JOURNAL_KIND.WALLET_TOPUP);
  eq('DR goodwill expense paise', (await line(j5, goodwill, 'D')).debitPaise, toPaise(75));
  eq('CR liability paise (goodwill)', (await line(j5, liab, 'C')).creditPaise, toPaise(75));
  const ev5 = await domainEventService.findEventByKey(`${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${c2.txn._id}`);
  eq('goodwill event flags goodwill counter', ev5 && ev5.payload.goodwill === true && ev5.payload.counter, goodwill);
  const r5 = await reconcile();
  check('reconcile balanced after goodwill', r5.balanced, JSON.stringify(r5));

  // ==========================================================================
  section('§6 DRIFT: white-box balance edit → detected → signed backfill → balanced');
  // ==========================================================================
  const walletA = await Wallet.findOne({ tenantId: TENANT, userId: USER_A });
  const drift = 12.34;
  walletA.balance = (walletA.balance + drift).toFixed(2);
  walletA.version += 1;
  await walletA.save();

  const r6a = await reconcile();
  check('drift detected', !r6a.balanced);
  eq('difference paise exact', r6a.differencePaise, toPaise(drift));
  eq('wallet total > ledger by drift', r6a.walletTotalPaise - r6a.ledgerPaise, toPaise(drift));

  const r6b = await walletService.ledgerReconcile({ tenantId: TENANT, repair: true });
  check('repair posted + balanced', r6b.repaired && r6b.repaired.posted === true && r6b.balanced, JSON.stringify(r6b));
  eq('liability now = wallet total', r6b.ledgerPaise, r6b.walletTotalPaise);

  const backfills = await LedgerJournal.find({ tenantId: TENANT, kind: LEDGER_JOURNAL_KIND.WALLET_BACKFILL }).sort({ createdAt: 1 });
  eq('exactly one backfill posted', backfills.length, 1);
  eq('backfill amount paise', backfills[0].totalPaise, toPaise(drift));
  check('backfill signed correctly (wallet ahead → DR clearing / CR liability)',
    !!(await line(backfills[0], clearing, 'D')) && !!(await line(backfills[0], liab, 'C')));
  const ev6 = await domainEventService.findEventByKey(backfills[0].idempotencyKey);
  check('backfill event posted, payload carries the difference',
    !!ev6 && ev6.kind === DOMAIN_EVENT_TYPE.WALLET_BACKFILL && ev6.payload.differencePaise === toPaise(drift));

  const r6c = await walletService.ledgerReconcile({ tenantId: TENANT, repair: true });
  check('no-op repair stays balanced', r6c.repaired === null && r6c.balanced);

  // ==========================================================================
  section('§7 SELF-HEAL: delete a topup journal → findDrift → replay → balanced');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: j1._id });
  await LedgerJournal.deleteOne({ _id: j1._id });

  const d7 = await domainEventService.findDrift({ tenantId: TENANT });
  check('findDrift flags the missing journal', d7.missingJournalsTotal === 1, JSON.stringify(d7.missingJournals));
  const healed = await domainEventService.replay({ limit: 50 });
  eq('replay re-posted 1 journal', healed.journalsReposted, 1);
  const j1b = await journalFor(t1.txn._id);
  check('journal restored', !!j1b);
  eq('restored paise exact (re-derived from tx)', j1b.totalPaise, toPaise(250.5));
  check('DR side restored', !!(await line(j1b, clearing, 'D')));
  const r7 = await reconcile();
  check('reconcile balanced after replay', r7.balanced, JSON.stringify(r7));

  // ==========================================================================
  section('§8 WALLET_BACKFILL replay must refuse, never guess');
  // ==========================================================================
  await LedgerEntry.deleteMany({ journalId: backfills[0]._id });
  await LedgerJournal.deleteOne({ _id: backfills[0]._id });
  const d8 = await domainEventService.findDrift({ tenantId: TENANT });
  check('missing backfill flagged', d8.missingJournals.some((m) => m.kind === DOMAIN_EVENT_TYPE.WALLET_BACKFILL), JSON.stringify(d8.missingJournals));
  const healed8 = await domainEventService.replay({ limit: 50 });
  eq('backfill event NOT replayed (refused)', healed8.journalsReposted, 0);
  check('failure reports WALLET_BACKFILL_NOT_REPLAYABLE',
    healed8.failed.some((f) => String(f.reason || '').includes('WALLET_BACKFILL_NOT_REPLAYABLE')),
    JSON.stringify(healed8.failed));

  // ==========================================================================
  section('§9 trial balance + audit chain hold with wallet journals mixed in');
  // ==========================================================================
  const tb = await ledgerService.trialBalance();
  check('trial balance: DR = CR', tb.balanced, `DR ${tb.totalDebitPaise} vs CR ${tb.totalCreditPaise}`);
  const chains = await domainEventService.verifyChains({ tenantId: TENANT });
  check('audit chain verifies (no breaks)', (chains.breaks || []).length === 0, JSON.stringify(chains.breaks || []));

  // ==========================================================================
  console.log(`\n${'='.repeat(56)}`);
  if (failed === 0) console.log(`✅ WALLET-LEDGER SMOKE: ALL ${passed} CHECKS PASSED (${mode})`);
  else {
    console.log(`❌ WALLET-LEDGER SMOKE: ${failed}/${passed + failed} FAILED (${mode})`);
    failures.forEach((f) => console.log(`   ✗ ${f}`));
  }
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 smoke-wallet crashed:', err);
  stopHermeticMongoSync(mongod);
  process.exit(1);
});
