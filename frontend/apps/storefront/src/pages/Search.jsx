import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PackageSearch, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useCatalogFeed } from '../lib/useCatalogFeed.js';
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
  // Brand-filtered listing (?brand=<id>) — the brands page and brand rails
  // land here. `brandName` is a display hint so the header renders before
  // (or without) the brand-index fetch below.
  const brandId = params.get('brand') || '';
  const brandNameParam = params.get('brandName') || '';
  const sort = params.get('sort') || 'relevance';
  const inStock = params.get('inStock') === '1';
  const minPrice = params.get('minPrice') || '';
  const maxPrice = params.get('maxPrice') || '';
  const attributesParam = params.get('attributes') || '';
  const [filtersOpen, setFiltersOpen] = useState(false);
  const selectedAttributes = useMemo(() => {
    try {
      const parsed = JSON.parse(attributesParam || '{}');
      return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [attributesParam]);
  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || v === false) next.delete(k);
      else next.set(k, String(v === true ? '1' : v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const toggleAttribute = (key, value) => {
    const next = { ...selectedAttributes };
    const current = Array.isArray(next[key]) ? next[key] : [];
    const identity = JSON.stringify(value);
    const exists = current.some((item) => JSON.stringify(item) === identity);
    const values = exists
      ? current.filter((item) => JSON.stringify(item) !== identity)
      : [...current, value];
    if (values.length) next[key] = values;
    else delete next[key];
    set({ attributes: Object.keys(next).length ? JSON.stringify(next) : '' });
  };

  const { data: categories } = useApi(() => api.shop.categories(), []);
  // Resolve the brand's display name when the link didn't carry one. Skipped
  // entirely for plain searches (no brand → no extra call).
  const { data: storeBrands } = useApi(
    () => (brandId && !brandNameParam ? api.shop.storeBrands() : Promise.resolve({ data: [] })),
    [brandId, brandNameParam]
  );
  const {
    data, meta, loading, loadingMore, error, loadMore, refetch,
  } = useCatalogFeed({
    search: q || undefined,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    sort: sort || undefined,
    inStock: inStock || undefined,
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined,
    attributes: attributesParam || undefined,
  }, { limit: 24 });

  const items = data || [];
  const facets = meta?.facets || {};
  const tree = categories || [];
  const brandName = brandNameParam
    || (storeBrands || []).find((b) => String(b.id) === brandId)?.name
    || '';
  const unserviceable = Boolean(pincode && serviceability && serviceability.serviceable === false);
  const activeFilterCount = [categoryId, brandId, inStock, minPrice || maxPrice]
    .filter(Boolean).length + Object.values(selectedAttributes).filter((value) => Array.isArray(value) ? value.length : value != null).length;
  const facetCats = useMemo(() => {
    if (facets.categories?.length) return facets.categories;
    return tree.map((c) => ({ id: String(c.id), name: c.name, count: null }));
  }, [facets, tree]);

  return (
    <div className="wrap py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {q ? <>Results for “{q}”</> : brandId ? <>Shop {brandName || 'brand'}</> : 'Browse'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? 'Searching…' : `${meta?.total ?? items.length} product${(meta?.total ?? items.length) === 1 ? '' : 's'}`}
          {q && <> for “<span className="font-medium text-slate-700">{q}</span>”</>}
        </p>
        {brandId && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="chip chip-active">
              {brandName || 'Brand'}
              <button
                type="button"
                onClick={() => set({ brand: '', brandName: '' })}
                aria-label="Clear brand filter"
                className="ml-1 grid h-5 w-5 place-items-center rounded-full bg-white/20 text-xs leading-none"
              >
                ×
              </button>
            </span>
            <button
              type="button"
              onClick={() => navigate('/brands')}
              className="text-xs font-semibold text-slate-500 hover:underline"
            >
              All brands →
            </button>
          </div>
        )}
        {(inStock || minPrice || maxPrice || Object.keys(selectedAttributes).length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Active filters">
            {inStock && <button type="button" className="chip chip-active" onClick={() => set({ inStock: '' })}>In stock <X className="h-3 w-3" /></button>}
            {(minPrice || maxPrice) && <button type="button" className="chip chip-active" onClick={() => set({ minPrice: '', maxPrice: '' })}>₹{minPrice || '0'}–{maxPrice || 'Any'} <X className="h-3 w-3" /></button>}
            {Object.entries(selectedAttributes).flatMap(([key, values]) => (Array.isArray(values) ? values : []).map((value) => (
              <button key={`${key}:${JSON.stringify(value)}`} type="button" className="chip chip-active" onClick={() => toggleAttribute(key, value)}>
                {key.replace(/_/g, ' ')}: {String(value)} <X className="h-3 w-3" />
              </button>
            )))}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
        >
          <SlidersHorizontal className="h-4 w-4" /> Filters
          {activeFilterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1 text-[10px] text-white">{activeFilterCount}</span>}
        </button>
        {activeFilterCount > 0 && <button type="button" onClick={() => set({ categoryId: '', brand: '', brandName: '', inStock: '', minPrice: '', maxPrice: '', attributes: '' })} className="text-xs font-semibold text-rose-600">Clear all</button>}
      </div>
      {filtersOpen && <button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)} className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden" />}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className={cn(
          'space-y-5 lg:sticky lg:top-24 lg:self-start',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(88vw,360px)] max-lg:overflow-y-auto max-lg:bg-white max-lg:p-5 max-lg:shadow-2xl max-lg:transition-transform',
          filtersOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )} aria-label="Product filters">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 lg:hidden">
            <div><p className="font-display text-xl text-slate-900">Filters</p><p className="text-xs text-slate-500">{meta?.total ?? items.length} matching products</p></div>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600"><X className="h-5 w-5" /></button>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Category</p>
            <div className="flex flex-wrap gap-2 lg:flex-col">
              <button type="button" onClick={() => set({ categoryId: '', attributes: '' })} className={cn('chip', !categoryId && 'chip-active')}>All</button>
              {facetCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set({ categoryId: String(c.id) === categoryId ? '' : String(c.id), attributes: '' })}
                  className={cn('chip', categoryId === String(c.id) && 'chip-active')}
                >
                  {c.name || 'Category'}
                  {c.count != null && <span className="opacity-70">· {c.count}</span>}
                </button>
              ))}
            </div>
          </div>
          {facets.brands?.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Brand</p>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {facets.brands.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => set({ brand: brandId === String(brand.id) ? '' : brand.id, brandName: brand.name || '' })}
                    className={cn('chip', brandId === String(brand.id) && 'chip-active')}
                  >
                    {brand.name || 'Brand'} <span className="opacity-70">· {brand.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Price</p>
            <form
              key={`${minPrice}-${maxPrice}-${facets.priceRange?.min}-${facets.priceRange?.max}`}
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                set({ minPrice: form.get('minPrice'), maxPrice: form.get('maxPrice') });
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-500">
                  Minimum
                  <input name="minPrice" type="number" min="0" step="1" defaultValue={minPrice} placeholder={facets.priceRange?.min != null ? `₹${Math.floor(facets.priceRange.min)}` : '₹0'} className="input mt-1 !py-1.5 text-sm" />
                </label>
                <label className="text-[11px] text-slate-500">
                  Maximum
                  <input name="maxPrice" type="number" min="0" step="1" defaultValue={maxPrice} placeholder={facets.priceRange?.max != null ? `₹${Math.ceil(facets.priceRange.max)}` : 'Any'} className="input mt-1 !py-1.5 text-sm" />
                </label>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="soft" className="!px-3 !py-1.5 text-xs">Apply</Button>
                {(minPrice || maxPrice) && <Button type="button" variant="ghost" className="!px-2 !py-1.5 text-xs" onClick={() => set({ minPrice: '', maxPrice: '' })}>Clear</Button>}
              </div>
            </form>
          </div>
          {(facets.attributes || []).map((facet) => (
            <div key={facet.key}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {facet.label}{facet.unit ? ` · ${facet.unit}` : ''}
              </p>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto lg:flex-col lg:flex-nowrap">
                {facet.values.map((option) => {
                  const selected = (selectedAttributes[facet.key] || [])
                    .some((value) => JSON.stringify(value) === JSON.stringify(option.value));
                  return (
                    <button
                      key={`${facet.key}:${JSON.stringify(option.value)}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAttribute(facet.key, option.value)}
                      className={cn('chip justify-between', selected && 'chip-active')}
                    >
                      <span className="truncate">{String(option.value)}</span>
                      {option.count != null && <span className="opacity-65">· {option.count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
          <div className="sticky bottom-0 -mx-5 border-t border-slate-200 bg-white/95 p-4 backdrop-blur lg:hidden">
            <Button className="w-full justify-center" onClick={() => setFiltersOpen(false)}>View {meta?.total ?? items.length} products</Button>
          </div>
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
          ) : error && !data ? (
            <Empty icon={PackageSearch} title="Search failed" message={errMsg(error)} action={<Button variant="soft" onClick={refetch}>Try again</Button>} />
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
                <div className="mt-6 flex flex-col items-center gap-2">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading more…' : `Show more · ${items.length} of ${meta.total}`}
                  </Button>
                  {error && <span role="alert" className="text-xs text-rose-600">Could not load the next page. Your current products are still here—try again.</span>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
