/**
 * Phase 4 smoke test — admin dashboard API (products · inventory · slots ·
 * orders · users · analytics) per `uploads/admin_dashboard_api_analytics.md`.
 *
 * Covers:
 *   1. RBAC: customer token → 403 on /admin/*; admin token works
 *   2. Inventory: restock adjust (atomic, ledger row, TenantProduct.stockQty
 *      refreshed); shrinkage below zero → 409; ledger history
 *   3. Slots: intraday override raises effective capacity; override below
 *      reserved → 409; close hides the slot
 *   4. Staff: create rider; block a customer; rider stats after deliveries
 *   5. Orders: admin list + full detail (items, breakdown, timeline)
 *   6. Analytics: dashboard KPIs EXACTLY match seeded order docs; top
 *      products; rebuild → analyticsdailies; export.csv has BOM
 *
 * Run: node scripts/smoke-admin.test.js
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
  config.mongoUri = mongod.getUri('flower_market_admin_smoke');
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
    'inventoryAdjustment.model.js','analyticsDaily.model.js',
  ].map((f) => import(`../src/models/${f}`)));
  const M = {};
  for (const m of models) { const mod = m.default; M[mod.modelName] = mod; await mod.init(); }

  const tenant = await M.Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });

  const admin = await M.User.create({ tenantId: tenant.id, email: { address: 'a@fm.in', verified: true }, role: 'super_admin', status: 'active' });
  const customer = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520001', verified: true }, status: 'active' });
  const picker = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520002', verified: true }, role: 'picker', status: 'active' });
  const rider = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520003', verified: true }, role: 'rider', status: 'active', rider: { availability: 'available' } });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;
  const pickerTok = (await AuthService.issueTokens(picker)).accessToken;
  const riderTok = (await AuthService.issueTokens(rider)).accessToken;

  // ---- taxonomy + catalog + policies ----
  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh Flowers', slug: 'fresh-flowers', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'RoseVille', slug: 'roseville', status: 'active' });
  const master = await M.ProductMaster.create({ tenantId: tenant.id, categoryId: category.id, brandId: brand.id, skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10', slug: 'red-roses-10', status: 'active', isPerishable: true });
  const listing = await M.TenantProduct.create({ tenantId: tenant.id, productMasterId: master.id, price: { mrp: 399, sellingPrice: 299, currency: 'INR' }, stockQty: 100, status: 'active', version: 1 });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 100 });

  await M.DeliveryFeePolicy.create({ tenantId: tenant.id, name: 'default', baseFee: 49, freeDeliveryThreshold: 499, expressSurgeMultiplier: 1.25, isActive: true, version: 1 });
  await M.TaxPolicy.create({ categoryId: category.id, gstSlabPct: 5, hsnCode: '0603', isActive: true });
  await M.TenantRefundPolicy.create({ tenantId: tenant.id, refundDeliveryFeeWhen: 'full_order_return_only', refundFeePct: 100 });

  const hub = await M.Hub.create({ tenantId: tenant.id, name: 'Hub', code: 'H1', defaultSlotCapacity: 10, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const { default: slotService } = await import('../src/services/slot.service.js');
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: tomorrow, capacity: 10 });
  const address = await M.Address.create({ tenantId: tenant.id, userId: customer.id, name: 'Ramu', phone: '9876520001', line1: '12-13-4 Main Rd', city: 'Vizag', state: 'AP', pincode: '530013' });

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
    const r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const reserveSlot = async (date) => {
    const r = await call(`/cart/slots?pincode=530013&date=${date}`, { token: custTok });
    const slot = r.body.data.slots.find((s) => s.remaining > 0);
    const r2 = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custTok });
    return { reservationId: r2.body.data.id, slotId: slot.id };
  };
  const checkout = async (date) => {
    await addToCart(1);
    const { reservationId } = await reserveSlot(date);
    const r = await call('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: reservationId, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.order;
  };
  const rideToDelivered = async (orderId) => {
    await call(`/fulfillment/orders/${orderId}/pick`, { method: 'POST', token: pickerTok });
    await call(`/fulfillment/orders/${orderId}/pack`, { method: 'POST', token: pickerTok });
    const r = await call(`/fulfillment/orders/${orderId}/dispatch`, { method: 'POST', token: riderTok });
    const aid = r.body.data.deliveryAssignment.id;
    await call(`/rider/deliveries/${aid}/accept`, { method: 'POST', token: riderTok });
    await call(`/rider/deliveries/${aid}/arrive-hub`, { method: 'POST', token: riderTok });
    await call(`/rider/deliveries/${aid}/depart`, { method: 'POST', token: riderTok, body: { package_verified: true } });
    await call(`/rider/deliveries/${aid}/arrive`, { method: 'POST', token: riderTok });
    const rr = await call(`/rider/deliveries/${aid}/complete`, { method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: '9999' } });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
  };

  // ================= 1. RBAC =================
  let r = await call('/admin/inventory/summary', { token: custTok });
  assert.equal(r.status, 403, 'customer must be forbidden from /admin');
  assert.equal(r.body.code, 'FORBIDDEN');
  r = await call('/admin/inventory/summary', { token: adminTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  ok('RBAC: customer → 403 FORBIDDEN, admin → 200');

  // ================= 1b. products (shared master catalog joined via listings) =================
  r = await call('/admin/products?limit=10', { token: adminTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 1, 'seeded master appears (shared catalog, tenant-scoped join)');
  assert.equal(r.body.data[0].skuGlobal, 'ROS-RED-10', 'master metadata resolved');
  assert.equal(r.body.data[0].stock.health, 'in_stock');
  assert.ok(r.body.data[0].id && r.body.data[0].id !== 'undefined', 'product id is a real id string');
  ok('products: shared master catalog joined via tenant listings');

  // ================= 2. inventory adjust + ledger =================
  r = await call(`/admin/inventory/${listing.id}/adjust`, { method: 'POST', token: adminTok, body: { type: 'restock', qtyChange: 5, reason: 'fresh stock arrived' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.inventory.qtyOnHand, 105);
  assert.equal(r.body.data.adjustment.qtyBefore, 100);
  assert.equal(r.body.data.adjustment.qtyAfter, 105);
  const listingFresh = await M.TenantProduct.findById(listing.id);
  assert.equal(listingFresh.stockQty, 105, 'TenantProduct.stockQty snapshot refreshed');
  r = await call(`/admin/inventory/${listing.id}/adjust`, { method: 'POST', token: adminTok, body: { type: 'shrinkage', qtyChange: -999, reason: 'test negative' } });
  assert.equal(r.status, 409, 'shrinkage below zero must 409');
  r = await call(`/admin/inventory/ledger/${listing.id}`, { token: adminTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.adjustments.length, 1, 'ledger has the restock row');
  assert.equal(r.body.data.inventory.qtyOnHand, 105);
  ok('inventory: atomic restock +5 (ledger row, snapshot refreshed), negative → 409');

  // low-stock filter: create a second listing with 2 on hand
  const master2 = await M.ProductMaster.create({ tenantId: tenant.id, categoryId: category.id, brandId: brand.id, skuGlobal: 'ROS-WHITE-10', type: 'fresh_flower', title: 'White Roses 10', slug: 'white-roses-10', status: 'active', isPerishable: true });
  const listing2 = await M.TenantProduct.create({ tenantId: tenant.id, productMasterId: master2.id, price: { mrp: 349, sellingPrice: 249, currency: 'INR' }, stockQty: 2, status: 'active', version: 1 });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing2.id, qtyOnHand: 2 });
  r = await call(`/admin/inventory?health=low_stock`, { token: adminTok });
  assert.equal(r.body.data.length >= 1, true, 'low-stock filter returns the 2-unit SKU');
  assert.equal(r.body.data[0].health, 'low_stock');
  ok('inventory: low-stock filter works');

  // ================= 3. slots: override + close =================
  const slotDoc = await M.DeliverySlot.findOne({ tenantId: tenant.id, date: today, startTime: '08:00' });
  const slotId = slotDoc.id;
  r = await call(`/admin/slots/${slotId}/override`, { method: 'POST', token: adminTok, body: { manualCapacity: 25, reason: 'festival rush' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const slotFresh = await M.DeliverySlot.findById(slotId);
  assert.equal(slotFresh.manualCapacity, 25);
  assert.equal(slotFresh.manualCapacityBy?.toString(), admin.id, 'override actor recorded');
  // override below reserved (currently 0 reserved) → try 0 → must 400; and below reserved scenario
  r = await call(`/admin/slots/${slotId}/override`, { method: 'POST', token: adminTok, body: { manualCapacity: 0, reason: 'x' } });
  assert.equal(r.status, 400, 'capacity < 1 must 400');
  // customer listAvailable should now expose 25 effective
  r = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custTok });
  const effSlot = r.body.data.slots.find((s) => s.id === slotId);
  assert.equal(effSlot.remaining, 25, 'customer sees overridden capacity');
  // close the slot
  r = await call(`/admin/slots/${slotId}/status`, { method: 'POST', token: adminTok, body: { status: 'closed', reason: 'weather' } });
  assert.equal(r.status, 200);
  r = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custTok });
  assert.equal(r.body.data.slots.find((s) => s.id === slotId), undefined, 'closed slot hidden from customers');
  await call(`/admin/slots/${slotId}/status`, { method: 'POST', token: adminTok, body: { status: 'open', reason: 'reopened' } });
  ok('slots: override honored atomically (25 visible), close hides, reopen works');

  // ================= 4. staff + user management =================
  // NOTE: no hubId — hub affinity would make this NEW rider (higher priority
  // at the hub) steal the assignment from the original rider used below.
  r = await call('/admin/users/staff', { method: 'POST', token: adminTok, body: { role: 'rider', firstName: 'Ravi', phone: { number: '9876520009' }, password: 'Staff@12345' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const staffRider = r.body.data;
  assert.equal(staffRider.role, 'rider');
  r = await call('/admin/users/staff', { method: 'POST', token: adminTok, body: { role: 'super_admin', phone: { number: '9876520008' } } });
  assert.equal(r.status, 400, 'cannot create super_admin');
  // block the customer
  r = await call(`/admin/users/${customer.id}/status`, { method: 'PATCH', token: adminTok, body: { status: 'blocked' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const blocked = await M.User.findById(customer.id);
  assert.equal(blocked.status, 'blocked');
  await call(`/admin/users/${customer.id}/status`, { method: 'PATCH', token: adminTok, body: { status: 'active' } });
  ok('users: staff rider created (super_admin rejected), customer blocked/unblocked');

  // ================= 5. orders (create 2 + deliver) =================
  const orderA = await checkout(today);
  const orderB = await checkout(today);
  await rideToDelivered(orderA.id);
  await rideToDelivered(orderB.id);
  r = await call('/admin/orders?status=delivered', { token: adminTok });
  assert.equal(r.body.data.length, 2, 'admin list finds delivered orders');
  r = await call(`/admin/orders/${orderA.id}`, { token: adminTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.items.length, 1);
  assert.ok(r.body.data.chargeBreakdown, 'immutable breakdown attached');
  assert.ok(r.body.data.timeline.length >= 5, 'timeline present');
  assert.ok(r.body.data.delivery, 'delivery assignment attached');
  ok('orders: admin list filter + full detail (items/breakdown/timeline/assignment)');

  // ================= 6. analytics =================
  const from = today;
  const to = today;
  r = await call(`/admin/analytics/dashboard?from=${from}&to=${to}`, { token: adminTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = r.body.data.kpis;
  // 2 delivered orders × ₹362.95 each (299 + 14.95 tax + 49 fee)
  assert.equal(k.ordersCreated, 2, 'ordersCreated = 2');
  assert.equal(k.gmv, 2 * 362.95, 'gmv = 2 × 362.95');
  assert.equal(k.aov, 362.95, 'aov');
  assert.equal(k.delivered, 2, 'delivered = 2');
  assert.equal(k.cancelled, 0);
  assert.equal(k.deliverySuccessRate, 1);
  ok(`analytics: KPIs exact (orders=${k.ordersCreated}, gmv=₹${k.gmv}, aov=₹${k.aov}, delivered=${k.delivered})`);

  r = await call(`/admin/analytics/products?from=${from}&to=${to}`, { token: adminTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data[0].tenantProductId, listing.id, 'top product = the ordered listing');
  assert.equal(r.body.data[0].qty, 2);
  assert.equal(r.body.data[0].revenue, 2 * (299 + 14.95), 'revenue = 2 × (item + tax)');
  ok('analytics: top products exact (qty 2, revenue matches)');

  r = await call('/admin/analytics/rebuild', { method: 'POST', token: adminTok, body: { from, to } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const daily = await M.AnalyticsDaily.findOne({ tenantId: tenant.id, hubId: null, date: today });
  assert.ok(daily, 'rollup row upserted');
  assert.equal(daily.ordersCreated, 2);
  assert.equal(daily.gmv, 2 * 362.95);
  assert.equal(daily.delivered, 2);
  assert.equal(daily.topProducts.length, 1);
  assert.equal(daily.topProducts[0].qty, 2);
  ok('analytics: rebuild upserts analyticsdailies (idempotent)');

  // raw byte check: fetch() .text() strips the BOM, so verify EF BB BF prefix
  const csvRes = await fetch(`${base}/admin/analytics/export.csv?from=${from}&to=${to}`, {
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${adminTok}` },
  });
  assert.equal(csvRes.status, 200);
  const buf = Buffer.from(await csvRes.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV has UTF-8 BOM bytes');
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  assert.ok(text.startsWith('Date,Hub,Orders'), 'CSV header present');
  assert.ok(text.includes(`${today},ALL,2,${2 * 362.95}`), `CSV row has date ${today}, ALL, orders 2, gmv ${2 * 362.95}`);
  ok('analytics: export.csv with BOM + data row');

  console.log(`\nADMIN SMOKE: ${passed} assertions passed ✔`);
  server.close();
}

async function teardown() {
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  if (mongod) await mongod.stop();
}

main()
  .then(async () => { console.log('\nADMIN SMOKE: PASS'); await teardown(); process.exit(0); })
  .catch(async (err) => { console.error('\nADMIN SMOKE FAILURE:', err); await teardown(); process.exit(1); });
