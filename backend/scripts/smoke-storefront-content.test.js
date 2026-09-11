/**
 * smoke-storefront-content.test.js — rich storefront content (hero slides, about,
 * brands page, categories page).
 *
 * Hermetic (memory-server only — it wipes its world). Proves the DB-bound half:
 *   1. storefrontBrands() — only brands mapped to THIS tenant's ACTIVE listings,
 *      with product counts + from-prices, featured-first ordering.
 *   2. storefrontCategories() — pruned tree with subtree roll-up (a parent with
 *      no direct listings survives when a descendant sells; dead branches go).
 *   3. updateStore() — the full rich payload round-trips; unknown featured ids
 *      fail loudly; publicStoreShape() filters/sorts slides + gates the
 *      announcement + aliases contact for the storefront About page.
 *   4. Validators — oversized arrays rejected; rich brand/category fields accepted.
 *   5. Admin id contract — brand/category list + tree rows carry string `id`
 *      (no `_id`), so edit/verify/delete actions can never aim at `undefined`.
 */

import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (n, ok, d = '') => { if (ok) { passed += 1; console.log(`  ✅ ${n}`); } else { failed += 1; failures.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`); } };
const eq = (n, a, e) => check(n, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
const section = (t) => console.log(`\n${t}`);

let mongod = null;
async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    return 'real MongoDB';
  }
  mongod = await createHermeticMongo();
  await mongoose.connect(mongod.getUri('fm_storefront_content_test'), { autoIndex: true });
  return 'mongodb-memory-server';
}

async function main() {
  let mode;
  try { mode = await connect(); } catch (err) {
    const msg = `no database available (${err.message.split('\n')[0]})`;
    if (process.env.REQUIRE_DB === 'true') { console.error(`\n❌ smoke-storefront-content: ${msg}\n`); process.exit(1); }
    console.log('\n⏭  SKIPPED — smoke-storefront-content needs MongoDB.');
    console.log(`   ${msg}\n`);
    process.exit(0);
  }
  console.log(`\n🌷 storefront content smoke — ${mode}`);

  if (!mode.includes('memory')) {
    console.error('\n❌ smoke-storefront-content: refusing to run against a real DB — the suite\n   wipes its collections. Run it hermetically (no MONGODB_URI).\n');
    process.exit(1);
  }

  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: Category } = await import('../src/models/category.model.js');
  const { default: Brand } = await import('../src/models/brand.model.js');
  const { default: ProductMaster } = await import('../src/models/productMaster.model.js');
  const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');
  const { default: search } = await import('../src/services/catalogSearch.service.js');
  const { default: storeService } = await import('../src/services/store.service.js');
  const { default: brandService } = await import('../src/services/brand.service.js');
  const { default: categoryService } = await import('../src/services/category.service.js');
  const { storeUpdateSchema } = await import('../src/utils/validators/marketplace.validators.js');

  await Promise.all([
    Tenant.deleteMany({}), Category.deleteMany({}), Brand.deleteMany({}),
    ProductMaster.deleteMany({}), TenantProduct.deleteMany({}),
  ]);

  const tenant = await Tenant.create({
    name: 'Petal & Stem', slug: 'petal-stem', type: 'business', status: 'active',
    contactEmail: 'hello@petal.in', contactPhone: '9876543210',
  });

  const flowers = await Category.create({ name: 'Flowers', slug: 'flowers', status: 'active', sortOrder: 1 });
  const roses = await Category.create({
    name: 'Roses', slug: 'roses', parentId: flowers._id, level: 1,
    status: 'active', sortOrder: 1, description: 'Farm-fresh roses',
    imageUrl: 'https://cdn.test/roses.jpg', bannerUrl: 'https://cdn.test/roses-wide.jpg',
  });
  await Category.create({ name: 'Seeds', slug: 'seeds', status: 'active' }); // unmapped — must be pruned

  const brandA = await Brand.create({
    name: 'Farm Fresh', slug: 'farm-fresh', status: 'active',
    tagline: 'Cut at dawn', story: 'Our story…', logoUrl: 'https://cdn.test/ff.png',
    bannerUrl: 'https://cdn.test/ff-wide.jpg', website: 'https://farmfresh.test',
    foundedYear: 2015, headquarters: 'Bengaluru', countryOfOrigin: 'India',
    isFeatured: true, sortOrder: 2,
    verification: { status: 'verified', isVerified: true, verifiedAt: new Date() },
  });
  const brandB = await Brand.create({ name: 'Wild Bunch', slug: 'wild-bunch', status: 'active' });
  await Brand.create({ name: 'Ghost Growers', slug: 'ghost-growers', status: 'active' }); // unmapped

  const master = (over) => ProductMaster.create({
    skuGlobal: `SKU-${Math.random().toString(36).slice(2, 8)}`,
    type: 'fresh_flower', title: over.title || 'Red Rose Bunch', slug: `sku-${Math.random().toString(36).slice(2, 10)}`,
    status: 'active', ...over,
  });
  const m1 = await master({ title: 'Red Roses', categoryId: roses._id, brandId: brandA._id });
  const m2 = await master({ title: 'Pink Roses', categoryId: roses._id, brandId: brandA._id });
  const m3 = await master({ title: 'Wild Roses', categoryId: roses._id, brandId: brandB._id });
  const m4 = await master({ title: 'Mixed Bouquet', categoryId: flowers._id, brandId: null });
  const m5 = await master({ title: 'Draft Rose', categoryId: roses._id, brandId: brandA._id });
  const m6 = await master({ title: 'Pending Rose', categoryId: roses._id, brandId: brandB._id, status: 'pending_review' });

  const listing = (masterId, price, status = 'active') => TenantProduct.create({
    tenantId: tenant._id, productMasterId: masterId, status,
    price: { mrp: price, sellingPrice: price, currency: 'INR' }, stockQty: 10,
  });
  await listing(m1._id, 500);
  await listing(m2._id, 300);
  await listing(m3._id, 900);
  await listing(m4._id, 150);
  await listing(m5._id, 100, 'draft'); // draft listing — must not count
  await listing(m6._id, 100); // master not active — must not count

  // -------------------------------------------------------------------------
  section('1. storefrontBrands — tenant-mapped brands with counts');
  // -------------------------------------------------------------------------
  const brands = await search.storefrontBrands({ tenantId: tenant._id });
  eq('only mapped brands surface (ghost excluded)', brands.length, 2);
  eq('featured brand sorts first', String(brands[0].id), String(brandA._id));
  eq('brand A counts its two live listings', brands[0].productCount, 2);
  eq('fromPrice is the cheapest live listing', brands[0].fromPrice, 300);
  eq('brand B has one listing at 900', brands[1].productCount === 1 && brands[1].fromPrice === 900, true);
  eq('rich fields ride along (tagline)', brands[0].tagline, 'Cut at dawn');
  eq('rich fields ride along (story)', brands[0].story, 'Our story…');
  eq('rich fields ride along (foundedYear)', brands[0].foundedYear, 2015);
  eq('verification surfaces as a badge field', brands[0].isVerified, true);
  check('unverified brand still lists (badge, not filter)', brands[1].isVerified !== true);

  // -------------------------------------------------------------------------
  section('2. storefrontCategories — pruned tree with roll-up');
  // -------------------------------------------------------------------------
  const cats = await search.storefrontCategories({ tenantId: tenant._id });
  eq('one root survives (Seeds pruned)', cats.tree.length, 1);
  eq('root is Flowers', cats.tree[0].name, 'Flowers');
  eq('root direct count is 1 (mixed bouquet)', cats.tree[0].productCount, 1);
  eq('root total rolls up descendants (1 + 3)', cats.tree[0].totalCount, 4);
  eq('root fromPrice rolls up to the cheapest descendant', cats.tree[0].fromPrice, 150);
  eq('Roses nests under Flowers', cats.tree[0].children.length, 1);
  eq('Roses counts its three live listings', cats.tree[0].children[0].totalCount, 3);
  eq('Roses fromPrice is 300', cats.tree[0].children[0].fromPrice, 300);
  eq('banner rides along', cats.tree[0].children[0].bannerUrl, 'https://cdn.test/roses-wide.jpg');
  check('flat lookup mirrors the tree', cats.flat.length === 2 && cats.flat.every((f) => f.totalCount > 0));

  // -------------------------------------------------------------------------
  section('3. updateStore — rich payload round-trips');
  // -------------------------------------------------------------------------
  const payload = {
    heroSlides: [
      {
        imageUrl: 'https://cdn.test/hero1.jpg', mobileImageUrl: 'https://cdn.test/hero1-m.jpg',
        title: 'Diwali Blooms', subtitle: 'Up to 30% off', ctaLabel: 'Shop now',
        ctaLink: '/browse', sortOrder: 2, isActive: true,
      },
      { imageUrl: 'https://cdn.test/hero2.jpg', title: 'Second', sortOrder: 1, isActive: true },
      { imageUrl: 'https://cdn.test/hero3.jpg', title: 'Paused', sortOrder: 0, isActive: false },
    ],
    announcement: { text: 'Free delivery over ₹499', linkUrl: '/browse', isActive: true },
    about: {
      title: 'Our farm story', content: 'We grow…', imageUrl: 'https://cdn.test/farm.jpg',
      videoUrl: 'https://cdn.test/farm.mp4',
    },
    highlights: [{ icon: 'leaf', title: 'Fresh, always', text: 'Cut at dawn' }],
    testimonials: [{ name: 'Anitha', text: 'Loved it!', rating: 5 }],
    contact: {
      phone: '9123456780', email: 'care@petal.in',
      address: { line1: '12 Flower St', city: 'Kakinada', state: 'AP', pincode: '533001' },
      hours: 'Mon–Sun 8am–9pm', whatsapp: '9123456780', mapUrl: 'https://maps.test/petal',
    },
    socialLinks: { instagram: 'https://instagram.com/petal', youtube: 'https://youtube.com/@petal' },
    seo: { title: 'Petal & Stem — Fresh Flowers', description: 'Same-day flower delivery' },
    footerText: 'Grown with love in Andhra Pradesh',
    featuredCategoryIds: [String(roses._id)],
    featuredBrandIds: [String(brandA._id)],
  };
  const { error: validErr } = storeUpdateSchema.validate(payload);
  eq('rich payload passes validation', validErr?.message || null, null);
  await storeService.updateStore({ tenantId: tenant._id, payload });
  const after = await Tenant.findById(tenant._id).lean();
  eq('three slides persist', after.store.heroSlides.length, 3);
  eq('about round-trips', after.store.about.title, 'Our farm story');
  eq('contact round-trips', after.store.contact.address.city, 'Kakinada');
  eq('seo round-trips', after.store.seo.title, 'Petal & Stem — Fresh Flowers');
  eq('youtube social persists', after.store.socialLinks.youtube, 'https://youtube.com/@petal');

  // Cross-card save: an unrelated slice must not strip nested blocks.
  // (Regression: live SingleNested instances cast back as {} through the
  // wholesale store replacement, wiping about/socials/announcement/contact/seo.)
  await storeService.updateStore({
    tenantId: tenant._id,
    payload: { testimonials: [{ name: 'Ravi', text: 'Superb!', rating: 4 }] },
  });
  const afterX = await Tenant.findById(tenant._id).lean();
  eq('about survives other-card save', afterX.store.about.title, 'Our farm story');
  eq('socials survive other-card save', afterX.store.socialLinks.youtube, 'https://youtube.com/@petal');
  eq('slides survive other-card save', afterX.store.heroSlides.length, 3);
  eq('contact survives other-card save', afterX.store.contact.address.city, 'Kakinada');
  eq('seo survives other-card save', afterX.store.seo.title, 'Petal & Stem — Fresh Flowers');
  eq('new slice applied', afterX.store.testimonials.length, 1);

  const pub = storeService.publicStoreShape(afterX);
  eq('public shape drops the paused slide', pub.heroSlides.length, 2);
  eq('public slides sort by sortOrder', pub.heroSlides[0].title, 'Second');
  eq('announcement gates on isActive+text', pub.announcement.text, 'Free delivery over ₹499');
  eq('contact aliases flatten for the About page', pub.phone, '9123456780');
  eq('featured ids stringify', pub.featuredCategoryIds[0], String(roses._id));

  // inactive announcement + legacy contact fallback
  await storeService.updateStore({
    tenantId: tenant._id,
    payload: { announcement: { text: '', isActive: false }, contact: { phone: '', email: '' } },
  });
  const after2 = await Tenant.findById(tenant._id).lean();
  const pub2 = storeService.publicStoreShape(after2);
  eq('empty announcement hides', pub2.announcement, null);
  eq('cleared contact falls back to tenant phone', pub2.phone, '9876543210');
  eq('cleared contact falls back to tenant email', pub2.email, 'hello@petal.in');

  let badFeatured = null;
  try {
    await storeService.updateStore({
      tenantId: tenant._id,
      payload: { featuredBrandIds: [new mongoose.Types.ObjectId().toString()] },
    });
  } catch (e) { badFeatured = e; }
  eq('unknown featured ids fail loudly', badFeatured?.code, 'INVALID_FEATURED_IDS');

  const tooMany = { heroSlides: Array.from({ length: 9 }, (_, i) => ({ imageUrl: `https://cdn.test/${i}.jpg` })) };
  const { error: tooManyErr } = storeUpdateSchema.validate(tooMany);
  check('9 slides rejected (max 8)', Boolean(tooManyErr));

  // -------------------------------------------------------------------------
  section('4. rich brand + category writes');
  // -------------------------------------------------------------------------
  const created = await brandService.create({
    payload: {
      name: 'Petal Labs', tagline: 'Engineered blooms', story: 'Long story…',
      bannerUrl: 'https://cdn.test/pl.jpg', website: 'https://petallabs.test',
      foundedYear: 2020, headquarters: 'Hyderabad', isFeatured: true, sortOrder: 1,
      socialLinks: { instagram: 'https://instagram.com/petallabs' },
    },
  });
  eq('rich brand creates', created.tagline, 'Engineered blooms');
  const updated = await brandService.update({ id: created._id, patch: { story: 'Edited story' } });
  eq('rich brand patches', updated.story, 'Edited story');
  const searched = await brandService.list({ search: 'petal labs' });
  check('brand search finds it', searched.items.length === 1);
  const featOnly = await brandService.list({ featured: true });
  check('featured filter works', featOnly.items.length >= 1 && featOnly.items.every((b) => b.isFeatured));

  const catUpd = await categoryService.update({ id: roses._id, patch: { bannerUrl: 'https://cdn.test/roses-v2.jpg' } });
  eq('category banner patches', catUpd.bannerUrl, 'https://cdn.test/roses-v2.jpg');

  const enriched = await search.customerCategories();
  const rosesNode = (function find(list) {
    for (const n of list) {
      if (String(n.id) === String(roses._id)) return n;
      const hit = find(n.children || []);
      if (hit) return hit;
    }
    return null;
  }(enriched));
  eq('customer tree carries images now', rosesNode?.imageUrl, 'https://cdn.test/roses.jpg');

  section('5. admin list/tree id contract — every entity row carries string id');
  // -------------------------------------------------------------------------
  // Regression: lean rows skipped the toJSON _id → id mapping, so the admin
  // category edit modal sent `undefined` as the route param (VALIDATION_ERROR).
  const adminBrands = await brandService.list({});
  check('brand list non-empty', adminBrands.items.length >= 1);
  check(
    'brand rows carry string id, no _id',
    adminBrands.items.every((b) => typeof b.id === 'string' && /^[0-9a-f]{24}$/.test(b.id) && !('_id' in b))
  );
  const adminCats = await categoryService.list({ includeInactive: true });
  check(
    'category list rows carry string id, no _id',
    adminCats.items.length >= 1
      && adminCats.items.every((c) => typeof c.id === 'string' && /^[0-9a-f]{24}$/.test(c.id) && !('_id' in c))
  );
  const adminTree = await categoryService.tree({ includeInactive: true });
  const treeIds = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      treeIds.push(n);
      walk(n.children);
    }
  }(adminTree));
  check(
    'category tree nodes carry string id at every depth, no _id',
    treeIds.length >= 1
      && treeIds.every((n) => typeof n.id === 'string' && /^[0-9a-f]{24}$/.test(n.id) && !('_id' in n))
  );

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`storefront content: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); for (const f of failures) console.log(`  • ${f}`); }
}

async function cleanup() {
  await mongoose.disconnect().catch(() => {});
  await stopHermeticMongo(mongod);
}

main()
  .then(async () => { await cleanup(); process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error('\n❌ suite crashed:', e); await cleanup(); process.exit(1); });
