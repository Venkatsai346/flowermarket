/**
 * smoke-ledger.test.js — Phase 6.1 double-entry ledger, end to end.
 *
 * DUAL MODE (deliberate):
 *   1. `MONGODB_URI=mongodb://…  node scripts/smoke-ledger.test.js`
 *      runs against a real MongoDB — the mode CI should use.
 *   2. no URI → falls back to mongodb-memory-server.
 *   3. neither available (offline sandbox) → SKIPS with exit 0 and says why,
 *      unless REQUIRE_DB=true, which makes the skip a hard failure.
 *
 * The pure arithmetic this suite sits on top of is covered without any database
 * by `scripts/money.test.js`, which always runs.
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

// ---------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------
let mongod = null;

async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    return `real MongoDB (${process.env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')})`;
  }
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  const uri = mongod.getUri('flower_market_ledger_test');
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
      console.error(`\n❌ smoke-ledger: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-ledger needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_test node scripts/smoke-ledger.test.js');
    console.log('   (the pure money-core invariants are covered by scripts/money.test.js)\n');
    process.exit(0);
  }

  console.log(`\n🧾 Phase 6.1 ledger smoke — ${mode}`);

  const { default: ledgerService, ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: ledgerPosting } = await import('../src/services/ledgerPosting.service.js');
  const { default: LedgerJournal } = await import('../src/models/ledgerJournal.model.js');
  const { default: LedgerEntry } = await import('../src/models/ledgerEntry.model.js');
  const { default: AccountBalance } = await import('../src/models/accountBalance.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { LEDGER_JOURNAL_KIND, REFUND_DESTINATION, REFUND_REASON } = await import('../src/constants/enums.js');
  const { toPaise } = await import('../src/utils/money.js');

  const oid = () => new mongoose.Types.ObjectId();
  const TENANT = oid();
  const USER = oid();

  // clean slate
  await Promise.all([
    LedgerJournal.deleteMany({}), LedgerEntry.deleteMany({}), AccountBalance.deleteMany({}),
  ]);

  const txnSupported = await ledgerService.transactionsSupported();
  console.log(`   transactions: ${txnSupported ? 'ENABLED (replica set)' : 'disabled (standalone) — journal-first + verify sweep'}`);

  // -------------------------------------------------------------------------
  section('1. chart of accounts');
  // -------------------------------------------------------------------------
  const seeded = await ledgerService.ensureChartOfAccounts();
  await ledgerService.ensureChartOfAccounts(); // idempotent
  const { default: LedgerAccount } = await import('../src/models/ledgerAccount.model.js');
  eq('global accounts seeded', await LedgerAccount.countDocuments({ isSystem: true }), seeded);

  // -------------------------------------------------------------------------
  section('2. posting a balanced journal');
  // -------------------------------------------------------------------------
  const key1 = 'sale_captured:order:000000000000000000000001';
  const r1 = await ledgerService.post({
    kind: LEDGER_JOURNAL_KIND.SALE_CAPTURED,
    idempotencyKey: key1,
    tenantId: TENANT,
    refType: 'order',
    refId: oid(),
    lines: [
      { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: 100000 },
      { accountCode: ledgerAccounts.tenantPayable(TENANT), creditPaise: 90000 },
      { accountCode: ledgerAccounts.commissionIncome(), creditPaise: 10000 },
    ],
  });
  check('journal created', r1.created);
  eq('total recorded', r1.journal.totalPaise, 100000);
  eq('entries flattened', await LedgerEntry.countDocuments({ journalId: r1.journal._id }), 3);

  const gw = await ledgerService.balance(ledgerAccounts.gatewayClearing());
  eq('asset balance is debit-positive (₹1000)', gw.balancePaise, 100000);
  const payable = await ledgerService.balance(ledgerAccounts.tenantPayable(TENANT));
  eq('liability balance is credit-positive (₹900)', payable.balancePaise, 90000);

  // -------------------------------------------------------------------------
  section('3. an unbalanced journal is refused and writes nothing');
  // -------------------------------------------------------------------------
  const beforeCount = await LedgerJournal.countDocuments({});
  let threw = null;
  try {
    await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.ADJUSTMENT,
      idempotencyKey: 'adjustment:test:unbalanced',
      lines: [
        { accountCode: ledgerAccounts.bank(), debitPaise: 5000 },
        { accountCode: ledgerAccounts.commissionIncome(), creditPaise: 4999 },
      ],
    });
  } catch (err) { threw = err; }
  eq('rejected with LEDGER_UNBALANCED', threw?.code, 'LEDGER_UNBALANCED');
  eq('nothing was written', await LedgerJournal.countDocuments({}), beforeCount);

  let threwSide = null;
  try {
    await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.ADJUSTMENT,
      idempotencyKey: 'adjustment:test:bothsides',
      lines: [{ accountCode: ledgerAccounts.bank(), debitPaise: 10, creditPaise: 10 }],
    });
  } catch (err) { threwSide = err; }
  eq('a line cannot be both debit and credit', threwSide?.code, 'LEDGER_BOTH_SIDES');

  let threwUnknown = null;
  try {
    await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.ADJUSTMENT,
      idempotencyKey: 'adjustment:test:unknown',
      lines: [
        { accountCode: 'not_a_real_account', debitPaise: 10 },
        { accountCode: ledgerAccounts.bank(), creditPaise: 10 },
      ],
    });
  } catch (err) { threwUnknown = err; }
  eq('unknown account rejected', threwUnknown?.code, 'LEDGER_UNKNOWN_ACCOUNT');

  // -------------------------------------------------------------------------
  section('4. idempotency & concurrency');
  // -------------------------------------------------------------------------
  const replay = await ledgerService.post({
    kind: LEDGER_JOURNAL_KIND.SALE_CAPTURED,
    idempotencyKey: key1,
    lines: [
      { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: 100000 },
      { accountCode: ledgerAccounts.tenantPayable(TENANT), creditPaise: 100000 },
    ],
  });
  check('replay returns the original, creates nothing', replay.created === false);
  eq('same journal id', String(replay.journal._id), String(r1.journal._id));
  eq('balance unchanged by the replay',
    (await ledgerService.balance(ledgerAccounts.gatewayClearing())).balancePaise, 100000);

  const raceKey = 'adjustment:test:race';
  const raceLines = [
    { accountCode: ledgerAccounts.bank(), debitPaise: 2500 },
    { accountCode: ledgerAccounts.commissionIncome(), creditPaise: 2500 },
  ];
  const raced = await Promise.allSettled(
    Array.from({ length: 8 }, () => ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.ADJUSTMENT, idempotencyKey: raceKey, lines: raceLines,
    }))
  );
  const okRaces = raced.filter((r) => r.status === 'fulfilled');
  eq('8 concurrent posts of the same key: none error', okRaces.length, 8);
  eq('exactly one created the journal', okRaces.filter((r) => r.value.created).length, 1);
  eq('exactly one journal row exists', await LedgerJournal.countDocuments({ idempotencyKey: raceKey }), 1);
  eq('bank balance incremented once (₹25)',
    (await ledgerService.balance(ledgerAccounts.bank())).balancePaise, 2500);

  // -------------------------------------------------------------------------
  section('5. a real order → sale journal');
  // -------------------------------------------------------------------------
  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Rose Farms', slug: `rose-farms-${Date.now()}`,
    commissionRateBps: 1000, status: 'active',
  });

  const order = await Order.create({
    tenantId: TENANT, userId: USER, orderNumber: `FM-TEST-${Date.now()}`,
    status: 'confirmed',
    itemsCount: 10, itemsSubtotal: 5000, deliveryFee: 49, discount: 0,
    taxAmount: 900, totalAmount: 5949, currency: 'INR',
    paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: new Date() },
  });
  await OrderItem.create({
    orderId: order._id, tenantId: TENANT,
    tenantProductId: oid(), productMasterId: oid(), vendorId: vendor._id,
    skuSnapshot: { title: 'Red Rose Bouquet' },
    priceAtOrder: { sellingPrice: 500 }, qty: 10, lineTotal: 5000,
    taxAmount: 900, discountAllocated: 0, hsnCode: '0603',
  });

  const sale = await ledgerPosting.postSaleCaptured({ order });
  check('sale journal posted', sale.created);
  eq('vendor payable ₹4500',
    (await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id))).balancePaise, toPaise(4500));
  eq('GST output payable ₹900',
    (await ledgerService.balance(ledgerAccounts.gstOutputPayable(vendor._id))).balancePaise, toPaise(900));
  eq('store payable holds the ₹49 delivery fee',
    (await ledgerService.balance(ledgerAccounts.tenantPayable(TENANT))).balancePaise, 90000 + toPaise(49));

  const replaySale = await ledgerPosting.postSaleCaptured({ order });
  check('re-posting the same order is a no-op (webhook replay safe)', replaySale.created === false);

  // -------------------------------------------------------------------------
  section('6. refund reverses proportionally');
  // -------------------------------------------------------------------------
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const refund = await RefundTransaction.create({
    tenantId: TENANT, orderId: order._id, userId: USER,
    amount: 594.9, // exactly 10% of the order
    reason: REFUND_REASON.RETURN_QC_PASSED,
    destination: REFUND_DESTINATION.WALLET,
    idempotencyKey: `refund_test_${Date.now()}`,
    status: 'success', completedAt: new Date(),
  });
  const rev = await ledgerPosting.postRefund({ refundTransaction: refund });
  check('refund journal posted', rev.created);

  const vendorAfter = await ledgerService.balance(ledgerAccounts.vendorPayable(vendor._id));
  eq('vendor payable reduced by 10% (₹4500 → ₹4050)', vendorAfter.balancePaise, toPaise(4050));
  const gstAfter = await ledgerService.balance(ledgerAccounts.gstOutputPayable(vendor._id));
  eq('GST liability reduced by 10% (₹900 → ₹810)', gstAfter.balancePaise, toPaise(810));
  const wallet = await ledgerService.balance(ledgerAccounts.walletLiability());
  eq('wallet liability now owes the customer ₹594.90', wallet.balancePaise, toPaise(594.9));

  const refundReplay = await ledgerPosting.postRefund({ refundTransaction: refund });
  check('refund replay is a no-op', refundReplay.created === false);

  // -------------------------------------------------------------------------
  section('7. over-reversal is impossible');
  // -------------------------------------------------------------------------
  let overThrew = null;
  try {
    await ledgerService.reverseProportional({
      originalKey: ledgerPosting.saleKey(order._id),
      amountPaise: toPaise(99999),
      counterAccount: ledgerAccounts.walletLiability(),
      idempotencyKey: `refund_issued:test:over_${Date.now()}`,
    });
  } catch (err) { overThrew = err; }
  eq('rejected with LEDGER_OVER_REVERSAL', overThrew?.code, 'LEDGER_OVER_REVERSAL');

  // -------------------------------------------------------------------------
  section('8. integrity: trial balance & drift detection');
  // -------------------------------------------------------------------------
  const tb = await ledgerService.trialBalance();
  check('trial balance: Σ debits === Σ credits across the whole ledger', tb.balanced,
    `diff ${tb.differencePaise} paise`);

  const v1 = await ledgerService.verifyBalances();
  check('no drift between entries and the materialized view', v1.ok,
    JSON.stringify(v1.drifted.slice(0, 2)));

  // corrupt the view on purpose — this is what a crash between the journal
  // write and the balance $inc would look like on a standalone mongod
  await AccountBalance.updateOne(
    { accountCode: ledgerAccounts.commissionIncome() },
    { $inc: { creditTotalPaise: 777 } }
  );
  const v2 = await ledgerService.verifyBalances();
  check('injected drift is detected', v2.drifted.length === 1, JSON.stringify(v2.drifted));
  eq('drift amount reported exactly', v2.drifted[0]?.driftPaise, -777);

  const v3 = await ledgerService.verifyBalances({ repair: true });
  eq('repair rewrote one account', v3.repaired, 1);
  const v4 = await ledgerService.verifyBalances();
  check('ledger is clean again after repair', v4.ok);

  // -------------------------------------------------------------------------
  section('9. backfill sweep');
  // -------------------------------------------------------------------------
  const orphan = await Order.create({
    tenantId: TENANT, userId: USER, orderNumber: `FM-ORPHAN-${Date.now()}`,
    status: 'delivered',
    itemsCount: 1, itemsSubtotal: 200, deliveryFee: 0, discount: 0,
    taxAmount: 0, totalAmount: 200, currency: 'INR',
    paymentMethod: 'cod', paymentSummary: { status: 'success', paidAt: new Date() },
  });
  await OrderItem.create({
    orderId: orphan._id, tenantId: TENANT,
    tenantProductId: oid(), productMasterId: oid(), vendorId: null,
    skuSnapshot: { title: 'Marigold Garland' },
    priceAtOrder: { sellingPrice: 200 }, qty: 1, lineTotal: 200,
    taxAmount: 0, discountAllocated: 0,
  });

  const bf1 = await ledgerPosting.backfillSales({});
  check('backfill posted the missing journal', bf1.posted >= 1, JSON.stringify(bf1));
  eq('backfill reported no failures', bf1.failures.length, 0);
  const bf2 = await ledgerPosting.backfillSales({});
  eq('second backfill run posts nothing (idempotent)', bf2.posted, 0);

  const tb2 = await ledgerService.trialBalance();
  check('trial balance still balanced after backfill', tb2.balanced);

  // -------------------------------------------------------------------------
  section('10. statement');
  // -------------------------------------------------------------------------
  const stmt = await ledgerService.statement({ accountCode: ledgerAccounts.vendorPayable(vendor._id) });
  check('vendor statement lists the sale and the refund', stmt.items.length === 2, `${stmt.items.length} rows`);
  eq('statement header carries the live balance', stmt.account.balancePaise, toPaise(4050));
  check('statement rows expose rupee views', typeof stmt.items[0].credit === 'number');

  // ---- summary ----
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`ledger smoke: ${passed} passed, ${failed} failed`);
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
