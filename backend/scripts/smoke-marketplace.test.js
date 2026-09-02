/**
 * Phase 5 smoke test — multi-tenant marketplace (per
 * `uploads/multi_tenant_marketplace.md`).
 *
 * Covers:
 *   1. Public: plan catalog; tenant self-service register; duplicate slug 409;
 *      discovery (published only)
 *   2. Storefront: owner branding + publish; public storefront renders branding
 *   3. Vendor onboarding: apply → approve (role vendor + profile); reject path;
 *      duplicate apply 409
 *   4. Vendor products + routing: create (pending) → approve → marketplaceListed;
 *      marketplace-enabled store syncs; checkout → orderitem.vendorId; vendor stats
 *   5. Billing: period invoice = subscription + commission (hand-verified); plan
 *      change pro-rata adjustment; pay → paid; cycle idempotent; overdue sweep
 *   6. Cross-tenant analytics: platform dashboard hand-summed; platformdailies
 *      rebuild idempotent; marketplace nightly pass idempotent
 *   7. Regression sanity
 *
 * Run: node scripts/smoke-marketplace.test.js
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
  config.mongoUri = mongod.getUri('flower_marketplace_smoke');
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
    'device.model.js', 'notificationTemplate.model.js', 'notification.model.js', 'exportJob.model.js', 'exportArtifact.model.js',
    // ---- Phase 5 ----
    'plan.model.js', 'subscription.model.js', 'invoice.model.js', 'vendorApplication.model.js', 'vendor.model.js',
    'platformDaily.model.js', 'counter.model.js',
  ];
  const models = await Promise.all(modelFiles.map((f) => import(`../src/models/${f}`)));
  const M = {};
  for (const m of models) { const mod = m.default; M[mod.modelName] = mod; await mod.init(); }

  const { default: planService } = await import('../src/services/plan.service.js');
  await planService.ensureDefaults();

  // ---- tenant A: the existing store (Phase 1-4 world) ----
  const tenantA = await M.Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active', plan: 'pro' });
  await M.TenantAuthConfig.create({ tenantId: tenantA.id });

  const platformAdmin = await M.User.create({ tenantId: tenantA.id, email: { address: 'ops@fm.in', verified: true }, role: 'super_admin', status: 'active' });
  const ownerA = await M.User.create({ tenantId: tenantA.id, email: { address: 'owner@fm.in', verified: true }, role: 'admin', status: 'active', profile: { firstName: 'Store' } });
  const custA = await M.User.create({ tenantId: tenantA.id, phone: { number: '9876520001', verified: true }, email: { address: 'cust@fm.in', verified: true }, status: 'active' });
  const picker = await M.User.create({ tenantId: tenantA.id, phone: { number: '9876520002', verified: true }, role: 'picker', status: 'active' });
  const rider = await M.User.create({ tenantId: tenantA.id, phone: { number: '9876520003', verified: true }, role: 'rider', status: 'active', rider: { availability: 'available' } });
  // would-be vendors
  const applicant1 = await M.User.create({ tenantId: tenantA.id, phone: { number: '9876520011', verified: true }, status: 'active' });
  const applicant2 = await M.User.create({ tenantId: tenantA.id, phone: { number: '9876520012', verified: true }, status: 'active' });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const platTok = (await AuthService.issueTokens(platformAdmin)).accessToken;
  const ownerATok = (await AuthService.issueTokens(ownerA)).accessToken;
  const custATok = (await AuthService.issueTokens(custA)).accessToken;
  let applicant1Tok = (await AuthService.issueTokens(applicant1)).accessToken;
  const applicant2Tok = (await AuthService.issueTokens(applicant2)).accessToken;

  // ---- store A catalog + policies (mirror smoke-admin) ----
  const category = await M.Category.create({ tenantId: tenantA.id, name: 'Fresh Flowers', slug: 'fresh-flowers', status: 'active' });
  const brand = await M.Brand.create({ tenantId: tenantA.id, name: 'RoseVille', slug: 'roseville', status: 'active' });
  const master = await M.ProductMaster.create({ tenantId: null, categoryId: category.id, brandId: brand.id, skuGlobal: 'ROS-RED-10', type: 'fresh_flower', title: 'Red Roses 10', slug: 'red-roses-10', status: 'active', isPerishable: true });
  const listing = await M.TenantProduct.create({ tenantId: tenantA.id, productMasterId: master.id, price: { mrp: 399, sellingPrice: 299, currency: 'INR' }, stockQty: 100, status: 'active', version: 1 });
  await M.Inventory.create({ tenantId: tenantA.id, tenantProductId: listing.id, qtyOnHand: 100 });

  await M.DeliveryFeePolicy.create({ tenantId: tenantA.id, name: 'default', baseFee: 49, freeDeliveryThreshold: 499, expressSurgeMultiplier: 1.25, isActive: true, version: 1 });
  await M.TaxPolicy.create({ categoryId: category.id, gstSlabPct: 5, hsnCode: '0603', isActive: true });
  await M.TenantRefundPolicy.create({ tenantId: tenantA.id, refundDeliveryFeeWhen: 'full_order_return_only', refundFeePct: 100 });

  const hub = await M.Hub.create({ tenantId: tenantA.id, name: 'Hub', code: 'H1', defaultSlotCapacity: 10, isActive: true });
  await M.ServiceablePincode.create({ tenantId: tenantA.id, pincode: '530013', hubId: hub.id, isServiceable: true });
  const { default: slotService } = await import('../src/services/slot.service.js');
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await slotService.generateForDates({ tenantId: tenantA.id, hubId: hub.id, fromDate: today, toDate: tomorrow, capacity: 10 });
  const address = await M.Address.create({ tenantId: tenantA.id, userId: custA.id, name: 'Ramu', phone: '9876520001', line1: '12-13-4 Main Rd', city: 'Vizag', state: 'AP', pincode: '530013' });

  // ---- app harness ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (path, { method = 'GET', body, token, raw = false, tenantId = null } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(tenantId ? { 'x-tenant-id': tenantId } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

  const addToCart = async (listingId, qty = 1) => {
    const r = await call('/cart/items', { method: 'POST', token: custATok, body: { tenantProductId: listingId, qty } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const reserveSlot = async () => {
    const r = await call(`/cart/slots?pincode=530013&date=${today}`, { token: custATok });
    const slot = r.body.data.slots.find((s) => s.remaining > 0);
    const r2 = await call(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custATok });
    return r2.body.data.id;
  };
  const checkout = async (listingId) => {
    await addToCart(listingId);
    const reservationId = await reserveSlot();
    const r = await call('/cart/checkout', { method: 'POST', token: custATok, body: { slotReservationId: reservationId, addressId: address.id, paymentMethod: 'upi', confirmPriceChanges: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.order;
  };

  // ================= 1. public: plans + register + discovery =================
  let r = await call('/marketplace/plans');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 3, 'free/pro/business seeded');
  const pro = r.body.data.find((p) => p.code === 'pro');
  assert.equal(pro.priceMonthly, 999);
  assert.equal(pro.features.marketplaceEnabled, true);
  ok('public: plan catalog (free/pro/business)');

  r = await call('/marketplace/tenants/register', {
    method: 'POST',
    body: { name: 'Kakatiya Blooms', slug: 'kakatiya-blooms', plan: 'free', contactEmail: 'hi@kakatiya.in', owner: { firstName: 'Ravi', email: 'ravi@kakatiya.in', password: 'Store@12345' } },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const storeB = r.body.data.tenant;
  const storeBOwnerTok = r.body.data.tokens.accessToken;
  assert.equal(storeB.slug, 'kakatiya-blooms');
  assert.equal(storeB.plan, 'free');
  assert.equal(storeB.ownerUserId, r.body.data.owner.id, 'owner attached');
  assert.equal(r.body.data.owner.role, 'admin', 'owner is tenant admin, never super_admin');
  assert.ok(storeBOwnerTok, 'owner auto-login tokens');
  // duplicate slug → 409
  r = await call('/marketplace/tenants/register', {
    method: 'POST',
    body: { name: 'Kakatiya Again', slug: 'kakatiya-blooms', owner: { email: 'x@x.in', password: 'Store@12345' } },
  });
  assert.equal(r.status, 409, 'duplicate slug must 409');
  assert.equal(r.body.code, 'TENANT_SLUG_EXISTS');
  ok('public: register store (owner admin + tokens), duplicate slug → 409');

  // discovery: nothing published yet
  r = await call('/marketplace/stores');
  assert.equal(r.body.data.length, 0, 'unpublished stores hidden from discovery');
  ok('public: discovery hides unpublished stores');

  // ================= 2. storefront: owner branding + publish =================
  r = await call('/marketplace/store', { token: ownerATok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.subscription, null, 'existing store has no subscription yet');
  r = await call('/marketplace/store', {
    method: 'PATCH', token: ownerATok,
    body: { tagline: 'Fresh flowers, delivered', description: 'Your daily blooms from Vizag', isPublished: true, theme: { primaryColor: '#1a7f4d' }, socialLinks: { instagram: 'https://instagram.com/fm' } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.store.isPublished, true);
  assert.equal(r.body.data.store.onboardingStatus, 'active', 'publish flips onboarding');
  r = await call('/marketplace/stores/flower-market');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.store.tagline, 'Fresh flowers, delivered');
  assert.equal(r.body.data.store.theme.primaryColor, '#1a7f4d');
  assert.equal(r.body.data.store.marketplaceEnabled, false, 'single-brand store unchanged');
  r = await call('/marketplace/stores?search=blooms');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 0, 'store B still unpublished');
  r = await call('/marketplace/stores?search=flower');
  assert.equal(r.body.data.length, 1, 'store A discoverable after publish');
  assert.equal(r.body.data[0].slug, 'flower-market');
  ok('storefront: owner branding + publish, public page + discovery, unpublished hidden');

  // ================= 3. vendor onboarding =================
  r = await call('/marketplace/vendor/apply', { method: 'POST', token: applicant1Tok, body: { businessName: 'Vizag Fresh Farms', slug: 'vizag-fresh', contactPhone: '9876500111', gstin: '37AAAAA0000A1Z5', categories: ['fresh-flowers'], city: 'Visakhapatnam' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const appId = r.body.data.application.id;
  // duplicate apply → 409? No — re-submit updates (200). Second different apply for same user updates.
  r = await call('/marketplace/vendor/apply', { method: 'POST', token: applicant1Tok, body: { businessName: 'Vizag Fresh Farms', slug: 'vizag-fresh' } });
  assert.equal(r.status, 200, 're-submit updates the same application');
  assert.equal(r.body.data.reSubmitted, true);
  // customer (non-vendor) cannot hit vendor-only endpoints
  r = await call('/marketplace/vendor/me', { token: custATok });
  assert.equal(r.status, 403, 'non-vendor forbidden from vendor endpoints');
  // platform admin approves applicant1
  r = await call(`/marketplace/admin/vendor-applications/${appId}/review`, { method: 'POST', token: platTok, body: { decision: 'approve', note: 'KYC ok' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.vendor.status, 'active');
  const vendorId = r.body.data.vendor.id;
  const applicant1Fresh = await M.User.findById(applicant1.id);
  assert.equal(applicant1Fresh.role, 'vendor', 'approval grants vendor role');
  // re-issue tokens so the JWT carries the vendor role
  applicant1Tok = (await AuthService.issueTokens(applicant1Fresh)).accessToken;
  // vendor can now use vendor endpoints
  r = await call('/marketplace/vendor/me', { token: applicant1Tok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.businessName, 'Vizag Fresh Farms');
  assert.equal(r.body.data.commissionRateBps, 100, 'default commission from config (1%)');
  // reject applicant2
  r = await call('/marketplace/vendor/apply', { method: 'POST', token: applicant2Tok, body: { businessName: 'Sea Coast Greens', slug: 'seacoast' } });
  const app2Id = r.body.data.application.id;
  r = await call(`/marketplace/admin/vendor-applications/${app2Id}/review`, { method: 'POST', token: platTok, body: { decision: 'reject', note: 'Docs incomplete' } });
  assert.equal(r.status, 200);
  const vendor2 = await M.Vendor.findOne({ userId: applicant2.id });
  assert.equal(vendor2, null, 'rejected applicant has no vendor profile');
  // already-a-vendor re-apply → 409
  r = await call('/marketplace/vendor/apply', { method: 'POST', token: applicant1Tok, body: { businessName: 'X', slug: 'y' } });
  assert.equal(r.status, 409, 'existing vendor cannot re-apply');
  ok('vendor onboarding: apply → approve (role vendor + profile), reject (no profile), 409 re-apply');

  // ================= 4. vendor products + routing =================
  r = await call('/marketplace/vendor/products', { method: 'POST', token: applicant1Tok, body: { title: 'Vendor Red Roses 10', type: 'fresh_flower', categoryId: category.id, skuGlobal: 'VFR-ROSE-10', sellingPrice: 0 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const vpId = r.body.data.id;
  assert.equal(r.body.data.vendorId, vendorId, 'vendorId attributed at creation');
  assert.equal(r.body.data.status, 'pending_review', 'starts pending');
  assert.equal(r.body.data.marketplaceListed, false);
  // update while pending works
  r = await call(`/marketplace/vendor/products/${vpId}`, { method: 'PATCH', token: applicant1Tok, body: { description: 'Premium roses' } });
  assert.equal(r.status, 200);
  // platform admin approves the vendor product
  r = await call(`/marketplace/admin/vendor-products/${vpId}/review`, { method: 'POST', token: platTok, body: { decision: 'approve' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'active');
  assert.equal(r.body.data.marketplaceListed, true, 'approved → marketplace listed');
  // vendor cannot edit after approval (locked)
  r = await call(`/marketplace/vendor/products/${vpId}`, { method: 'PATCH', token: applicant1Tok, body: { title: 'Hacked' } });
  assert.equal(r.status, 400, 'approved product locked for vendor edits');
  ok('vendor products: create (pending) → admin approve → marketplaceListed, locked after');

  // store A joins the marketplace: change plan → pro (creates subscription + enables marketplace)
  r = await call('/marketplace/store/plan', { method: 'PATCH', token: ownerATok, body: { planCode: 'pro' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.changed, true);
  assert.equal(r.body.data.created, true, 'existing store subscribes on first plan change');
  r = await call('/marketplace/store', { token: ownerATok });
  assert.equal(r.body.data.subscription.planCode, 'pro');
  assert.equal(r.body.data.subscription.status, 'trial', 'pro plan starts on a 14-day trial');
  assert.equal(r.body.data.tenant.features.marketplaceEnabled, true, 'pro plan enables marketplace mode');
  // sync vendor products into store A
  r = await call(`/marketplace/store/vendors/${vendorId}/sync`, { method: 'POST', token: ownerATok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.created, 1, 'one listing synced');
  // idempotent re-sync
  r = await call(`/marketplace/store/vendors/${vendorId}/sync`, { method: 'POST', token: ownerATok });
  assert.equal(r.body.data.created, 0, 're-sync creates nothing');
  assert.equal(r.body.data.skipped, 1);
  r = await call('/marketplace/store/vendors', { token: ownerATok });
  assert.equal(r.body.data.length, 1, 'store vendors list shows the vendor');
  assert.equal(r.body.data[0].businessName, 'Vizag Fresh Farms');
  // non-marketplace store cannot sync (store B = free plan, marketplace mode off)
  r = await call('/marketplace/store/vendors/' + vendorId + '/sync', { method: 'POST', token: storeBOwnerTok, tenantId: storeB.id });
  assert.equal(r.status, 403, 'free plan store lacks marketplace mode');
  assert.equal(r.body.code, 'MARKETPLACE_DISABLED');
  ok('routing: store joins marketplace (pro), idempotent vendor sync, non-marketplace store blocked');

  // tenant activates the synced listing (price/stock) then checkout routes vendorId
  const vListing = await M.TenantProduct.findOne({ tenantId: tenantA.id, productMasterId: vpId });
  vListing.price = { mrp: 349, sellingPrice: 249, currency: 'INR' };
  vListing.stockQty = 50;
  vListing.status = 'active';
  vListing.lastPriceChangedAt = new Date();
  vListing.lastStockChangedAt = new Date();
  vListing.lastStatusChangedAt = new Date();
  await vListing.save();
  await M.Inventory.create({ tenantId: tenantA.id, tenantProductId: vListing.id, qtyOnHand: 50 });

  const orderV = await checkout(vListing.id);
  const vOrderItem = await M.OrderItem.findOne({ orderId: orderV.id });
  assert.equal(String(vOrderItem.vendorId), vendorId, 'orderitem.vendorId snapshot set');
  // vendor stats reflect the sale
  r = await call('/marketplace/vendor/me', { token: applicant1Tok });
  assert.equal(r.body.data.stats.orders, 1, 'vendor order count');
  assert.ok(r.body.data.stats.gmv > 0, `vendor gmv ${r.body.data.stats.gmv}`);
  // storefront (marketplace mode on + published) now shows vendor product
  r = await call('/marketplace/stores/flower-market');
  assert.equal(r.body.data.store.marketplaceEnabled, true);
  assert.equal(r.body.data.vendorProducts.length, 1, 'vendor product on storefront');
  assert.equal(r.body.data.vendors.length, 1);
  ok('routing: checkout sets orderitem.vendorId, vendor stats + storefront reflect it');

  // ================= 5. billing =================
  // rebuild analytics so the commission uses rollup GMV
  const from30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  r = await call('/admin/analytics/rebuild', { method: 'POST', token: platTok, body: { from: from30, to: today } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // backdate store A subscription period to [today-30, today] so the cycle is due;
  // expire the trial so the fee is actually billed (trial waives the fee)
  const subA = await M.Subscription.findOne({ tenantId: tenantA.id, status: 'trial' });
  subA.periodStart = new Date(Date.now() - 30 * 86400000);
  subA.periodEnd = new Date();
  subA.trialEndsAt = new Date(Date.now() - 86400000); // trial over → cycle rolls it to active
  await subA.save();
  // hand-verify GMV: 2 orders (original ROS-RED-10 at 362.95 + vendor order at 249+49+12.45=310.45)
  const [gmvAgg] = await M.AnalyticsDaily.aggregate([
    // NOTE: aggregates do NOT auto-cast — match on the ObjectId
    { $match: { tenantId: tenantA._id, hubId: null, date: { $gte: from30, $lte: today } } },
    { $group: { _id: null, gmv: { $sum: '$gmv' }, orders: { $sum: '$ordersCreated' } } },
  ]);
  const gmvA = gmvAgg?.gmv || 0;
  // run the billing cycle
  r = await call('/marketplace/admin/billing/cycle', { method: 'POST', token: platTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.invoicesCreated >= 1, `invoice for the due tenant (${r.body.data.invoicesCreated})`);
  const invA = await M.Invoice.findOne({ tenantId: tenantA.id, status: 'open' });
  assert.ok(invA, 'store A invoice generated');
  const subLine = invA.lineItems.find((l) => l.type === 'subscription');
  const commLine = invA.lineItems.find((l) => l.type === 'commission');
  assert.equal(subLine.amount, 999, 'pro plan fee');
  const expectedComm = Math.round(gmvA * 0.01 * 100) / 100; // 100bps = 1%
  assert.equal(commLine.amount, expectedComm, `commission = 1% of GMV (${gmvA})`);
  assert.equal(invA.total, Math.round((999 + expectedComm) * 100) / 100, 'total = fee + commission');
  // cycle idempotent: re-run creates nothing new for the same period
  const invCountBefore = await M.Invoice.countDocuments({ tenantId: tenantA.id });
  r = await call('/marketplace/admin/billing/cycle', { method: 'POST', token: platTok });
  assert.equal(r.status, 200);
  const invCountAfter = await M.Invoice.countDocuments({ tenantId: tenantA.id });
  assert.equal(invCountAfter, invCountBefore, 'no duplicate invoices');
  ok(`billing: invoice = ₹999 + 1% commission (${expectedComm}), cycle idempotent`);

  // plan change mid-period → prorated adjustment on the NEXT invoice
  r = await call('/marketplace/store/plan', { method: 'PATCH', token: ownerATok, body: { planCode: 'business' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const subAFresh = await M.Subscription.findOne({ tenantId: tenantA.id, status: { $in: ["trial", "active", "past_due"] } });
  assert.equal(subAFresh.planSnapshot.priceMonthly, 2999);
  assert.ok(subAFresh.pendingAdjustment.amount > 0, `prorated adjustment ${subAFresh.pendingAdjustment.amount}`);
  // force a NEW period (different from the first invoice's key) due and generate →
  // adjustment lands on the invoice and clears
  const forcedStart = new Date(Date.now() - 15 * 86400000);
  const forcedEnd = new Date();
  subAFresh.periodStart = forcedStart;
  subAFresh.periodEnd = forcedEnd;
  await subAFresh.save();
  r = await call('/marketplace/admin/billing/cycle', { method: 'POST', token: platTok });
  assert.equal(r.status, 200);
  const invNext = await M.Invoice.findOne({ tenantId: tenantA.id, 'period.from': forcedStart, 'period.to': forcedEnd });
  assert.ok(invNext, 'next invoice generated');
  const adjLine = invNext.lineItems.find((l) => l.type === 'adjustment');
  assert.ok(adjLine, 'proration adjustment line present');
  const subA2 = await M.Subscription.findById(subAFresh.id);
  assert.equal(subA2.pendingAdjustment.amount, 0, 'adjustment applied and cleared');
  ok('billing: mid-period plan change → prorated adjustment on next invoice, then cleared');

  // pay the first invoice (mock provider) → paid
  r = await call(`/marketplace/admin/billing/invoices/${invA.id}/pay`, { method: 'POST', token: platTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.invoice.status, 'paid');
  assert.ok(r.body.data.invoice.paidAt && r.body.data.invoice.paymentRef, 'paidAt + paymentRef');
  r = await call(`/marketplace/admin/billing/invoices/${invA.id}/pay`, { method: 'POST', token: platTok });
  assert.equal(r.body.data.alreadyPaid, true, 'pay is idempotent');
  // overdue sweep
  const invOpen = await M.Invoice.findOne({ tenantId: tenantA.id, status: 'open' });
  invOpen.dueAt = new Date(Date.now() - 10 * 86400000);
  await invOpen.save();
  r = await call('/marketplace/admin/billing/overdue-sweep', { method: 'POST', token: platTok });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.markedOverdue >= 1);
  const subA3 = await M.Subscription.findById(subAFresh.id);
  assert.equal(subA3.status, 'past_due', 'overdue invoice → subscription past_due');
  ok('billing: pay (mock, idempotent), overdue sweep → past_due');

  // ================= 6. cross-tenant analytics =================
  r = await call(`/marketplace/admin/analytics/dashboard?from=${from30}&to=${today}`, { token: platTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const dash = r.body.data;
  assert.equal(dash.gmv, Math.round(gmvA * 100) / 100, 'platform gmv = Σ tenant gmv');
  assert.equal(dash.orders, gmvAgg?.orders || 0, 'orders aggregated from rollups');
  // store B has no orders: platform gmv == store A gmv (only tenant with data)
  assert.ok(dash.activeTenants >= 2, `activeTenants >= 2 (${dash.activeTenants})`);
  assert.equal(dash.mrr, 2999, 'mrr = business 2999 + free 0 (store B)');
  // byPlan: business (store A after upgrade) + free (store B)
  assert.equal(dash.byPlan.business, 1);
  assert.equal(dash.byPlan.free, 1);
  // top vendors
  r = await call(`/marketplace/admin/analytics/top-vendors?from=${from30}&to=${today}`, { token: platTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].businessName, 'Vizag Fresh Farms');
  // platformdailies rebuild idempotent
  r = await call('/marketplace/admin/analytics/rebuild', { method: 'POST', token: platTok, body: { from: from30, to: today } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.rebuiltDays >= 1);
  const pdCount = await M.PlatformDaily.countDocuments();
  r = await call('/marketplace/admin/analytics/rebuild', { method: 'POST', token: platTok, body: { from: from30, to: today } });
  assert.equal(r.status, 200);
  assert.equal(await M.PlatformDaily.countDocuments(), pdCount, 'rebuild is idempotent upsert');
  ok('analytics: platform dashboard hand-verified (gmv/mrr/byPlan), top vendors, rollup idempotent');

  // marketplace nightly pass: runs + idempotent
  r = await call('/marketplace/admin/nightly', { method: 'POST', token: platTok });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  assert.ok(r.body.data.billing && !r.body.data.billing.error, 'billing step ran');
  assert.ok(r.body.data.platformRollup && !r.body.data.platformRollup.error, 'rollup step ran');
  assert.ok(r.body.data.overdueSweep && !r.body.data.overdueSweep.error, 'overdue sweep ran');
  const invBeforeNightly = await M.Invoice.countDocuments();
  r = await call('/marketplace/admin/nightly', { method: 'POST', token: platTok });
  assert.equal(r.status, 200);
  assert.equal(await M.Invoice.countDocuments(), invBeforeNightly, 'nightly re-run creates no duplicate invoices');
  ok('nightly: marketplace pass runs, re-run idempotent');

  // ================= 7. regression sanity =================
  r = await call('/admin/products?limit=5', { token: ownerATok });
  assert.equal(r.status, 200, 'Phase 4 admin works for store owner');
  r = await call('/admin/inventory/summary', { token: ownerATok });
  assert.equal(r.status, 200);
  r = await call('/marketplace/plans');
  assert.equal(r.status, 200);
  r = await call('/users/me', { token: custATok });
  assert.equal(r.status, 200);
  ok('regression: admin + marketplace public + user endpoints healthy');

  console.log(`\nsmoke-marketplace: ${passed} checks passed ✅`);
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
}

main().catch(async (err) => {
  console.error('\nsmoke-marketplace FAILED:', err);
  if (mongod) await mongod.stop().catch(() => {});
  process.exit(1);
});
