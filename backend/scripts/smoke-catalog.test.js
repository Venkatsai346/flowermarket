/**
 * Catalog smoke test — exercises the multi-tenant catalog domain end to end:
 *
 *   category+brand create -> tenant proposes master -> admin approves
 *   -> tenant lists it (price/stock) -> customer merged-view search
 *   -> optimistic lock conflict -> price change + history
 *   -> atomic inventory reserve/release -> global-field change request flow
 *   -> duplicate detection -> RBAC (tenant cannot touch taxonomy)
 *
 * Run: node scripts/smoke-catalog.test.js   (requires npm install already done)
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
let mongod;

process.env.OTP_PROVIDER = 'memory';

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await MongoMemoryServer.create({
    instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] },
  });
  config.mongoUri = mongod.getUri('flower_market_catalog_smoke');
    await mongoose.connect(config.mongoUri, { autoIndex: false });

  // init indexes we rely on
  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: TenantAuthConfig } = await import('../src/models/tenantAuthConfig.model.js');
  const { default: User } = await import('../src/models/user.model.js');
  const { default: Category } = await import('../src/models/category.model.js');
  const { default: Brand } = await import('../src/models/brand.model.js');
  const { default: ProductMaster } = await import('../src/models/productMaster.model.js');
  const { default: ProductVariant } = await import('../src/models/productVariant.model.js');
  const { default: ProductImage } = await import('../src/models/productImage.model.js');
  const { default: ProductAttributeValue } = await import('../src/models/productAttributeValue.model.js');
  const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');
  const { default: PriceHistory } = await import('../src/models/priceHistory.model.js');
  const { default: Inventory } = await import('../src/models/inventory.model.js');
  const { default: ProductChangeRequest } = await import('../src/models/productChangeRequest.model.js');
  const { default: AuditLog } = await import('../src/models/auditLog.model.js');
  const { default: CatalogEvent } = await import('../src/models/catalogEvent.model.js');
  await Promise.all([
    Tenant.init(), TenantAuthConfig.init(), User.init(), Category.init(), Brand.init(),
    ProductMaster.init(), ProductVariant.init(), ProductImage.init(), ProductAttributeValue.init(),
    TenantProduct.init(), PriceHistory.init(), Inventory.init(), ProductChangeRequest.init(),
    AuditLog.init(), CatalogEvent.init(),
  ]);

  const tenant = await Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await TenantAuthConfig.create({ tenantId: tenant.id });

  // users: super admin + tenant customer
  const admin = await User.create({
    tenantId: tenant.id, email: { address: 'admin@flowermarket.in', verified: true },
    role: 'super_admin', status: 'active',
  });
  const customer = await User.create({
    tenantId: tenant.id, phone: { number: '9876500001', verified: true }, status: 'active',
  });
  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const custTok = (await AuthService.issueTokens(customer)).accessToken;

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
    return { status: res.status, body: await res.json() };
  };

  // ================= 1. taxonomy (admin only) =================
  let r = await call('/catalog/admin/categories', {
    method: 'POST', token: adminTok,
    body: {
      name: 'Fresh Flowers', slug: 'fresh-flowers',
      attributeSchema: [
        { key: 'vase_life_days', type: 'number', required: true, min: 1, max: 30, label: 'Vase life (days)' },
        { key: 'color', type: 'select', required: true, options: ['red', 'white', 'mixed'], label: 'Color' },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const catId = r.body.data.id;

  // tenant cannot create categories
  r = await call('/catalog/admin/categories', {
    method: 'POST', token: custTok, body: { name: 'Hacked', slug: 'hacked' },
  });
  assert.equal(r.status, 403, 'tenant must not create categories');

  r = await call('/catalog/admin/brands', {
    method: 'POST', token: adminTok, body: { name: 'RoseVille', slug: 'roseville' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const brandId = r.body.data.id;

  // ================= 2. tenant proposes a new global SKU =================
  r = await call('/catalog/tenant/masters/propose', {
    method: 'POST', token: custTok,
    body: {
      skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10 Stems',
      categoryId: catId, brandId,
      attributes: [
        { key: 'vase_life_days', value: '7' },
        { key: 'color', value: 'red' },
      ],
      note: 'Proposing for Valentine season',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const masterId = r.body.data.master.id;
  assert.equal(r.body.data.master.status, 'pending_review', 'new master must be PENDING_REVIEW');
  assert.ok(r.body.data.changeRequest.id);

  // duplicate detection: same title -> 409
  r = await call('/catalog/tenant/masters/propose', {
    method: 'POST', token: custTok,
    body: {
      skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10 Stems',
      categoryId: catId, brandId,
      attributes: [{ key: 'vase_life_days', value: '7' }, { key: 'color', value: 'red' }],
    },
  });
  assert.equal(r.status, 409, 'duplicate SKU must be rejected');
  assert.equal(r.body.code, 'DUPLICATE_SKU');

  // ================= 3. admin reviews & approves =================
  r = await call(`/catalog/admin/masters/${masterId}/review`, {
    method: 'POST', token: adminTok, body: { decision: 'approve', note: 'Looks good' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'active');

  // ================= 4. tenant creates a listing =================
  r = await call('/catalog/tenant/listings', {
    method: 'POST', token: custTok,
    body: { productMasterId: masterId, price: { mrp: 499, sellingPrice: 399 }, stockQty: 50, status: 'active' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const listingId = r.body.data.id;
  assert.equal(r.body.data.version, 1);
  assert.equal(r.body.data.availability.status, 'in_stock');

  // ================= 5. customer merged-view search =================
  r = await call('/catalog?search=roses');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 1, 'customer must see exactly 1 product');
  assert.equal(r.body.data[0].product.title, 'Red Roses 10 Stems');
  assert.equal(r.body.data[0].price.sellingPrice, 399);

  // inactive listing must NOT surface
  r = await call(`/catalog/tenant/listings/${listingId}/status`, {
    method: 'PATCH', token: custTok, body: { status: 'inactive', expectedVersion: 1 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('/catalog?search=roses');
  assert.equal(r.body.data.length, 0, 'inactive listing must be hidden from customers');

  // reactivate
  r = await call(`/catalog/tenant/listings/${listingId}/status`, {
    method: 'PATCH', token: custTok, body: { status: 'active', expectedVersion: 2 },
  });
  assert.equal(r.status, 200);

  // ================= 6. optimistic lock conflict =================
  r = await call(`/catalog/tenant/listings/${listingId}/price`, {
    method: 'PATCH', token: custTok,
    body: { price: { mrp: 499, sellingPrice: 349 }, expectedVersion: 2 }, // stale version
  });
  assert.equal(r.status, 409, 'stale version must 409');
  assert.equal(r.body.code, 'VERSION_CONFLICT');

  // correct version works + price history recorded
  r = await call(`/catalog/tenant/listings/${listingId}/price`, {
    method: 'PATCH', token: custTok,
    body: { price: { mrp: 499, sellingPrice: 349 }, expectedVersion: 3, reason: 'promotion' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const historyCount = await PriceHistory.countDocuments({ tenantProductId: listingId });
  assert.ok(historyCount >= 1, 'price history must be recorded');

  // ================= 7. atomic inventory reserve / release =================
  const inv = await Inventory.findOne({ tenantProductId: listingId });
  assert.ok(inv, 'inventory row must exist');
  assert.equal(inv.qtyOnHand, 50);

  // reserve 10 -> available 40
  r = await call(`/catalog/tenant/listings/${listingId}/stock/reserve`, {
    method: 'POST', token: custTok, body: { qty: 10, orderRef: 'TEST-ORDER-1' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // over-reserve must fail atomically
  r = await call(`/catalog/tenant/listings/${listingId}/stock/reserve`, {
    method: 'POST', token: custTok, body: { qty: 999, orderRef: 'TEST-ORDER-2' },
  });
  assert.equal(r.status, 409, 'over-reservation must fail');
  assert.equal(r.body.code, 'INSUFFICIENT_STOCK');

  // release 10 -> available back to 50
  r = await call(`/catalog/tenant/listings/${listingId}/stock/release`, {
    method: 'POST', token: custTok, body: { qty: 10, orderRef: 'TEST-ORDER-1' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const invAfter = await Inventory.findOne({ tenantProductId: listingId });
  assert.equal(invAfter.qtyReserved, 0);
  assert.equal(invAfter.qtyOnHand, 50);

  // ================= 8. global-field change request flow =================
  // tenant cannot edit title directly (not in the listing update schema) — via CR:
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: custTok,
    body: {
      type: 'update_global_fields', productMasterId: masterId,
      diff: { after: { title: 'Red Roses 10 Stems Premium' } },
      note: 'Update title for clarity',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const crId = r.body.data.id;

  // admin rejects with reason
  r = await call(`/catalog/admin/change-requests/${crId}/review`, {
    method: 'POST', token: adminTok, body: { decision: 'reject', note: 'Keep it simple' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const masterAfterReject = await ProductMaster.findById(masterId);
  assert.equal(masterAfterReject.title, 'Red Roses 10 Stems', 'rejected request must not change the master');

  // submit again + approve -> applied
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: custTok,
    body: {
      type: 'update_global_fields', productMasterId: masterId,
      diff: { after: { title: 'Red Roses Premium 10 Stems' } },
    },
  });
  const crId2 = r.body.data.id;
  r = await call(`/catalog/admin/change-requests/${crId2}/review`, {
    method: 'POST', token: adminTok, body: { decision: 'approve', note: 'OK' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const masterAfterApprove = await ProductMaster.findById(masterId);
  assert.equal(masterAfterApprove.title, 'Red Roses Premium 10 Stems', 'approved request must apply to master');
  assert.equal(masterAfterApprove.version, 3, 'master version must bump on approved change');

  // customer search reflects the new title
  r = await call('/catalog?search=premium');
  assert.equal(r.status, 200);
  assert.equal(r.body.data[0].product.title, 'Red Roses Premium 10 Stems');

  // ================= 9. events + audit were recorded =================
  const events = await CatalogEvent.countDocuments({});
  assert.ok(events >= 6, `expected >= 6 catalog events, got ${events}`);
  const audits = await AuditLog.countDocuments({});
  assert.ok(audits >= 10, `expected >= 10 audit entries, got ${audits}`);

  // drain handlers run without throwing
  const catalogEventService = (await import('../src/services/catalogEvent.service.js')).default;
  const drain = await catalogEventService.drain({ limit: 100 });
  assert.equal(drain.failed, 0, 'no events should fail draining');
  assert.ok(drain.published >= events, 'all events should be published');

  // ================= 10. admin audit view is cross-tenant; tenant sees own only =================
  r = await call('/catalog/admin/audit?limit=5', { token: adminTok });
  assert.equal(r.status, 200);

  // ================= 11. deprecate cascades to listings =================
  r = await call(`/catalog/admin/masters/${masterId}/deprecate`, {
    method: 'POST', token: adminTok, body: { note: 'Season over' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const listingAfterDeprecate = await TenantProduct.findById(listingId);
  assert.equal(listingAfterDeprecate.status, 'inactive', 'deprecating master must cascade listings to INACTIVE');
  r = await call('/catalog?search=roses');
  assert.equal(r.body.data.length, 0, 'deprecated master products must vanish from customer view');

  console.log('✅ ALL CATALOG SMOKE TESTS PASSED');

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}

async function run() {
  try { await main(); } catch (err) { console.error('❌', err); await mongoose.disconnect().catch(()=>{}); await mongod.stop().catch(()=>{}); process.exit(1); }
}
run();
