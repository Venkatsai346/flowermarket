import { MapPin, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useCartActions } from '../lib/useCart.js';
import ProductCard from '../components/ProductCard.jsx';
import { Empty, ProductSkeleton, Button } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';
import { useState } from 'react';

const SORTS = [
  ['', 'Featured'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['popularity', 'Popular'],
];

export default function Home() {
  const store = useShop((s) => s.store);
  const pincode = useShop((s) => s.pincode);
  const serviceability = useShop((s) => s.serviceability);
  const openPin = useShop((s) => s.openPin);
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

  return (
    <>
      {store && (
        <section className="relative overflow-hidden border-b border-slate-200/70" style={{ background: 'var(--brand-soft)' }}>
          <div className="wrap flex flex-col gap-4 py-10 sm:py-14">
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {store.tagline || `Fresh from ${store.name}`}
            </h1>
            {store.description && (
              <p className="max-w-xl text-sm leading-relaxed text-slate-600">{store.description}</p>
            )}
            <button
              type="button"
              onClick={openPin}
              className="inline-flex w-fit items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200/80"
            >
              <MapPin className="h-3.5 w-3.5" />
              {pincode
                ? (serviceability && !serviceability.serviceable
                  ? `We don't deliver to ${pincode}`
                  : `Delivering to ${pincode}`)
                : 'Set your pincode for slots'}
            </button>
          </div>
        </section>
      )}

      <div className="wrap py-6">
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
          <Empty icon={PackageSearch} title="Could not load products" message={errMsg(error)} />
        ) : items.length === 0 ? (
          <Empty
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
