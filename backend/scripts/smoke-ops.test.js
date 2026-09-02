/**
 * Phase 4b smoke test — notifications (devices · templates · event consumer ·
 * worker · inbox) + exports (jobs · artifacts · BOM download) + nightly
 * pipeline, per `uploads/ops_tooling_notifications_exports.md` §6.
 *
 * Covers:
 *   1. Devices: customer registers a push device; duplicate token → dedupe
 *   2. Templates: admin CRUD; duplicate code → 409; platform-default fallback
 *   3. Event consumer: full checkout → delivered → drain → notifications rows
 *      with placeholders resolved from the order
 *   4. Manual send + worker + inbox + mark-read + manual dedupe
 *   5. Exports: orders job → run → artifact (BOM + rows); jobKey idempotency;
 *      download is text/csv; analytics_daily idempotent too
 *   6. Nightly pipeline: runs, analyticsdailies exist, export jobs created,
 *      re-run is idempotent (no duplicate jobs)
 *   7. Regression: core endpoints still healthy
 *
 * Run: node scripts/smoke-ops.test.js
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
  config.mongoUri = mongod.getUri('flower_market_ops_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const modelFiles = [
    'tenant.model.js', 'tenantAuthConfig.model.js', 'user.model.js', 'category.model.js', 'brand.model.js',
    'productMaster.model.js', 'tenantProduct.model.js', 'inventory.model.js', 'address.model.js', 'hub.model.js',
    'serviceablePincode.model.js', 'deliverySlot.model.js', 'slotReservation.model.js', 'cart.model.js', 'cartItem.model.js',
    'order.model.js', 'orderItem.model.js', 'orderStatusHistory.model.js', 'payment.model.js', 'paymentTransaction.model.js',
    'refundTransaction.model.js', 'wallet.model.js', 'walletTransaction.model.js', 'returnRequest.model.js', 'returnItem.model.js',
    'fulfillmentTask.model.js', 'deliveryAssignment.model.js', 'deliveryFeePolicy.model.js', 'taxPolicy.model.js',
    'discountPolicy.model.js', 'couponUsage.model.js', 'orderChargeBreakdown.model.js', 'tenantRefundPolicy.model.js',
    'fulfillmentTimeLog.model.js', 'auditLog.model.js', 'catalogEvent.model.js',
    'inventoryAdjustment.model.js', 'analyticsDaily.model.js',
    // ---- Phase 4b ----
    'device.model.js', 'notificationTemplate.model.js', 'notification.model.js', 'exportJob.model.js', 'exportArtifact.model.js',
  ];
  const models = await Promise.all(modelFiles.map((f) => import(`../src/models/${f}`)));
  const M = {};
  for (const m of models) { const mod = m.default; M[mod.modelName] = mod; await mod.init(); }

  const tenant = await M.Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenant.id });

  const admin = await M.User.create({ tenantId: tenant.id, email: { address: 'a@fm.in', verified: true }, role: 'super_admin', status: 'active' });
  // customer has verified phone AND email AND registers a device → all 3 channels reachable
  const customer = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520001', verified: true }, email: { address: 'cust@fm.in', verified: true }, profile: { firstName: 'Ramu' }, status: 'active' });
  const picker = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520002', verified: true }, role: 'picker', status: 'active' });
  const rider = await M.User.create({ tenantId: tenant.id, phone: { number: '9876520003', verified: true }, role: 'rider', status: 'active', rider: { availability: 'available' } });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;
  const pickerTok = (await AuthService.issueTokens(picker)).accessToken;
  const riderTok = (await AuthService.issueTokens(rider)).accessToken;

  // ---- taxonomy + catalog + policies (mirror smoke-admin) ----
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

  // ---- platform-default templates (fallback path: tenantId null) ----
  const platformDefaults = [
    {
      code: 'welcome_push', channels: ['push'],
      content: { push: { subject: 'Welcome 🌷', body: 'Hi {{firstName}}, welcome to Flower Market!' } },
    },
    {
      code: 'order_out_for_delivery', channels: ['push', 'sms'],
      content: {
        push: { subject: 'Out for delivery 🚚', body: 'Order {{orderNumber}} is out for delivery. Fresh flowers incoming!' },
        sms: { body: 'Order {{orderNumber}} is out for delivery.' },
      },
    },
    {
      code: 'rider_arrived', channels: ['push'],
      content: { push: { subject: 'Rider arrived 📍', body: 'Your rider is at the door for order {{orderNumber}}.' } },
    },
    {
      code: 'order_delivered', channels: ['push', 'email'],
      content: {
        push: { subject: 'Delivered ✅', body: 'Order {{orderNumber}} delivered. Enjoy your blooms!' },
        email: { subject: 'Order {{orderNumber}} delivered', body: 'Hi {{firstName}},\n\nYour order {{orderNumber}} has been delivered.' },
      },
    },
  ];
  for (const t of platformDefaults) {
    await M.NotificationTemplate.create({ tenantId: null, code: t.code, eventType: null, channels: t.channels, content: t.content, priority: 'normal', isActive: true, version: 1 });
  }

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
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, contentType: res.headers.get('content-type'), buf, text: buf.toString('utf8') };
    }
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

  // ================= 1. devices =================
  let r = await call('/users/me/devices', { method: 'POST', token: custTok, body: { provider: 'fcm', platform: 'android', pushToken: 'tok-abc-12345', metadata: { appVersion: '1.2.3', deviceModel: 'Pixel 8', locale: 'en-IN' } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const deviceId = r.body.data.id;
  assert.equal(r.body.data.pushToken, 'tok-abc-12345');
  r = await call('/users/me/devices', { token: custTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1, 'device appears in list');
  // duplicate token → dedupe (same row, refreshed, not duplicated)
  r = await call('/users/me/devices', { method: 'POST', token: custTok, body: { provider: 'fcm', platform: 'android', pushToken: 'tok-abc-12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.id, deviceId, 'same device row returned (dedupe)');
  r = await call('/users/me/devices', { token: custTok });
  assert.equal(r.body.data.length, 1, 'still exactly one device');
  // remove device
  r = await call(`/users/me/devices/${deviceId}`, { method: 'DELETE', token: custTok });
  assert.equal(r.status, 200);
  r = await call('/users/me/devices', { token: custTok });
  assert.equal(r.body.data[0].status, 'disabled', 'device soft-disabled');
  // re-register so the push channel is reachable for later scenarios
  r = await call('/users/me/devices', { method: 'POST', token: custTok, body: { provider: 'fcm', platform: 'android', pushToken: 'tok-abc-12345' } });
  assert.equal(r.status, 200);
  ok('devices: register → list → duplicate dedupe → remove (soft) → re-register');

  // ================= 2. templates =================
  r = await call('/admin/notifications/templates', { token: adminTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 4, 'platform-default templates visible to admin');
  // create tenant-specific order_confirmed (overrides platform default)
  r = await call('/admin/notifications/templates', {
    method: 'POST', token: adminTok,
    body: {
      code: 'order_confirmed', eventType: 'order_confirmed', channels: ['push', 'email', 'sms'],
      content: {
        push: { subject: 'Order confirmed 🎉', body: 'Hi {{firstName}}, order {{orderNumber}} for ₹{{total}} is confirmed. Slot: {{slot}}.' },
        email: { subject: 'Order {{orderNumber}} confirmed', body: 'Hi {{firstName}},\n\nYour order {{orderNumber}} (₹{{total}}) is confirmed for {{slot}}.' },
        sms: { body: 'Order {{orderNumber}} confirmed (₹{{total}}), slot {{slot}}.' },
      },
      priority: 'high',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tplId = r.body.data.id;
  assert.equal(r.body.data.version, 1);
  // duplicate code → 409
  r = await call('/admin/notifications/templates', { method: 'POST', token: adminTok, body: { code: 'order_confirmed', channels: ['push'] } });
  assert.equal(r.status, 409, 'duplicate tenant template code must 409');
  assert.equal(r.body.code, 'DUPLICATE_TEMPLATE_CODE');
  // update → version bumps
  r = await call(`/admin/notifications/templates/${tplId}`, { method: 'PATCH', token: adminTok, body: { content: { push: { subject: 'Order confirmed 🎉', body: 'Hi {{firstName}}, order {{orderNumber}} (₹{{total}}) confirmed for {{slot}}. 🌷' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.version, 2, 'update bumps version');
  ok('templates: admin CRUD, duplicate code → 409, update bumps version');

  // ================= 3. event consumer: checkout → delivered → drain =================
  const orderA = await checkout(today);
  const orderB = await checkout(today);
  await rideToDelivered(orderA.id);
  await rideToDelivered(orderB.id);
  const { default: catalogEventService } = await import('../src/services/catalogEvent.service.js');
  const drained = await catalogEventService.drain({ limit: 100 });
  assert.equal(drained.failed, 0, 'no event row failed during drain');
  assert.ok(drained.published >= 8, `expected >=8 events (2 orders × 4), got ${drained.published}`);
  // notifications rows created for the customer with resolved placeholders
  r = await call('/users/me/notifications', { token: custTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = r.body.data;
  const confA = list.find((n) => n.templateCode === 'order_confirmed' && String(n.orderId) === orderA.id);
  assert.ok(confA, 'order_confirmed notification exists for order A');
  assert.equal(confA.title, 'Order confirmed 🎉', 'rendered push subject');
  assert.ok(confA.body.includes(orderA.orderNumber), `placeholder resolved: ${orderA.orderNumber} in "${confA.body}"`);
  assert.ok(confA.body.includes('Ramu'), 'firstName placeholder resolved from user profile');
  assert.ok(['pending', 'sending', 'sent', 'failed'].includes(confA.status), `status is lifecycle value, got ${confA.status}`);
  assert.deepEqual(Object.keys(confA.channelStatus || {}).sort(), ['email', 'push', 'sms'], 'all 3 channels pending for this user');
  ok(`event consumer: 2 orders × 4 events drained, notifications with resolved placeholders (${list.length} rows)`);

  // ================= 4. worker + inbox + mark read + manual dedupe =================
  r = await call('/admin/notifications/process', { method: 'POST', token: adminTok, body: { limit: 100 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.sent >= 8, `worker sent all queued, got ${r.body.data.sent}`);
  r = await call(`/users/me/notifications`, { token: custTok });
  const sentRow = r.body.data.find((n) => n.templateCode === 'order_confirmed');
  assert.equal(sentRow.status, 'sent');
  assert.equal(sentRow.channelStatus.push, 'sent');
  assert.equal(sentRow.channelStatus.email, 'sent');
  assert.equal(sentRow.channelStatus.sms, 'sent');
  assert.ok(sentRow.attempts >= 1, 'attempts recorded');
  // mark read
  r = await call(`/users/me/notifications/${sentRow.id}/read`, { method: 'POST', token: custTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'read');
  assert.ok(r.body.data.readAt, 'readAt set');
  // manual send with dedupeKey → second is duplicate
  r = await call('/admin/notifications/send', { method: 'POST', token: adminTok, body: { templateCode: 'welcome_push', userId: customer.id, data: { firstName: 'Ramu' }, dedupeKey: 'welcome:ramu' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const welcomeId = r.body.data.id;
  r = await call('/admin/notifications/send', { method: 'POST', token: adminTok, body: { templateCode: 'welcome_push', userId: customer.id, data: { firstName: 'Ramu' }, dedupeKey: 'welcome:ramu' } });
  assert.equal(r.status, 200, 'duplicate manual send returns 200');
  assert.equal(r.body.data.id, welcomeId, 'same notification returned');
  assert.equal(r.body.meta.reason, 'duplicate');
  // fallback template rendered from platform default (tenantId null)
  await call('/admin/notifications/process', { method: 'POST', token: adminTok, body: { limit: 100 } });
  r = await call('/users/me/notifications', { token: custTok });
  const welcome = r.body.data.find((n) => n.id === welcomeId);
  assert.equal(welcome.templateCode, 'welcome_push');
  assert.equal(welcome.title, 'Welcome 🌷', 'platform-default template used via fallback');
  assert.ok(welcome.body.includes('welcome to Flower Market'), 'platform-default body rendered');
  ok('worker → sent (per-channel), inbox list, mark read, manual send deduped, platform fallback');

  // ================= 5. exports =================
  r = await call('/admin/exports', { method: 'POST', token: adminTok, body: { type: 'orders', params: {} } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const jobId = r.body.data.id;
  r = await call('/admin/exports', { method: 'POST', token: adminTok, body: { type: 'orders', params: {} } });
  assert.equal(r.status, 200, 'duplicate jobKey returns existing job');
  assert.equal(r.body.data.id, jobId, 'same job (idempotent jobKey)');
  r = await call(`/admin/exports/${jobId}/run`, { method: 'POST', token: adminTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'done');
  assert.equal(r.body.meta.artifact.rowCount, 2, 'both orders exported');
  assert.ok(r.body.meta.artifact.sizeBytes > 0);
  // download: text/csv + UTF-8 BOM (EF BB BF) + headers + data
  r = await call(`/admin/exports/${jobId}/download`, { token: adminTok, raw: true });
  assert.equal(r.status, 200);
  assert.ok(r.contentType.startsWith('text/csv'), `content-type ${r.contentType}`);
  assert.deepEqual([r.buf[0], r.buf[1], r.buf[2]], [0xef, 0xbb, 0xbf], 'UTF-8 BOM present');
  assert.ok(r.text.includes('Order,Status,Created'), 'CSV headers (display labels) present');
  assert.ok(r.text.includes(orderA.orderNumber), 'order data present');
  // analytics_daily jobKey idempotent
  r = await call('/admin/exports', { method: 'POST', token: adminTok, body: { type: 'analytics_daily', params: { from: today, to: today } } });
  assert.equal(r.status, 201);
  const adId = r.body.data.id;
  r = await call('/admin/exports', { method: 'POST', token: adminTok, body: { type: 'analytics_daily', params: { from: today, to: today } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.id, adId, 'analytics_daily jobKey idempotent');
  r = await call(`/admin/exports/${adId}/run`, { method: 'POST', token: adminTok });
  assert.equal(r.body.data.status, 'done');
  ok('exports: orders job run (BOM + rows), jobKey idempotent, download text/csv, analytics_daily idempotent');

  // ================= 6. nightly pipeline =================
  r = await call('/admin/maintenance/nightly', { method: 'POST', token: adminTok, body: { analyticsDays: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 600));
  assert.equal(r.body.data.forecast.hubs, 1, 'forecast step ran');
  assert.ok(r.body.data.analytics.rebuiltDays >= 1, 'analytics rollups rebuilt');
  assert.ok(r.body.data.exportJobsCreated >= 1, 'analytics_daily jobs created');
  assert.ok(r.body.data.eventsDrained && !r.body.data.eventsDrained.error, 'events drained');
  assert.ok(r.body.data.notificationsSent && !r.body.data.notificationsSent.error, 'notification worker ran');
  const rolled = await M.AnalyticsDaily.countDocuments({ tenantId: tenant.id });
  assert.ok(rolled >= 1, `analyticsdailies exist (${rolled})`);
  const adJobs = await M.ExportJob.countDocuments({ tenantId: tenant.id, type: 'analytics_daily' });
  assert.ok(adJobs >= 7, `nightly created 7 daily jobs, got ${adJobs}`);
  // idempotency: run again → no duplicate export jobs
  const before = await M.ExportJob.countDocuments({ tenantId: tenant.id });
  r = await call('/admin/maintenance/nightly', { method: 'POST', token: adminTok, body: { analyticsDays: 7 } });
  assert.equal(r.status, 200);
  const after = await M.ExportJob.countDocuments({ tenantId: tenant.id });
  assert.equal(after, before, 'nightly re-run creates no duplicate export jobs');
  assert.equal(r.body.data.exportJobsCreated, 0, 'all jobKeys already existed');
  ok('nightly: pipeline runs, analyticsdailies rolled, jobs created, re-run idempotent');

  // ================= 7. regression sanity =================
  r = await call('/admin/products?limit=5', { token: adminTok });
  assert.equal(r.status, 200);
  r = await call('/cart/slots?pincode=530013&date=' + tomorrow, { token: custTok });
  assert.equal(r.status, 200);
  r = await call('/admin/orders?status=delivered', { token: adminTok });
  assert.equal(r.body.data.length, 2, 'prior admin list still intact');
  ok('regression: admin products, cart slots, admin orders all healthy');

  console.log(`\nsmoke-ops: ${passed} checks passed ✅`);
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

main().catch(async (err) => {
  console.error('\nsmoke-ops FAILED:', err);
  if (mongod) await mongod.stop().catch(() => {});
  process.exit(1);
});
