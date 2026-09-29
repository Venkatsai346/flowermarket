import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ArrowUp, CheckCircle2, Image, ImageOff, Maximize2, RefreshCw, Search, ShieldCheck, Sparkles, Star, Trash2, Type, UploadCloud } from 'lucide-react';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { cn, errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { uploadFile, uploadErrorText, MEDIA_PURPOSE } from '../../lib/upload.js';

const ISSUE_OPTIONS = [
  ['', 'All operational states'], ['no_media', 'No product media'], ['no_primary', 'Primary missing'],
  ['primary_conflict', 'Multiple primaries'], ['missing_alt', 'Alt text missing'], ['dimensions', 'Dimensions / resolution'],
  ['variant_coverage', 'Variant coverage'], ['healthy', 'Healthy families'],
];
const ROLES = ['gallery', 'thumbnail', 'swatch', 'lifestyle', 'size_chart', 'manual'];

function Metric({ label, value, note, icon: Icon, tone = 'slate' }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-800', emerald: 'bg-emerald-100 text-emerald-700', violet: 'bg-violet-100 text-violet-700' };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><span className={cn('rounded-xl p-2', tones[tone])}><Icon className="h-4 w-4" /></span></div><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div>;
}

function MediaScore({ score }) {
  const tone = score >= 90 ? 'bg-emerald-100 text-emerald-800' : score >= 70 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800';
  return <span className={cn('inline-flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-black', tone)}>{score}</span>;
}

function assetDraft(asset) {
  return {
    altText: asset.altText || '', role: asset.role || 'gallery', mimeType: asset.mimeType || '',
    width: asset.width ?? '', height: asset.height ?? '', fileSize: asset.fileSize ?? '',
    focalX: asset.focalPoint?.x ?? 0.5, focalY: asset.focalPoint?.y ?? 0.5, sortOrder: asset.sortOrder ?? 0,
  };
}

function AssetEditor({ asset, masterId, version, onChanged }) {
  const [draft, setDraft] = useState(() => assetDraft(asset));
  const [confirmRetire, setConfirmRetire] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => setDraft(assetDraft(asset)), [asset]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    try {
      const result = await run(() => api.catalogAdmin.updateMediaAsset(masterId, rid(asset), {
        altText: draft.altText || null, role: draft.role, mimeType: draft.mimeType || null,
        width: draft.width === '' ? null : Number(draft.width), height: draft.height === '' ? null : Number(draft.height),
        fileSize: draft.fileSize === '' ? null : Number(draft.fileSize),
        focalPoint: { x: Number(draft.focalX), y: Number(draft.focalY) }, sortOrder: Number(draft.sortOrder), expectedVersion: version,
      }));
      toast.success('Media evidence saved'); onChanged(result.data?.version);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const setPrimary = async () => {
    try { await run(() => api.catalogAdmin.setImagePrimary(masterId, rid(asset), { expectedVersion: version })); toast.success('Primary media updated'); onChanged(); }
    catch (error) { toast.error(errMsg(error)); }
  };
  const retire = async () => {
    if (!confirmRetire) { setConfirmRetire(true); return; }
    try { await run(() => api.catalogAdmin.removeImage(masterId, rid(asset), { expectedVersion: version })); toast.success(asset.isPrimary ? 'Asset retired and deterministic fallback promoted' : 'Asset retired'); onChanged(); }
    catch (error) { toast.error(errMsg(error)); }
  };
  return (
    <article className={cn('overflow-hidden rounded-2xl border bg-white', asset.isPrimary ? 'border-violet-300 ring-2 ring-violet-100' : 'border-slate-200')}>
      <div className="grid gap-0 md:grid-cols-[220px_1fr]">
        <div className="relative min-h-52 bg-slate-100"><img src={asset.url} alt={asset.altText || ''} className="absolute inset-0 h-full w-full object-contain" loading="lazy" />{asset.isPrimary && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-black uppercase text-white"><Star className="h-3 w-3 fill-current" />Primary</span>}<span className="absolute bottom-3 left-3 rounded bg-slate-950/75 px-2 py-1 text-[10px] font-semibold text-white">{asset.variantLabel || 'Master gallery'}</span></div>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]"><label className="text-xs font-semibold text-slate-600">Accessible description<Input className="mt-1" value={draft.altText} maxLength={300} onChange={(event) => set('altText', event.target.value)} placeholder="Describe the visible product accurately" /></label><label className="text-xs font-semibold text-slate-600">Asset role<Select className="mt-1" value={draft.role} onChange={(event) => set('role', event.target.value)}>{ROLES.map((role) => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}</Select></label></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6"><Input type="number" min="1" placeholder="Width px" value={draft.width} onChange={(event) => set('width', event.target.value)} /><Input type="number" min="1" placeholder="Height px" value={draft.height} onChange={(event) => set('height', event.target.value)} /><Input type="number" min="0" placeholder="Bytes" value={draft.fileSize} onChange={(event) => set('fileSize', event.target.value)} /><Input type="number" min="0" max="1" step="0.05" title="Focal point X" value={draft.focalX} onChange={(event) => set('focalX', event.target.value)} /><Input type="number" min="0" max="1" step="0.05" title="Focal point Y" value={draft.focalY} onChange={(event) => set('focalY', event.target.value)} /><Input type="number" min="0" title="Gallery order" placeholder="Order" value={draft.sortOrder} onChange={(event) => set('sortOrder', event.target.value)} /></div>
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="primary" loading={busy} onClick={save}>Save metadata</Button>{!asset.isPrimary && <Button size="sm" variant="secondary" icon={Star} disabled={busy} onClick={setPrimary}>Make primary</Button>}<Button size="sm" variant={confirmRetire ? 'danger' : 'ghost'} icon={Trash2} disabled={busy} onClick={retire}>{confirmRetire ? 'Confirm retire' : 'Retire'}</Button>{confirmRetire && <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setConfirmRetire(false)}>Cancel</button>}<span className="ml-auto max-w-xs truncate text-[10px] text-slate-400" title={asset.url}>{asset.mimeType || asset.mediaType} · {asset.width && asset.height ? `${asset.width}×${asset.height}` : 'dimensions unknown'}</span></div>
        </div>
      </div>
    </article>
  );
}

function FamilyMediaModal({ masterId, onClose, onUpdated }) {
  const detail = useApi(() => masterId ? api.catalogAdmin.master(masterId) : Promise.resolve({ data: null }), [masterId], { toastOnError: Boolean(masterId) });
  const master = detail.data;
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newAsset, setNewAsset] = useState({ url: '', altText: '', variantId: '', isPrimary: false });
  const assets = useMemo(() => {
    const seen = new Set();
    const rows = [];
    const append = (asset, variantLabel = null) => { const id = rid(asset); if (id && !seen.has(id)) { seen.add(id); rows.push({ ...asset, variantLabel }); } };
    (master?.images || []).forEach((asset) => append(asset));
    (master?.variants || []).forEach((variant) => (variant.images || []).forEach((asset) => append(asset, variant.displayLabel || variant.value || variant.sku)));
    return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [master]);
  const changed = async () => { await detail.refetch(); onUpdated?.(); };
  const upload = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadFile({ file, purpose: MEDIA_PURPOSE.productImage });
      setNewAsset((current) => ({ ...current, url: asset.url, mimeType: file.type || null, fileSize: file.size }));
      toast.success('Upload complete — review and attach the asset');
    } catch (error) { toast.error(uploadErrorText(error)); }
    finally { setUploading(false); }
  };
  const addAsset = async () => {
    if (!newAsset.url || !newAsset.altText.trim()) { toast.error('Upload an asset and add accurate alternative text'); return; }
    setAdding(true);
    try {
      const body = { url: newAsset.url, altText: newAsset.altText.trim(), mediaType: 'image', role: 'gallery', mimeType: newAsset.mimeType || null, fileSize: newAsset.fileSize || null, isPrimary: newAsset.isPrimary, expectedVersion: master.version };
      if (newAsset.variantId) await api.catalogAdmin.addVariantImage(rid(master), newAsset.variantId, body);
      else await api.catalogAdmin.addImage(rid(master), body);
      setNewAsset({ url: '', altText: '', variantId: '', isPrimary: false });
      toast.success('Governed media asset attached'); await changed();
    } catch (error) { toast.error(errMsg(error)); }
    finally { setAdding(false); }
  };
  return (
    <Modal open={Boolean(masterId)} onClose={onClose} title={master?.title || 'Loading media workspace…'} subtitle={master ? `${master.skuGlobal || 'No global SKU'} · version ${master.version} · ${assets.length} governed assets` : undefined} size="xl">
      {detail.loading && !master ? <div className="py-16 text-center text-sm text-slate-500">Loading governed media…</div> : master && <div className="space-y-5">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900"><b>Governed media editing.</b> Changes are optimistic-locked, audited, and emit catalog reindex events. Variant assets remain scoped to their exact variant.</div>
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2"><input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} /><Button size="sm" variant="secondary" icon={UploadCloud} loading={uploading} onClick={() => inputRef.current?.click()}>{newAsset.url ? 'Replace upload' : 'Upload image'}</Button><Input className="min-w-56 flex-1" value={newAsset.altText} maxLength={300} onChange={(event) => setNewAsset((current) => ({ ...current, altText: event.target.value }))} placeholder="Required: accurate accessible description" /><Select className="sm:!w-48" value={newAsset.variantId} onChange={(event) => setNewAsset((current) => ({ ...current, variantId: event.target.value }))}><option value="">Master gallery</option>{(master.variants || []).map((variant) => <option key={rid(variant)} value={rid(variant)}>{variant.displayLabel || variant.value || variant.sku}</option>)}</Select><label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={newAsset.isPrimary} onChange={(event) => setNewAsset((current) => ({ ...current, isPrimary: event.target.checked }))} />Primary</label><Button size="sm" variant="primary" loading={adding} disabled={!newAsset.url} onClick={addAsset}>Attach asset</Button></div>
          {newAsset.url && <p className="mt-2 truncate text-[10px] text-emerald-700">Upload ready: {newAsset.url}</p>}
        </section>
        {assets.length ? <div className="space-y-4">{assets.map((asset) => <AssetEditor key={rid(asset)} asset={asset} masterId={rid(master)} version={master.version} onChanged={changed} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center"><ImageOff className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-700">No media is attached</p><p className="mt-1 text-xs text-slate-500">Use the product master workspace to upload the first factual asset.</p></div>}
      </div>}
    </Modal>
  );
}

export default function MediaOperationsPanel() {
  const [filters, setFilters] = useState({ search: '', issue: '', sort: 'priority', page: 1 });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(filters.search.trim()), 250); return () => clearTimeout(timer); }, [filters.search]);
  const summary = useApi(() => api.catalogAdmin.mediaSummary(), []);
  const query = useMemo(() => ({ page: filters.page, limit: 20, search: debouncedSearch || undefined, issue: filters.issue || undefined, sort: filters.sort }), [filters.page, filters.issue, filters.sort, debouncedSearch]);
  const families = useApi(() => api.catalogAdmin.mediaFamilies(query), [query]);
  const refresh = () => Promise.all([summary.refetch(), families.refetch()]);
  const s = summary.data || {};
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 p-6 text-white shadow-xl shadow-slate-200 sm:p-8"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-violet-200"><Sparkles className="h-3.5 w-3.5" />Global media operations</div><h2 className="text-2xl font-black tracking-tight sm:text-3xl">Every angle. Every variant. Every customer.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A governed queue for primary-image integrity, resolution evidence, accessibility descriptions and visual variant coverage across the shared catalog.</p></div><Button variant="primary" icon={RefreshCw} onClick={refresh} loading={summary.loading || families.loading}>Refresh evidence</Button></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="Media health" value={`${s.averageScore || 0}%`} note={`${s.healthyFamilies || 0} fully healthy families`} icon={ShieldCheck} tone="violet" /><Metric label="No media" value={s.noMedia || 0} note="families invisible to customers" icon={ImageOff} tone="rose" /><Metric label="Primary issues" value={(s.noPrimary || 0) + (s.primaryConflicts || 0)} note={`${s.primaryConflicts || 0} conflicting galleries`} icon={Star} tone="amber" /><Metric label="Accessibility" value={s.missingAlt || 0} note="assets missing useful alt text" icon={Type} tone="amber" /><Metric label="Variant gaps" value={s.uncoveredVariants || 0} note="variants without visual fallback" icon={Image} tone="slate" /></div>
      <Card title="Media remediation queue" subtitle="Blockers first, then the lowest-scoring and widest-impact families.">
        <div className="mb-4 grid gap-2 md:grid-cols-[minmax(240px,1fr)_220px_160px]"><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Search product or global SKU" /></label><Select value={filters.issue} onChange={(event) => setFilters((current) => ({ ...current, issue: event.target.value, page: 1 }))}>{ISSUE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value, page: 1 }))}><option value="priority">Highest priority</option><option value="newest">Recently changed</option></Select></div>
        {families.error ? <p className="py-12 text-center text-sm text-rose-600">{errMsg(families.error)}</p> : families.loading && !families.data ? <p className="py-12 text-center text-sm text-slate-500">Building media evidence…</p> : !families.data?.length ? <div className="py-16 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" /><p className="mt-3 text-sm font-bold text-slate-700">No families match this queue</p></div> : <div className="divide-y divide-slate-100">{families.data.map((family) => <button key={rid(family)} type="button" onClick={() => setSelectedId(rid(family))} className="flex w-full items-center gap-3 px-1 py-4 text-left transition hover:bg-slate-50 sm:px-3"><MediaScore score={family.mediaScore} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{family.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{family.skuGlobal || 'No global SKU'} · {family.mediaCount} assets · {family.variantCount} variants</p><div className="mt-2 flex flex-wrap gap-1.5">{family.noMedia && <span className="rounded bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase text-rose-700">No media</span>}{family.primaryMissing && <span className="rounded bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase text-rose-700">Primary missing</span>}{family.variantPrimaryMissingCount > 0 && <span className="rounded bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase text-rose-700">{family.variantPrimaryMissingCount} variant primaries</span>}{family.missingAltCount > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">{family.missingAltCount} alt gaps</span>}{family.uncoveredVariantCount > 0 && <span className="rounded bg-sky-100 px-2 py-0.5 text-[9px] font-black uppercase text-sky-800">{family.uncoveredVariantCount} variant gaps</span>}</div></div><div className="hidden text-right sm:block"><p className={cn('text-xs font-bold', family.blockerCount ? 'text-rose-700' : 'text-emerald-700')}>{family.blockerCount ? `${family.blockerCount} blockers` : 'Publish-safe'}</p><p className="mt-1 text-[10px] text-slate-400">{family.warningCount} evidence gaps</p></div><ArrowRight className="h-4 w-4 text-slate-300" /></button>)}</div>}
        {(families.meta?.totalPages || 0) > 1 && <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4"><Button size="sm" variant="ghost" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button><span className="text-xs text-slate-500">Page {families.meta.page} of {families.meta.totalPages}</span><Button size="sm" variant="ghost" disabled={!families.meta.hasMore} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</Button></div>}
      </Card>
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><Maximize2 className="h-5 w-5 text-violet-600" /><p className="mt-2 text-sm font-bold text-slate-900">Resolution evidence</p><p className="mt-1 text-xs leading-5 text-slate-500">{s.unmeasured || 0} unmeasured and {s.lowResolution || 0} below the 800×800 launch standard.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><ArrowUp className="h-5 w-5 text-violet-600" /><p className="mt-2 text-sm font-bold text-slate-900">Primary governance</p><p className="mt-1 text-xs leading-5 text-slate-500">Primary designation is scoped independently to master and variant galleries.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><AlertTriangle className="h-5 w-5 text-violet-600" /><p className="mt-2 text-sm font-bold text-slate-900">Safe remediation</p><p className="mt-1 text-xs leading-5 text-slate-500">Every metadata save is version-checked, audited and reindexed through the catalog outbox.</p></div></div>
      <FamilyMediaModal masterId={selectedId} onClose={() => setSelectedId(null)} onUpdated={refresh} />
    </div>
  );
}
