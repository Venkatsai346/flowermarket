import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useCatalogFeed } from '../lib/useCatalogFeed.js';
import { useCartActions } from '../lib/useCart.js';
import ProductCard from '../components/ProductCard.jsx';
import ProductImage from '../components/ProductImage.jsx';
import { Empty, Money, ProductSkeleton, Button } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

/** Flatten a nested category tree (global-nav fallback) into id-keyed rows. */
function flattenTree(nodes, out = []) {
  for (const n of nodes || []) {
    out.push(n);
    if (n.children?.length) flattenTree(n.children, out);
  }
  return out;
}

/**
 * Category browse page — dedicated experience for browsing by category.
 * Shows a grid of subcategories at the top, then products in the selected category.
 *
 * Route: /browse?category=:id or /browse/:slug
 */
export default function Browse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('category') || '';
  const sort = searchParams.get('sort') || '';
  const inStock = searchParams.get('inStock') === '1';
  const attributesParam = searchParams.get('attributes') || '';
  const selectedAttributes = useMemo(() => {
    try {
      const parsed = JSON.parse(attributesParam || '{}');
      return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [attributesParam]);
  const { qtyByListing, busyId, add, changeQty } = useCartActions();

  const { data: categories } = useApi(() => api.shop.categories(), []);
  // Store-scoped index: live counts per category (+ subtree roll-up). The
  // global tree stays as the nav fallback when the store index is empty.
  const { data: storeCats } = useApi(() => api.shop.storeCategories(), []);
  const {
    data, meta, loading, loadingMore, error, loadMore, refetch,
  } = useCatalogFeed({
    categoryId: categoryId || undefined,
    sort: sort || undefined,
    inStock: inStock || undefined,
    attributes: attributesParam || undefined,
  }, { limit: 24 });

  const items = data || [];
  const tree = categories || [];

  // Flat lookup: store index first (it carries counts), global tree flattened.
  const flat = useMemo(() => {
    if (storeCats?.flat?.length) return storeCats.flat;
    return flattenTree(tree);
  }, [storeCats, tree]);
  const byId = useMemo(() => new Map(flat.map((c) => [String(c.id), c])), [flat]);
  const current = categoryId ? byId.get(categoryId) : null;

  // Breadcrumb walks parentIds through the FLAT map, so nested categories
  // resolve no matter how deep they sit (the old roots-only search broke
  // below the first level).
  const breadcrumb = useMemo(() => {
    if (!categoryId || !byId.size) return [];
    const path = [];
    const seen = new Set();
    let node = byId.get(categoryId);
    while (node && !seen.has(String(node.id))) {
      seen.add(String(node.id));
      path.unshift(node);
      node = node.parentId ? byId.get(String(node.parentId)) : null;
    }
    return path;
  }, [categoryId, byId]);

  // Children with live counts (store tree when available).
  const children = useMemo(() => {
    if (storeCats?.tree?.length) {
      const find = (nodes) => {
        for (const n of nodes) {
          if (String(n.id) === categoryId) return n.children || [];
          const hit = find(n.children || []);
          if (hit) return hit;
        }
        return null;
      };
      if (!categoryId) return storeCats.tree;
      return find(storeCats.tree) || [];
    }
    if (!categoryId) return tree.filter((c) => !c.parentId);
    return flat.filter((c) => String(c.parentId || '') === categoryId);
  }, [categoryId, storeCats, tree, flat]);

  const currentName = current?.name || (breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'All Products');
  const currentTotal = current ? Number(current.totalCount ?? current.productCount ?? items.length) : null;

  const setCategory = (id) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('category', id);
    else params.delete('category');
    params.delete('attributes');
    setSearchParams(params);
  };
  const toggleAttribute = (key, value) => {
    const next = { ...selectedAttributes };
    const current = Array.isArray(next[key]) ? next[key] : [];
    const identity = JSON.stringify(value);
    const values = current.some((item) => JSON.stringify(item) === identity)
      ? current.filter((item) => JSON.stringify(item) !== identity)
      : [...current, value];
    if (values.length) next[key] = values;
    else delete next[key];
    const params = new URLSearchParams(searchParams);
    if (Object.keys(next).length) params.set('attributes', JSON.stringify(next));
    else params.delete('attributes');
    setSearchParams(params);
  };

  return (
    <div className="wrap py-6">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link to="/browse" className="hover:text-slate-800">Browse</Link>
        {breadcrumb.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3" />
            <button
              type="button"
              onClick={() => setCategory(String(c.id))}
              className="hover:text-slate-800"
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Category header — banner, story, live counts */}
      {current ? (
        <div className="card mb-2 overflow-hidden">
          {(current.bannerUrl || current.imageUrl) && (
            <div className="relative h-36 overflow-hidden sm:h-44">
              <ProductImage
                src={current.bannerUrl || current.imageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
            </div>
          )}
          <div className="p-4 sm:p-5">
            <h1 className="font-display text-2xl text-slate-900">{currentName}</h1>
            {current.description && (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{current.description}</p>
            )}
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {currentTotal} product{currentTotal === 1 ? '' : 's'}
              {current.fromPrice != null && (
                <span className="text-slate-400">
                  {' '}· from <Money value={current.fromPrice} className="font-bold text-slate-700" />
                </span>
              )}
            </p>
          </div>
        </div>
      ) : (
        <h1 className="font-display text-2xl text-slate-900">{currentName}</h1>
      )}

      {/* Subcategories */}
      {children.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(String(c.id))}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-2xl border border-slate-200 p-3 transition hover:border-rose-300 hover:bg-rose-50',
                categoryId === String(c.id) && 'border-rose-400 bg-rose-50',
              )}
            >
              <span className="block h-16 w-16 overflow-hidden rounded-xl bg-slate-100">
                <ProductImage src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
              </span>
              <span className="text-center text-xs font-medium text-slate-700 group-hover:text-rose-700">
                {c.name}
              </span>
              {(c.totalCount ?? c.productCount) != null && (
                <span className="text-[10px] tabular-nums text-slate-400">
                  {c.totalCount ?? c.productCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Sort bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-1 text-sm text-slate-500" aria-live="polite">
            {loading && !data ? 'Loading…' : `${items.length} of ${meta?.total ?? items.length} products`}
          </p>
          <button
            type="button"
            className={cn('chip', inStock && 'chip-active')}
            aria-pressed={inStock}
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              if (inStock) params.delete('inStock');
              else params.set('inStock', '1');
              setSearchParams(params);
            }}
          >
            In stock{meta?.facets?.inStock != null ? ` · ${meta.facets.inStock}` : ''}
          </button>
        </div>
        <label className="relative">
          <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <select
            value={sort}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams);
              if (e.target.value) params.set('sort', e.target.value);
              else params.delete('sort');
              setSearchParams(params);
            }}
            aria-label="Sort products"
            className="input !w-auto rounded-full !py-1.5 pl-8 pr-3 text-sm"
          >
            <option value="">Featured</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest</option>
            <option value="popularity">Popular</option>
          </select>
        </label>
      </div>

      {meta?.facets?.attributes?.length > 0 && (
        <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Refine this category</p>
            {attributesParam && <button type="button" onClick={() => { const params = new URLSearchParams(searchParams); params.delete('attributes'); setSearchParams(params); }} className="text-xs font-semibold text-rose-600">Clear specifications</button>}
          </div>
          {meta.facets.attributes.map((facet) => (
            <div key={facet.key} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <p className="w-32 shrink-0 pt-1 text-xs font-semibold text-slate-600">{facet.label}{facet.unit ? ` (${facet.unit})` : ''}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {facet.values.map((option) => {
                  const selected = (selectedAttributes[facet.key] || []).some((value) => JSON.stringify(value) === JSON.stringify(option.value));
                  return <button key={`${facet.key}:${JSON.stringify(option.value)}`} type="button" aria-pressed={selected} onClick={() => toggleAttribute(facet.key, option.value)} className={cn('chip shrink-0', selected && 'chip-active')}>{String(option.value)} {option.count != null && <span className="opacity-65">· {option.count}</span>}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Products grid */}
      {loading && !data ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
        </div>
      ) : error && !data ? (
        <div className="mt-8">
          <Empty floral icon={PackageSearch} title="Could not load products" message={errMsg(error)} action={<Button variant="soft" onClick={refetch}>Retry</Button>} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <Empty
            floral
            icon={PackageSearch}
            title="No products in this category"
            message="Try browsing a different category."
            action={<Button variant="soft" onClick={() => setCategory('')}>Browse all</Button>}
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            <div className="mt-8 flex flex-col items-center gap-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading more…' : 'Show more products'}
              </Button>
              <span className="text-xs tabular-nums text-slate-400">{items.length} of {meta.total}</span>
              {error && <span role="alert" className="text-xs text-rose-600">Could not load the next page. Your current products are still here—try again.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
