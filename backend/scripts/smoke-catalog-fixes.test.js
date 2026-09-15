/**
 * Catalog fixes — adversarial end-to-end suite (hermetic in-memory mongod).
 *
 * Re-exercises every F-01..F-20 fix through the REAL HTTP stack, including
 * the attacks the fixes were written for:
 *
 *   F-01  response cache is per-user and invalidated on writes
 *   F-02  concurrent same-version writers: exactly one wins
 *   F-03  approved CR cannot smuggle status/version/soldCount into a master
 *   F-04  concurrent CR approvals: one claim, one apply; bad payloads
 *         compensate back to PENDING with lastApplyError
 *   F-05  activation gates (price required; master must be ACTIVE)
 *   F-06  deprecated master vanishes from public PDP/PLP
 *   F-07  per-variant primary images survive master syncs
 *   F-08  category cycles: blocked on write, tolerated on read (no hang)
 *   F-09  brand removal is a soft delete (+ event, + audit)
 *   F-10  regex-injection search strings return 200, not 500
 *   F-11  stock writes: validated, atomic (no lost updates)
 *   F-12  reserve/release HTTP endpoints are gone (404)
 *   F-13  admin product list: true counts, listingsCount, complete CSV
 *   F-14  bulk upload: hard row cap; deterministic master-level targeting
 *   F-17  RBAC uses the LIVE role — demotion applies on the next request
 *   F-18  dedup is scoped per user+tenant (cross-tenant identical bodies
 *         are never replayed); identical POST bodies are
 *   F-19  soldCount increments on commit, decrements on restore
 *   F-20  soft-deleted rows release unique keys (slug re-creation works)
 *
 * Run: node scripts/smoke-catalog-fixes.test.js   (requires npm install)
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = '';
process.env.MONGODB_URI = '';
let mongod;
process.env.OTP_PROVIDER = 'memory';

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_catalog_fixes');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const models = [
    'tenant.model.js', 'tenantAuthConfig.model.js', 'user.model.js', 'category.model.js',
    'brand.model.js', 'productMaster.model.js', 'productVariant.model.js', 'productImage.model.js',
    'productAttributeValue.model.js', 'tenantProduct.model.js', 'priceHistory.model.js',
    'inventory.model.js', 'productChangeRequest.model.js', 'auditLog.model.js', 'catalogEvent.model.js',
  ];
  const loaded = {};
  for (const m of models) {
    // Sequential on purpose: models register with mongoose in import order —
    // a defined load order the suites rely on.
    // eslint-disable-next-line no-await-in-loop
    loaded[m] = (await import(`../src/models/${m}`)).default;
  }
  await Promise.all(Object.values(loaded).map((M) => M.init()));
  const {
    Tenant, TenantAuthConfig, User, Category, Brand, ProductMaster, ProductVariant, ProductImage,
    TenantProduct, Inventory, ProductChangeRequest, AuditLog, CatalogEvent,
  } = loaded;

  // ---------------- tenancy + users ----------------
  const tenant = await Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await TenantAuthConfig.create({ tenantId: tenant.id });
  const tenant2 = await Tenant.create({ name: 'Second Store', slug: 'second-store', status: 'active' });
  await TenantAuthConfig.create({ tenantId: tenant2.id });

  const admin = await User.create({
    tenantId: tenant.id, email: { address: 'admin@fm.test', verified: true },
    role: 'super_admin', status: 'active',
  });
  const vendor = await User.create({
    tenantId: tenant.id, phone: { number: '9876501001', verified: true }, status: 'active', role: 'vendor',
  });
  const vendor2 = await User.create({
    tenantId: tenant2.id, phone: { number: '9876502001', verified: true }, status: 'active', role: 'vendor',
  });
  const custA = await User.create({ tenantId: tenant.id, phone: { number: '9876503001', verified: true }, status: 'active' });
  const custB = await User.create({ tenantId: tenant.id, phone: { number: '9876503002', verified: true }, status: 'active' });
  const adminUser = await User.create({
    tenantId: tenant.id, email: { address: 'ops@fm.test', verified: true },
    role: 'admin', status: 'active',
  });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const tok = {};
  for (const [k, u] of Object.entries({ admin, vendor, vendor2, custA, custB, adminUser })) {
    // Bounded setup: six users minted one at a time so a failure names the user.
    // eslint-disable-next-line no-await-in-loop
    tok[k] = (await AuthService.issueTokens(u)).accessToken;
  }

  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { default: catalogEvents } = await import('../src/services/catalogEvent.service.js');
  const { default: inventoryService } = await import('../src/services/inventory.service.js');
  const { invalidateAll } = await import('../src/middleware/responseCache.js');

  const call = async (path, { method = 'GET', body, token, tenantId = tenant.id, raw = false, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) {
      const text = await res.text();
      return { status: res.status, text, headers: res.headers };
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body: json, headers: res.headers };
  };

  const drain = async () => {
    const r = await catalogEvents.drain({ limit: 200 });
    assert.equal(r.failed, 0, 'outbox drain must not fail');
    return r;
  };

  const pollJob = async (jobId, { timeoutMs = 15_000 } = {}) => {
    const t0 = Date.now();
    for (;;) {
      // Polling loop: each round depends on the previous one's job status.
      // eslint-disable-next-line no-await-in-loop
      const r = await call(`/catalog/tenant/bulk/jobs/${jobId}`, { token: tok.vendor });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const job = r.body.data;
      if (job.status === 'completed' || job.status === 'failed') return job;
      if (Date.now() - t0 > timeoutMs) throw new Error(`job ${jobId} did not finish: ${JSON.stringify(job)}`);
      // Poll cadence: sleep, then the next round depends on the previous result.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res2) => { setTimeout(res2, 150); });
    }
  };

  let passed = 0;
  const section = (name) => { console.log(`\n── ${name}`); passed += 1; };

  // ================= setup: taxonomy =================
  let r = await call('/catalog/admin/categories', {
    method: 'POST', token: tok.admin, body: { name: 'Fresh Flowers', slug: 'fresh-flowers' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const catA = r.body.data.id;
  r = await call('/catalog/admin/categories', {
    method: 'POST', token: tok.admin,
    body: { name: 'Rose Bouquets', slug: 'rose-bouquets', parentId: catA },
  });
  const catB = r.body.data.id;
  r = await call('/catalog/admin/categories', {
    method: 'POST', token: tok.admin,
    body: { name: 'Premium Roses', slug: 'premium-roses', parentId: catB },
  });
  const catC = r.body.data.id;
  r = await call('/catalog/admin/brands', {
    method: 'POST', token: tok.admin, body: { name: 'RoseVille', slug: 'roseville' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const brandId = r.body.data.id;

  const propose = async (body, { token = tok.vendor, tenantId = tenant.id } = {}) =>
    call('/catalog/tenant/masters/propose', { method: 'POST', body, token, tenantId });
  const approveMaster = async (masterId) => {
    const rr = await call(`/catalog/admin/masters/${masterId}/review`, {
      method: 'POST', token: tok.admin, body: { decision: 'approve' },
    });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    return rr;
  };
  const makeListing = async (body, { token = tok.vendor, tenantId = tenant.id } = {}) => {
    const rr = await call('/catalog/tenant/listings', { method: 'POST', body, token, tenantId });
    return rr;
  };

  // ================= F-18: dedup scoping (via propose) =================
  section('F-18 dedup: identical POST body replays; cross-tenant never replays');
  const dedupBody = {
    skuGlobal: 'DEDUP-ROS-1', type: 'fresh_flower', title: 'Dedup Roses',
    categoryId: catA, brandId,
  };
  const d1 = await propose(dedupBody);
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  assert.equal(d1.headers.get('x-dedup-cached'), null, 'first call is fresh');
  const m1Id = d1.body.data.master.id;

  const d2 = await propose(dedupBody);
  assert.equal(d2.status, 201);
  assert.equal(d2.headers.get('x-dedup-cached'), 'true', 'identical POST must replay the first response');
  assert.equal(d2.body.data.master.id, m1Id, 'replay must return the SAME master id');
  assert.equal(await ProductMaster.countDocuments({ skuGlobal: 'DEDUP-ROS-1' }), 1, 'no duplicate master may be created');

  // Cross-tenant: SUPER ADMIN (tenant-exempt) sends the identical body for
  // tenant2. A buggy shared key would replay d1 (201 + tenant1 id). The
  // request must be processed independently → global SKU uniqueness 409.
  const d3 = await propose(dedupBody, { token: tok.admin, tenantId: tenant2.id });
  assert.equal(d3.headers.get('x-dedup-cached'), null, 'cross-tenant must never replay');
  assert.equal(d3.status, 409, `expected DUPLICATE_SKU from independent processing, got ${d3.status}: ${JSON.stringify(d3.body)}`);
  assert.equal(d3.body.code, 'DUPLICATE_SKU');
  await approveMaster(m1Id);

  // ================= F-05: activation gates =================
  section('F-05 activation gates: price required + master must be ACTIVE');
  r = await makeListing({ productMasterId: m1Id, status: 'active', stockQty: 10 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'PRICE_REQUIRED', 'active listing without price must be rejected');

  r = await makeListing({ productMasterId: m1Id, status: 'draft' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const draftId = r.body.data.id;
  r = await call(`/catalog/tenant/listings/${draftId}/status`, {
    method: 'PATCH', token: tok.vendor, body: { status: 'active', expectedVersion: 1 },
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'PRICE_REQUIRED', 'activating a priceless draft must be rejected');

  // the main listing L1 for later sections
  r = await makeListing({
    productMasterId: m1Id, status: 'active',
    price: { mrp: 499, sellingPrice: 399 }, stockQty: 50,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const L1 = r.body.data.id;

  // pending master cannot be listed as active
  r = await propose({ skuGlobal: 'PEND-ROS-1', type: 'fresh_flower', title: 'Pending Roses', categoryId: catA, brandId });
  assert.equal(r.status, 201);
  const pendId = r.body.data.master.id;
  r = await makeListing({ productMasterId: pendId, status: 'draft', price: { mrp: 100, sellingPrice: 90 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pendListing = r.body.data.id;
  r = await call(`/catalog/tenant/listings/${pendListing}/status`, {
    method: 'PATCH', token: tok.vendor, body: { status: 'active', expectedVersion: 1 },
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'MASTER_NOT_ACTIVE', 'draft under a PENDING master must not activate');

  // ============ store-owner master browse: read-only for listings ============
  section('store owner browses global masters READ-ONLY; master editing stays admin');
  // Context: m1 (active) + pend (pending) exist. A store owner must be able to
  // SEE the global catalog to add listings, via the tenant (store) surface —
  // NOT the admin master surface that carries edit/review/deprecate.
  r = await call('/catalog/tenant/masters', { token: tok.vendor });
  assert.equal(r.status, 200, `store owner tenant master browse must be 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.data), 'tenant master browse must return an array of masters');
  assert.ok(r.body.data.some((m) => String(m._id) === String(m1Id)), 'active master must be visible to the store owner');
  assert.ok(r.body.data.some((m) => String(m._id) === String(pendId)), 'pending master must also be visible (browse is the global catalog)');
  assert.ok(Number.isInteger(r.body.meta.total), 'meta.total must be an integer');
  assert.equal(r.body.meta.total, r.body.data.length, 'small catalog: total must equal item count');

  // status filter: the listing picker requests only ACTIVE masters
  r = await call('/catalog/tenant/masters?status=active', { token: tok.vendor });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.total, 1, 'only the active master matches status=active');
  assert.ok(r.body.data.every((m) => m.status === 'active'), 'status=active must return ONLY active masters');
  assert.ok(r.body.data.some((m) => String(m._id) === String(m1Id)), 'the active master must be the one returned');

  // search filter works on the tenant browse too (title/sku)
  r = await call(`/catalog/tenant/masters?search=${encodeURIComponent('Dedup')}`, { token: tok.vendor });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.some((m) => String(m._id) === String(m1Id)), 'search must find the master by title');

  // hostile search string must be regex-safe (200, not 500)
  r = await call(`/catalog/tenant/masters?search=${encodeURIComponent('(a+)+')}`, { token: tok.vendor });
  assert.equal(r.status, 200, 'regex-injection search on tenant browse must be 200');

  // READ-ONLY contract: a store owner must NOT reach the admin master surface
  // (create/update/review/deprecate all live there). This is the 403 the
  // reported bug hit — the store owner was pointed at the admin endpoint.
  r = await call('/catalog/admin/masters', { token: tok.vendor });
  assert.equal(r.status, 403, `store owner must be 403 on the ADMIN master surface, got ${r.status}`);

  // but a true admin keeps full access to that same surface
  r = await call('/catalog/admin/masters', { token: tok.adminUser });
  assert.equal(r.status, 200, 'admin role must still reach the admin master surface');
  assert.ok(Array.isArray(r.body.data) && r.body.data.length >= 1, 'admin master list must be populated');

  // and a plain customer is locked out of the store-owner browse entirely
  r = await call('/catalog/tenant/masters', { token: tok.custA });
  assert.equal(r.status, 403, `customer must be 403 on the tenant master browse, got ${r.status}`);

  // ================= F-02: optimistic lock under concurrency =================
  section('F-02 concurrent same-version price writers: one wins, one 409s');
  r = await call(`/catalog/tenant/listings/${L1}`, { token: tok.vendor });
  const v0 = r.body.data.version;
  const priceP = async (sellingPrice) => call(`/catalog/tenant/listings/${L1}/price`, {
    method: 'PATCH', token: tok.vendor,
    body: { price: { mrp: 499, sellingPrice }, expectedVersion: v0, reason: 'promotion' },
  });
  const [pa, pb] = await Promise.all([priceP(349), priceP(299)]);
  const codes = [pa, pb].map((x) => x.status).sort();
  assert.deepEqual(codes, [200, 409], `expected one 200 + one 409, got ${JSON.stringify(codes)}`);
  const loser = pa.status === 409 ? pa : pb;
  assert.equal(loser.body.code, 'VERSION_CONFLICT');
  const winnerPrice = pa.status === 200 ? 349 : 299;
  r = await call(`/catalog/tenant/listings/${L1}`, { token: tok.vendor });
  assert.equal(r.body.data.version, v0 + 1, 'version must bump exactly once');
  assert.equal(r.body.data.price.sellingPrice, winnerPrice, 'winner\'s price must be the final one');

  // ================= F-11: stock writes =================
  section('F-11 stock: validated + atomic (no lost updates)');
  r = await call(`/catalog/tenant/listings/${L1}/stock`, {
    method: 'PUT', token: tok.vendor, body: { qty: 50 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [s1, s2] = await Promise.all([
    call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PATCH', token: tok.vendor, body: { delta: 10 } }),
    call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PATCH', token: tok.vendor, body: { delta: 10 } }),
  ]);
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  r = await call(`/catalog/tenant/listings/${L1}/stock`, { token: tok.vendor });
  assert.equal(r.body.data.qtyOnHand, 70, 'two concurrent +10s must both land (no lost update)');

  r = await call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PATCH', token: tok.vendor, body: { delta: -99999 } });
  assert.equal(r.status, 400, 'negative-below-zero adjustment must be rejected');
  assert.equal(r.body.code, 'INVALID_QTY');
  r = await call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PUT', token: tok.vendor, body: { qty: -5 } });
  assert.equal(r.status, 400, 'validator must reject negative qty');
  r = await call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PUT', token: tok.vendor, body: { qty: 'abc' } });
  assert.equal(r.status, 400, 'validator must reject non-numeric qty');
  r = await call(`/catalog/tenant/listings/${L1}/stock`, { method: 'PATCH', token: tok.vendor, body: { delta: 0 } });
  assert.equal(r.status, 400, 'zero delta must be rejected');

  // ================= F-12: reserve/release endpoints removed =================
  section('F-12 tenant reserve/release endpoints are gone');
  r = await call(`/catalog/tenant/listings/${L1}/stock/reserve`, {
    method: 'POST', token: tok.vendor, body: { qty: 5 },
  });
  assert.equal(r.status, 404, 'reserve endpoint must be removed');
  r = await call(`/catalog/tenant/listings/${L1}/stock/release`, {
    method: 'POST', token: tok.vendor, body: { qty: 5 },
  });
  assert.equal(r.status, 404, 'release endpoint must be removed');

  // ================= F-19: soldCount on commit / restore =================
  section('F-19 soldCount increments on commit, decrements on restore');
  const mBefore = await ProductMaster.findById(m1Id).lean();
  const soldBefore = mBefore.soldCount || 0;
  const commit = await inventoryService.commitForOrder({ tenantId: tenant.id, items: [{ listingId: L1, qty: 3 }] });
  assert.equal(commit.failed.length, 0, JSON.stringify(commit.failed));
  let mAfter = await ProductMaster.findById(m1Id).lean();
  assert.equal(mAfter.soldCount, soldBefore + 3, 'commit must bump soldCount');
  const invAfter = await Inventory.findOne({ tenantProductId: L1 });
  assert.equal(invAfter.qtyOnHand, 67, 'stock must be deducted');
  await inventoryService.restoreForOrder({ tenantId: tenant.id, items: [{ listingId: L1, qty: 3 }] });
  mAfter = await ProductMaster.findById(m1Id).lean();
  assert.equal(mAfter.soldCount, soldBefore, 'restore must undo the soldCount bump');
  const invAfter2 = await Inventory.findOne({ tenantProductId: L1 });
  assert.equal(invAfter2.qtyOnHand, 70, 'stock must be restored');

  // ================= F-03: CR cannot smuggle lifecycle fields =================
  section('F-03 approved CR diff cannot smuggle status/version/soldCount/slug');
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: tok.vendor,
    body: {
      type: 'update_global_fields', productMasterId: m1Id,
      diff: {
        after: {
          title: 'Smuggled Title', status: 'deprecated', version: 999,
          soldCount: 42, slug: 'evil-slug', price: { mrp: 1 },
        },
      },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const smuggleCr = r.body.data.id;
  const mPreSmuggle = await ProductMaster.findById(m1Id).lean();
  r = await call(`/catalog/admin/change-requests/${smuggleCr}/review`, {
    method: 'POST', token: tok.admin, body: { decision: 'approve' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mSmuggled = await ProductMaster.findById(m1Id).lean();
  assert.equal(mSmuggled.title, 'Smuggled Title', 'legitimate field must apply');
  assert.equal(mSmuggled.status, mPreSmuggle.status, 'status must NOT apply from a CR diff');
  assert.equal(mSmuggled.version, mPreSmuggle.version + 1, 'version must bump exactly once (not to 999)');
  assert.equal(mSmuggled.soldCount, mPreSmuggle.soldCount, 'soldCount must NOT apply from a CR diff');
  assert.equal(mSmuggled.slug, mPreSmuggle.slug, 'slug must NOT apply from a CR diff');

  // ================= F-04: concurrent CR approvals + bad payload =================
  section('F-04 concurrent approvals: one claim, one apply; bad payload compensates');
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: tok.vendor,
    body: {
      type: 'update_global_fields', productMasterId: m1Id,
      diff: { after: { title: 'Concurrent One' } },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const concCr = r.body.data.id;
  const mPreConc = await ProductMaster.findById(m1Id).lean();
  const approveP = call(`/catalog/admin/change-requests/${concCr}/review`, {
    method: 'POST', token: tok.admin, body: { decision: 'approve' },
  });
  const approveP2 = call(`/catalog/admin/change-requests/${concCr}/review`, {
    method: 'POST', token: tok.admin, body: { decision: 'approve' },
  });
  const [ra, rb] = await Promise.all([approveP, approveP2]);
  const concCodes = [ra, rb].map((x) => x.status).sort();
  assert.deepEqual(concCodes, [200, 409], `expected one 200 + one 409, got ${JSON.stringify(concCodes)}`);
  const mConc = await ProductMaster.findById(m1Id).lean();
  assert.equal(mConc.title, 'Concurrent One');
  assert.equal(mConc.version, mPreConc.version + 1, 'apply must happen exactly once (version +1, not +2)');
  const crAfter = await ProductChangeRequest.findById(concCr).lean();
  assert.equal(crAfter.status, 'approved');
  assert.ok(crAfter.appliedAt, 'appliedAt stamp must be set');

  // bad payload: attributes CR whose payload is the wrong shape — the
  // validator cannot see through it, so the APPROVE path must guard,
  // compensate back to PENDING, and record lastApplyError.
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: tok.vendor,
    body: {
      type: 'update_attributes', productMasterId: m1Id,
      payload: { attributes: 'not-an-array' },
      diff: { after: { note: 'bad shape' } },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const badCr = r.body.data.id;
  r = await call(`/catalog/admin/change-requests/${badCr}/review`, {
    method: 'POST', token: tok.admin, body: { decision: 'approve' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'PAYLOAD_INVALID');
  const badCrAfter = await ProductChangeRequest.findById(badCr).lean();
  assert.equal(badCrAfter.status, 'pending', 'failed apply must compensate back to PENDING');
  assert.ok(badCrAfter.lastApplyError, 'lastApplyError must record the reason');

  // a corrected request then applies cleanly
  r = await call('/catalog/tenant/change-requests', {
    method: 'POST', token: tok.vendor,
    body: {
      type: 'update_attributes', productMasterId: m1Id,
      payload: { attributes: [{ key: 'stem_count', value: '10' }] },
      diff: { after: { note: 'good shape' } },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const goodCr = r.body.data.id;
  r = await call(`/catalog/admin/change-requests/${goodCr}/review`, {
    method: 'POST', token: tok.admin, body: { decision: 'approve' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mAttrs = await ProductMaster.findById(m1Id).lean();
  const attrApplied = (mAttrs.attributes || []).some((a) => a.key === 'stem_count' && a.value === '10');
  assert.ok(attrApplied, 'correctly-shaped attributes must apply');

  // ================= F-07: primary images survive syncs =================
  section('F-07 per-variant primary images survive master syncs');
  r = await propose({
    skuGlobal: 'VAR-ROS-1', type: 'fresh_flower', title: 'Multi Variant Roses',
    categoryId: catA, brandId,
    variants: [
      { variantType: 'size', value: '10 stems', images: [{ url: 'http://img.test/v10.jpg', isPrimary: true }] },
      { variantType: 'size', value: '25 stems', images: [{ url: 'http://img.test/v25.jpg', isPrimary: true }] },
    ],
    images: [{ url: 'http://img.test/master.jpg', isPrimary: true }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const m4Id = r.body.data.master.id;
  await approveMaster(m4Id);
  const primaries = await ProductImage.find({ productMasterId: m4Id, isPrimary: true }).lean();
  assert.equal(primaries.length, 3, `master + both variant primaries must survive, got ${JSON.stringify(primaries.map((p) => p.url))}`);
  const variantPrimaries = primaries.filter((p) => p.variantId != null);
  assert.equal(variantPrimaries.length, 2, 'variant primaries must NOT be cleared by master syncs');

  // listings: master-level + both variants (for F-14 targeting)
  r = await makeListing({ productMasterId: m4Id, status: 'active', price: { mrp: 200, sellingPrice: 150 }, stockQty: 5 });
  const Lm = r.body.data.id;
  const m4Variants = await ProductVariant.find({ productMasterId: m4Id }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  assert.equal(m4Variants.length, 2, 'M4 must have exactly 2 variants');
  const [v10, v25] = m4Variants;
  r = await makeListing({ productMasterId: m4Id, variantId: v10._id, status: 'active', price: { mrp: 300, sellingPrice: 250 }, stockQty: 5 });
  const Lv10 = r.body.data.id;
  r = await makeListing({ productMasterId: m4Id, variantId: v25._id, status: 'active', price: { mrp: 400, sellingPrice: 350 }, stockQty: 5 });
  const Lv25 = r.body.data.id;

  // ================= F-14: bulk upload =================
  section('F-14 bulk: hard row cap + deterministic master-level targeting');
  const bigRows = ['masterId,listingId,sku,price,mrp'];
  for (let i = 0; i < 5001; i += 1) bigRows.push(`X-${i},,,100,`);
  r = await call('/catalog/tenant/bulk/price', {
    method: 'POST', token: tok.vendor, body: { csv: bigRows.join('\n') },
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'CSV_TOO_LARGE', 'uploads over 5000 rows must be rejected');

  // SKU-keyed row must hit the MASTER-LEVEL listing, not a variant row
  const targetCsv = [
    'masterId,listingId,sku,price,mrp',
    `,,${'VAR-ROS-1'},100,`,
  ].join('\n');
  r = await call('/catalog/tenant/bulk/price', {
    method: 'POST', token: tok.vendor, body: { csv: targetCsv },
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const job = await pollJob(r.body.data.jobId);
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(job.succeeded, 1, JSON.stringify(job.errors));
  const lM4 = await TenantProduct.findById(Lm).lean();
  const lV10 = await TenantProduct.findById(Lv10).lean();
  const lV25 = await TenantProduct.findById(Lv25).lean();
  assert.equal(lM4.price.sellingPrice, 100, 'SKU-keyed price row must update the master-level listing');
  assert.equal(lV10.price.sellingPrice, 250, 'variant listings must be untouched');
  assert.equal(lV25.price.sellingPrice, 350, 'variant listings must be untouched');

  // ================= F-13: admin product list + CSV =================
  section('F-13 admin list: true counts, listingsCount, complete CSV');
  // tenant2 gets its own master + listing (multi-tenant visibility)
  r = await propose(
    { skuGlobal: 'TUL-2ND-1', type: 'fresh_flower', title: 'Second Store Tulips', categoryId: catA, brandId },
    { token: tok.vendor2, tenantId: tenant2.id }
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const m5Id = r.body.data.master.id;
  await approveMaster(m5Id);
  r = await makeListing(
    { productMasterId: m5Id, status: 'active', price: { mrp: 300, sellingPrice: 240 }, stockQty: 8 },
    { token: tok.vendor2, tenantId: tenant2.id }
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));

  // Admin catalog is TENANT-SCOPED (req.tenantId). tenant1 holds M1 (2 listings),
  // PEND (1), M4 (master + 2 variants = 3).
  r = await call('/admin/products', { token: tok.admin, tenantId: tenant.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t1Items = r.body.data;
  assert.ok(Array.isArray(t1Items) && t1Items.length >= 3, `expected >= 3 tenant1 masters, got ${t1Items.length}`);
  assert.ok(Number.isInteger(r.body.meta.total), 'total must be an integer');
  assert.equal(r.body.meta.total, t1Items.length, 'small tenant: total must equal item count (no hidden truncation)');
  const m4Item = t1Items.find((i) => i.id === m4Id);
  assert.ok(m4Item, 'M4 must appear in admin list');
  assert.equal(m4Item.listingsCount, 3, 'M4 has master + 2 variant listings');
  assert.ok(Number.isInteger(m4Item.stock.available), 'stock.available must be an integer count');
  assert.ok(['in_stock', 'low_stock', 'out_of_stock'].includes(m4Item.stock.health), `health must be a known state, got ${m4Item.stock.health}`);

  // tenant2 holds M5 (1 listing) — visible when scoped to tenant2
  r = await call('/admin/products', { token: tok.admin, tenantId: tenant2.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t2Items = r.body.data;
  const m5Item = t2Items.find((i) => i.id === m5Id);
  assert.ok(m5Item, 'admin must see tenant2 masters when scoped to tenant2');
  assert.equal(m5Item.listingsCount, 1);

  // CSV export must include every row of the tenant (old code silently cut at 200)
  r = await call('/admin/products/export.csv', { token: tok.admin, tenantId: tenant.id, raw: true });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  let csvLines = r.text.trim().split('\n');
  assert.ok(csvLines[0].toLowerCase().includes('title'), 'CSV must have a header');
  assert.ok(csvLines.some((l) => l.includes('Multi Variant Roses')), 'tenant1 CSV must contain M4');
  assert.ok(!csvLines.some((l) => l.includes('Second Store Tulips')), 'tenant1 CSV must not leak tenant2 rows');

  r = await call('/admin/products/export.csv', { token: tok.admin, tenantId: tenant2.id, raw: true });
  csvLines = r.text.trim().split('\n');
  assert.ok(csvLines.some((l) => l.includes('Second Store Tulips')), 'tenant2 CSV must contain M5');
  assert.ok(csvLines.length - 1 >= 1, `tenant2 CSV must export its masters, got ${csvLines.length - 1} rows`);

  // ================= F-10: regex injection in search =================
  section('F-10 hostile search strings return 200, not 500');
  // Bounded: eight hostile strings probed one at a time so each result is attributable.
  for (const evil of ['(', '(a+)+', '[', '*', '.*', '$$$', '\\', 'a|b']) {
    // eslint-disable-next-line no-await-in-loop
    const a = await call(`/catalog/admin/masters?search=${encodeURIComponent(evil)}`, { token: tok.admin });
    assert.equal(a.status, 200, `admin master search "${evil}" must be 200`);
    // Same string on the second surface — sequential keeps the log ordered.
    // eslint-disable-next-line no-await-in-loop
    const b = await call(`/catalog/tenant/listings?search=${encodeURIComponent(evil)}`, { token: tok.vendor });
    assert.equal(b.status, 200, `tenant listing search "${evil}" must be 200`);
  }
  r = await call(`/catalog?search=${encodeURIComponent('(*&|\\')}`, {});
  assert.equal(r.status, 200, `public search "${'(*&|\\)'}" must be 200`);

  // ================= F-17: live role =================
  section('F-17 demoted user loses access on the very next request');
  r = await call('/catalog/admin/categories', { token: tok.adminUser });
  assert.equal(r.status, 200, 'admin role must pass before demotion');
  await User.findByIdAndUpdate(adminUser.id, { role: 'customer' });
  r = await call('/catalog/admin/categories', { token: tok.adminUser });
  assert.equal(r.status, 403, `demoted user must be 403 with the SAME token, got ${r.status}`);
  await User.findByIdAndUpdate(adminUser.id, { role: 'admin' });

  // ================= F-08: category cycles =================
  section('F-08 cycles: blocked on write, tolerated on read');
  r = await call(`/catalog/admin/categories/${catA}`, {
    method: 'PATCH', token: tok.admin, body: { parentId: catC },
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'CATEGORY_CYCLE', 'move-under-descendant must be rejected');
  r = await call(`/catalog/admin/categories/${catA}`, {
    method: 'PATCH', token: tok.admin, body: { parentId: catA },
  });
  assert.equal(r.status, 400, 'self-parent must be rejected');

  // valid re-parent: move B under a new root D; C must be re-leveled
  r = await call('/catalog/admin/categories', {
    method: 'POST', token: tok.admin, body: { name: 'D Store', slug: 'd-store', status: 'active' },
  });
  const catD = r.body.data.id;
  r = await call(`/catalog/admin/categories/${catB}`, {
    method: 'PATCH', token: tok.admin, body: { parentId: catD },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cRow = await Category.findById(catC).lean();
  assert.equal(cRow.level, 2, `descendant level must be recomputed (D=0, B=1, C=2), got ${cRow.level}`);

  // inject a LEGACY cycle directly (A->C->B->A) and prove reads survive
  await Category.updateOne({ _id: catA }, { $set: { parentId: catC } });
  await Category.updateOne({ _id: catB }, { $set: { parentId: catA } });
  await Category.updateOne({ _id: catC }, { $set: { parentId: catB } });
  r = await call('/catalog/categories', {});
  assert.equal(r.status, 200, 'public categories must not 500/hang on a legacy cycle');
  r = await call('/catalog/admin/categories/tree', { token: tok.admin });
  assert.equal(r.status, 200, 'admin tree must not 500/hang on a legacy cycle');

  // ================= F-09 + F-20: soft delete releases keys =================
  section('F-09/F-20 soft delete: brand+category removed softly, slugs re-usable');
  r = await call(`/catalog/admin/brands/${brandId}`, { method: 'DELETE', token: tok.admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const brandRow = await Brand.findById(brandId).select('+isDeleted').lean();
  assert.equal(brandRow.isDeleted, true, 'brand removal must be a SOFT delete');
  assert.ok(await CatalogEvent.exists({ eventType: 'brand_updated', entityId: brandId }), 'brand_updated event must be published');
  assert.ok(await AuditLog.exists({ entityType: 'brand', entityId: brandId }), 'brand deletion must be audited');
  r = await call('/catalog/admin/brands', { token: tok.admin });
  assert.equal(r.status, 200);
  assert.ok(!r.body.data.some((b) => String(b._id) === String(brandId)), 'deleted brand must not be listed');

  // F-20: build the REAL unique indexes (hermetic boots with autoIndex:false)
  // and prove the partial index both (a) still enforces uniqueness among LIVE
  // rows and (b) releases the key on soft delete.
  await Brand.syncIndexes();
  await Category.syncIndexes();

  // (a) two LIVE brands with the same slug → 409 (unique index enforced)
  await Brand.create({ tenantId: tenant.id, name: 'DupSlug', slug: 'dup-slug', status: 'active' });
  r = await call('/catalog/admin/brands', {
    method: 'POST', token: tok.admin, body: { name: 'DupSlug 2', slug: 'dup-slug' },
  });
  assert.equal(r.status, 409, `live duplicate slug must 409 (unique index), got ${r.status}: ${JSON.stringify(r.body)}`);

  // (b) the deleted brand's slug is RELEASED — re-creation must succeed
  // (the old full-unique index would 409 against the ghost row)
  r = await call('/catalog/admin/brands', {
    method: 'POST', token: tok.admin, body: { name: 'RoseVille Reborn', slug: 'roseville' },
  });
  assert.equal(r.status, 201, `deleted brand's slug must be re-usable, got ${r.status}: ${JSON.stringify(r.body)}`);

  // same for categories: D has no children now (B moved into the cycle)
  r = await call(`/catalog/admin/categories/${catD}`, { method: 'DELETE', token: tok.admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('/catalog/admin/categories', {
    method: 'POST', token: tok.admin, body: { name: 'D Store Reborn', slug: 'd-store' },
  });
  assert.equal(r.status, 201, `deleted category's slug must be re-usable, got ${r.status}: ${JSON.stringify(r.body)}`);

  // ================= F-06: deprecated master vanishes publicly =================
  section('F-06 deprecated master: PDP 404, PLP hidden');
  r = await call(`/catalog/products/${m1Id}`, {});
  assert.equal(r.status, 200, 'PDP must exist before deprecation');
  r = await call(`/catalog/admin/masters/${m1Id}/deprecate`, {
    method: 'POST', token: tok.admin, body: { note: 'Season over' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const l1Row = await TenantProduct.findById(L1).lean();
  assert.equal(l1Row.status, 'inactive', 'deprecation must cascade the listing to INACTIVE');
  await drain();
  r = await call(`/catalog/products/${m1Id}`, {});
  assert.equal(r.status, 404, 'PDP of a deprecated master must 404');
  assert.equal(r.body.code, 'PRODUCT_NOT_FOUND');
  r = await call('/catalog?search=smuggled', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 0, 'deprecated master must vanish from the public PLP');

  // ================= F-01: response cache isolation + invalidation =================
  section('F-01 response cache: per-user keying + write invalidation');
  await drain();
  invalidateAll();
  const url = '/catalog?search=variant';
  const rA1 = await call(url, { token: tok.custA });
  assert.equal(rA1.status, 200);
  assert.equal(rA1.headers.get('x-cache'), 'MISS');
  assert.ok((rA1.body.data || []).some((p) => p.product?.title === 'Multi Variant Roses'), 'search must find M4 before the write');
  const rB1 = await call(url, { token: tok.custB });
  assert.equal(rB1.status, 200);
  assert.equal(rB1.headers.get('x-cache'), 'MISS', 'user B must NOT hit user A\'s cache entry');
  const rA2 = await call(url, { token: tok.custA });
  assert.equal(rA2.headers.get('x-cache'), 'HIT', 'user A\'s repeat must be a cache hit');

  // a write (tenant1 price change on the master-level listing) must
  // invalidate the cache process-wide
  r = await call(`/catalog/tenant/listings/${Lm}/price`, {
    method: 'PATCH', token: tok.vendor,
    body: { price: { mrp: 200, sellingPrice: 99 }, expectedVersion: (await TenantProduct.findById(Lm).lean()).version, reason: 'promotion' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await drain();
  const rA3 = await call(url, { token: tok.custA });
  assert.equal(rA3.headers.get('x-cache'), 'MISS', 'cache must be invalidated after a catalog write');
  const hit99 = (rA3.body.data || []).some((p) => p.price?.sellingPrice === 99);
  assert.ok(hit99, 'post-invalidation read must reflect the new price');

  // ================= final: outbox settled, audit present =================
  section('final: outbox fully drained, audit trail recorded');
  await drain();
  const unsettled = await CatalogEvent.countDocuments({ status: { $ne: 'published' } });
  assert.equal(unsettled, 0, 'every outbox event must be published');
  const audits = await AuditLog.countDocuments({});
  assert.ok(audits >= 15, `expected >= 15 audit entries, got ${audits}`);

  console.log(`\n✅ ALL CATALOG-FIXES ADVERSARIAL TESTS PASSED (${passed} sections)`);
  server.close();
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
  process.exit(0);
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error('❌', err);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    try { await stopHermeticMongo(mongod); } catch { /* noop */ }
    process.exit(1);
  }
}
run();
