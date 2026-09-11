import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ChevronLeft, Search, SlidersHorizontal, Store } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { t } from '../i18n.js';
import BrandCard from '../components/BrandCard.jsx';
import { Button, Empty, Skeleton } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const SORTS = [
  ['featured', 'Featured'],
  ['name', 'Name A–Z'],
  ['products', 'Most products'],
  ['price', 'Lowest starting price'],
];

/**
 * Brands index — every brand this store actually sells (server-scoped to the
 * tenant's live listings), with client-side search / sort / verified filter.
 * Route: /brands
 */
export default function Brands() {
  const language = useShop((s) => s.language);
  const store = useShop((s) => s.store);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('featured');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const { data, loading, error, refetch } = useApi(() => api.shop.storeBrands(), []);

  const brands = useMemo(() => {
    const list = (data || []).filter((b) => {
      if (verifiedOnly && !b.isVerified) return false;
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [b.name, b.tagline, b.description, b.headquarters]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(needle));
    });
    const by = {
      featured: (a, b) =>
        Number(b.isFeatured || false) - Number(a.isFeatured || false)
        || (b.productCount || 0) - (a.productCount || 0),
      name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      products: (a, b) => (b.productCount || 0) - (a.productCount || 0),
      price: (a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity),
    };
    return [...list].sort(by[sort] || by.featured);
  }, [data, q, sort, verifiedOnly]);

  return (
    <div className="wrap py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> {t(language, 'backToShop')}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-slate-900">
            {t(language, 'brandsAt', store?.name || '')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? t(language, 'loading') : t(language, 'brandCount', brands.length)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(language, 'searchBrands')}
            aria-label={t(language, 'searchBrands')}
            className="input rounded-full !py-2 pl-10"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVerifiedOnly((v) => !v)}
            aria-pressed={verifiedOnly}
            className={cn('chip', verifiedOnly && 'chip-active')}
          >
            <BadgeCheck className="h-3.5 w-3.5" /> {t(language, 'verifiedOnly')}
          </button>
          <label className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort brands"
              className="input !w-auto rounded-full !py-1.5 pl-8 pr-3 text-sm"
            >
              {SORTS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && !data ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <Skeleton className="h-24 w-full rounded-none sm:h-28" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-8">
          <Empty
            floral
            icon={Store}
            title={t(language, 'couldNotLoadBrands')}
            message={errMsg(error)}
            action={<Button variant="soft" onClick={() => refetch()}>{t(language, 'retry')}</Button>}
          />
        </div>
      ) : brands.length === 0 ? (
        <div className="mt-8">
          <Empty
            floral
            icon={Store}
            title={q || verifiedOnly ? t(language, 'noBrandsMatch') : t(language, 'noBrandsYet')}
            message={q || verifiedOnly ? t(language, 'noBrandsMatchMsg') : t(language, 'noBrandsYetMsg')}
            action={
              (q || verifiedOnly) && (
                <Button variant="soft" onClick={() => { setQ(''); setVerifiedOnly(false); }}>
                  {t(language, 'clearFilters')}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <BrandCard key={b.id} brand={b} />
          ))}
        </div>
      )}
    </div>
  );
}
