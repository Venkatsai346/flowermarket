import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck, Building2, Check, ChevronDown, Folder, FolderTree,
  Layers3, LoaderCircle, Package, Search, ShieldQuestion, X,
} from 'lucide-react';
import { api } from '../../api.js';
import { cn } from '../../lib/utils.js';
import {
  buildCategoryTree, catalogId, filterCategoryTree, resolveSelectedBrand,
} from './catalogPickerUtils.js';

function useFloatingPanel(open, anchorRef) {
  const [style, setStyle] = useState({});
  useEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 360), viewportWidth - margin * 2);
      const estimatedHeight = Math.min(440, viewportHeight - margin * 2);
      const below = viewportHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const placeAbove = below < Math.min(300, estimatedHeight) && above > below;
      setStyle({
        position: 'fixed',
        zIndex: 120,
        width,
        maxHeight: Math.max(160, Math.min(440, placeAbove ? above : below)),
        left: Math.max(margin, Math.min(rect.left, viewportWidth - width - margin)),
        ...(placeAbove ? { bottom: viewportHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, anchorRef]);
  return style;
}

function PickerShell({
  label, placeholder, value, selectedLabel, selectedMeta, icon: Icon = Package,
  query, setQuery, options, active, setActive, onChoose, onClear, loading,
  emptyText, emptyHint = 'Try a shorter name or another keyword.', renderOption,
  disabled = false, required = false, resultHint, noResults = false,
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const floatingStyle = useFloatingPanel(open, anchorRef);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const outside = (event) => {
      if (!anchorRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); };
  }, [open]);

  useEffect(() => { setActive(0); }, [query, options.length, setActive]);

  const choose = (option) => {
    if (!option || option.disabled) return;
    onChoose(option);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const keyDown = (event) => {
    const enabled = options.filter((option) => !option.disabled);
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, Math.max(enabled.length - 1, 0))); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Enter' && enabled[active]) { event.preventDefault(); choose(enabled[active]); }
  };

  const enabledOptions = options.filter((option) => !option.disabled);
  return (
    <div ref={anchorRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-required={required}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'group flex min-h-11 w-full items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left shadow-sm transition',
          open ? 'border-rose-400 ring-4 ring-rose-100' : 'border-slate-200 hover:border-slate-300 hover:shadow',
          disabled && 'cursor-not-allowed bg-slate-50 opacity-60',
        )}
      >
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg transition', value ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400')}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-semibold', value ? 'text-slate-900' : 'text-slate-400')}>{selectedLabel || placeholder}</span>
          {selectedMeta && <span className="mt-0.5 block truncate text-[11px] text-slate-400">{selectedMeta}</span>}
        </span>
        {value && onClear && <span className="h-7 w-7 shrink-0" aria-hidden="true" />}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {value && onClear && (
        <button type="button" aria-label={`Clear ${label}`} onClick={() => { onClear(); setQuery(''); setOpen(false); triggerRef.current?.focus(); }} className="absolute right-8 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-300">
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && createPortal(
        <div ref={panelRef} style={floatingStyle} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20" onKeyDown={keyDown}>
          <div className="border-b border-slate-100 p-3">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-rose-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-rose-50">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" role="searchbox" aria-controls={listId} aria-activedescendant={enabledOptions[active] ? `${listId}-${enabledOptions[active].id}` : undefined} autoComplete="off" />
              {loading && <LoaderCircle className="h-4 w-4 animate-spin text-rose-500" />}
              {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-600"><X className="h-4 w-4" /></button>}
            </div>
            {resultHint && <p className="mt-2 px-1 text-[11px] text-slate-400">{resultHint}</p>}
          </div>
          <div id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {!loading && (noResults || !options.length) && <div className="px-4 py-8 text-center"><Search className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-sm font-medium text-slate-600">{emptyText}</p><p className="mt-1 text-xs text-slate-400">{emptyHint}</p></div>}
            {options.map((option) => {
              const enabledIndex = enabledOptions.indexOf(option);
              return <div key={option.id} id={`${listId}-${option.id}`} role="option" aria-selected={option.id === value} aria-disabled={option.disabled || undefined}>{renderOption(option, { active: !option.disabled && enabledIndex === active, selected: option.id === value, choose: () => choose(option) })}</div>;
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] text-slate-400"><span>↑↓ navigate · enter select · esc close</span><span>{enabledOptions.length} selectable</span></div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function CategoryPicker({
  categories, value, onChange, selectedCategory, required = false, disabled = false,
  placeholder = 'Select a category',
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const all = useMemo(() => buildCategoryTree(categories), [categories]);
  const selected = all.find((item) => item.id === value) || (selectedCategory ? { ...selectedCategory, id: catalogId(selectedCategory), path: selectedCategory.name } : null);
  const normalized = query.trim().toLowerCase();
  const options = useMemo(() => filterCategoryTree(all, normalized), [all, normalized]);
  const leafCount = all.filter((item) => item.isLeaf).length;

  return <PickerShell
    label="Category"
    placeholder={placeholder}
    value={value}
    selectedLabel={selected?.name}
    selectedMeta={selected?.path && selected.path !== selected.name ? selected.path : selected ? `${selected.attributeSchema?.length || 0} governed specifications` : ''}
    icon={FolderTree}
    query={query}
    setQuery={setQuery}
    options={options}
    active={active}
    setActive={setActive}
    onChoose={(item) => onChange(item.id)}
    onClear={!required ? () => onChange('') : undefined}
    loading={false}
    required={required}
    disabled={disabled}
    emptyText="No category found"
    resultHint={normalized ? 'Matching categories include their full taxonomy path.' : `${leafCount} product categories · select a leaf to inherit its schema and compliance rules`}
    renderOption={(item, state) => {
      const BranchIcon = item.isLeaf ? Package : item.depth === 0 ? Layers3 : Folder;
      return <button type="button" disabled={item.disabled} onClick={state.choose} onMouseEnter={() => { if (!item.disabled) setActive(options.filter((option) => !option.disabled).indexOf(item)); }} className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition', item.disabled ? 'cursor-default bg-slate-50/70 text-slate-500' : state.active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100')} style={!normalized ? { paddingLeft: `${12 + Math.min(item.depth, 4) * 20}px` } : undefined}>
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', item.disabled ? 'bg-white text-slate-400 ring-1 ring-slate-200' : state.active ? 'bg-white/10 text-rose-300' : 'bg-rose-50 text-rose-500')}><BranchIcon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.name}</span><span className={cn('block truncate text-[10px]', state.active ? 'text-white/60' : 'text-slate-400')}>{normalized ? item.path : item.isLeaf ? `${item.attributeSchema?.length || 0} specifications · ${item.complianceRequirements?.length || 0} compliance rules` : `${item.children.length} child ${item.children.length === 1 ? 'group' : 'groups'}`}</span></span>
        {state.selected && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
      </button>;
    }}
  />;
}

export function BrandPicker({
  brands = [], value, onChange, selectedBrand, disabled = false,
  placeholder = 'Search and select a brand', emptyLabel = 'No brand / unbranded',
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState(null);
  const selected = resolveSelectedBrand({ value, remote, loaded: brands, selectedLocal, selectedBrand });

  useEffect(() => {
    const needle = query.trim();
    if (!needle) { setRemote(null); setHasMore(false); setSearchError(false); setLoading(false); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const response = await api.catalogAdmin.brands({ search: needle, limit: 100, page: 1 });
        if (alive) { setRemote(response.data || []); setHasMore(Boolean(response.meta?.hasMore)); }
      } catch {
        if (alive) { setRemote([]); setHasMore(false); setSearchError(true); }
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  const source = remote || brands;
  const normalized = query.trim().toLowerCase();
  const visible = remote || source.filter((brand) => `${brand.name} ${brand.slug || ''}`.toLowerCase().includes(normalized));
  const options = [
    { id: '__none__', name: emptyLabel, clear: true },
    ...visible.map((brand) => ({ ...brand, id: catalogId(brand) })),
  ];

  return <PickerShell
    label="Brand"
    placeholder={placeholder}
    value={value}
    selectedLabel={selected?.name}
    selectedMeta={selected ? `${selected.verification?.isVerified ? 'Verified brand' : 'Unverified brand'}${selected.countryOfOrigin ? ` · ${selected.countryOfOrigin}` : ''}` : ''}
    icon={Building2}
    query={query}
    setQuery={setQuery}
    options={options}
    active={active}
    setActive={setActive}
    onChoose={(item) => { setSelectedLocal(item.clear ? null : item); onChange(item.clear ? '' : item.id); }}
    onClear={() => { setSelectedLocal(null); onChange(''); }}
    loading={loading}
    disabled={disabled}
    emptyText={searchError ? 'Brand registry search is unavailable' : 'No brand found'}
    emptyHint={searchError ? 'You can retry without losing the current selection.' : 'Try a shorter name or another keyword.'}
    noResults={Boolean(normalized) && visible.length === 0}
    resultHint={searchError ? 'Check your connection and type again to retry.' : hasMore ? 'More than 100 matches — keep typing to narrow the registry.' : normalized ? 'Searching the complete global brand registry.' : `${brands.length} loaded · type to search all brands`}
    renderOption={(item, state) => {
      const verified = item.verification?.isVerified;
      const OptionIcon = item.clear ? X : verified ? BadgeCheck : ShieldQuestion;
      return <button type="button" onClick={state.choose} onMouseEnter={() => setActive(options.indexOf(item))} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', state.active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100')}>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', item.clear ? 'bg-slate-100 text-slate-400' : verified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600', state.active && 'bg-white/10 text-white')}><OptionIcon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.name}</span><span className={cn('block truncate text-[10px]', state.active ? 'text-white/60' : 'text-slate-400')}>{item.clear ? 'Products without a registered consumer brand' : `${verified ? 'Verified' : 'Pending verification'}${item.countryOfOrigin ? ` · ${item.countryOfOrigin}` : ''}`}</span></span>
        {(state.selected || (item.clear && !value)) && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
      </button>;
    }}
  />;
}
