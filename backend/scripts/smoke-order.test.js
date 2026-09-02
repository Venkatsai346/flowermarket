/**
 * Phase-3 smoke test — order lifecycle end to end (cart -> slotted delivery ->
 * fulfillment -> delivery -> returns -> refunds), per the blueprint
 * `uploads/order_lifecycle_cart_delivery_fulfillment_returns.md`.
 *
 * Covers:
 *   1. Cart: add (price/stock snapshots), item limit, revalidate
 *   2. Stale-cart guard: price change -> 409 PRICE_CHANGED until re-confirmed
 *   3. Checkout saga: reserve slot -> charge -> hard-decrement -> confirm slot
 *      -> queue picking; order number, timeline, cart CHECKED_OUT
 *   4. Fulfillment: pick -> pack -> dispatch -> POD (OTP) -> DELIVERED; RBAC
 *   5. Returns Flow A (PICKUP_QC): pickup -> QC pass -> wallet refund
 *   6. Returns Flow B (INSTANT_CLAIM): auto-approve + instant refund + fraud guard
 *   7. Cancellation reverse saga: restore inventory, release slot, refund
 *   8. Payment fail compensation: no inventory decrement, slot released, CANCELLED
 *   9. Slot atomic lock: capacity 1 -> second reserve 409 SLOT_FULL
 *  10. Payment idempotency: same key -> same payment
 *
 * Run: node scripts/smoke-order.test.js   (requires npm install already done)
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
  config.mongoUri = mongod.getUri('flower_market_order_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const models = await Promise.all([
    import('../src/models/tenant.model.js'),
    import('../src/models/tenantAuthConfig.model.js'),
    import('../src/models/user.model.js'),
    import('../src/models/category.model.js'),
    import('../src/models/brand.model.js'),
    import('../src/models/productMaster.model.js'),
    import('../src/models/tenantProduct.model.js'),
    import('../src/models/inventory.model.js'),
    import('../src/models/address.model.js'),
    import('../src/models/hub.model.js'),
    import('../src/models/serviceablePincode.model.js'),
    import('../src/models/deliverySlot.model.js'),
    import('../src/models/slotReservation.model.js'),
    import('../src/models/cart.model.js'),
    import('../src/models/cartItem.model.js'),
    import('../src/models/order.model.js'),
    import('../src/models/orderItem.model.js'),
    import('../src/models/orderStatusHistory.model.js'),
    import('../src/models/payment.model.js'),
    import('../src/models/paymentTransaction.model.js'),
    import('../src/models/refundTransaction.model.js'),
    import('../src/models/wallet.model.js'),
    import('../src/models/walletTransaction.model.js'),
    import('../src/models/returnRequest.model.js'),
    import('../src/models/returnItem.model.js'),
    import('../src/models/fulfillmentTask.model.js'),
    import('../src/models/deliveryAssignment.model.js'),
    import('../src/models/auditLog.model.js'),
    import('../src/models/catalogEvent.model.js'),
  ]);
  const M = {};
  for (const m of models) {
    const mod = m.default;
    M[mod.modelName] = mod;
    await mod.init();
  }

  const tenant = await M.Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });

  const admin = await M.User.create({
    tenantId: tenant.id, email: { address: 'admin@flowermarket.in', verified: true },
    role: 'super_admin', status: 'active',
  });
  const customer = await M.User.create({
    tenantId: tenant.id, phone: { number: '9876500002', verified: true }, status: 'active',
  });
  const customer2 = await M.User.create({
    tenantId: tenant.id, phone: { number: '9876500005', verified: true }, status: 'active',
  });
  const picker = await M.User.create({
    tenantId: tenant.id, phone: { number: '9876500003', verified: true }, role: 'picker', status: 'active',
  });
  const rider = await M.User.create({
    tenantId: tenant.id, phone: { number: '9876500004', verified: true }, role: 'rider', status: 'active',
    rider: { availability: 'available' },
  });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;
  const cust2Tok = (await AuthService.issueTokens(customer2)).accessToken;
  const pickerTok = (await AuthService.issueTokens(picker)).accessToken;
  const riderTok = (await AuthService.issueTokens(rider)).accessToken;

  // ---------- taxonomy + listing (direct setup; catalog API tested in Phase 2) ----------
  const category = await M.Category.create({ tenantId: tenant.id, name: 'Fresh Flowers', slug: 'fresh-flowers', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenant.id, name: 'RoseVille', slug: 'roseville', status: 'active' });
  const master = await M.ProductMaster.create({
    tenantId: tenant.id, categoryId: category.id, brandId: brand.id,
    skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10 Stems',
    slug: 'red-roses-10-stems', status: 'active', isPerishable: true,
  });
  const listing = await M.TenantProduct.create({
    tenantId: tenant.id, productMasterId: master.id,
    price: { mrp: 499, sellingPrice: 399, currency: 'INR' },
    stockQty: 50, status: 'active', version: 1,
  });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: listing.id, qtyOnHand: 50 });

  // ---------- hub + pincode + slots ----------
  const hub = await M.Hub.create({
    tenantId: tenant.id, name: 'Hub Vizag Central', code: 'VIZ-CENTRAL',
    defaultSlotCapacity: 20, isActive: true,
  });
  await M.ServiceablePincode.create({
    tenantId: tenant.id, pincode: '530013', hubId: hub.id, isServiceable: true,
  });

  const { default: slotService } = await import('../src/services/slot.service.js');
  const today = new Date().toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub.id, fromDate: today, toDate: today, capacity: 10 });

  // ---------- address ----------
  const address = await M.Address.create({
    tenantId: tenant.id, userId: customer.id,
    name: 'Ramu', phone: '9876500002',
    line1: '12-13-4, Main Road', city: 'Visakhapatnam', state: 'AP', pincode: '530013',
  });

  // ---------- app + harness ----------
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const call = async (path, { method = 'GET', body, token, raw = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenant.id,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return { status: res.status, text: await res.text() };
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };

  let passed = 0;
  const ok = (label) => { passed += 1; console.log(`  ✓ ${label}`); };

  // ================= 1. cart =================
  let r = await call('/cart', { token: custTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.items.length, 0, 'cart starts empty');
  ok('cart starts empty');

  r = await call('/cart/items', {
    method: 'POST', token: custTok,
    body: { tenantProductId: listing.id, qty: 2 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cartItem = r.body.data.items.find((i) => i.tenantProductId === listing.id);
  assert.equal(cartItem.qty, 2);
  assert.equal(cartItem.priceSnapshot.sellingPrice, 399, 'price snapshot at add-time');
  assert.equal(cartItem.lineTotal, 798);
  ok('add item captures price/stock snapshots');

  // item limit guard
  r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty: 99 } });
  assert.equal(r.status, 409, 'qty beyond stock must 409');
  assert.equal(r.body.code, 'INSUFFICIENT_STOCK');
  ok('insufficient stock rejected at add');

  // ================= 2. stale-cart guard =================
  // tenant changes the live price (simulating a promo ending)
  listing.price.sellingPrice = 349;
  await listing.save();

  r = await call('/cart/revalidate', { method: 'POST', token: custTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.changed, true, 'revalidation must detect price change');
  const diff = r.body.data.diffs.find((d) => d.listingId === listing.id);
  assert.equal(diff.issue, 'price_changed');
  assert.equal(diff.from, 399);
  assert.equal(diff.to, 349);
  ok('revalidate detects price change (stale-cart guard)');

  // checkout WITHOUT confirm -> 409
  let slotList = await call('/cart/slots?pincode=530013&date=' + today, { token: custTok });
  assert.equal(slotList.status, 200);
  const slot = slotList.body.data.slots.find((s) => s.remaining > 0);
  assert.ok(slot, 'at least one open slot');
  r = await call('/cart/slots/' + slot.id + '/reserve', { method: 'POST', token: custTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reservationId = r.body.data.id;
  ok('slot reserved (HELD, 10-min TTL)');

  r = await call('/cart/checkout', {
    method: 'POST', token: custTok,
    body: { slotReservationId: reservationId, addressId: address.id, paymentMethod: 'upi' },
  });
  assert.equal(r.status, 409, 'checkout with changed price must 409');
  assert.equal(r.body.code, 'PRICE_CHANGED');
  ok('checkout blocked until price change re-confirmed (never surprise-charge)');

  // ================= 3. checkout saga =================
  r = await call('/cart/checkout', {
    method: 'POST', token: custTok,
    body: { slotReservationId: reservationId, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = r.body.data.order;
  assert.equal(order.status, 'confirmed');
  assert.match(order.orderNumber, /^FM-\d{6}-\d{5}$/);
  assert.equal(order.totalAmount, 349 * 2 + 49, 'total = live price * qty + delivery fee');
  assert.equal(order.paymentSummary.status, 'success');
  assert.equal(order.addressSnapshot.pincode, '530013');
  assert.equal(order.addressSnapshot.line1, '12-13-4, Main Road');
  ok(`checkout saga -> CONFIRMED (${order.orderNumber}, ₹${order.totalAmount})`);

  // timeline history rows
  const timeline = r.body.data.timeline.map((t) => t.toStatus);
  assert.deepEqual(timeline, ['created', 'payment_pending', 'confirmed']);
  ok('order status history: created -> payment_pending -> confirmed');

  // slot reservation CONFIRMED, inventory decremented, cart checked out
  const hold = await M.SlotReservation.findById(reservationId);
  assert.equal(hold.status, 'confirmed');
  const inv = await M.Inventory.findOne({ tenantProductId: listing.id });
  assert.equal(inv.qtyOnHand, 48, 'inventory hard-decremented post-payment');
  const cartDoc = await M.Cart.findOne({ tenantId: tenant.id, userId: customer.id });
  assert.equal(cartDoc.status, 'checked_out');
  ok('slot confirmed + inventory decremented + cart checked out');

  // ================= 4. fulfillment + RBAC =================
  // customer cannot pick
  r = await call(`/fulfillment/orders/${order.id}/pick`, { method: 'POST', token: custTok });
  assert.equal(r.status, 403, 'customer must not start picking');
  // picker can
  r = await call(`/fulfillment/orders/${order.id}/pick`, { method: 'POST', token: pickerTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'picking');
  r = await call(`/fulfillment/orders/${order.id}/pack`, { method: 'POST', token: pickerTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'packed');
  ok('picking: queued -> picking -> packed (RBAC enforced)');

  // ---- Phase 3.5: full rider state machine (blueprint §3) ----
  r = await call(`/fulfillment/orders/${order.id}/dispatch`, { method: 'POST', token: riderTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'out_for_delivery');
  const assignmentId = r.body.data.deliveryAssignment.id;
  assert.ok(assignmentId, 'assignment created');

  // accept -> arrive-hub, then prove the depart gate: 400 without verification
  r = await call(`/rider/deliveries/${assignmentId}/accept`, { method: 'POST', token: riderTok });
  assert.equal(r.status, 200);
  r = await call(`/rider/deliveries/${assignmentId}/arrive-hub`, { method: 'POST', token: riderTok });
  assert.equal(r.status, 200);
  r = await call(`/rider/deliveries/${assignmentId}/depart`, { method: 'POST', token: riderTok, body: {} });
  assert.equal(r.status, 400, 'depart without package verification must 400');
  assert.equal(r.body.code, 'PACKAGE_NOT_VERIFIED');
  ok('package_verified gate enforced on /depart');

  // depart (verified) -> arrive -> complete (OTP POD)
  r = await call(`/rider/deliveries/${assignmentId}/depart`, { method: 'POST', token: riderTok, body: { package_verified: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'out_for_delivery');
  r = await call(`/rider/deliveries/${assignmentId}/arrive`, { method: 'POST', token: riderTok });
  assert.equal(r.status, 200);
  r = await call(`/rider/deliveries/${assignmentId}/complete`, {
    method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: '1234' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'delivered');
  const assignment = await M.DeliveryAssignment.findById(assignmentId);
  assert.equal(assignment.status, 'delivered');
  assert.ok(assignment.podReference, 'POD reference stored (hashed OTP)');
  assert.notEqual(assignment.podReference, '1234', 'OTP must be hashed, never plaintext');
  ok('rider machine: accept→arrive-hub→depart→arrive→complete (OTP hashed)');

  // ================= 5. returns Flow B (INSTANT_CLAIM) =================
  // flowers are perishable -> NOT returnable via pickup; the instant-claim
  // quality guarantee is the correct (only) flow for them (doc §6).
  const orderItem = await M.OrderItem.findOne({ orderId: order.id });
  assert.equal(orderItem.isReturnable, false, 'perishable flower is not pickup-returnable');
  r = await call('/returns', {
    method: 'POST', token: custTok,
    body: { orderId: order.id, claimType: 'instant_claim', reason: 'wilted bunch', items: [{ orderItemId: orderItem.id, qty: 1 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const icId = r.body.data.returnRequest.id;
  assert.equal(r.body.data.returnRequest.autoApproved, true, 'instant claim auto-approved');
  assert.equal(r.body.data.returnRequest.status, 'refunded', 'instant refund, no pickup/QC');
  const wallet = await M.Wallet.findOne({ tenantId: tenant.id, userId: customer.id });
  assert.ok(wallet, 'wallet created');
  assert.equal(wallet.balance, 349, 'instant refund lands in wallet (1 item @ 349)');
  const orderDoc = await M.Order.findById(order.id);
  assert.equal(orderDoc.status, 'refunded', 'order enters return sub-machine');
  assert.equal(orderDoc.paymentSummary.refundedAmount, 349);
  const oi = await M.OrderItem.findById(orderItem.id);
  assert.equal(oi.returnedQty, 1, 'per-item returnedQty tracked (prevents over-return)');
  ok('instant claim: auto-approve + instant wallet refund ₹349');

  // fraud guard baseline: 1 instant claim counted this month
  const claims = await M.ReturnRequest.countDocuments({
    userId: customer.id, claimType: 'instant_claim',
    status: { $in: ['approved', 'refund_initiated', 'refunded'] },
  });
  assert.equal(claims, 1, 'one instant claim so far');
  ok(`fraud-guard baseline: ${claims} instant claim counted`);

  // ================= 6. returns Flow A (PICKUP_QC) =================
  // a NON-perishable product (vase) so the pickup -> QC path applies
  const vaseMaster = await M.ProductMaster.create({
    tenantId: tenant.id, categoryId: category.id, brandId: brand.id,
    skuGlobal: 'VASE-CER-01', type: 'floral_accessory', title: 'Ceramic Vase',
    slug: 'ceramic-vase', status: 'active', isPerishable: false,
  });
  const vaseListing = await M.TenantProduct.create({
    tenantId: tenant.id, productMasterId: vaseMaster.id,
    price: { mrp: 399, sellingPrice: 299, currency: 'INR' },
    stockQty: 30, status: 'active', version: 1,
  });
  await M.Inventory.create({ tenantId: tenant.id, tenantProductId: vaseListing.id, qtyOnHand: 30 });

  r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: vaseListing.id, qty: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  slotList = await call('/cart/slots?pincode=530013&date=' + today, { token: custTok });
  const slotV = slotList.body.data.slots.find((s) => s.remaining > 0);
  r = await call('/cart/slots/' + slotV.id + '/reserve', { method: 'POST', token: custTok });
  const resV = r.body.data.id;
  r = await call('/cart/checkout', {
    method: 'POST', token: custTok,
    body: { slotReservationId: resV, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const orderV = r.body.data.order;
  assert.equal(orderV.totalAmount, 299 + 49, 'vase order total');
  await call(`/fulfillment/orders/${orderV.id}/pick`, { method: 'POST', token: pickerTok });
  await call(`/fulfillment/orders/${orderV.id}/pack`, { method: 'POST', token: pickerTok });
  await call(`/fulfillment/orders/${orderV.id}/dispatch`, { method: 'POST', token: riderTok });
  r = await call(`/fulfillment/orders/${orderV.id}/deliver`, { method: 'POST', token: riderTok, body: { podType: 'signature', podValue: 'https://cdn.example/pod/sig1.png' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  ok('vase order placed + delivered (signature POD)');

  const oiV = await M.OrderItem.findOne({ orderId: orderV.id });
  assert.equal(oiV.isReturnable, true, 'non-perishable vase is returnable');
  r = await call('/returns', {
    method: 'POST', token: custTok,
    body: { orderId: orderV.id, claimType: 'pickup_qc', reason: 'cracked on arrival', items: [{ orderItemId: oiV.id, qty: 1 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const returnId = r.body.data.returnRequest.id;
  assert.equal(r.body.data.returnRequest.status, 'approved');
  assert.equal(r.body.data.returnRequest.autoApproved, false, 'Flow A is reviewed, not auto-approved');
  ok('return Flow A approved (pickup scheduled)');

  r = await call(`/returns/${returnId}/pickup`, { method: 'POST', token: pickerTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'picked_up');
  r = await call(`/returns/${returnId}/qc`, { method: 'POST', token: pickerTok, body: { decision: 'pass' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'refunded', 'QC pass -> refund');
  const walletV = await M.Wallet.findOne({ tenantId: tenant.id, userId: customer.id });
  // 349 (instant claim) + 299 (vase item) + 49 (delivery fee — full return under FULL_ORDER_RETURN_ONLY)
  assert.equal(walletV.balance, 349 + 299 + 49, 'pickup/QC refund lands in wallet (item + fee, full return)');
  const orderVDoc = await M.Order.findById(orderV.id);
  assert.equal(orderVDoc.status, 'refunded', 'order enters return sub-machine');
  ok('return Flow A: pickup -> QC pass -> REFUNDED ₹299 + ₹49 fee');

  // ================= 7. cancellation reverse saga =================
  r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  slotList = await call('/cart/slots?pincode=530013&date=' + today, { token: custTok });
  const slot3 = slotList.body.data.slots.find((s) => s.remaining > 0);
  r = await call('/cart/slots/' + slot3.id + '/reserve', { method: 'POST', token: custTok });
  const res3 = r.body.data.id;
  r = await call('/cart/checkout', {
    method: 'POST', token: custTok,
    body: { slotReservationId: res3, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order3 = r.body.data.order;
  const invBefore = (await M.Inventory.findOne({ tenantProductId: listing.id })).qtyOnHand;

  r = await call(`/orders/${order3.id}/cancel`, { method: 'POST', token: custTok, body: { reason: 'changed_mind' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cancelled = r.body.data.order;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation.reason, 'changed_mind');
  assert.equal(cancelled.cancellation.refundStatus, 'success');
  const invAfter = (await M.Inventory.findOne({ tenantProductId: listing.id })).qtyOnHand;
  assert.equal(invAfter, invBefore + 1, 'inventory restored on cancel');
  const hold3 = await M.SlotReservation.findById(res3);
  assert.equal(hold3.status, 'released', 'slot hold released on cancel');
  const wallet3 = await M.Wallet.findOne({ tenantId: tenant.id, userId: customer.id });
  // 349 (instant claim) + 299+49 (vase full return) + 349+49 (cancelled order incl. its fee)
  assert.equal(wallet3.balance, 349 + 299 + 49 + 349 + 49, 'paid amount refunded (incl. delivery fees)');
  ok('cancellation reverse saga: restore stock + release slot + refund');

  // ================= 8. payment-fail compensation =================
  listing.price.sellingPrice = 251.13; // total 251.13 + 49 = 300.13 -> mock decline (ends '13')
  await listing.save();
  r = await call('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.id, qty: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  slotList = await call('/cart/slots?pincode=530013&date=' + today, { token: custTok });
  const slot4 = slotList.body.data.slots.find((s) => s.remaining > 0);
  r = await call('/cart/slots/' + slot4.id + '/reserve', { method: 'POST', token: custTok });
  const res4 = r.body.data.id;
  const invBeforeFail = (await M.Inventory.findOne({ tenantProductId: listing.id })).qtyOnHand;
  r = await call('/cart/checkout', {
    method: 'POST', token: custTok,
    body: { slotReservationId: res4, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true },
  });
  assert.equal(r.status, 409, 'declined charge must surface as 409');
  assert.equal(r.body.code, 'PAYMENT_FAILED');
  const failedOrder = await M.Order.findById(r.body.details.orderId);
  assert.equal(failedOrder.status, 'cancelled');
  assert.equal(failedOrder.cancellation.reason, 'payment_failed');
  const hold4 = await M.SlotReservation.findById(res4);
  assert.equal(hold4.status, 'released', 'slot released on payment failure');
  const invAfterFail = (await M.Inventory.findOne({ tenantProductId: listing.id })).qtyOnHand;
  assert.equal(invAfterFail, invBeforeFail, 'no inventory decrement on payment failure');
  ok('payment-fail compensation: CANCELLED + slot released + stock untouched');

  // ================= 9. slot atomic lock =================
  const hub2 = await M.Hub.create({
    tenantId: tenant.id, name: 'Hub Hub2', code: 'VIZ-2', defaultSlotCapacity: 1, isActive: true,
  });
  await slotService.generateForDates({ tenantId: tenant.id, hubId: hub2.id, fromDate: today, toDate: today, capacity: 1 });
  const fullSlot = await M.DeliverySlot.findOne({ tenantId: tenant.id, hubId: hub2.id, date: today });
  r = await call('/cart/slots/' + fullSlot.id + '/reserve', { method: 'POST', token: custTok });
  assert.equal(r.status, 200);
  r = await call('/cart/slots/' + fullSlot.id + '/reserve', { method: 'POST', token: cust2Tok });
  assert.equal(r.status, 409, 'second reserve on capacity-1 slot must 409');
  assert.equal(r.body.code, 'SLOT_FULL');
  ok('atomic slot lock: capacity 1 -> second reserve SLOT_FULL');

  // ================= 10. payment idempotency =================
  const { default: paymentService } = await import('../src/services/payment.service.js');
  const key = 'pay_demo_' + Date.now();
  const a = await paymentService.charge({ tenantId: tenant.id, userId: customer.id, orderId: order3.id, amount: 100, idempotencyKey: key });
  const b = await paymentService.charge({ tenantId: tenant.id, userId: customer.id, orderId: order3.id, amount: 100, idempotencyKey: key });
  assert.equal(String(a.payment.id), String(b.payment.id), 'same idempotencyKey -> same payment, no double charge');
  assert.equal(b.chargeResult.idempotent, true, 'second call detected as idempotent replay');
  const payCount = await M.Payment.countDocuments({ idempotencyKey: key });
  assert.equal(payCount, 1, 'exactly one Payment row for the key');
  ok('payment idempotency: same key -> same payment (no double charge)');

  // ---------- wrap ----------
  console.log(`\nORDER LIFECYCLE SMOKE: ${passed} assertions passed ✔`);
}

async function teardown() {
  try { server?.close(); } catch { /* ignore */ }
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  if (mongod) await mongod.stop();
}

main()
  .then(async () => { console.log('\nORDER LIFECYCLE SMOKE: PASS'); await teardown(); process.exit(0); })
  .catch(async (err) => {
    console.error('\nSMOKE FAILURE:', err);
    await teardown();
    process.exit(1);
  });
