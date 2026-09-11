import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useCartActions } from '../lib/useCart.js';
import { resolveBrandTheme } from '../theme.js';
import { t } from '../i18n.js';
import { readViewed } from '../lib/viewed.js';
import ProductCard from '../components/ProductCard.jsx';
import FloralImage from '../components/FloralImage.jsx';
import ArrivalPromise from '../components/ArrivalPromise.jsx';
import HeroCarousel from '../components/HeroCarousel.jsx';
import StoreHighlights from '../components/StoreHighlights.jsx';
import Testimonials from '../components/Testimonials.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { Empty, ProductSkeleton, Button } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const SORTS = [
  ['', 'Featured'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['popularity', 'Popular'],
];

/**
 * Pick the rail entries: the tenant's curation first (in the tenant's order),
 * falling back to the best-stocked when the tenant curated nothing (or
 * curated rows that no longer sell). A rail must never render empty while
 * the store has products.
 */
function pickRail(curatedIds, pool, { parentOnly = false, limit = 8 } = {}) {
  const list = pool || [];
  if (!list.length) return [];
  const wanted = (curatedIds || []).map(String);
  if (wanted.length) {
    const byId = new Map(list.map((c) => [String(c.id), c]));
    const picked = wanted.map((id) => byId.get(id)).filter(Boolean);
    if (picked.length) return picked.slice(0, 12);
  }
  const candidates = parentOnly ? list.filter((c) => !c.parentId) : list;
  return [...candidates]
    .sort((a, b) => (b.totalCount ?? b.productCount ?? 0) - (a.totalCount ?? a.productCount ?? 0))
    .slice(0, limit);
}

