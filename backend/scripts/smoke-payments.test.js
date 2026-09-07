/**
 * Payments smoke test — async capture, signature-verified idempotent webhooks,
 * amount verification, webhook-loss reconciliation, customer status polling.
 *
 * Hermetic: in-memory mongod, app via createApp() on an ephemeral port, mock
 * provider (forcePending simulates the Razorpay async flow). No dev .env
 * leakage (test-env-guard first).
 *
 * Covers:
 *   1. Sync mock charge regression (checkout → confirmed, payment success)
 *   2. Async flow: checkout → order PAYMENT_PENDING + payment pending
 *   3. Signed mock webhook → processed → order confirmed (event row audit)
 *   4. Duplicate delivery (same eventId) → duplicate, state unchanged
 *   5. Bad signature → 401, no state change, no event row
 *   6. Amount mismatch → NOT confirmed, event recorded as mismatch
 *   7. Unknown payment: razorpay path acks 200 (prod semantics); mock 400 (dev)
 *   8. Webhook-LOSS recovery: reconcile polls gateway (mock map) → confirms
 *   9. Reconcile fail path: gateway silent → payment failed + order cancelled
 *  10. Customer GET /orders/:id/payment (pending → success; 404 for others)
 *  11. Razorpay HMAC verify (known vector + tamper reject)
 *  12. Gateway refund reconciliation (pending → processed)
 *
 * Run: node scripts/smoke-payments.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = ''; // hermetic
process.env.MONGODB_URI = ''; // hermetic
process.env.OTP_PROVIDER = 'memory';

let mongod;
let server;
let passed = 0;
const ok = (label) => { passed += 1; console.log(`  PASS  ${label}`); };

async function main() {
  const config = (await import('../src/config/index.js')).default;
  const MOCK_SECRET = config.payments.mockWebhookSecret;
  config.razorpay.webhookSecret = 'test-rzp-secret'; // razorpay webhook path tests

  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_payments_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const MODEL_FILES = (await import('../src/config/models.js')).default;
  for (const f of MODEL_FILES) {
    await (await import(`../src/models/${f}`)).default.init();
  }
  const M = {};
  for (const f of MODEL_FILES) M[(await import(`../src/models/${f}`)).default.modelName] = (await import(`../src/models/${f}`)).default;

  // ---------- tenant / users / catalog / slots / address ----------
  const tenant = await M.Tenant.create({ name: 'Pay T', slug: 'pay-t', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });
  const admin = await M.User.create({ tenantId: tenant.id, email: { address: 'a@pay.in', verified: true }, role: 'super_admin', status: 'active' });
  const customer = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510001', verified: true }, status: 'active' });
  const stranger = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510002', verified: true }, status: 'active' });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const custTok = (await AuthService.issueTokens(customer)).accessToken;
  const stratTok = (await AuthService.issueTokens(stranger)).accessToken;

  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh', slug: 'fresh', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'B', slug: 'b', status: 'active' });
  const master = await M.ProductMaster.create({
    tenantId: tenant.id, categoryId: category.id, brandId: brand.id,
    skuGlobal: 'ROS-PAY-10', type: 'fresh_flower', title: 'Pay Roses', slug: 'pay-roses', status: 'active', isPerishable: true,
  });
  const listing = await M.TenantProduct.create({
    tenantId: tenant.id, productMasterId: master.id,
    price: { mrp: 500, sellingPrice: 400, currency: 'INR' }, stockQty: 50, status: 'active', version: 1,
  });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 50 });
  const hub = await M.Hub.create({ tenantId: tenant.id, name: 'Hub', code: 'PAY-HUB', defaultSlotCapacity: 40, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const { default: slotService } = await import('../src/services/slot.service.js');
  const today = new Date().toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: today, capacity: 40 });
  const address = await M.Address.create({
    tenantId: tenant.id, userId: customer.id, name: 'R', phone: '9876510001',
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
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenant.id, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
  const sign = (body) => crypto.createHmac('sha256', MOCK_SECRET).update(body).digest('hex');
  const mockWebhook = (body, sig = sign(JSON.stringify(body))) => call('/payments/webhook/mock', {
    method: 'POST', body, headers: { 'x-mock-signature': sig, 'content-type': 'application/json' },
  });
  const placeOrder = async (paymentMethod = 'upi') => {
    await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty: 1 } });
    const slots = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custTok });
    const slot = slots.body.data.slots.find((s) => s.remaining > 0);
    const resv = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custTok });
    const r = await call('/cart/checkout', {
      method: 'POST', token: custTok,
      body: { slotReservationId: resv.body.data.id, addressId: address.id, paymentMethod },
    });
    assert.ok([200, 201].includes(r.status), `checkout ${r.status}: ${r.text}`);
    return r.body.data.order;
  };

  const { default: paymentProvider } = await import('../src/services/paymentProvider.service.js');
  const { default: paymentService } = await import('../src/services/payment.service.js');
  const { default: refundService } = await import('../src/services/refund.service.js');

  // ============ 1. sync mock regression ============
  let order = await placeOrder('upi');
  assert.equal(order.status, 'confirmed', 'sync mock charge confirms the order');
  assert.equal(order.paymentSummary.status, 'success');
  ok('sync mock charge regression — checkout → confirmed');

  // ============ 2. async flow (forcePending simulates razorpay) ============
  paymentProvider.forcePending(true);
  order = await placeOrder('upi');
  assert.equal(order.status, 'payment_pending', 'order stays PAYMENT_PENDING for async capture');
  const pendingPayment = await M.Payment.findOne({ orderId: order.id }).lean();
  assert.equal(pendingPayment.status, 'pending');
  assert.ok(pendingPayment.gatewayOrderId, 'gatewayOrderId recorded');
  ok('async flow — checkout → PAYMENT_PENDING + payment pending with gatewayOrderId');

  const gid = pendingPayment.gatewayOrderId;
  const payId = String(pendingPayment._id);

  // ============ 10a. customer payment status: pending ============
  let ps = await call(`/orders/${order.id}/payment`, { token: custTok });
  assert.equal(ps.status, 200);
  assert.equal(ps.body.data.payment.status, 'pending');
  assert.equal(ps.body.data.order.status, 'payment_pending');
  const psStranger = await call(`/orders/${order.id}/payment`, { token: stratTok });
  assert.equal(psStranger.status, 404, 'other customers cannot read this order');
  ok('customer payment-status endpoint — pending visible to owner, 404 to others');

  // ============ 5. bad signature → 401, nothing changes ============
  const badSig = await mockWebhook({ gatewayOrderId: gid }, 'deadbeef'.repeat(8));
  assert.equal(badSig.status, 401, 'bad signature rejected');
  let after = await M.Payment.findById(payId).lean();
  assert.equal(after.status, 'pending', 'bad signature must not change state');
  assert.equal(await M.PaymentWebhookEvent.countDocuments({}), 0, 'bad signature must not create an event row');
  ok('bad signature → 401, no state change, no event row');

  // ============ 6. amount mismatch → NOT confirmed ============
  const wrongAmount = await mockWebhook({ gatewayOrderId: gid, eventId: 'evt_mismatch_1', amountPaise: 99999 });
  assert.equal(wrongAmount.status, 200);
  assert.equal(wrongAmount.body.data.result, 'mismatch');
  after = await M.Payment.findById(payId).lean();
  assert.equal(after.status, 'pending', 'mismatch must never confirm');
  const mmEvent = await M.PaymentWebhookEvent.findOne({ provider: 'mock', eventId: 'evt_mismatch_1' }).lean();
  assert.equal(mmEvent.status, 'mismatch');
  assert.match(mmEvent.note, /99999/);
  ok('amount mismatch → 200 ack, payment untouched, event recorded for review');

  // ============ 3. signed webhook → processed → confirmed ============
  const good = await mockWebhook({ gatewayOrderId: gid, eventId: 'evt_good_1', amountPaise: Math.round(pendingPayment.amount * 100) });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.body.data.result, 'processed');
  after = await M.Payment.findById(payId).lean();
  assert.equal(after.status, 'success', 'webhook confirmed the payment');
  assert.ok(after.paidAt, 'paidAt stamped');
  const confirmedOrder = await M.Order.findById(order.id).lean();
  assert.equal(confirmedOrder.status, 'confirmed', 'saga finalised to confirmed');
  const evt = await M.PaymentWebhookEvent.findOne({ eventId: 'evt_good_1' }).lean();
  assert.equal(evt.status, 'processed');
  assert.equal(String(evt.paymentId), payId);
  ps = await call(`/orders/${order.id}/payment`, { token: custTok });
  assert.equal(ps.body.data.payment.status, 'success');
  ok('signed webhook → processed → payment success + order confirmed (audit row written)');

  // ============ 4. duplicate delivery ============
  const dup = await mockWebhook({ gatewayOrderId: gid, eventId: 'evt_good_1', amountPaise: Math.round(pendingPayment.amount * 100) });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.data.result, 'duplicate', 'replay detected at event level');
  const evtRows = await M.PaymentWebhookEvent.find({ eventId: 'evt_good_1' }).lean();
  assert.equal(evtRows.length, 1, 'unique (provider, eventId) — one row');
  assert.equal(evtRows[0].status, 'processed', 'replay must NOT overwrite the original disposition');
  assert.equal(evtRows[0].deliveries, 2, 'replay bookkept as a second delivery');
  const confirmedAgain = await M.Order.findById(order.id).lean();
  assert.equal(confirmedAgain.status, 'confirmed', 'state machine not re-entered');
  ok('duplicate delivery → duplicate, single audit row, disposition preserved, state unchanged');

  // ============ 7. unknown payment semantics ============
  // exact raw bytes, signed, sent as-is (webhook routes use express.raw)
  const rzpBody = JSON.stringify({
    id: 'evt_rzp_unknown', event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_nope', order_id: 'order_nope', amount: 40000, currency: 'INR' } } },
  });
  const rzpRes = await fetch(base + '/payments/webhook/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      'x-razorpay-signature': crypto.createHmac('sha256', 'test-rzp-secret').update(rzpBody).digest('hex'),
    },
    body: rzpBody,
  });
  const rzpJson = await rzpRes.json().catch(() => null);
  assert.equal(rzpRes.status, 200, 'production semantics: unknown payment is ACKED (no retry storm)');
  assert.equal(rzpJson?.data?.result, 'ignored');
  const mockUnknown = await mockWebhook({ gatewayOrderId: 'mord_nope', eventId: 'evt_mock_unknown' });
  assert.equal(mockUnknown.status, 400, 'dev semantics: mock webhook reports unknown refs');
  ok('unknown payment — razorpay path 200-ack (prod), mock path 400 (dev)');

  // ============ 8. webhook-LOSS recovery via reconciliation ============
  const order2 = await placeOrder('upi');
  assert.equal(order2.status, 'payment_pending');
  const pay2 = await M.Payment.findOne({ orderId: order2.id }).lean();
  // the gateway captured it, but our webhook was LOST
  paymentProvider.mockGatewaySet(pay2.gatewayOrderId, { captured: true, gatewayPaymentId: 'mpay_lost_webhook' });
  // age the payment past the stale threshold
  await M.Payment.updateOne({ _id: pay2._id }, { $set: { createdAt: new Date(Date.now() - 20 * 60000) } });
  const rec1 = await paymentService.reconcilePending({ olderThanMinutes: 15, limit: 50 });
  const pay2After = await M.Payment.findById(pay2._id).lean();
  assert.equal(pay2After.status, 'success', 'reconciliation recovered the lost webhook from the gateway');
  assert.equal(pay2After.gatewayPaymentId, 'mpay_lost_webhook');
  const order2After = await M.Order.findById(order2.id).lean();
  assert.equal(order2After.status, 'confirmed', 'order finalised by reconciliation');
  assert.ok(rec1.scanned >= 1);
  ok('webhook lost → reconciliation polls gateway (source of truth) → confirmed');

  // ============ 9. reconcile fail path: gateway silent ============
  const order3 = await placeOrder('upi');
  const pay3 = await M.Payment.findOne({ orderId: order3.id }).lean();
  assert.equal(pay3.status, 'pending');
  await M.Payment.updateOne({ _id: pay3._id }, { $set: { createdAt: new Date(Date.now() - 20 * 60000) } });
  await paymentService.reconcilePending({ olderThanMinutes: 15, limit: 50 });
  const pay3After = await M.Payment.findById(pay3._id).lean();
  assert.equal(pay3After.status, 'failed', 'no capture at gateway → payment failed');
  const order3After = await M.Order.findById(order3.id).lean();
  assert.equal(order3After.status, 'cancelled', 'order cancelled (compensation)');
  ok('gateway silent → payment failed + order cancelled (slot released by saga)');

  paymentProvider.forcePending(false);

  // ============ 11. razorpay HMAC verify (known vector + tamper) ============
  const secret = 'test-rzp-secret';
  const body = '{"id":"evt_1","event":"payment.captured"}';
  const goodSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(paymentProvider.verifyWebhook('razorpay', Buffer.from(body), goodSig).ok, true, 'valid HMAC accepted');
  assert.equal(paymentProvider.verifyWebhook('razorpay', Buffer.from(body + ' '), goodSig).ok, false, 'tampered body rejected');
  assert.equal(paymentProvider.verifyWebhook('razorpay', Buffer.from(body), 'zz' + goodSig.slice(2)).ok, false, 'tampered signature rejected');
  assert.equal(paymentProvider.verifyWebhook('razorpay', Buffer.from(body), '').ok, false, 'missing signature rejected');
  ok('razorpay HMAC verification — valid accepted, tamper/missing rejected (constant-time)');

  // ============ 12. gateway refund reconciliation ============
  // build a captured order + refund txn stuck PENDING with a gateway ref
  const order4 = await placeOrder('upi');
  const pay4 = await M.Payment.findOne({ orderId: order4.id }).lean();
  const refundTxn = await M.RefundTransaction.create({
    tenantId: tenant.id, orderId: order4.id, userId: customer.id, paymentId: pay4.id,
    amount: 40, currency: 'INR', reason: 'order_cancelled',
    destination: 'original_method', status: 'pending',
    idempotencyKey: `refund_recon_${Date.now()}`, gatewayRef: 'mref_recon_1',
    initiatedAt: new Date(Date.now() - 20 * 60000),
  });
  const recRef = await refundService.reconcileRefunds({ olderThanMinutes: 10, limit: 50 });
  const refundAfter = await M.RefundTransaction.findById(refundTxn._id).lean();
  assert.equal(refundAfter.status, 'success', 'gateway-confirmed refund finalised');
  assert.ok(recRef.resolved.length >= 1);
  ok('gateway refund reconciliation — pending → processed (source of truth)');

  // ============ metrics sanity ============
  const metrics = await call('/metrics', { headers: {} });
  void metrics; // /metrics is at app root, not /api/v1 — fetch it directly
  const mres = await fetch(`http://127.0.0.1:${server.address().port}/metrics`);
  const mtext = await mres.text();
  assert.match(mtext, /fm_webhook_events_total\{provider="mock",result="processed"\} [1-9]/, 'webhook processed counter');
  assert.match(mtext, /fm_webhook_events_total\{provider="mock",result="duplicate"\} [1-9]/, 'webhook duplicate counter');
  assert.match(mtext, /fm_webhook_events_total\{provider="mock",result="mismatch"\} [1-9]/, 'webhook mismatch counter');
  assert.match(mtext, /fm_payment_pending_count \d+/, 'payment pending gauge');
  ok('payment metrics — webhook results + pending gauges exposed on /metrics');

  console.log(`\n=== PAYMENTS SMOKE: ${passed}/13 sections passed ===`);
}

main()
  .then(async () => {
    if (server) server.close();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nFAILED:', err);
    try { if (server) server.close(); } catch { /* noop */ }
    try { await mongoose.disconnect(); } catch { /* noop */ }
    if (mongod) await mongod.stop().catch(() => {});
    process.exit(1);
  });
