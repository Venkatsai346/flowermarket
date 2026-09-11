/**
 * storefront-contracts.test.js — PURE contract tests for the storefront-content
 * surface (rich store pages, brands, categories). No database, no network.
 *
 *   node scripts/storefront-contracts.test.js
 *
 * WHY THIS FILE EXISTS. Three production bugs shipped in one release, all with
 * the same signature — code that referenced fields/shape the runtime silently
 * did not have:
 *
 *   1. Admin BrandsPage crashed (`featured is not defined`): the filter UI was
 *      committed without its useState declarations. Browsers fail at RENDER;
 *      esbuild/vite builds do NOT catch undeclared variables. Only a wiring
 *      assertion (or a real render) sees it.
 *   2. Category edit 500'd with `'id' with value 'undefined'`: the admin
 *      list/tree endpoints return `.lean()` rows, which skip the toJSON
 *      plugin's `_id → id` mapping — so the edit modal sent `undefined` as
 *      the route param. The public contract is "every entity object carries a
 *      string id"; these endpoints broke it.
 *   3. Saved hero slides/highlights never appeared in the storefront: the
 *      Tenant `store` schema never gained the new paths, so Mongoose strict
 *      mode silently STRIPPED them on save — 200 + success toast, nothing in
 *      the DB. (Content saved while the schema was incomplete was dropped and
 *      must be re-saved; nothing can recover what was never written.)
 *
 * Each section below pins the contract that the corresponding bug violated, in
 * the cheapest failing-first form: schema paths, strict-mode round-trips,
 * serializer behaviour, validator acceptance, and source-wiring invariants.
 * Style matches the other pure suites: hand-rolled checks, loud summary,
 * non-zero exit on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Tenant from '../src/models/tenant.model.js';
import Brand from '../src/models/brand.model.js';
import Category from '../src/models/category.model.js';
import { serializeDoc, serializeList } from '../src/utils/serialize.js';
import { buildStoreUpdate, cleanStoreValue, cleanStoreObject } from '../src/services/store.service.js';
import { parseLocalSubdomain } from '../src/services/tenantDomain.service.js';
import { TENANT_RESOLUTION_SOURCE } from '../src/constants/enums.js';
import { storeUpdateSchema } from '../src/utils/validators/marketplace.validators.js';
import { brandCreateSchema, categoryCreateSchema } from '../src/utils/validators/catalog.validators.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── S1 · schema paths: the models must physically carry the content ──────────
console.log('S1 · model schema paths');
for (const p of [
  'store.heroSlides', 'store.announcement.text', 'store.announcement.isActive',
  'store.about.title', 'store.about.content', 'store.about.imageUrl', 'store.about.videoUrl',
  'store.highlights', 'store.testimonials', 'store.contact.phone', 'store.contact.address',
  'store.seo.title', 'store.footerText', 'store.featuredCategoryIds', 'store.featuredBrandIds',
  'store.socialLinks.youtube', 'store.socialLinks.x', 'store.socialLinks.whatsapp',
]) {
  check(`tenant ${p}`, Boolean(Tenant.schema.path(p)));
}
for (const p of [
  'bannerUrl', 'tagline', 'story', 'website', 'headquarters', 'foundedYear',
  'socialLinks.youtube', 'socialLinks.x', 'isFeatured', 'sortOrder',
]) {
  check(`brand ${p}`, Boolean(Brand.schema.path(p)));
}
check('category bannerUrl', Boolean(Category.schema.path('bannerUrl')));

// ── S2 · strict-mode round-trip: rich content survives `new + validate` ───────
// (Mongoose strips unknown paths WITHOUT an error — the exact issue-3 shape.)
console.log('S2 · strict-mode persistence behaviour');
{
  const slide = { imageUrl: 'https://cdn/img.jpg', title: 'Festive', sortOrder: 0, isActive: true };
  const t = new Tenant({
    name: 'T', slug: 't',
    store: {
      heroSlides: [slide],
      announcement: { text: 'Sale', isActive: true },
      about: { title: 'Story', content: 'Once upon a time' },
      highlights: [{ icon: 'truck', title: 'Fast', text: 'Same day' }],
      testimonials: [{ name: 'Priya', text: 'Lovely', rating: 5 }],
      contact: { phone: '+91 1', address: { city: 'Hyd' } },
      seo: { title: 'Best florist' },
      footerText: 'Since 2010',
      featuredCategoryIds: [new mongoose.Types.ObjectId()],
      featuredBrandIds: [],
    },
  });
  const err = t.validateSync();
  check('rich store passes model validation', !err, err?.message || '');
  check('heroSlides kept', t.store.heroSlides?.length === 1 && t.store.heroSlides[0].title === 'Festive');
  check('highlights kept', t.store.highlights?.length === 1);
  check('testimonials kept', t.store.testimonials?.length === 1);
  check('about kept', t.store.about?.content === 'Once upon a time');
  check('contact.address kept', t.store.contact?.address?.city === 'Hyd');
  const bad = new Tenant({ name: 'x', slug: 'x', store: { noSuchField: 'dropped-silently' } });
  check('unknown store paths still stripped (strict on)', bad.store.noSuchField === undefined);
}

// ── S3 · serializer: lean rows and transformed docs both yield string ids ────
console.log('S3 · serializeDoc / serializeList');
{
  const oid = new mongoose.Types.ObjectId();
  const lean = serializeDoc({ _id: oid, name: 'Roses' });
  check('lean row gains string id', lean.id === String(oid));
  check('lean row drops _id', !('_id' in lean));
  check('lean row keeps payload', lean.name === 'Roses');
  const already = serializeDoc({ id: String(oid), name: 'Kept' });
  check('transformed doc id preserved', already.id === String(oid));
  check('null-safe', serializeDoc(null) === null && serializeDoc(undefined) === undefined);
  check('non-array passthrough', serializeList('nope') === 'nope');
  const list = serializeList([{ _id: oid }, null]);
  check('list maps rows, keeps holes', list[0].id === String(oid) && list[1] === null);
}

// ── S4 · validators accept the rich payloads the consoles submit ─────────────
console.log('S4 · Joi acceptance');
{
  const rich = {
    announcement: { text: 'Diwali sale', linkUrl: '/search?q=diwali', isActive: true },
    heroSlides: [{ imageUrl: 'https://cdn/a.jpg', title: 'Hi', ctaLabel: 'Shop', ctaLink: '/search' }],
    about: { title: 'Story', content: 'Para 1\n\nPara 2', videoUrl: 'https://youtube.com/watch?v=abcdefghijk' },
    highlights: [{ icon: 'truck', title: 'Fast', text: 'Same-day' }],
    testimonials: [{ name: 'A', text: 'Great', rating: 5 }],
    contact: { phone: '+91 1', email: 'a@b.in', address: { city: 'Hyd', pincode: '500001' }, hours: '9-9' },
    seo: { title: 'T', description: 'D' },
    footerText: 'F',
    featuredCategoryIds: [String(new mongoose.Types.ObjectId())],
    featuredBrandIds: [],
  };
  const { error } = storeUpdateSchema.validate(rich);
  check('rich store update validates', !error, error?.message || '');
  const tooMany = { heroSlides: Array.from({ length: 9 }, () => ({ imageUrl: 'https://cdn/a.jpg' })) };
  check('9 hero slides rejected (max 8)', Boolean(storeUpdateSchema.validate(tooMany).error));
  const brand = {
    name: 'Green Thumb', tagline: 'Fresh', story: 'S', website: 'https://brand.example.com',
    headquarters: 'BLR', foundedYear: 2015, isFeatured: true, sortOrder: 1,
    socialLinks: { instagram: 'https://instagram.com/x' },
  };
  check('rich brand create validates', !brandCreateSchema.validate(brand).error);
  check('category bannerUrl validates', !categoryCreateSchema.validate({ name: 'Roses', bannerUrl: 'https://cdn/b.jpg' }).error);
}

// ── S5 · wiring invariants: every consumer must resolve what it renders ──────
// Source-reads are deliberate here (same precedent as lint.test.js): they pin
// the exact seams where code was once committed half-wired.
console.log('S5 · wiring invariants');
{
  const categoryService = read('backend/src/services/category.service.js');
  check('category list serializes ids', categoryService.includes('serializeList(docs)'));
  check('category tree serializes ids', categoryService.includes('serializeDoc(cat)'));
  check('brand list serializes ids', read('backend/src/services/brand.service.js').includes('serializeList(docs)'));

  const catalogAdmin = read('backend/src/controllers/catalog.admin.controller.js');
  const bustSites = (catalogAdmin.match(/bustCatalogCache\(\);/g) || []).length;
  check('taxonomy writes bust catalog cache (7 sites)', bustSites === 7, `found ${bustSites}`);
  const marketplace = read('backend/src/controllers/marketplace.controller.js');
  check('store save busts bootstrap', marketplace.includes("invalidateCache('/domains/bootstrap')"));
  check('store save busts storefront api', marketplace.includes("invalidateCache('/marketplace/store')"));
  check('store save busts store indexes', marketplace.includes("invalidateCache('/catalog/store/')"));

  const brandsPage = read('frontend/apps/web/src/features/catalog/BrandsPage.jsx');
  check('BrandsPage declares featured state', brandsPage.includes('const [featured, setFeatured]'));
  check('BrandsPage declares search state', brandsPage.includes('const [q, setQ]'));
  check('BrandsPage queries featured', brandsPage.includes('featured: featured ==='));
  check('BrandsPage queries search', brandsPage.includes('search: q.trim()'));

  const catsPage = read('frontend/apps/web/src/features/catalog/CategoriesPage.jsx');
  check('CategoryModal edits via rid(initial)', catsPage.includes('updateCategory(rid(initial), body)'));
}

// ── S6 · storefront prop wiring: every section receives what it renders ──────
// esbuild/vite never flag a wrong prop NAME (it is just an unused key), and
// the section components null-guard — so `message=` instead of `announcement=`
// shipped a storefront where saved announcements could never appear.
console.log('S6 · storefront prop wiring');
{
  const app = read('frontend/apps/storefront/src/App.jsx');
  check('App feeds AnnouncementBar.announcement', app.includes('<AnnouncementBar announcement={store?.announcement}'));
  check('App has no message= leftover', !app.includes('<AnnouncementBar message='));

  const home = read('frontend/apps/storefront/src/pages/Home.jsx');
  for (const prop of ['slides={slides}', 'storeName={store.name}', 'tagline={store.tagline}', 'description={store.description}']) {
    check(`Home feeds HeroCarousel ${prop.split('=')[0]}`, home.includes(prop));
  }
  check('Home feeds StoreHighlights items', home.includes('<StoreHighlights items={store.highlights}'));
  check('Home feeds Testimonials items+title', home.includes('<Testimonials items={store.testimonials}'));
  check('Home rails link out', home.includes('actionTo="/categories"') && home.includes('actionTo="/brands"'));

  const about = read('frontend/apps/storefront/src/pages/About.jsx');
  check('About feeds Testimonials', about.includes('<Testimonials items={store.testimonials}'));
  check('Brands page feeds BrandCard', read('frontend/apps/storefront/src/pages/Brands.jsx').includes('<BrandCard key={b.id} brand={b}'));
  const catsPage = read('frontend/apps/storefront/src/pages/Categories.jsx');
  check('Categories page feeds CategoryCard', catsPage.includes('<CategoryCard key={c.id} node={c}'));
}

// ── S7 · brand modal coherence: blank/pick/body/UI must all know the fields ──
// Shipped once half-wired: body referenced new keys while blank/pick/UI were
// the old shape — new fields invisible AND wiped (null) on every edit save.
console.log('S7 · brand modal coherence');
{
  const page = read('frontend/apps/web/src/features/catalog/BrandsPage.jsx');
  const blank = page.slice(page.indexOf('const blank'), page.indexOf('function BrandModal'));
  const pick = page.slice(page.indexOf('const pickFields'), page.indexOf('export default function BrandsPage'));
  for (const key of [
    'bannerUrl', 'tagline', 'story', 'website', 'headquarters', 'foundedYear',
    'instagram', 'youtube', 'isFeatured', 'sortOrder',
  ]) {
    check(`blank() carries ${key}`, blank.includes(key));
    check(`pickFields() carries ${key}`, pick.includes(key));
  }
  check('modal edits media banner purpose', page.includes('MEDIA_PURPOSE.brandBanner'));
  check('modal edits via rid(initial)', page.includes('updateBrand(rid(initial), body)'));
}

// ── S8 · cache freshness wiring: authed reads fresh, writes bust publics ─────
console.log('S8 · cache freshness wiring');
{
  const cache = read('backend/src/middleware/responseCache.js');
  check('credentialed requests bypass cache', cache.includes('req.headers.authorization || req.headers.cookie'));
  const marketplace = read('backend/src/controllers/marketplace.controller.js');
  check('store save busts owner GET + public stores', marketplace.includes("invalidateCache('/marketplace/store')"));
}

// ── S9 · store-merge fidelity: unrelated saves must not strip nested blocks ──
// updateStore() wholesale-replaces tenant.store. The merge once ran on the
// live subdocument, and re-parented SingleNested instances cast back as {} —
// so saving highlights wiped about/socials/announcement/contact/seo while
// arrays and scalars survived. The merge is now a pure POJO function;
// these checks run it over a hydrated-then-dehydrated doc, exactly as the
// service does (prev = tenant.store.toObject()).
console.log('S9 · store-merge fidelity');
{
  const hydrated = new Tenant({
    name: 'T', slug: 't',
    store: {
      tagline: 'hi', bannerUrl: 'https://b.jpg', isPublished: true,
      socialLinks: { instagram: 'https://ig/x', x: 'https://x/y' },
      about: { title: 'Story', content: 'Once upon', imageUrl: 'https://a.jpg' },
      heroSlides: [{ imageUrl: 'https://s.jpg', title: 'S', sortOrder: 0, isActive: true }],
      highlights: [{ icon: 'truck', title: 'H', text: 'fast' }],
      testimonials: [{ name: 'Priya', text: 'Lovely', rating: 5 }],
      contact: { phone: '+911', address: { city: 'Hyd' } },
      seo: { title: 'Seo' },
      announcement: { text: 'Old', isActive: true },
    },
  });
  const prev = hydrated.store.toObject();

  // Other-card save: only highlights in the payload.
  const m1 = buildStoreUpdate(prev, { highlights: [{ icon: 'leaf', title: 'Fresh' }] }, {});
  check('about survives other-card save', m1.about?.title === 'Story' && m1.about?.content === 'Once upon');
  check('socials survive other-card save', m1.socialLinks?.instagram === 'https://ig/x');
  check('slides survive other-card save', m1.heroSlides?.length === 1 && m1.heroSlides[0].imageUrl === 'https://s.jpg');
  check('contact survives other-card save', m1.contact?.address?.city === 'Hyd');
  check('seo survives other-card save', m1.seo?.title === 'Seo');
  check('announcement survives other-card save', m1.announcement?.text === 'Old');
  check('testimonials survive other-card save', m1.testimonials?.length === 1);
  check('scalars survive other-card save', m1.tagline === 'hi' && m1.bannerUrl === 'https://b.jpg');
  check('flags survive other-card save', m1.isPublished === true);
  check('payload replaces wholesale', m1.highlights?.length === 1 && m1.highlights[0].title === 'Fresh');

  // Nested objects merge; address merges one level deeper.
  const m2 = buildStoreUpdate(prev, { about: { title: 'New' }, contact: { address: { city: 'Vja' } } }, {});
  check('about merges (content kept)', m2.about?.title === 'New' && m2.about?.content === 'Once upon');
  check('address merges (phone kept)', m2.contact?.address?.city === 'Vja' && m2.contact?.phone === '+911');

  // Clearing semantics + featured-id pass-through.
  const m3 = buildStoreUpdate(prev, { tagline: '' }, {});
  check("'' cleans to null", m3.tagline === null);
  const oid = String(new mongoose.Types.ObjectId());
  const m4 = buildStoreUpdate(prev, {}, { categoryIds: [oid] });
  check('featured ids applied', m4.featuredCategoryIds?.length === 1 && m4.featuredCategoryIds[0] === oid);
  check('featured ids default to []', Array.isArray(m4.featuredBrandIds));
  const m5 = buildStoreUpdate({ ...prev, featuredBrandIds: [oid] }, {}, {});
  check('featured ids kept when absent', m5.featuredBrandIds?.length === 1);
  const m6 = buildStoreUpdate({ ...prev, featuredBrandIds: [oid] }, {}, { brandIds: [] });
  check('featured ids clearable with []', m6.featuredBrandIds?.length === 0);

  check('cleanStoreValue passthrough', cleanStoreValue('x') === 'x' && cleanStoreValue(null) === null);
  check('cleanStoreObject skips arrays', cleanStoreObject([1])?.length === 1);
}

// ── S10 · local multi-store: <slug>.localhost parsing + dev-plumbing wiring ──
// One dev server acts as every store via per-slug loopback hostnames. The
// parser is pure (pinned here); live resolution is pinned hermetically in
// smoke-domains section 8. The wiring checks pin the two silent killers:
// a proxy that rewrites Host collapses every store to the fallback tenant,
// and storage that ignores the ?asTenant pin cross-contaminates tabs.
console.log('S10 · local multi-store parsing + wiring');
{
  check('basic slug parses', parseLocalSubdomain('rosebazaar.localhost') === 'rosebazaar');
  check('port tolerated', parseLocalSubdomain('rosebazaar.localhost:5174') === 'rosebazaar');
  check('case tolerated', parseLocalSubdomain('Rose-Bazaar.LOCALHOST') === 'rose-bazaar');
  check('bare localhost falls through', parseLocalSubdomain('localhost:5174') === null);
  check('loopback IP falls through', parseLocalSubdomain('127.0.0.1:5174') === null);
  check('multi-label falls through', parseLocalSubdomain('a.b.localhost') === null);
  check('non-local hosts untouched', parseLocalSubdomain('rosebazaar.flowermarket.in') === null);
  check('reserved labels fall through', parseLocalSubdomain('admin.localhost', { reservedSlugs: ['admin', 'api'] }) === null);
  check('non-reserved passes with list', parseLocalSubdomain('shop.localhost', { reservedSlugs: ['admin'] }) === 'shop');
  check('userinfo rejected', parseLocalSubdomain('rosebazaar.localhost@evil.com') === null);
  check('empty rejected', parseLocalSubdomain('') === null && parseLocalSubdomain(null) === null);
  check('HOST_LOCAL source exists', TENANT_RESOLUTION_SOURCE.HOST_LOCAL === 'host_local');

  const svc = read('backend/src/services/tenantDomain.service.js');
  check('resolveByHost consults the dev parser', svc.includes('parseLocalSubdomain(rawHost'));
  check('dev path gated by flag', svc.includes('config.domains.allowLocalSubdomains'));
  check('unknown local slug fails closed', svc.includes("throw notFound(`No store at ${host}`, 'STORE_NOT_FOUND')"));
  check('config flag mirrors override style', read('backend/src/config/index.js').includes('ALLOW_LOCAL_SUBDOMAINS'));

  const vite = read('frontend/apps/storefront/vite.config.js');
  check('dev proxy preserves Host (no changeOrigin: key)', !/changeOrigin\s*:/.test(vite));
  const api = read('frontend/apps/storefront/src/api.js');
  check('storage isolated per dev pin', api.includes('fm-shop:${host}${devPin'));
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('storefront contracts: OK');