export default function Home() {
  const store = useShop((s) => s.store);
  const theme = useShop((s) => s.theme);
  const pincode = useShop((s) => s.pincode);
  const serviceability = useShop((s) => s.serviceability);
  const openPin = useShop((s) => s.openPin);
  const language = useShop((s) => s.language);
  const { qtyByListing, busyId, add, changeQty } = useCartActions();

  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('');
  const [inStock, setInStock] = useState(false);

  const { data: categories } = useApi(() => api.shop.categories(), []);
  const { data: storeCats } = useApi(() => api.shop.storeCategories(), []);
  const { data: storeBrands } = useApi(() => api.shop.storeBrands(), []);
  const { data, loading, error } = useApi(
    () => api.shop.products({
      categoryId: categoryId || undefined,
      sort: sort || undefined,
      inStock: inStock || undefined,
      groupBy: 'master',
      limit: 24,
    }),
    [categoryId, sort, inStock]
  );

  const items = data || [];
  const tree = categories || [];
  const unserviceable = Boolean(pincode && serviceability && serviceability.serviceable === false);
  const resolved = resolveBrandTheme(theme || {});
  const hero = store?.bannerUrl || resolved.heroUrl;
  const viewed = useMemo(() => readViewed(), [items.length]);

  const slides = store?.heroSlides || [];
  const categoryRail = useMemo(
    () => pickRail(store?.featuredCategoryIds, storeCats?.flat, { parentOnly: true }),
    [store?.featuredCategoryIds, storeCats]
  );
  const brandRail = useMemo(
    () => pickRail(store?.featuredBrandIds, storeBrands, { limit: 10 }),
    [store?.featuredBrandIds, storeBrands]
  );
  const about = store?.about?.title || store?.about?.content ? store.about : null;

  return (
    <>
      {store && slides.length > 0 ? (
        <HeroCarousel
          slides={slides}
          storeName={store.name}
          tagline={store.tagline}
          description={store.description}
        />
      ) : store ? (
        <section className="relative min-h-[28rem] overflow-hidden sm:min-h-[32rem]">
          <FloralImage
            src={hero}
            alt=""
            priority
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15" />
          <div className="wrap relative z-10 flex min-h-[28rem] flex-col justify-end gap-4 py-12 text-white sm:min-h-[32rem] sm:py-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
              {store.name}
            </p>
            <h1 className="font-display max-w-2xl text-4xl leading-[1.1] tracking-tight sm:text-5xl">
              {store.tagline || `Fresh from ${store.name}`}
            </h1>
            {store.description && (
              <p className="max-w-xl text-sm leading-relaxed text-white/80">{store.description}</p>
            )}
            <ArrivalPromise className="w-fit" />
          </div>
        </section>
      ) : null}

      <div className="wrap space-y-10 py-8">
        {(store?.highlights?.length > 0) && <StoreHighlights items={store.highlights} />}

        {viewed.length > 0 && !unserviceable && (
          <section>
            <h2 className="mb-3 font-display text-lg text-slate-900">{t(language, 'recentlyViewed')}</h2>
            <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {viewed.map((v) => (
                <Link
                  key={v.slug}
                  to={`/p/${v.slug}`}
                  className="w-28 shrink-0"
                >
                  <span className="block aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    <FloralImage src={v.imageUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                  <span className="mt-1.5 block line-clamp-2 text-[11px] font-medium text-slate-600">{v.title}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {categoryRail.length > 0 && (
          <section aria-label={t(language, 'shopByCategory')}>
            <SectionHeader
              title={t(language, 'shopByCategory')}
              actionTo="/categories"
              actionLabel={t(language, 'viewAll')}
            />
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {categoryRail.map((c) => (
                <Link
                  key={c.id}
                  to={`/browse?category=${c.id}`}
                  className="group w-24 shrink-0 text-center sm:w-28"
                >
                  <span className="block aspect-square overflow-hidden rounded-3xl bg-slate-100 ring-1 ring-slate-200/70 transition group-hover:ring-2" style={{ '--tw-ring-color': 'var(--brand)' }}>
                    <FloralImage
                      src={c.imageUrl || c.bannerUrl}
                      alt=""
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.06]"
                    />
                  </span>
                  <span className="mt-2 block truncate text-xs font-bold text-slate-800">{c.name}</span>
                  <span className="block text-[11px] tabular-nums text-slate-400">
                    {c.totalCount ?? c.productCount ?? 0}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Products">
          {tree.length > 0 && (
            <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <button
                type="button"
                onClick={() => setCategoryId('')}
                className={cn('chip', !categoryId && 'chip-active')}
              >
                All
              </button>
              {tree.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(String(c.id) === categoryId ? '' : String(c.id))}
                  className={cn('chip', categoryId === String(c.id) && 'chip-active')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {loading ? 'Loading…' : `${items.length} product${items.length === 1 ? '' : 's'}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInStock((v) => !v)}
                className={cn('chip', inStock && 'chip-active')}
              >
                In stock
              </button>
              <label className="relative">
                <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort products"
                  className="input !w-auto rounded-full !py-1.5 pl-8 pr-3 text-sm"
                >
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
          </div>

          {unserviceable ? (
            <Empty
              floral
              icon={MapPin}
              title={`We don't deliver to ${pincode}`}
              message="Try a pin we cover — we will not show a catalogue we cannot fulfil."
              action={<Button variant="soft" onClick={openPin}>Change pincode</Button>}
            />
          ) : loading && !data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
            </div>
          ) : error ? (
            <Empty floral icon={PackageSearch} title="Could not load products" message={errMsg(error)} />
          ) : items.length === 0 ? (
            <Empty
              floral
              icon={PackageSearch}
              title="No products yet"
              message="This store has not listed anything yet."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((l) => (
                <ProductCard
                  key={l.masterId || l.listingId}
                  listing={l}
                  qtyByListing={qtyByListing}
                  busyId={busyId}
                  onAdd={add}
                  onQty={changeQty}
                />
              ))}
            </div>
          )}
        </section>

        {brandRail.length > 0 && (
          <section aria-label={t(language, 'ourBrands')}>
            <SectionHeader
              title={t(language, 'ourBrands')}
              actionTo="/brands"
              actionLabel={t(language, 'viewAll')}
            />
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {brandRail.map((b) => (
                <Link
                  key={b.id}
                  to={`/search?brand=${b.id}&brandName=${encodeURIComponent(b.name || '')}`}
                  className="group w-24 shrink-0 text-center sm:w-28"
                >
                  <span className="mx-auto grid aspect-square w-full place-items-center overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 transition group-hover:ring-2" style={{ '--tw-ring-color': 'var(--brand)' }}>
                    {b.logoUrl ? (
                      <img src={b.logoUrl} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
                    ) : (
                      <span
                        className="grid h-full w-full place-items-center text-2xl font-bold"
                        style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                      >
                        {(b.name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block truncate text-xs font-bold text-slate-800">{b.name}</span>
                  <span className="block text-[11px] tabular-nums text-slate-400">{b.productCount ?? 0}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {about && (
          <section
            aria-label={t(language, 'ourStory')}
            className="card grid overflow-hidden sm:grid-cols-2"
          >
            <div className="relative min-h-56 overflow-hidden bg-slate-100">
              <FloralImage
                src={about.imageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--brand)' }}>
                {t(language, 'ourStory')}
              </p>
              <h2 className="font-display text-2xl tracking-tight text-slate-900">
                {about.title || `About ${store?.name}`}
              </h2>
              {about.content && (
                <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">
                  {about.content.split(/\n\n/)[0]}
                </p>
              )}
              <Link
                to="/about"
                className="mt-1 text-sm font-bold hover:underline"
                style={{ color: 'var(--brand)' }}
              >
                {t(language, 'readOurStory')} →
              </Link>
            </div>
          </section>
        )}

        {(store?.testimonials?.length > 0) && (
          <Testimonials items={store.testimonials} title={t(language, 'lovedByCustomers')} />
        )}
      </div>
    </>
  );
}
