import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PackageSearch, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useCartActions } from '../lib/useCart.js';
import ProductCard from '../components/ProductCard.jsx';
import { Button, Empty, ProductSkeleton } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const SORTS = [
  ['relevance', 'Relevance'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['popularity', 'Popular'],
];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pincode = useShop((s) => s.pincode);
  const serviceability = useShop((s) => s.serviceability);
  const openPin = useShop((s) => s.openPin);
  const { qtyByListing, busyId, add, changeQty } = useCartActions();

  const q = (params.get('q') || '').trim();
  const categoryId = params.get('categoryId') || '';
  const sort = params.get('sort') || 'relevance';
  const inStock = params.get('inStock') === '1';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || v === false) next.delete(k);
      else next.set(k, String(v === true ? '1' : v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data: categories } = useApi(() => api.shop.categories(), []);
  const { data, meta, loading, error } = useApi(
    () => api.shop.products({
      search: q || undefined,
      categoryId: categoryId || undefined,
      sort: sort || undefined,
      inStock: inStock || undefined,
      groupBy: 'master',
      page,
      limit: 24,
    }),
    [q, categoryId, sort, inStock, page]
  );

  const items = data || [];
  const facets = meta?.facets || {};
  const tree = categories || [];
  const unserviceable = Boolean(pincode && serviceability && serviceability.serviceable === false);
  const facetCats = useMemo(() => {
    if (facets.categories?.length) return facets.categories;
    return tree.map((c) => ({ id: String(c.id), name: c.name, count: null }));
  }, [facets, tree]);

  return (
    <div className="wrap py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {q ? <>Results for “{q}”</> : 'Browse'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? 'Searching…' : `${meta?.total ?? items.length} product${(meta?.total ?? items.length) === 1 ? '' : 's'}`}
          {q && <> for “<span className="font-medium text-slate-700">{q}</span>”</>}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Category</p>
            <div className="flex flex-wrap gap-2 lg:flex-col">
              <button type="button" onClick={() => set({ categoryId: '' })} className={cn('chip', !categoryId && 'chip-active')}>All</button>
              {facetCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set({ categoryId: String(c.id) === categoryId ? '' : String(c.id) })}
                  className={cn('chip', categoryId === String(c.id) && 'chip-active')}
                >
                  {c.name || 'Category'}
                  {c.count != null && <span className="opacity-70">· {c.count}</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Availability</p>
            <button
              type="button"
              onClick={() => set({ inStock: !inStock })}
              className={cn('chip', inStock && 'chip-active')}
            >
              In stock{facets.inStock != null ? ` · ${facets.inStock}` : ''}
            </button>
          </div>
          {facets.priceRange && (
            <p className="text-xs text-slate-400">
              ₹{Math.round(facets.priceRange.min)} – ₹{Math.round(facets.priceRange.max)}
            </p>
          )}
        </aside>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <label className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={sort}
                onChange={(e) => set({ sort: e.target.value })}
                aria-label="Sort products"
                className="input !w-auto rounded-full !py-1.5 pl-8 pr-3 text-sm"
              >
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {unserviceable ? (
            <Empty
              icon={PackageSearch}
              title={`We don't deliver to ${pincode}`}
              message="Try a pin we cover — we will not show a catalogue we cannot fulfil."
              action={<Button variant="soft" onClick={openPin}>Change pincode</Button>}
            />
          ) : loading && !data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <ProductSkeleton key={i} />)}
            </div>
          ) : error ? (
            <Empty icon={PackageSearch} title="Search failed" message={errMsg(error)} />
          ) : items.length === 0 ? (
            <Empty
              icon={PackageSearch}
              title={q ? `Nothing matches “${q}”` : 'No products yet'}
              message={q ? 'Try a different word, or browse the categories.' : 'This store has not listed anything yet.'}
              action={q ? <Button variant="soft" onClick={() => navigate('/')}>Clear search</Button> : null}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
              {meta?.hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => set({ page: page + 1 })}>Load more</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
