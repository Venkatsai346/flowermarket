import { useEffect, useMemo, useState } from 'react';
import { PackageSearch, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import ProductCard from '../components/ProductCard.jsx';
import ProductSheet from '../components/ProductSheet.jsx';
import { Empty, ProductSkeleton, Button } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const SORTS = [
  ['', 'Featured'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['popularity', 'Popular'],
];

export default function Home({ query }) {
  const store = useShop((s) => s.store);
  const cart = useShop((s) => s.cart);
  const setCart = useShop((s) => s.setCart);
  const toast = useShop((s) => s.toast);

  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('');
  const [inStock, setInStock] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(null);

  const { data: categories } = useApi(() => api.shop.categories(), []);
  const { data, loading, error } = useApi(
    () => api.shop.products({
      search: query || undefined,
      categoryId: categoryId || undefined,
      sort: sort || undefined,
      inStock: inStock || undefined,
      limit: 24,
    }),
    [query, categoryId, sort, inStock]
  );

  /** listingId → qty, so a tile can render its own stepper. */
  const qtyByListing = useMemo(() => {
    const m = new Map();
    for (const it of cart?.items || []) m.set(String(it.tenantProductId), { qty: it.qty, itemId: it.id });
    return m;
  }, [cart]);

  const add = async (listing) => {
    setBusyId(listing.listingId);
    try {
      const r = await api.shop.addItem({ tenantProductId: listing.listingId, qty: 1 });
      setCart(r.data);
      toast(`${listing.product?.title} added`, 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changeQty = async (listing, qty) => {
    const entry = qtyByListing.get(String(listing.listingId));
    if (!entry) return;
    setBusyId(listing.listingId);
    try {
      const r = qty <= 0
        ? await api.shop.removeItem(entry.itemId)
        : await api.shop.updateItem(entry.itemId, { qty });
      setCart(r.data);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const items = data || [];
  const tree = categories || [];

  return (
    <>
      {!query && store && (
        <section className="relative overflow-hidden border-b border-slate-200/70" style={{ background: 'var(--brand-soft)' }}>
          <div className="wrap flex flex-col gap-4 py-10 sm:py-14">
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {store.tagline || `Fresh from ${store.name}`}
            </h1>
            {store.description && (
              <p className="max-w-xl text-sm leading-relaxed text-slate-600">{store.description}</p>
            )}
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Same-day delivery slots available
            </div>
          </div>
        </section>
      )}

      <div className="wrap py-6">
        {/* category rail */}
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
            {query && <> for “<span className="font-medium text-slate-700">{query}</span>”</>}
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

        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
          </div>
        ) : error ? (
          <Empty icon={PackageSearch} title="Could not load products" message={errMsg(error)} />
        ) : items.length === 0 ? (
          <Empty
            icon={PackageSearch}
            title={query ? `Nothing matches “${query}”` : 'No products yet'}
            message={query ? 'Try a different word, or browse the categories above.' : 'This store has not listed anything yet.'}
            action={query ? <Button variant="soft" onClick={() => window.location.assign('/')}>Clear search</Button> : null}
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
                onQty={(q) => changeQty(l, q)}
                onOpen={setOpen}
              />
            ))}
          </div>
        )}
      </div>

      {open && (
        <ProductSheet
          listing={open}
          qty={qtyByListing.get(String(open.listingId))?.qty || 0}
          onClose={() => setOpen(null)}
          onAdd={add}
          onQty={(q) => changeQty(open, q)}
        />
      )}
    </>
  );
}
