import { useEffect, useMemo, useState } from 'react';
import { Check, GitBranch, Layers3, Package, RefreshCw, X } from 'lucide-react';
import { api } from '../../api.js';
import { cn, rid } from '../../lib/utils.js';
import Button from '../../components/ui/Button.jsx';
import { PickerShell } from './CatalogPickers.jsx';
import { bundleVariantLabel } from './bundleComponentUtils.js';

const CACHE_TTL_MS = 60_000;
const variantCache = new Map();
const variantRequests = new Map();

const productId = (item) => String(rid(item) || '');

async function fetchActiveVariants(masterId, force = false) {
  const cached = variantCache.get(masterId);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.variants;
  if (!force && variantRequests.has(masterId)) return variantRequests.get(masterId);
  const request = api.catalogAdmin.masterVariants(masterId)
    .then((response) => {
      const variants = response.data?.variants || [];
      variantCache.set(masterId, { variants, fetchedAt: Date.now() });
      return variants;
    })
    .finally(() => variantRequests.delete(masterId));
  variantRequests.set(masterId, request);
  return request;
}

/** Complete-registry, keyboard-accessible picker for a bundle edge. */
export function BundleComponentProductPicker({
  masters = [], bundleId, value, selectedMaster, onChange, disabled = false,
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState(null);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setRemote(null); setHasMore(false); setSearchError(false); setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true); setSearchError(false);
    const timer = setTimeout(async () => {
      try {
        const response = await api.catalogAdmin.masters({
          status: 'active', search: needle, limit: 50, page: 1, sortBy: 'title', sortOrder: 'asc',
        });
        if (alive) {
          setRemote(response.data || []);
          setHasMore(Boolean(response.meta?.hasMore));
        }
      } catch {
        if (alive) { setRemote([]); setHasMore(false); setSearchError(true); }
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  const normalized = query.trim().toLowerCase();
  const source = remote || masters;
  const visible = source.filter((item) => `${item.title || ''} ${item.skuGlobal || ''} ${item.searchText || ''}`.toLowerCase().includes(normalized));
  const options = visible
    .filter((item) => productId(item) && productId(item) !== String(bundleId))
    .map((item) => ({ ...item, id: productId(item) }));
  const selected = selectedLocal && productId(selectedLocal) === String(value) ? selectedLocal
    : selectedMaster && productId(selectedMaster) === String(value) ? selectedMaster
      : masters.find((item) => productId(item) === String(value))
        || remote?.find((item) => productId(item) === String(value))
        || null;

  return <PickerShell
    label="Component product"
    placeholder="Search title, global SKU or catalog keywords"
    value={String(value || '')}
    selectedLabel={selected?.title}
    selectedMeta={selected ? `${selected.skuGlobal || 'No global SKU'} · ${(selected.kind || 'physical').replace(/_/g, ' ')}` : ''}
    icon={Package}
    query={query}
    setQuery={setQuery}
    options={options}
    active={active}
    setActive={setActive}
    onChoose={(item) => { setSelectedLocal(item); onChange(item); }}
    loading={loading}
    disabled={disabled}
    required
    emptyText={searchError ? 'Product registry search is unavailable' : 'No eligible component product found'}
    emptyHint={searchError ? 'Your current selection is safe. Check the connection and type again.' : 'Search by product title, global SKU, model or catalog keywords.'}
    noResults={Boolean(normalized) && options.length === 0}
    resultHint={searchError ? 'Search could not reach the global catalog.' : hasMore ? 'More matches exist — keep typing to narrow the registry.' : normalized ? 'Searching every active product master; the current bundle is excluded.' : `${options.length} active products loaded · type to search the complete registry`}
    renderOption={(item, state) => <button
      type="button"
      onClick={state.choose}
      onMouseEnter={() => setActive(options.indexOf(item))}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', state.active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100')}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600', state.active && 'bg-white/10 text-violet-200')}><Package className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.title}</span>
        <span className={cn('block truncate font-mono text-[10px]', state.active ? 'text-white/60' : 'text-slate-400')}>{item.skuGlobal || 'No global SKU'} · {(item.kind || 'physical').replace(/_/g, ' ')}</span>
      </span>
      {state.selected && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
    </button>}
  />;
}

/** Fetches and selects only active variants owned by the chosen component. */
export function BundleComponentVariantPicker({
  masterId, value, selectedVariant, onChange, disabled = false,
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setQuery(''); setSelectedLocal(null);
    if (!masterId) { setVariants([]); setLoadError(false); setLoading(false); return undefined; }
    let alive = true;
    setVariants([]); setLoading(true); setLoadError(false);
    fetchActiveVariants(String(masterId), reloadToken > 0)
      .then((items) => { if (alive) setVariants(items); })
      .catch(() => { if (alive) { setVariants([]); setLoadError(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [masterId, reloadToken]);

  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => variants.filter((variant) => `${bundleVariantLabel(variant)} ${variant.sku || ''} ${variant.combinationKey || ''}`.toLowerCase().includes(normalized)), [variants, normalized]);
  const staleSelected = !loading && !loadError && selectedVariant && String(rid(selectedVariant)) === String(value)
    && !variants.some((variant) => String(rid(variant)) === String(value));
  const options = [
    { id: '__any__', clear: true, displayLabel: 'Any active variant' },
    ...(staleSelected ? [{ ...selectedVariant, id: String(value), unavailable: true, disabled: true }] : []),
    ...visible.map((variant) => ({ ...variant, id: String(rid(variant)) })),
  ];
  const selected = selectedLocal && String(rid(selectedLocal)) === String(value) ? selectedLocal
    : selectedVariant && String(rid(selectedVariant)) === String(value) ? selectedVariant
      : variants.find((variant) => String(rid(variant)) === String(value))
        || null;

  return <div>
    <PickerShell
      label="Component variant"
      placeholder={masterId ? 'Any active variant' : 'Select a component product first'}
      value={String(value || '')}
      selectedLabel={selected ? bundleVariantLabel(selected) : undefined}
      selectedMeta={selected ? `${selected.sku || selected.combinationKey || 'Exact component SKU'}${staleSelected ? ' · no longer active' : ''}` : masterId ? 'Not pinned — bundle can use the product default' : ''}
      icon={GitBranch}
      query={query}
      setQuery={setQuery}
      options={options}
      active={active}
      setActive={setActive}
      onChoose={(item) => {
        const next = item.clear ? null : item;
        setSelectedLocal(next);
        onChange(item.clear ? '' : item.id, next);
      }}
      onClear={value ? () => { setSelectedLocal(null); onChange('', null); } : undefined}
      loading={loading}
      disabled={disabled || !masterId}
      emptyText="No matching variant found"
      emptyHint="Try a label, SKU, option value or combination key."
      noResults={Boolean(normalized) && visible.length === 0}
      resultHint={loadError ? 'Variants could not be loaded; retry below without losing this row.' : loading ? 'Loading active variants from the selected product…' : variants.length ? `${variants.length} active variant${variants.length === 1 ? '' : 's'} available · pin one or keep the product default` : 'This product has no active variants. Keep “Any active variant” or choose another product.'}
      renderOption={(item, state) => {
        const OptionIcon = item.clear ? Layers3 : item.unavailable ? X : GitBranch;
        return <button
          type="button"
          disabled={item.unavailable}
          onClick={state.choose}
          onMouseEnter={() => { if (!item.unavailable) setActive(options.filter((option) => !option.disabled).indexOf(item)); }}
          className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', item.unavailable ? 'cursor-not-allowed bg-rose-50/60 text-rose-500' : state.active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100')}
        >
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600', item.clear && 'bg-slate-100 text-slate-500', state.active && 'bg-white/10 text-sky-200')}><OptionIcon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{bundleVariantLabel(item)}</span><span className={cn('block truncate font-mono text-[10px]', state.active ? 'text-white/60' : 'text-slate-400')}>{item.clear ? 'Use the product default at fulfillment' : item.unavailable ? 'Inactive or removed — select another variant' : item.sku || item.combinationKey || 'Active SKU'}</span></span>
          {(state.selected || (item.clear && !value)) && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
        </button>;
      }}
    />
    {loadError && <Button type="button" size="sm" variant="ghost" icon={RefreshCw} className="mt-1" onClick={() => setReloadToken((token) => token + 1)}>Retry variant lookup</Button>}
  </div>;
}
