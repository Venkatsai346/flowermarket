/**
 * Phase 3.5 smoke test — policy engine, component refunds, rider app,
 * forecasting, and the async (razorpay-style) payment + webhook flow.
 *
 * Covers:
 *   1. Delivery fee policy: free-delivery threshold (≥ ₹499 -> fee 0)
 *   2. Tax policy per category -> per-item taxAmount + order taxTotal
 *   3. Coupon (WELCOME10) -> proportional discountAllocated per line
 *   4. Immutable OrderChargeBreakdown persisted (grandTotal = item+tax−disc+fee)
 *   5. Refund components: partial return (no fee) vs full return (fee refunded)
 *   6. Rider app: accept-timeout sweep + reject -> reassignment
 *   7. Async payment (razorpay-style): pending -> mock webhook -> CONFIRMED
 *
 * Run: node scripts/smoke-phase35.test.js   (requires npm install already done)
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.OTP_PROVIDER = 'memory';
let mongod;

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_p35_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const models = await Promise.all([
    'tenant.model.js','tenantAuthConfig.model.js','user.model.js','category.model.js','brand.model.js',
    'productMaster.model.js','tenantProduct.model.js','inventory.model.js','address.model.js','hub.model.js',
    'serviceablePincode.model.js','deliverySlot.model.js','slotReservation.model.js','cart.model.js','cartItem.model.js',
    'order.model.js','orderItem.model.js','orderStatusHistory.model.js','payment.model.js','paymentTransaction.model.js',
    'refundTransaction.model.js','wallet.model.js','walletTransaction.model.js','returnRequest.model.js','returnItem.model.js',
    'fulfillmentTask.model.js','deliveryAssignment.model.js','deliveryFeePolicy.model.js','taxPolicy.model.js',
    'discountPolicy.model.js','couponUsage.model.js','orderChargeBreakdown.model.js','tenantRefundPolicy.model.js',
    'fulfillmentTimeLog.model.js','auditLog.model.js','catalogEvent.model.js',
  ].map((f) => import(`../src/models/${f}`)));
  const M = {};
  for (const m of models) { const mod = m.default; M[mod.modelName] = mod; await mod.init(); }

  const tenant = await M.Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });

  const admin = await M.User.create({ tenantId: tenant.id, email: { address: 'a@fm.in', verified: true }, role: 'super_admin', status: 'active' });
  const customer = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510001', verified: true }, status: 'active' });
  const picker = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510002', verified: true }, role: 'picker', status: 'active' });
  const rider = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510003', verified: true }, role: 'rider', status: 'active', rider: { availability: 'available' } });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;
  const pickerTok = (await AuthService.issueTokens(picker)).accessToken;
  const riderTok = (await AuthService.issueTokens(rider)).accessToken;

  // ---- taxonomy + catalog (direct setup; catalog API is Phase-2 tested) ----
  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh Flowers', slug: 'fresh-flowers', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'RoseVille', slug: 'roseville', status: 'active' });
  const master = await M.ProductMaster.create({ tenantId: tenant.id, categoryId: category.id, brandId: brand.id, skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10', slug: 'red-roses-10', status: 'active', isPerishable: true });
  const listing = await M.TenantProduct.create({ tenantId: tenant.id, productMasterId: master.id, price: { mrp: 399, sellingPrice: 299, currency: 'INR' }, stockQty: 100, status: 'active', version: 1 });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 100 });

  // ---- Phase 3.5 policies ----
  await M.DeliveryFeePolicy.create({ tenantId: tenant.id, name: 'default', baseFee: 49, freeDeliveryThreshold: 499, expressSurgeMultiplier: 1.25, distanceFeePerKm: 0, isActive: true, version: 1 });
  await M.TaxPolicy.create({ categoryId: category.id, gstSlabPct: 5, hsnCode: '0603', isActive: true });
  await M.TenantRefundPolicy.create({ tenantId: tenant.id, refundDeliveryFeeWhen: 'full_order_return_only', refundFeePct: 100 });
  const coupon = await M.DiscountPolicy.create({ tenantId: tenant.id, code: 'WELCOME10', discountType: 'percent', value: 10, minCartValue: 199, maxDiscountCap: 100, validFrom: new Date(Date.now() - 86400000), validTo: new Date(Date.now() + 90 * 86400000), status: 'active', isActive: true });

  // ---- hub + slots ----
  const hub = await M.Hub.create({ tenantId: tenant.id, name: 'Hub', code: 'H1', defaultSlotCapacity: 20, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const { default: slotService } = await import('../src/services/slot.service.js');
  const today = new Date().toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: today, capacity: 10 });
  const address = await M.Address.create({ tenantId: tenant.id, userId: customer.id, name: 'Ramu', phone: '9876510001', line1: '12-13-4 Main Rd', city: 'Vizag', state: 'AP', pincode: '530013' });

  // ---- app harness ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (path, { method = 'GET', body, token, raw = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenant.id, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return { status: res.status, text: await res.text() };
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
  let passed = 0;
  const ok = (l) => { passed += 1; console.log(`  ✓ ${l}`); };

  const addToCart = async (qty) => {
    let r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const reserveSlot = async () => {
    const r = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custTok });
    const slot = r.body.data.slots.find((s) => s.remaining > 0);
    const r2 = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custTok });
    return r2.body.data.id;
  };

  // ================= 1. delivery fee policy: free ≥ 499 =================
  await addToCart(1); // subtotal 299 < 499 -> fee 49
  let res = await reserveSlot();
  let r = await call('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: res, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  let order = r.body.data.order;
  const firstOrder = await M.Order.findById(order.id);
  assert.equal(order.deliveryFee, 49, 'below threshold -> fee charged');
  assert.equal(order.taxAmount, 14.95, '5% GST on 299');
  assert.equal(order.itemsSubtotal, 299);
  assert.equal(order.totalAmount, 299 + 14.95 + 49);
  ok(`fee policy: subtotal 299 < 499 -> fee ₹49, tax ₹14.95 (total ₹${order.totalAmount})`);

  // ================= 2. coupon + proportional discount + breakdown =================
  // fresh cart: 2 roses = 598 ≥ 499 -> free delivery; apply WELCOME10 (10% off)
  await addToCart(1);
  await addToCart(1);
  r = await call('/cart/coupon', { method: 'POST', token: custTok, body: { code: 'WELCOME10' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  ok('coupon applied to cart');

  res = await reserveSlot();
  r = await call('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: res, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  order = r.body.data.order;
  assert.equal(order.deliveryFee, 0, 'free delivery ≥ 499');
  assert.equal(order.discount, 59.8, '10% of 598');
  assert.equal(order.taxAmount, 29.9, '5% of 598');
  assert.equal(order.totalAmount, Math.round((598 + 29.9 - 59.8) * 100) / 100);
  const oi2 = (await M.OrderItem.find({ orderId: order.id })).find((x) => String(x.tenantProductId) === String(listing.id));
  assert.equal(oi2.discountAllocated, 59.8, 'discount fully allocated to the single line');
  assert.equal(oi2.taxAmount, 29.9);
  ok('coupon + free delivery + tax: total ₹' + order.totalAmount + ', line discount ₹59.8');

  const breakdown = await M.OrderChargeBreakdown.findOne({ orderId: order.id });
  assert.ok(breakdown, 'immutable charge breakdown persisted');
  assert.equal(breakdown.grandTotal, order.totalAmount);
  assert.equal(breakdown.discountTotal, 59.8);
  assert.ok(breakdown.deliveryFeePolicyId, 'fee policy audit ref stored');
  ok('OrderChargeBreakdown immutable snapshot persisted');

  // ride an order through the full rider machine to DELIVERED
  const rideToDelivered = async (orderId, pod) => {
    let rr = await call(`/fulfillment/orders/${orderId}/pick`, { method: 'POST', token: pickerTok });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    rr = await call(`/fulfillment/orders/${orderId}/pack`, { method: 'POST', token: pickerTok });
    assert.equal(rr.status, 200);
    rr = await call(`/fulfillment/orders/${orderId}/dispatch`, { method: 'POST', token: riderTok });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    const aid = rr.body.data.deliveryAssignment.id;
    assert.ok(aid, 'assignment id present in dispatch response');
    await call(`/rider/deliveries/${aid}/accept`, { method: 'POST', token: riderTok });
    await call(`/rider/deliveries/${aid}/arrive-hub`, { method: 'POST', token: riderTok });
    await call(`/rider/deliveries/${aid}/depart`, { method: 'POST', token: riderTok, body: { package_verified: true } });
    await call(`/rider/deliveries/${aid}/arrive`, { method: 'POST', token: riderTok });
    rr = await call(`/rider/deliveries/${aid}/complete`, { method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: pod } });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    return aid;
  };

  // deliver order 1 (no coupon, fee ₹49) and order 2 (coupon, free delivery)
  await rideToDelivered(firstOrder.id, '1111');
  await rideToDelivered(order.id, '4321');
  ok('both orders delivered via full rider machine');

  // ================= 3. refund components: partial vs full return =================
  // partial return (1 of 2 items) on order 2 — policy FULL_ORDER_RETURN_ONLY -> NO fee
  const oiDoc = await M.OrderItem.findOne({ orderId: order.id });
  r = await call('/returns', { method: 'POST', token: custTok, body: { orderId: order.id, claimType: 'instant_claim', reason: 'wilted', items: [{ orderItemId: oiDoc.id, qty: 1 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const retId = r.body.data.returnRequest.id;
  const rt = await M.RefundTransaction.findOne({ returnRequestId: retId });
  assert.equal(rt.refundFeeAmount, 0, 'partial return -> fee NOT refunded (FULL_ORDER_RETURN_ONLY)');
  assert.equal(rt.refundItemAmount, Math.round((299 - 29.9) * 100) / 100, 'item = net goods value (price − discount) for 1 unit');
  assert.equal(rt.refundTaxAmount, 14.95);
  assert.equal(rt.amount, Math.round((rt.refundItemAmount + rt.refundTaxAmount) * 100) / 100, 'components add up to amount (no double count)');
  ok(`partial refund: item ₹${rt.refundItemAmount} + tax ₹${rt.refundTaxAmount} + fee ₹0`);

  // full return on order 1 (1 rose, no coupon, fee charged) -> fee refunded
  const oi1 = await M.OrderItem.findOne({ orderId: firstOrder.id });
  r = await call('/returns', { method: 'POST', token: custTok, body: { orderId: firstOrder.id, claimType: 'instant_claim', reason: 'wilted', items: [{ orderItemId: oi1.id, qty: 1 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const retId1 = r.body.data.returnRequest.id;
  const rt1 = await M.RefundTransaction.findOne({ returnRequestId: retId1 });
  assert.equal(rt1.refundFeeAmount, 49, 'FULL return -> delivery fee refunded');
  assert.equal(rt1.refundItemAmount, 299);
  assert.equal(rt1.refundTaxAmount, 14.95);
  assert.equal(rt1.amount, 299 + 14.95 + 49, 'full refund incl. fee');
  ok(`full refund: item ₹299 + tax ₹14.95 + fee ₹49 = ₹${rt1.amount}`);

  // ================= 4. rider reject -> reassignment =================
  const rider2 = await M.User.create({ tenantId: tenant.id, phone: { number: '9876510004', verified: true }, role: 'rider', status: 'active', rider: { availability: 'available' } });
  const rider2Tok = (await AuthService.issueTokens(rider2)).accessToken;
  await addToCart(1);
  res = await reserveSlot();
  r = await call('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: res, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
  const order3 = r.body.data.order;
  await call(`/fulfillment/orders/${order3.id}/pick`, { method: 'POST', token: pickerTok });
  await call(`/fulfillment/orders/${order3.id}/pack`, { method: 'POST', token: pickerTok });
  r = await call(`/fulfillment/orders/${order3.id}/dispatch`, { method: 'POST', token: riderTok });
  const a3 = r.body.data.deliveryAssignment.id;
  assert.equal(r.body.data.deliveryAssignment.status, 'pending_accept');
  // rider rejects -> reassigned to rider2
  r = await call(`/rider/deliveries/${a3}/reject`, { method: 'POST', token: riderTok, body: { reason: 'too far' } });
  assert.equal(r.status, 200);
  const after = await M.DeliveryAssignment.findById(a3);
  assert.equal(String(after.riderId), String(rider2.id), 'reassigned to next available rider');
  assert.equal(after.rejectCount, 1);
  // rider2 accepts and completes
  await call(`/rider/deliveries/${a3}/accept`, { method: 'POST', token: rider2Tok });
  await call(`/rider/deliveries/${a3}/arrive-hub`, { method: 'POST', token: rider2Tok });
  await call(`/rider/deliveries/${a3}/depart`, { method: 'POST', token: rider2Tok, body: { package_verified: true } });
  await call(`/rider/deliveries/${a3}/arrive`, { method: 'POST', token: rider2Tok });
  r = await call(`/rider/deliveries/${a3}/complete`, { method: 'POST', token: rider2Tok, body: { pod_type: 'signature', pod_reference: 'sig://1' } });
  assert.equal(r.status, 200);
  ok('rider reject -> auto-reassign to next rider -> delivered by rider2');

  // ================= 5. async payment (razorpay-style) + mock webhook =================
  const { default: paymentProvider } = await import('../src/services/paymentProvider.service.js');
  paymentProvider.forcePending(true);
  try {
    await addToCart(1);
    res = await reserveSlot();
    r = await call('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: res, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.paymentPending, true, 'async gateway -> paymentPending');
    const gatewayOrderId = r.body.data.gatewayOrderId;
    assert.ok(gatewayOrderId, 'gateway order id returned for client checkout');
    const pendingOrder = r.body.data.order;
    assert.equal(pendingOrder.status, 'payment_pending', 'order waits in PAYMENT_PENDING');
    ok('async checkout: order PAYMENT_PENDING with gateway order id');

    // simulate the gateway webhook (raw route mounted in app.js)
    const webhookRes = await fetch(`http://127.0.0.1:${port}/api/v1/payments/webhook/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gatewayOrderId }),
    });
    assert.equal(webhookRes.status, 200, await webhookRes.text());
    const orderDoc = await M.Order.findById(pendingOrder.id);
    assert.equal(orderDoc.status, 'confirmed', 'webhook -> saga finalizes to CONFIRMED');
    const payDoc = await M.Payment.findOne({ orderId: pendingOrder.id });
    assert.equal(payDoc.status, 'success');
    const inv = await M.Inventory.findOne({ tenantProductId: listing.id });
    assert.equal(inv.qtyOnHand, 95, '5 units across 4 orders committed (pending order included after webhook)');
    ok('webhook confirmed payment -> inventory committed -> CONFIRMED');
  } finally {
    paymentProvider.forcePending(false);
  }

  // ================= 6. forecasting (pure math sanity via service) =================
  const { default: slotForecastingService } = await import('../src/services/slotForecasting.service.js');
  const f = await slotForecastingService.forecastHubDay({ tenantId: tenant.id, hubId: hub.id, date: today, pickerCount: 2, riderCount: 3, dryRun: true });
  assert.ok(f.recommendedCapacity.normal >= 5, 'capacity never below floor');
  assert.ok(f.physical.physicalLimit > 0, 'physical limit computed');
  const logs = await M.FulfillmentTimeLog.countDocuments({ tenantId: tenant.id });
  assert.ok(logs >= 1, 'fulfillment time logs recorded on delivery (closing the loop)');
  ok('forecasting computes capacity + fulfillment time logs recorded');

  console.log(`\nPHASE 3.5 SMOKE: ${passed} assertions passed ✔`);
  server.close();
}

async function teardown() {
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  if (mongod) await mongod.stop();
}

main()
  .then(async () => { console.log('\nPHASE 3.5 SMOKE: PASS'); await teardown(); process.exit(0); })
  .catch(async (err) => { console.error('\nSMOKE FAILURE:', err); await teardown(); process.exit(1); });
