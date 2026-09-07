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
import { Empty, ProductSkeleton, Button } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const SORTS = [
  ['', 'Featured'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['popularity', 'Popular'],
];

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
  const { data, loading, error } = useApi(
    () => api.shop.products({
      categoryId: categoryId || undefined,
      sort: sort || undefined,
      inStock: inStock || undefined,
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

  return (
    <>
      {store && (
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
      )}

      <div className="wrap py-6">
        {viewed.length > 0 && !unserviceable && (
          <section className="mb-8">
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
                key={l.listingId}
                listing={l}
                qty={qtyByListing.get(String(l.listingId))?.qty || 0}
                busy={busyId === l.listingId}
                onAdd={add}
                onQty={(n) => changeQty(l, n)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
