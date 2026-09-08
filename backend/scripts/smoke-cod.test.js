/**
 * Cash-on-delivery smoke test — the whole cash lifecycle against a real
 * (in-memory) MongoDB, through the real HTTP API.
 *
 * WHY THIS EXISTS
 * COD was offered in the validators and the storefront but had no backend
 * handling at all. In production with Razorpay configured, a cash checkout
 * created a gateway order that was never captured, and the reconciliation sweep
 * cancelled the order about fifteen minutes later. So the load-bearing
 * assertions here are the ones that would have caught that:
 *
 *   #1  a cash order is CONFIRMED immediately (not left payment_pending)
 *   #2  the sale books to `cod_receivable`, never `gateway_clearing`
 *   #3  the reconciliation sweep leaves a cash order ALONE  ← the original bug
 *   #7  a cash order cannot be marked delivered without the money
 *
 * Covers:
 *   1. COD checkout → order confirmed, payment awaiting_collection
 *   2. Ledger: cod_receivable raised, gateway_clearing untouched
 *   3. reconcilePending does NOT cancel an outstanding cash order
 *   4. Over-cap basket → 422 and NO order left behind
 *   5. Cancellation before collection waives the receivable (no refund)
 *   6. Rider collect-cash: wrong amount refused, right amount posts once
 *   7. Delivery is blocked until the cash is recorded, then succeeds
 *   8. Deposit: cash_on_hand → bank
 *   9. Slot with codAllowed=false refuses cash
 *  10. Integrity _codCheck agrees with the payments it summarises
 *  11. Ops exposure report: outstanding, aging, collected-unbanked
 *  12. Payout gate 2 accepts cod_collected as cash-in-hand proof
 *
 * Hermetic: in-memory mongod, app via createApp() on an ephemeral port, mock
 * provider for the non-COD comparisons. No dev .env leakage (guard first).
 *
 * Run: node scripts/smoke-cod.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = ''; // hermetic
process.env.MONGODB_URI = ''; // hermetic
process.env.OTP_PROVIDER = 'memory';
// an explicit, low cap so the over-cap case is reachable with a small basket
process.env.COD_ENABLED = 'true';
process.env.COD_MAX_AMOUNT_PAISE = '200000'; // ₹2,000
process.env.COD_FEE_PAISE = '0';

let mongod;
let server;
let passed = 0;
const ok = (label) => { passed += 1; console.log(`  PASS  ${label}`); };

const paise = (rupees) => Math.round(Number(rupees || 0) * 100);

async function main() {
  const config = (await import('../src/config/index.js')).default;
  assert.equal(config.cod.maxAmountPaise, 200000, 'the cap under test is ₹2,000');

  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_cod_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const MODEL_FILES = (await import('../src/config/models.js')).default;
  const M = {};
  for (const f of MODEL_FILES) {
    const model = (await import(`../src/models/${f}`)).default;
    await model.init();
    M[model.modelName] = model;
  }

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const { default: slotService } = await import('../src/services/slot.service.js');
  const { default: ledgerService } = await import('../src/services/ledger.service.js');
  const { ledgerAccounts } = await import('../src/services/ledger.service.js');
  const { default: paymentService } = await import('../src/services/payment.service.js');
  const { default: orderService } = await import('../src/services/order.service.js');
  const { default: integrityService } = await import('../src/services/integrity.service.js');
  const { default: payoutService } = await import('../src/services/payout.service.js');

  // ---------- tenant / people / catalog / slots ----------
  const tenant = await M.Tenant.create({ name: 'Cod T', slug: 'cod-t', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });
  const admin = await M.User.create({ tenantId: tenant.id, email: { address: 'a@cod.in', verified: true }, role: 'super_admin', status: 'active' });
  const picker = await M.User.create({ tenantId: tenant.id, phone: { number: '9876530001', verified: true }, role: 'picker', status: 'active' });
  const rider = await M.User.create({
    tenantId: tenant.id, phone: { number: '9876530002', verified: true },
    role: 'rider', status: 'active', rider: { availability: 'available' },
  });
  const customer = await M.User.create({ tenantId: tenant.id, phone: { number: '9876530003', verified: true }, status: 'active' });

  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const pickerTok = (await AuthService.issueTokens(picker)).accessToken;
  const riderTok = (await AuthService.issueTokens(rider)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;

  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh', slug: 'fresh', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'B', slug: 'b', status: 'active' });

  const mkListing = async (sku, sellingPrice) => {
    const master = await M.ProductMaster.create({
      tenantId: tenant.id, categoryId: category.id, brandId: brand.id,
      skuGlobal: sku, type: 'fresh_flower', title: `${sku} bouquet`, slug: sku.toLowerCase(),
      status: 'active', isPerishable: true,
    });
    const listing = await M.TenantProduct.create({
      tenantId: tenant.id, productMasterId: master.id,
      price: { mrp: sellingPrice + 100, sellingPrice, currency: 'INR' },
      stockQty: 100, status: 'active', version: 1,
    });
    await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 100 });
    return { master, listing };
  };
  // a basket that stays under the ₹2,000 cap, and one that sails over it
  const { listing } = await mkListing('COD-ROSE-10', 400);
  const { listing: poshListing } = await mkListing('COD-ORCHID-99', 3500);

  const hub = await M.Hub.create({ tenantId: tenant.id, name: 'Hub', code: 'COD-HUB', defaultSlotCapacity: 40, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const today = new Date().toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: today, capacity: 40 });

  const address = await M.Address.create({
    tenantId: tenant.id, userId: customer.id, name: 'R', phone: '9876530003',
    line1: '1 Main Rd', city: 'Vizag', state: 'AP', pincode: '530013',
  });

  // ---------- app + harness ----------
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
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
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };

  /** Add to cart, reserve a slot, check out. Returns the order (or the raw response on failure). */
  const placeOrder = async ({ product = listing, qty = 1, paymentMethod = 'cod', expectOk = true }) => {
    // Start from an empty cart every time. A refused checkout leaves its items
    // behind, so without this the over-cap basket would silently inflate the
    // total of every later order — and the cap test would "pass" for the wrong
    // reason while the collection tests compared against the wrong amount.
    const cleared = await call('/cart/clear', { method: 'DELETE', token: custTok });
    assert.ok([200, 204].includes(cleared.status), `clear cart ${cleared.status}: ${cleared.text}`);
    const add = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: product.id, qty } });
    assert.ok([200, 201].includes(add.status), `add to cart ${add.status}: ${add.text}`);
    const slots = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custTok });
    const slot = (slots.body?.data?.slots || []).find((s) => s.remaining > 0);
    assert.ok(slot, `a bookable slot must exist (got ${slots.text})`);
    const resv = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custTok });
    assert.ok([200, 201].includes(resv.status), `reserve ${resv.status}: ${resv.text}`);
    const r = await call('/cart/checkout', {
      method: 'POST',
      token: custTok,
      body: {
        slotReservationId: resv.body.data.id,
        addressId: address.id,
        paymentMethod,
        confirmPriceChanges: true,
      },
    });
    if (expectOk) assert.ok([200, 201].includes(r.status), `checkout ${r.status}: ${r.text}`);
    return { res: r, slot };
  };

  /** Drive an order from confirmed to the rider standing at the door. */
  const rideToDoor = async (orderId) => {
    await call(`/fulfillment/orders/${orderId}/pick`, { method: 'POST', token: pickerTok });
    await call(`/fulfillment/orders/${orderId}/pack`, { method: 'POST', token: pickerTok });
    const d = await call(`/fulfillment/orders/${orderId}/dispatch`, { method: 'POST', token: riderTok });
    assert.equal(d.status, 200, `dispatch ${d.status}: ${d.text}`);
    const aid = d.body.data.deliveryAssignment.id;
    for (const [path, body] of [
      ['accept', undefined],
      ['arrive-hub', undefined],
      ['depart', { package_verified: true }],
      ['arrive', undefined],
    ]) {
      const r = await call(`/rider/deliveries/${aid}/${path}`, { method: 'POST', token: riderTok, body });
      assert.equal(r.status, 200, `rider ${path} ${r.status}: ${r.text}`);
    }
    return aid;
  };

  const bal = async (code) => (await ledgerService.balance(code)).balancePaise;

  // =====================================================================
  // 1. a cash order is CONFIRMED immediately — not left payment_pending
  // =====================================================================
  const { res: codRes } = await placeOrder({ paymentMethod: 'cod' });
  const order = codRes.body.data.order;
  assert.equal(order.status, 'confirmed', 'cash is not an async gateway: the saga commits stock and slot now');
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.paymentSummary.status, 'awaiting_collection', 'confirmed, but the money has not moved');
  assert.equal(order.paymentSummary.paidAt ?? null, null, 'nothing has been paid yet');

  const payment = await M.Payment.findOne({ orderId: order.id });
  assert.equal(payment.provider, 'cod', 'no gateway is behind a cash order');
  assert.equal(payment.status, 'awaiting_collection');
  assert.equal(payment.paidAt, null);
  assert.equal(paise(payment.amount), paise(order.totalAmount));
  ok('1. COD checkout → order CONFIRMED, payment awaiting_collection, provider=cod');

  // the payment must NOT be 'pending', or the sweep will treat it as a stale
  // gateway charge — which is exactly how COD orders used to die
  assert.notEqual(payment.status, 'pending');
  assert.equal(payment.gatewayOrderId ?? null, null, 'no gateway order was ever created');
  ok('1b. the cash payment is not "pending" and has no gateway order to reconcile');

  // =====================================================================
  // 2. the sale books to cod_receivable, never gateway_clearing
  // =====================================================================
  const totalPaise = paise(order.totalAmount);
  assert.equal(await bal(ledgerAccounts.codReceivable()), totalPaise, 'the receivable equals the order total');
  assert.equal(await bal(ledgerAccounts.gatewayClearing()), 0, 'no PSP is holding cash it has never seen');
  assert.equal(await bal(ledgerAccounts.cashOnHand()), 0, 'no notes counted yet');

  const saleJournal = await M.LedgerJournal.findOne({
    idempotencyKey: `sale_captured:order:${order.id}`,
  }).lean();
  assert.ok(saleJournal, 'sale_captured was posted');
  const sourceLine = saleJournal.lines.find((l) => (l.debitPaise || 0) > 0);
  assert.equal(sourceLine.accountCode, 'cod_receivable');
  ok('2. sale_captured debits cod_receivable; gateway_clearing stays at zero');

  // the payout settlement gate reads the journal by order, so the header must
  // ref the ORDER rather than the payment
  const payoutGateQuery = await M.LedgerJournal.exists({
    refType: 'order',
    refId: order.id,
    kind: { $in: ['psp_settled', 'cod_collected'] },
  });
  assert.equal(payoutGateQuery, null, 'no cash-in-hand proof exists yet');

  // =====================================================================
  // 3. THE REGRESSION: the sweep must leave a cash order alone
  // =====================================================================
  // This is the assertion that would have caught the original bug. With a
  // gateway provider configured, a cash checkout used to produce a PENDING
  // payment that reconcilePending resolved against the PSP — found nothing —
  // and cancelled ~15 minutes later.
  const swept = await paymentService.reconcilePending({ olderThanMinutes: 0, limit: 50 });
  const afterSweep = await M.Order.findById(order.id).lean();
  const paymentAfterSweep = await M.Payment.findById(payment._id).lean();
  assert.equal(afterSweep.status, 'confirmed', 'the sweep must not cancel a cash order');
  assert.notEqual(afterSweep.status, 'cancelled');
  assert.equal(paymentAfterSweep.status, 'awaiting_collection', 'still owed, not failed');
  assert.equal(swept.cancelled?.length || 0, 0, 'nothing was cancelled by the sweep');
  ok('3. reconcilePending leaves an outstanding cash order confirmed (the original bug)');

  // =====================================================================
  // 4. over the cap → 422 and NO order left behind
  // =====================================================================
  const ordersBefore = await M.Order.countDocuments({});
  const { res: overRes } = await placeOrder({ product: poshListing, qty: 1, expectOk: false });
  assert.equal(overRes.status, 422, `over-cap checkout must be 422, got ${overRes.status}: ${overRes.text}`);
  assert.equal(overRes.body?.error?.code, 'COD_LIMIT_EXCEEDED');
  assert.equal(await M.Order.countDocuments({}), ordersBefore, 'no half-built order survives the refusal');
  assert.equal(await M.Payment.countDocuments({ provider: 'cod', orderId: { $ne: order.id } }), 0, 'no stray cash payment');
  ok('4. a basket over the risk cap is refused cleanly, with no order created');

  // the same basket is fine when prepaid — the cap is about CASH, not size
  const { res: prepaidRes } = await placeOrder({ product: poshListing, qty: 1, paymentMethod: 'upi' });
  assert.equal(prepaidRes.body.data.order.status, 'confirmed');
  ok('4b. the same over-cap basket checks out fine when prepaid');

  // =====================================================================
  // 5. cancelling before collection WAIVES the receivable
  // =====================================================================
  const { res: cancelRes } = await placeOrder({ paymentMethod: 'cod' });
  const cancelledOrder = cancelRes.body.data.order;
  const receivableBeforeCancel = await bal(ledgerAccounts.codReceivable());
  assert.ok(receivableBeforeCancel >= paise(cancelledOrder.totalAmount));

  const c = await call(`/orders/${cancelledOrder.id}/cancel`, {
    method: 'POST', token: custTok, body: { reason: 'customer_requested', reasonText: 'changed my mind' },
  });
  assert.ok([200, 201].includes(c.status), `cancel ${c.status}: ${c.text}`);

  const cancelledPayment = await M.Payment.findOne({ orderId: cancelledOrder.id }).lean();
  assert.equal(cancelledPayment.status, 'failed', 'an uncollected cash payment is failed, not refunded');
  assert.equal(await bal(ledgerAccounts.codReceivable()), receivableBeforeCancel - paise(cancelledOrder.totalAmount), 'the receivable was waived, not stranded');
  const refundsForCancelled = await M.RefundTransaction.countDocuments({ orderId: cancelledOrder.id });
  assert.equal(refundsForCancelled, 0, 'no refund: no money ever arrived to give back');
  const waiver = await M.LedgerJournal.findOne({ kind: 'cod_receivable_waived', refId: cancelledOrder.id }).lean();
  assert.ok(waiver, 'the waiver was booked as its own journal kind');
  ok('5. cancelling an uncollected cash order waives the receivable and books no refund');

  // =====================================================================
  // 6. collection: wrong amount refused, right amount posts exactly once
  // =====================================================================
  const aid = await rideToDoor(order.id);

  // 6a. a shortfall must be refused, not absorbed
  const short = await call(`/rider/deliveries/${aid}/collect-cash`, {
    method: 'POST', token: riderTok,
    body: { amount_collected: order.totalAmount - 100 },
  });
  assert.equal(short.status, 422, `a shortfall must be refused, got ${short.status}: ${short.text}`);
  assert.equal(short.body?.error?.code, 'COD_AMOUNT_MISMATCH');
  assert.equal((await M.Payment.findById(payment._id).lean()).status, 'awaiting_collection', 'a refused collection changes nothing');
  assert.equal(await bal(ledgerAccounts.cashOnHand()), 0, 'no phantom cash was booked');
  ok('6a. a cash shortfall is REFUSED rather than silently absorbed');

  // 6b. the right amount
  const collected = await call(`/rider/deliveries/${aid}/collect-cash`, {
    method: 'POST', token: riderTok, body: { note: 'exact change' },
  });
  assert.equal(collected.status, 200, `collect ${collected.status}: ${collected.text}`);
  assert.equal(collected.body.data.collected, true);
  const paidPayment = await M.Payment.findById(payment._id).lean();
  assert.equal(paidPayment.status, 'success');
  assert.equal(paise(paidPayment.amountCollected), totalPaise);
  assert.ok(paidPayment.collectedAt, 'collection is timestamped');
  assert.equal(String(paidPayment.collectedBy), String(rider.id), 'attributed to the rider who took it');

  assert.equal(await bal(ledgerAccounts.codReceivable()), 0, 'the customer no longer owes us');
  assert.equal(await bal(ledgerAccounts.cashOnHand()), totalPaise, 'the notes are now ours');
  assert.equal(await bal(ledgerAccounts.bank()), 0, 'but not yet banked');
  ok('6b. collecting the exact amount swaps cod_receivable → cash_on_hand');

  // the order's own summary follows the payment, not the delivery
  const orderAfterCollect = await M.Order.findById(order.id).lean();
  assert.equal(orderAfterCollect.paymentSummary.status, 'success');
  assert.ok(orderAfterCollect.paymentSummary.paidAt, 'paidAt stamped at collection');
  ok('6c. the order summary is synced from the payment row');

  // 6d. idempotent: a second tap posts nothing
  const journalsBefore = await M.LedgerJournal.countDocuments({ kind: 'cod_collected' });
  const again = await call(`/rider/deliveries/${aid}/collect-cash`, { method: 'POST', token: riderTok, body: {} });
  assert.equal(again.status, 200, `replay ${again.status}: ${again.text}`);
  assert.equal(again.body.data.alreadyCollected, true);
  assert.equal(again.body.data.collected, false);
  assert.equal(await M.LedgerJournal.countDocuments({ kind: 'cod_collected' }), journalsBefore, 'no second journal');
  assert.equal(await bal(ledgerAccounts.cashOnHand()), totalPaise, 'cash on hand did not double');
  ok('6d. a second collection is idempotent — one journal, no doubled cash');

  // 6e. the money FACT is in the audit backbone, and the chain still verifies
  const codEvent = await M.DomainEvent.findOne({ kind: 'cod_collected', refId: payment._id }).lean();
  assert.ok(codEvent, 'cod_collected was appended to the hash chain');
  const chain = await (await import('../src/services/domainEvent.service.js')).default.verifyChains({ tenantId: tenant.id });
  assert.equal(chain.tenants >= 1, true);
  assert.equal((chain.breaks || []).length, 0, 'the audit chain is unbroken after the cash events');
  ok('6e. cod_collected is a domain event and the hash chain still verifies');

  // =====================================================================
  // 7. delivery is blocked until the cash is recorded
  // =====================================================================
  // Build a second cash order and take it to the door WITHOUT collecting.
  const { res: gateRes } = await placeOrder({ paymentMethod: 'cod' });
  const gateOrder = gateRes.body.data.order;
  const gateAid = await rideToDoor(gateOrder.id);

  const blocked = await call(`/rider/deliveries/${gateAid}/complete`, {
    method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: '4321' },
  });
  assert.equal(blocked.status, 409, `delivery without cash must be refused, got ${blocked.status}: ${blocked.text}`);
  assert.equal(blocked.body?.error?.code, 'COD_COLLECTION_REQUIRED');
  const stillOpen = await M.Order.findById(gateOrder.id).lean();
  assert.notEqual(stillOpen.status, 'delivered', 'the order must not be delivered with cash outstanding');

  // ops cannot route around it either
  const opsBlocked = await call(`/fulfillment/orders/${gateOrder.id}/deliver`, {
    method: 'POST', token: adminTok, body: { podType: 'otp', podValue: '4321' },
  });
  assert.equal(opsBlocked.status, 409, `ops deliver must also be refused, got ${opsBlocked.status}: ${opsBlocked.text}`);
  assert.equal(opsBlocked.body?.error?.code, 'COD_COLLECTION_REQUIRED');
  ok('7a. neither the rider nor ops can mark a cash order delivered without the money');

  // ...but ticking the box collects and delivers in one step
  const done = await call(`/rider/deliveries/${gateAid}/complete`, {
    method: 'POST', token: riderTok,
    body: { pod_type: 'otp', pod_reference: '4321', cod_collected: true },
  });
  assert.equal(done.status, 200, `collect+deliver ${done.status}: ${done.text}`);
  const deliveredOrder = await M.Order.findById(gateOrder.id).lean();
  assert.equal(deliveredOrder.status, 'delivered');
  assert.equal(deliveredOrder.paymentSummary.status, 'success', 'the inline flag collected the cash');
  ok('7b. cod_collected:true collects and delivers in one tap');

  // and the first order (already collected) delivers normally
  const done1 = await call(`/rider/deliveries/${aid}/complete`, {
    method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: '9999' },
  });
  assert.equal(done1.status, 200, `complete after collection ${done1.status}: ${done1.text}`);
  ok('7c. an already-collected cash order delivers with no extra step');

  // =====================================================================
  // 8. deposit: cash_on_hand → bank
  // =====================================================================
  const cashBefore = await bal(ledgerAccounts.cashOnHand());
  assert.ok(cashBefore > 0, 'there is cash in hand to bank');
  const dep = await call(`/fulfillment/payments/${payment._id}/deposit-cash`, {
    method: 'POST', token: adminTok, body: { deposit_ref: 'NEFT-COD-1' },
  });
  assert.equal(dep.status, 200, `deposit ${dep.status}: ${dep.text}`);
  assert.equal(dep.body.data.deposited, true);
  assert.equal(await bal(ledgerAccounts.cashOnHand()), cashBefore - totalPaise, 'the deposited notes left the till');
  assert.equal(await bal(ledgerAccounts.bank()), totalPaise, 'and reached the bank');
  const depAgain = await call(`/fulfillment/payments/${payment._id}/deposit-cash`, { method: 'POST', token: adminTok, body: {} });
  assert.equal(depAgain.body.data.alreadyDeposited, true, 'depositing twice is a no-op');
  ok('8. depositing moves cash_on_hand → bank, and is idempotent');

  // =====================================================================
  // 9. a slot that does not allow cash refuses cash
  // =====================================================================
  await M.DeliverySlot.updateMany({}, { $set: { codAllowed: false } });
  const { res: slotRes } = await placeOrder({ paymentMethod: 'cod', expectOk: false });
  assert.equal(slotRes.status, 422, `a no-cash slot must refuse cash, got ${slotRes.status}: ${slotRes.text}`);
  assert.equal(slotRes.body?.error?.code, 'COD_NOT_ALLOWED_FOR_SLOT');
  // prepaid is unaffected by the slot's cash flag
  const { res: slotPrepaid } = await placeOrder({ paymentMethod: 'upi' });
  assert.equal(slotPrepaid.body.data.order.status, 'confirmed');
  ok('9. slot.codAllowed=false refuses cash but still accepts prepayment');
  await M.DeliverySlot.updateMany({}, { $set: { codAllowed: true } });

  // =====================================================================
  // 10. integrity: the cash accounts agree with the payments behind them
  // =====================================================================
  const report = await integrityService.report({ tenantId: tenant.id });
  const cod = report.checks.cod;
  assert.ok(cod, 'the integrity report has a cod section');
  assert.equal(cod.error ?? null, null, `cod check must not error: ${cod.error}`);
  assert.equal(cod.receivableDifferencePaise, 0, 'cod_receivable agrees with outstanding cash payments');
  assert.equal(cod.cashOnHandDifferencePaise, 0, 'cash_on_hand agrees with collected-unbanked payments');
  assert.equal(cod.strandedReceivables, 0, 'no receivable survived a cancellation');
  assert.equal(cod.ok, true);
  ok('10. integrity _codCheck: both cash accounts reconcile, nothing stranded');

  // =====================================================================
  // 11. the ops exposure report
  // =====================================================================
  const exposure = await call('/fulfillment/payments/cod/outstanding', { token: adminTok });
  assert.equal(exposure.status, 200, exposure.text);
  const ex = exposure.body.data;
  assert.equal(typeof ex.outstandingCount, 'number');
  assert.equal(ex.receivablePaise, paise(ex.receivable), 'paise and rupee views agree');
  assert.ok(ex.aging && typeof ex.aging === 'object', 'aging buckets are present');
  const bandsSum = Object.values(ex.aging).reduce((a, b) => a + (b.paise || 0), 0);
  assert.equal(bandsSum, ex.receivablePaise, 'the aging bands sum to the total owed');
  // the gate order was collected at delivery, so it is cash in hand, not owed
  assert.ok(ex.collectedNotDeposited >= 1, 'the second order\'s cash is collected but unbanked');
  ok('11. exposure report: outstanding, aging bands that sum correctly, unbanked cash');

  // =====================================================================
  // 12. payout gate 2 accepts cod_collected as cash-in-hand proof
  // =====================================================================
  const gate2 = await M.LedgerJournal.exists({
    refType: 'order',
    refId: order.id,
    kind: { $in: ['psp_settled', 'cod_collected'] },
  });
  assert.ok(gate2, 'a collected cash order satisfies the settlement gate');
  // and with the gate switched on, the sweep must not block the delivered lines
  await payoutService.upsertPolicy({ scope: 'platform', payload: { requirePspSettlement: true } });
  const sweep = await payoutService.markEligible({ now: new Date(Date.now() + 40 * 86400000) });
  assert.equal(typeof sweep.scanned, 'number');
  const blockedLines = await M.PayoutLineItem.countDocuments({ orderId: order.id, state: 'accrued' });
  assert.ok(sweep.blocked === 0 || blockedLines === 0,
    `a collected cash order must not be blocked by the settlement gate (blocked=${sweep.blocked}, stillAccrued=${blockedLines})`);
  ok('12. payout gate 2 accepts cod_collected — cash orders are not blocked forever');

  // =====================================================================
  // the trial balance is still exactly zero after all of it
  // =====================================================================
  const trial = await ledgerService.trialBalance();
  assert.equal(trial.balanced, true, `debits ${trial.totalDebitPaise} vs credits ${trial.totalCreditPaise}`);
  assert.equal(trial.differencePaise, 0);
  ok('13. the whole cash lifecycle leaves the trial balance at exactly zero');

  console.log(`\nCOD SMOKE: ${passed} checks passed ✔`);
}

main()
  .then(async () => {
    try { await mongoose.disconnect(); } catch { /* best effort */ }
    try { await mongod?.stop(); } catch { /* best effort */ }
    try { server?.close(); } catch { /* best effort */ }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nCOD SMOKE FAILED:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    try { await mongoose.disconnect(); } catch { /* best effort */ }
    try { await mongod?.stop(); } catch { /* best effort */ }
    try { server?.close(); } catch { /* best effort */ }
    process.exit(1);
  });
