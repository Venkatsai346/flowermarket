/**
 * smoke-audit.test.js — Phase 10 "Follow the Money", end to end.
 *
 * Hermetic (in-memory mongod). Drives a REAL checkout through the HTTP app
 * (so the traceId middleware, the saga, the ledger post and the audit
 * backbone all run for real), then proves the four properties of the money
 * audit backbone:
 *
 *   1. TRACE PROPAGATION — a request's x-trace-id is stamped onto the order,
 *      payment and ledger journal; echoed in the response header.
 *   2. EVENT-AT-THE-FACT — a journal-carrying domain event (sale_captured) is
 *      appended with the SAME idempotencyKey as the sale journal and the same
 *      traceId.
 *   3. CRASH-WINDOW REPLAY — delete the journal (simulating a crash between
 *      the event append and the journal commit) → integrity flags the drift →
 *      the ledger replay re-posts the journal exactly → integrity green again.
 *   4. REFUND + CANCEL CHAIN — a cancellation (→ wallet refund) appends
 *      refund_issued + order_cancelled events on the same trace; the trace
 *      chain assembles the whole money life in time order.
 *   5. ORPHAN JOURNAL — a journal posted without an event is detected and the
 *      audit row is restored by replay.
 *   6. DEDUPE — re-appending an event with a known key is a no-op.
 *
 * Run: node scripts/smoke-audit.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = '';
process.env.MONGODB_URI = '';
process.env.OTP_PROVIDER = 'memory';

let mongod;
let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✓ ${label}`); };

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_audit_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  // import EVERY model (build indexes) — same list the worker uses
  const MODEL_FILES = (await import('../src/config/models.js')).default;
  const M = {};
  for (const f of MODEL_FILES) {
    const mod = await import(`../src/models/${f}`);
    M[mod.default.modelName] = mod.default;
  }
  // the exactly-once guarantee rests on unique indexes — materialise them
  // (hermetic DB connects with autoIndex:false, so production behaviour must
  // be opt-in here)
  await Promise.all([M.DomainEvent.syncIndexes(), M.LedgerJournal.syncIndexes(), M.AccountBalance.syncIndexes()]);

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const { default: slotService } = await import('../src/services/slot.service.js');
  const { default: ledgerService } = await import('../src/services/ledger.service.js');
  const { default: domainEventService } = await import('../src/services/domainEvent.service.js');
  const { default: integrityService } = await import('../src/services/integrity.service.js');
  const { default: searchIndexer } = await import('../src/services/searchIndexer.service.js');
  const { default: refundService } = await import('../src/services/refund.service.js');

  // ---------- seed ----------
  const tenant = await M.Tenant.create({ name: 'Audit Co', slug: 'audit-co', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });
  const admin = await M.User.create({
    tenantId: tenant.id, email: { address: 'admin@audit.test', verified: true },
    role: 'super_admin', status: 'active',
  });
  const customer = await M.User.create({
    tenantId: tenant.id, phone: { number: '9811100001', verified: true }, status: 'active',
  });
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;

  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh Flowers', slug: 'fresh-flowers', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'RoseVille', slug: 'roseville', status: 'active' });
  const master = await M.ProductMaster.create({
    tenantId: tenant.id, categoryId: category.id, brandId: brand.id,
    skuGlobal: 'AUD-1', type: 'fresh_flower', title: 'Audit Roses', slug: 'audit-roses',
    status: 'active', isPerishable: true,
  });
  const listing = await M.TenantProduct.create({
    tenantId: tenant.id, productMasterId: master.id,
    price: { mrp: 200, sellingPrice: 150, currency: 'INR' },
    stockQty: 50, status: 'active', version: 1,
  });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 50 });

  const hub = await M.Hub.create({ tenantId: tenant.id, name: 'Audit Hub', code: 'AUD-HUB', defaultSlotCapacity: 20, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const today = new Date().toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: today, capacity: 10 });

  const address = await M.Address.create({
    tenantId: tenant.id, userId: customer.id, name: 'Ramu', phone: '9811100001',
    line1: '1 Main Road', city: 'Visakhapatnam', state: 'AP', pincode: '530013',
  });

  // direct seeding bypasses the catalog outbox — build the search index the
  // way the seed script does, so the integrity search check starts green
  await searchIndexer.indexListing({ listingId: listing.id, tenantId: tenant.id });

  // ---------- harness ----------
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const TRACE = 'tr_smoke_audit_0001';
  const call = async (path, { method = 'GET', body, token = custTok, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenant.id,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, headers: res.headers };
  };

  console.log('\n— Phase 10: money audit backbone —');

  // ---------- 1. checkout with an inbound trace id ----------
  await call('/cart/items', { method: 'POST', body: { tenantProductId: listing.id, qty: 1 } });
  const slotList = await call('/cart/slots?pincode=530013&date=' + today);
  const slot = (slotList.body.data.slots || [])[0];
  const resv = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST' });
  const co = await call('/cart/checkout', {
    method: 'POST',
    body: { slotReservationId: resv.body.data.id || resv.body.data._id, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
    headers: { 'x-trace-id': TRACE },
  });
  assert.equal(co.status, 201, `checkout 201 (got ${co.status}: ${JSON.stringify(co.body).slice(0, 200)})`);
  const order = co.body.data.order || co.body.data;
  const orderId = order.id || order._id;
  ok('checkout succeeds (mock UPI)');

  // response echoes the trace; order carries it
  assert.equal(co.headers.get('x-trace-id'), TRACE, 'x-trace-id echoed in response');
  assert.equal(order.traceId, TRACE, 'order stamped with the request trace');
  ok('traceId echoed in response + stamped on the order');

  // ---------- 2. payment + journal + event all on the same trace/key ----------
  const payment = await M.Payment.findOne({ orderId });
  assert.ok(payment, 'payment exists');
  assert.equal(payment.traceId, TRACE, 'payment stamped with the trace');
  ok('payment carries the trace');

  const saleKey = `sale_captured:order:${orderId}`;
  const journal = await M.LedgerJournal.findOne({ idempotencyKey: saleKey });
  assert.ok(journal, 'sale journal posted');
  assert.equal(journal.traceId, TRACE, 'journal stamped with the trace');
  ok('sale journal posted + stamped with the trace');

  const saleEvent = await M.DomainEvent.findOne({ idempotencyKey: saleKey });
  assert.ok(saleEvent, 'sale_captured domain event appended at the fact');
  assert.equal(saleEvent.kind, 'sale_captured');
  assert.equal(saleEvent.traceId, TRACE, 'event carries the trace');
  assert.equal(saleEvent.aggregateType, 'order');
  ok('sale_captured event appended (event-at-the-fact, same key as journal)');

  // dedupe: re-appending the same key is a no-op
  const dup = await domainEventService.append({
    tenantId: tenant.id, traceId: TRACE, kind: 'sale_captured',
    aggregateType: 'order', aggregateId: orderId, idempotencyKey: saleKey,
  });
  assert.equal(dup.duplicate, true, 're-append of a known key reports duplicate');
  assert.equal(await M.DomainEvent.countDocuments({ idempotencyKey: saleKey }), 1, 'no second row');
  ok('event append is exactly-once (replay-safe)');

  // ---------- 3. integrity: green before the crash ----------
  let report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.ok, true, `ledger ok pre-crash (got ${JSON.stringify(report.checks.ledger)})`);
  assert.equal(report.overall, 'ok', `overall ok pre-crash (got ${report.overall})`);
  ok('integrity report green before the crash');

  // ---------- 4. CRASH WINDOW: journal vanishes, event survives ----------
  const entries = await M.LedgerEntry.find({ journalId: journal._id }).lean();
  await M.LedgerEntry.deleteMany({ journalId: journal._id });
  await M.LedgerJournal.deleteOne({ _id: journal._id });
  // the balances were already $inc'd at post time; a pre-commit crash would
  // not have them. Repair from entries to model "the journal never committed".
  await ledgerService.verifyBalances({ repair: true });
  void entries;

  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.ok, false, 'integrity detects the crash window');
  assert.equal(report.checks.ledger.eventJournalCoverage.missingJournals, 1, 'exactly one journal missing');
  ok('integrity flags the crash window (event present, journal missing)');

  // ---------- 5. REPLAY rebuilds the ledger from the event store ----------
  const replay = await integrityService.replay({ tenantId: tenant.id });
  assert.equal(replay.journalsReposted, 1, `journal re-posted (got ${JSON.stringify(replay)})`);
  const journal2 = await M.LedgerJournal.findOne({ idempotencyKey: saleKey });
  assert.ok(journal2, 'journal rebuilt');
  assert.equal(journal2.totalPaise, journal.totalPaise, 'rebuilt journal is identical (same paise)');
  assert.equal(journal2.traceId, TRACE, 'rebuilt journal keeps the trace');
  ok('replay re-posts the missing journal exactly (idempotent)');

  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.ok, true, `ledger ok after replay (got ${JSON.stringify(report.checks.ledger)})`);
  assert.equal(report.overall, 'ok', `overall ok after replay (got ${report.overall})`);
  const trial = await ledgerService.trialBalance();
  assert.equal(trial.balanced, true, 'trial balance still balances after replay');
  const vb = await ledgerService.verifyBalances();
  assert.equal(vb.ok, true, 'materialized balances match entries after replay');
  ok('ledger fully consistent after replay (trial + balances + coverage)');

  // ---------- 6. ORPHAN JOURNAL: a posting without an event ----------
  // post a second order's sale journal directly (bypassing the backbone)
  await call('/cart/items', { method: 'POST', body: { tenantProductId: listing.id, qty: 1 } });
  const slotList2 = await call('/cart/slots?pincode=530013&date=' + today);
  const slot2 = (slotList2.body.data.slots || [])[0];
  const resv2 = await call(`/cart/slots/${slot2.id}/reserve`, { method: 'POST' });
  const co2 = await call('/cart/checkout', {
    method: 'POST',
    body: { slotReservationId: resv2.body.data.id || resv2.body.data._id, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
  });
  const order2 = co2.body.data.order || co2.body.data;
  const order2Id = order2.id || order2._id;
  // simulate a legacy posting: delete its event, keep the journal
  await M.DomainEvent.deleteOne({ idempotencyKey: `sale_captured:order:${order2Id}` });

  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.eventJournalCoverage.missingEvents, 1, 'orphan journal detected (missing event)');
  const replay2 = await integrityService.replay({ tenantId: tenant.id });
  assert.equal(replay2.eventsRestored, 1, `audit row restored (got ${JSON.stringify(replay2)})`);
  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.ok, true, 'ledger ok after orphan restore');
  ok('orphan journal → audit row restored by replay (backbone completeness)');

  // ---------- 6b. GATEWAY REFUND CRASH WINDOW ----------
  // gateway refund created, process died before initiate() finished: the row
  // sits PENDING with a gatewayRef and has neither event nor journal. The
  // reconcile sweep asks the gateway, gets 'processed', records the FACT —
  // the journal is left to the replay (single journal-recovery path).
  const o2payment = await M.Payment.findOne({ orderId: order2Id });
  const crashRefund = await M.RefundTransaction.create({
    tenantId: tenant.id, orderId: order2Id, userId: customer.id, paymentId: o2payment._id,
    amount: 50, currency: 'INR', reason: 'order_cancelled', destination: 'original_method',
    idempotencyKey: `refund:smoke:crash:${Date.now()}`,
    status: 'pending', gatewayRef: 'mock_refund_crash_1',
    initiatedAt: new Date(Date.now() - 15 * 60 * 1000), traceId: o2payment.traceId,
  });
  const rec = await refundService.reconcileRefunds({ olderThanMinutes: 10 });
  assert.equal(rec.resolved.length, 1, `reconcile resolved the pending refund (got ${JSON.stringify(rec)})`);
  const recEvent = await M.DomainEvent.findOne({ idempotencyKey: `refund_issued:refund:${crashRefund._id}` });
  assert.ok(recEvent, 'reconcile-processed refund records its fact (event appended)');
  assert.equal(recEvent.traceId, o2payment.traceId, 'reconciled refund keeps ITS order trace');
  assert.ok(!(await M.LedgerJournal.findOne({ idempotencyKey: `refund_issued:refund:${crashRefund._id}` })), 'no journal posted by reconcile (replay owns that)');
  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.eventJournalCoverage.missingJournals, 1, 'crash window visible: event without journal');
  const replay3 = await integrityService.replay({ tenantId: tenant.id });
  assert.equal(replay3.journalsReposted, 1, `replay re-posts the refund journal (got ${JSON.stringify(replay3)})`);
  report = await integrityService.report({ tenantId: tenant.id });
  assert.equal(report.checks.ledger.ok, true, `ledger ok after refund-journal replay (got ${JSON.stringify(report.checks.ledger)})`);
  ok('gateway refund crash window: reconcile records the fact, replay posts the journal');

  // ---------- 7. REFUND + CANCEL chain on the same trace ----------
  const cancel = await call(`/orders/${orderId}/cancel`, {
    method: 'POST',
    body: { reason: 'changed_mind' },
    headers: { 'x-trace-id': 'tr_smoke_audit_cancel' },
  });
  assert.equal(cancel.status, 200, `cancel 200 (got ${cancel.status}: ${JSON.stringify(cancel.body).slice(0, 200)})`);
  const refundEvent = await M.DomainEvent.findOne({ kind: 'refund_issued', aggregateType: 'refund', refType: 'order', refId: String(orderId) });
  assert.ok(refundEvent, `refund_issued event appended (events: ${JSON.stringify((await M.DomainEvent.find().select('kind refType refId').lean()).map((e) => e.kind))})`);
  assert.equal(refundEvent.traceId, TRACE, 'refund sits on the ORDER trace (not the cancel request)');
  const cancelEvent = await M.DomainEvent.findOne({ kind: 'order_cancelled', aggregateId: orderId });
  assert.ok(cancelEvent, 'order_cancelled event appended');
  const refundJournal = await M.LedgerJournal.findOne({ kind: 'refund_issued', refType: 'refund' });
  assert.ok(refundJournal, 'refund journal posted');
  ok('cancellation → refund_issued + order_cancelled events + refund journal, on the order trace');

  // ---------- 8. THE TRACE CHAIN (follow the money) ----------
  const tr = await call(`/admin/traces/${TRACE}`, { token: adminTok });
  assert.equal(tr.status, 200, `trace 200 (got ${tr.status})`);
  const chain = tr.body.data.chain;
  const kinds = chain.map((c) => c.kind);
  assert.ok(kinds.includes('order.created'), 'chain has order.created');
  assert.ok(kinds.some((k) => k.startsWith('journal.')), 'chain has a journal');
  assert.ok(kinds.includes('event.sale_captured'), 'chain has the sale event');
  assert.ok(kinds.includes('event.refund_issued'), 'chain has the refund event');
  assert.ok(kinds.includes('event.order_cancelled'), 'chain has the cancel event');
  assert.ok(kinds.includes('payment.created'), 'chain has the payment');
  // time-ordered
  for (let i = 1; i < chain.length; i += 1) {
    assert.ok(new Date(chain[i - 1].at) <= new Date(chain[i].at), `chain time-ordered at ${i}`);
  }
  assert.equal(tr.body.data.orderCount, 1, 'one order on the trace');
  ok(`trace chain assembles the full money life (${chain.length} steps, time-ordered)`);

  // ---------- 9. HTTP integrity endpoints (RBAC + shape) ----------
  const integ = await call('/admin/integrity', { token: adminTok });
  assert.equal(integ.status, 200, 'GET /admin/integrity 200');
  assert.equal(integ.body.data.overall, 'ok', 'tenant integrity ok');
  ok('GET /admin/integrity (tenant-scoped) green');

  const integNoTok = await call('/admin/integrity', { token: null });
  assert.equal(integNoTok.status, 401, 'integrity requires auth');
  ok('integrity is auth-gated');

  console.log(`\n=== smoke-audit: ${passed} checks passed ===`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ smoke-audit FAILED:', err);
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop().catch(() => {});
    process.exit(1);
  });
