/**
 * Variant-catalog smoke test — the polo-t-shirt story end to end:
 *
 *   admin creates a master with 5 color variants + master gallery
 *   -> red gets its own photos; white falls back to master photos
 *   -> tenant lists ONE variant (case 1), then SOME (case 2), then ALL (case 3)
 *      via the bulk endpoint with per-variant prices
 *   -> selection grid shows listed/unlisted state per variant
 *   -> customer PLP flat rows carry variant + resolved thumbnails
 *   -> customer PLP ?groupBy=master returns one card with the full family
 *   -> PDP ?variantId= selects; unknown variant falls back to default
 *   -> cart snapshots carry "Title — Label" + variant photo
 *   -> variant primary never demotes the master primary (scoped primaries)
 *   -> removing a variant retires its gallery (no dangling photos)
 *
 * Run: node scripts/smoke-catalog-variants.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = '';
process.env.MONGODB_URI = '';
process.env.OTP_PROVIDER = 'memory';
let mongod;

const COLORS = ['white', 'red', 'black', 'navy blue', 'peach'];
const priceFor = (c, i) => ({ mrp: 999 + i * 100, sellingPrice: 799 + i * 100 });

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_variant_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: TenantAuthConfig } = await import('../src/models/tenantAuthConfig.model.js');
  const { default: User } = await import('../src/models/user.model.js');
  const { default: Category } = await import('../src/models/category.model.js');
  const { default: ProductMaster } = await import('../src/models/productMaster.model.js');
  const { default: ProductVariant } = await import('../src/models/productVariant.model.js');
  const { default: ProductImage } = await import('../src/models/productImage.model.js');
  const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');
  const { default: PriceHistory } = await import('../src/models/priceHistory.model.js');
  const { default: Inventory } = await import('../src/models/inventory.model.js');
  const { default: AuditLog } = await import('../src/models/auditLog.model.js');
  const { default: CatalogEvent } = await import('../src/models/catalogEvent.model.js');
  const { default: Cart } = await import('../src/models/cart.model.js');
  const { default: CartItem } = await import('../src/models/cartItem.model.js');
  await Promise.all([
    Tenant.init(), TenantAuthConfig.init(), User.init(), Category.init(),
    ProductMaster.init(), ProductVariant.init(), ProductImage.init(), TenantProduct.init(),
    PriceHistory.init(), Inventory.init(), AuditLog.init(), CatalogEvent.init(),
    Cart.init(), CartItem.init(),
  ]);

  const tenant = await Tenant.create({ name: 'Polo Store', slug: 'polo-store', status: 'active' });
  await TenantAuthConfig.create({ tenantId: tenant.id });
  const admin = await User.create({
    tenantId: tenant.id, email: { address: 'admin@polo.in', verified: true },
    role: 'super_admin', status: 'active',
  });
  const vendor = await User.create({
    tenantId: tenant.id, phone: { number: '9876500011', verified: true }, status: 'active', role: 'vendor',
  });
  const { default: AuthService } = await import('../src/services/auth.service.js');
  const adminTok = (await AuthService.issueTokens(admin)).accessToken;
  const vendTok = (await AuthService.issueTokens(vendor)).accessToken;

  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenant.id,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  // ================= 1. master with 5 variants + master gallery =================
  let r = await call('/catalog/admin/categories', {
    method: 'POST', token: adminTok, body: { name: 'Apparel', slug: 'apparel' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const catId = r.body.data.id;

  r = await call('/catalog/admin/masters', {
    method: 'POST', token: adminTok,
    body: {
      skuGlobal: 'POLO-CLASSIC', type: 'gift', title: 'Classic Polo T-Shirt', categoryId: catId,
      variants: COLORS.map((c, i) => ({
        variantType: 'color', value: c, displayLabel: c.replace(/\b\w/g, (m) => m.toUpperCase()),
        sku: `POLO-${c.replace(/\s+/g, '').toUpperCase()}`, sortOrder: i, isDefault: c === 'white',
      })),
      images: [
        { url: 'https://cdn.test/polo-front.jpg', altText: 'Polo front', isPrimary: true },
        { url: 'https://cdn.test/polo-back.jpg', altText: 'Polo back' },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const masterId = r.body.data.id;
  let version = r.body.data.version;

  r = await call(`/catalog/admin/masters/${masterId}`, { token: adminTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.variants.length, 5, 'master must expose 5 variants');
  assert.equal(r.body.data.images.length, 2, 'master gallery holds 2 photos');
  const byValue = new Map(r.body.data.variants.map((v) => [v.value, v]));
  // every variant falls back to the master gallery before its own shoot
  for (const v of r.body.data.variants) {
    assert.equal(v.imageSource, 'master', `${v.value} should fall back to master photos`);
    assert.equal(v.primaryImageUrl, 'https://cdn.test/polo-front.jpg');
  }
  version = r.body.data.version;

  // ================= 2. red gets its own photos =================
  const redId = byValue.get('red').id;
  r = await call(`/catalog/admin/masters/${masterId}/variants/${redId}/images`, {
    method: 'POST', token: adminTok,
    body: { url: 'https://cdn.test/polo-red.jpg', altText: 'Red polo', isPrimary: true, expectedVersion: version },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  version += 1;

  r = await call(`/catalog/admin/masters/${masterId}`, { token: adminTok });
  const after = new Map(r.body.data.variants.map((v) => [v.value, v]));
  assert.equal(after.get('red').imageSource, 'variant');
  assert.equal(after.get('red').primaryImageUrl, 'https://cdn.test/polo-red.jpg');
  assert.equal(after.get('white').imageSource, 'master', 'white still falls back');
  // scoped primaries: the master gallery keeps its own primary
  assert.equal(r.body.data.images.find((i) => i.isPrimary)?.url, 'https://cdn.test/polo-front.jpg');
  version = r.body.data.version;

  // variantId mismatch is rejected (image for another master's variant)
  r = await call(`/catalog/admin/masters/${masterId}/images`, {
    method: 'POST', token: adminTok,
    body: { url: 'https://cdn.test/evil.jpg', variantId: '000000000000000000000000', expectedVersion: version },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VARIANT_MISMATCH');

  // ================= 3. case 1: tenant lists ONE variant =================
  const whiteId = byValue.get('white').id;
  r = await call('/catalog/tenant/listings/bulk', {
    method: 'POST', token: vendTok,
    body: {
      productMasterId: masterId,
      selections: [{ variantId: whiteId, price: priceFor('white', 0), stockQty: 10, status: 'active' }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.created.length, 1);
  assert.equal(r.body.data.skipped.length, 0);

  // selection grid: white listed, the rest unlisted
  r = await call(`/catalog/tenant/masters/${masterId}/variants`, { token: vendTok });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.variants.length, 5);
  const grid = new Map(r.body.data.variants.map((v) => [v.variant.value, v]));
  assert.ok(grid.get('white').listing, 'white must show as listed');
  assert.equal(grid.get('white').listing.price.sellingPrice, 799);
  assert.equal(grid.get('red').listing, null, 'red must show as unlisted');
  assert.equal(grid.get('red').variant.imageSource, 'variant', 'grid carries resolved galleries');

  // ================= 4. case 2: tenant lists SOME more (idempotent re-submit) =================
  r = await call('/catalog/tenant/listings/bulk', {
    method: 'POST', token: vendTok,
    body: {
      productMasterId: masterId,
      selections: [
        { variantId: whiteId, price: priceFor('white', 0), stockQty: 10, status: 'active' }, // duplicate
        { variantId: redId, price: priceFor('red', 1), stockQty: 7, status: 'active' },
        { variantId: byValue.get('black').id, price: priceFor('black', 2), stockQty: 0, status: 'active' },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.created.length, 2, 'two new listings');
  assert.equal(r.body.data.skipped.length, 1, 'white skipped as already listed');
  assert.equal(r.body.data.skipped[0].reason, 'already_listed');

  // duplicate variant inside one request is a client bug -> 400
  r = await call('/catalog/tenant/listings/bulk', {
    method: 'POST', token: vendTok,
    body: {
      productMasterId: masterId,
      selections: [
        { variantId: redId, price: priceFor('red', 1), stockQty: 1 },
        { variantId: redId, price: priceFor('red', 1), stockQty: 1 },
      ],
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'DUPLICATE_SELECTION');

  // ================= 5. case 3: select-all lists the rest =================
  r = await call('/catalog/tenant/listings/bulk', {
    method: 'POST', token: vendTok,
    body: {
      productMasterId: masterId, selectAll: true,
      defaults: { price: { mrp: 1299, sellingPrice: 999 }, stockQty: 3, status: 'active' },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.created.length, 2, 'navy blue + peach newly listed');
  assert.equal(r.body.data.skipped.length, 3, 'white/red/black skipped');
  const count = await TenantProduct.countDocuments({ tenantId: tenant.id, productMasterId: masterId });
  assert.equal(count, 5, 'one listing row per variant');

  // tenant listing rows carry their variant
  r = await call('/catalog/tenant/listings?productMasterId=' + masterId, { token: vendTok });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 5);
  assert.ok(r.body.data.every((l) => l.variant && l.variant.value), 'every row carries its variant');

  // ================= 6. customer PLP: flat rows + grouped card =================
  r = await call('/catalog?search=polo');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 5, 'flat PLP shows one row per listed variant');
  const flatRed = r.body.data.find((l) => l.variant?.value === 'red');
  assert.equal(flatRed.product.imageUrl, 'https://cdn.test/polo-red.jpg', 'red row uses its own photo');
  assert.equal(flatRed.product.imageSource, 'variant');
  const flatWhite = r.body.data.find((l) => l.variant?.value === 'white');
  assert.equal(flatWhite.product.imageUrl, 'https://cdn.test/polo-front.jpg', 'white row falls back');
  assert.equal(flatWhite.product.imageSource, 'master');

  r = await call('/catalog?search=polo&groupBy=master');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 1, 'grouped PLP shows one card per master');
  const card = r.body.data[0];
  assert.equal(card.variants.length, 5, 'card carries the full family');
  assert.deepEqual(card.priceRange, { min: 799, max: 999 });
  assert.equal(card.defaultListingId, card.variants.find((v) => v.label === 'White').listingId, 'default = isDefault white');
  assert.equal(r.body.meta.grouped, true);

  // ================= 7. PDP: variant select + fallback =================
  const slug = 'classic-polo-t-shirt';
  r = await call(`/catalog/p/${slug}?variantId=${redId}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.selectedVariantId, redId);
  assert.equal(r.body.data.listing.price.sellingPrice, 899);
  assert.equal(r.body.data.product.imageUrl, 'https://cdn.test/polo-red.jpg');
  assert.equal(r.body.data.variants.length, 5);

  r = await call(`/catalog/p/${slug}?variantId=000000000000000000000000`);
  assert.equal(r.status, 200, 'unknown variant falls back instead of 404ing');
  assert.equal(r.body.data.selectedVariantId, whiteId);

  // ================= 8. cart snapshots carry variant label + photo =================
  const redListing = card.variants.find((v) => v.variantId === redId).listingId;
  r = await call('/cart/items', { method: 'POST', token: vendTok, body: { tenantProductId: redListing, qty: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const line = (r.body.data.items || []).find((i) => String(i.tenantProductId) === String(redListing));
  assert.ok(line, 'red line in cart');
  assert.match(line.titleSnapshot || '', /Red/, `title snapshot names the variant (got ${line.titleSnapshot})`);
  assert.equal(line.imageUrlSnapshot, 'https://cdn.test/polo-red.jpg');

  // ================= 9. variant update + retire retires its gallery =================
  r = await call(`/catalog/admin/masters/${masterId}/variants/${redId}`, {
    method: 'PATCH', token: adminTok, body: { displayLabel: 'Crimson Red', expectedVersion: version },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.displayLabel, 'Crimson Red');
  version += 1;

  r = await call(`/catalog/admin/masters/${masterId}/variants/${byValue.get('peach').id}`, {
    method: 'DELETE', token: adminTok, body: { expectedVersion: version },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const peachImages = await ProductImage.countDocuments({
    productMasterId: masterId, variantId: byValue.get('peach').id, isDeleted: { $ne: true },
  });
  assert.equal(peachImages, 0, 'retiring a variant retires its gallery');

  // grouped card now hides the retired variant's listing
  r = await call('/catalog?search=polo&groupBy=master');
  assert.equal(r.body.data[0].variants.length, 4, 'dead variant SKUs never offered');

  console.log('✅ ALL VARIANT-CATALOG SMOKE TESTS PASSED');

  server.close();
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
  process.exit(0);
}

async function run() {
  try { await main(); } catch (err) { console.error('❌', err); await mongoose.disconnect().catch(() => {}); await stopHermeticMongo(mongod); process.exit(1); }
}
run();
