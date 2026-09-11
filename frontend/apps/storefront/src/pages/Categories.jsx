import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, PackageSearch, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { t } from '../i18n.js';
import CategoryCard from '../components/CategoryCard.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { Button, Empty, Skeleton } from '../components/ui.jsx';
import { errMsg } from '../lib/utils.js';

/**
 * Categories index — every category this store actually sells (server-scoped
 * to the tenant's live listings, dead branches pruned, counts rolled up).
 * Route: /categories
 */
export default function Categories() {
  const language = useShop((s) => s.language);
  const store = useShop((s) => s.store);
  const [q, setQ] = useState('');

  const { data, loading, error, refetch } = useApi(() => api.shop.storeCategories(), []);

  const tree = data?.tree || [];
  const flat = data?.flat || [];

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    return flat.filter((c) =>
      [c.name, c.description].filter(Boolean).some((f) => String(f).toLowerCase().includes(needle))
    );
  }, [flat, q]);

  const featured = useMemo(
    () => flat.filter((c) => c.isFeatured && !c.parentId).slice(0, 3),
    [flat]
  );
  const showFeatured = !q.trim() && featured.length > 0;

  return (
    <div className="wrap py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> {t(language, 'backToShop')}
      </Link>

      <div>
        <h1 className="font-display text-3xl tracking-tight text-slate-900">
          {t(language, 'categoriesAt', store?.name || '')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading
            ? t(language, 'loading')
            : t(language, 'categoryCount', flat.length)}
        </p>
      </div>

      <label className="relative mt-5 block max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(language, 'searchCategories')}
          aria-label={t(language, 'searchCategories')}
          className="input rounded-full !py-2 pl-10"
        />
      </label>

      {loading && !data ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <Skeleton className="aspect-[16/10] w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-8">
          <Empty
            floral
            icon={PackageSearch}
            title={t(language, 'couldNotLoadCategories')}
            message={errMsg(error)}
            action={<Button variant="soft" onClick={() => refetch()}>{t(language, 'retry')}</Button>}
          />
        </div>
      ) : matches ? (
        matches.length === 0 ? (
          <div className="mt-8">
            <Empty
              floral
              icon={PackageSearch}
              title={t(language, 'noCategoriesMatch')}
              message={t(language, 'noCategoriesMatchMsg')}
              action={<Button variant="soft" onClick={() => setQ('')}>{t(language, 'clearSearch')}</Button>}
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((c) => (
              <CategoryCard key={c.id} node={c} showChildren={false} />
            ))}
          </div>
        )
      ) : tree.length === 0 ? (
        <div className="mt-8">
          <Empty
            floral
            icon={PackageSearch}
            title={t(language, 'noCategoriesYet')}
            message={t(language, 'noCategoriesYetMsg')}
          />
        </div>
      ) : (
        <>
          {showFeatured && (
            <section className="mt-6" aria-label={t(language, 'featuredCategories')}>
              <SectionHeader title={t(language, 'featuredCategories')} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((c) => {
                  const node = tree.find((r) => String(r.id) === String(c.id)) || c;
                  return <CategoryCard key={c.id} node={node} />;
                })}
              </div>
            </section>
          )}
          <section className="mt-8" aria-label={t(language, 'allCategories')}>
            {showFeatured && <SectionHeader title={t(language, 'allCategories')} />}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tree.map((c) => (
                <CategoryCard key={c.id} node={c} />
              ))}
            </div>
          </section>
        </>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        <Link to="/browse" className="font-semibold hover:underline" style={{ color: 'var(--brand)' }}>
          {t(language, 'browseAllProducts')} →
        </Link>
      </p>
    </div>
  );
}
