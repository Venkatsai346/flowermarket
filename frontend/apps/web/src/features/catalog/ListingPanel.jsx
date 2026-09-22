import { useEffect, useRef, useState } from 'react';
import { Boxes, CheckCircle2, Download, Eye, Layers, PackagePlus, Pencil, RefreshCw, Settings2, Trash2, Warehouse } from 'lucide-react';
import { inr, pickMeta, useAuthStore } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { useDownload } from '../../lib/useDownload.js';
import { errMsg, rid } from '../../lib/utils.js';
import { useRecoverableDraft } from '../../lib/useRecoverableDraft.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import { LISTING_STATUS_META, LISTING_STATUS_OPTIONS } from './catalogMeta.js';
import { Guidance, RecoveryNotice, SectionIntro, SubmissionError } from './CatalogFormUX.jsx';

const blank = () => ({
  productMasterId: '',
  mrp: '',
  sellingPrice: '',
  costPrice: '',
  saleStartsAt: '',
  saleEndsAt: '',
  taxInclusive: true,
  sellerSku: '',
  titleOverride: '',
  descriptionOverride: '',
  badges: '',
  featured: false,
  searchBoost: 0,
  priceBasisQuantity: 1,
  priceBasisUnit: 'piece',
  minOrderQty: '',
  maxOrderQty: '',
  allowBackorder: false,
  preorder: false,
  availableFrom: '',
  availableUntil: '',
  leadTimeDays: 0,
  storefront: true,
  marketplace: true,
  pos: true,
  wholesale: false,
  stockQty: 0,
  status: 'draft',
});

function CreateListingModal({ masters, onClose, onSaved }) {
  const { busy, run } = useAction();
  const [form, setForm] = useState(blank());
  const [variantId, setVariantId] = useState('');
  const [variantOptions, setVariantOptions] = useState(null);
  const [error, setError] = useState('');
  const previousMasterId = useRef('');
  const actorId = useAuthStore((state) => state.user?.id || state.user?._id || 'anonymous');
  const draft = useRecoverableDraft({ key: `${actorId}:tenant-listing:new`, value: { form, variantId }, initialValue: { form: blank(), variantId: '' } });
  const selectedMaster = (masters || []).find((master) => rid(master) === form.productMasterId);
  const allowedUnits = selectedMaster?.unitPolicy?.units || [];
  const hasPrices = form.mrp !== '' && form.sellingPrice !== '' && Number(form.sellingPrice) > 0;
  const validBasis = Number(form.priceBasisQuantity) > 0 && (!allowedUnits.length || allowedUnits.some((unit) => unit.code === form.priceBasisUnit));
  const canSave = form.productMasterId && hasPrices && validBasis;

  const set = (k, v) => { setError(''); setForm((f) => ({ ...f, [k]: v })); };

  // When the chosen master has variants, offer one of them (or the master row).
  useEffect(() => {
    if (previousMasterId.current !== form.productMasterId) setVariantId('');
    previousMasterId.current = form.productMasterId;
    if (!form.productMasterId) { setVariantOptions(null); return; }
    const master = (masters || []).find((item) => rid(item) === form.productMasterId);
    setForm((current) => ({ ...current, priceBasisUnit: master?.unitPolicy?.baseUnit || master?.defaultSellingUnit || 'piece' }));
    let live = true;
    api.catalogTenant.masterVariants(form.productMasterId)
      .then((r) => { if (live) setVariantOptions((r.data?.variants || []).filter((v) => v.variant)); })
      .catch(() => { if (live) setVariantOptions([]); });
    return () => { live = false; };
  }, [form.productMasterId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const mrp = form.mrp === '' ? null : Number(form.mrp);
    const price = {
      mrp: mrp ?? 0,
      sellingPrice: Number(form.sellingPrice),
      costPrice: form.costPrice === '' ? null : Number(form.costPrice),
      saleStartsAt: form.saleStartsAt || null,
      saleEndsAt: form.saleEndsAt || null,
      taxInclusive: form.taxInclusive,
      currency: 'INR',
    };
    if (mrp != null && mrp < price.sellingPrice) {
      const message = 'MRP must be greater than or equal to the selling price.';
      setError(message); toast.error(message); return;
    }
    if (!validBasis) {
      const message = 'Choose a positive price-basis quantity using one of the master’s allowed units.';
      setError(message); toast.error(message); return;
    }
    if (form.saleStartsAt && form.saleEndsAt && new Date(form.saleEndsAt) <= new Date(form.saleStartsAt)) {
      const message = 'Sale end must be after the sale start.'; setError(message); toast.error(message); return;
    }
    if (form.availableFrom && form.availableUntil && new Date(form.availableUntil) <= new Date(form.availableFrom)) {
      const message = 'Offer availability end must be after its start.'; setError(message); toast.error(message); return;
    }
    if (form.minOrderQty && form.maxOrderQty && Number(form.minOrderQty) > Number(form.maxOrderQty)) {
      const message = 'Minimum order quantity cannot exceed the maximum.'; setError(message); toast.error(message); return;
    }
    try {
      await run(() => api.catalogTenant.createListing({
        productMasterId: form.productMasterId,
        ...(variantId ? { variantId } : {}),
        sellerSku: form.sellerSku.trim() || null,
        price,
        merchandising: {
          titleOverride: form.titleOverride.trim() || null,
          descriptionOverride: form.descriptionOverride.trim() || null,
          badges: form.badges.split(',').map((value) => value.trim()).filter(Boolean),
          featured: form.featured,
          searchBoost: Number(form.searchBoost || 0),
        },
        priceBasis: { quantity: Number(form.priceBasisQuantity || 1), unitCode: form.priceBasisUnit },
        orderLimits: {
          ...(form.minOrderQty ? { minOrderQty: Number(form.minOrderQty) } : {}),
          ...(form.maxOrderQty ? { maxOrderQty: Number(form.maxOrderQty) } : {}),
        },
        sellingPolicy: {
          allowBackorder: form.allowBackorder,
          preorder: form.preorder,
          availableFrom: form.availableFrom || null,
          availableUntil: form.availableUntil || null,
          leadTimeDays: Number(form.leadTimeDays || 0),
        },
        channels: { storefront: form.storefront, pos: form.pos, marketplace: form.marketplace, wholesale: form.wholesale },
        stockQty: Math.max(0, Math.trunc(Number(form.stockQty) || 0)),
        status: form.status,
      }));
      toast.success('Listing created — it is now editable from this page');
      draft.clear();
      onClose();
      onSaved?.();
    } catch (err) {
      const message = errMsg(err);
      setError(message); toast.error(message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create a store offer"
      subtitle="Connect a governed catalog product to this store’s price, channels and inventory."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={PackagePlus} loading={busy} disabled={!canSave} onClick={submit}>Create listing</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <RecoveryNotice draft={draft.recovered} onRestore={() => { const recovered = draft.recover(); if (recovered) { previousMasterId.current = recovered.form?.productMasterId || ''; setForm(recovered.form || blank()); setVariantId(recovered.variantId || ''); toast.success('Unfinished listing restored'); } }} onDiscard={draft.discard} />
        <SubmissionError message={error} />
        <section>
          <SectionIntro eyebrow="Step 1" title="Choose what this store sells" description="A listing never duplicates product truth. It references one active master—or one exact variant—and owns only seller price, stock, merchandising and channel policy." icon={PackagePlus} />
        <Field label="Product master" required hint="Only active, publishable masters appear here. Compliance requirements are checked again if you activate the offer.">
          <Select value={form.productMasterId} onChange={(e) => set('productMasterId', e.target.value)}>
            <option value="">Select master…</option>
            {(masters || []).map((m) => <option key={rid(m)} value={rid(m)}>{m.title} · {m.skuGlobal}</option>)}
          </Select>
        </Field>
        {variantOptions && variantOptions.length > 0 && (
          <Field label="Variant" hint="List one specific variant, or the master itself. For several at once use “List variants”.">
            <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              <option value="">Whole product (no variant)</option>
              {variantOptions.map((row) => (
                <option key={row.variant.id} value={row.variant.id} disabled={Boolean(row.listing)}>
                  {row.variant.displayLabel || row.variant.value}
                  {row.variant.sku ? ` · ${row.variant.sku}` : ''}{row.listing ? ' · already listed' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {selectedMaster && (
          <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Catalog identity</p><p className="mt-1 text-xs font-semibold text-slate-800">{selectedMaster.skuGlobal}</p></div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Base unit</p><p className="mt-1 text-xs font-semibold text-slate-800">{selectedMaster.unitPolicy?.baseUnit || selectedMaster.defaultSellingUnit}</p></div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Compliance</p><p className="mt-1 text-xs font-semibold capitalize text-slate-800">{selectedMaster.complianceStatus || 'not required'}</p></div>
          </div>
        )}
        </section>
        <section>
          <SectionIntro eyebrow="Step 2" title="Price & quantity identity" description="The price basis tells customers—and downstream cart, order and GST documents—exactly how much product this price buys." icon={Settings2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Selling price (₹)" required hint="The current customer price before cart-level promotions.">
            <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
          </Field>
          <Field label="MRP (₹)" hint="Leave blank when no MRP.">
            <Input type="number" min="0" step="0.01" value={form.mrp} onChange={(e) => set('mrp', e.target.value)} />
          </Field>
          <Field label="Cost price (₹)" hint="Private margin reporting; never shown to customers.">
            <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
          </Field>
          <Field label="Tax treatment" hint="Catalog prices are normally GST-inclusive."><label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"><input type="checkbox" checked={form.taxInclusive} onChange={(e) => set('taxInclusive', e.target.checked)} /> Tax included in displayed price</label></Field>
          <Field label="Sale starts" hint="Optional scheduled promotional window."><Input type="datetime-local" value={form.saleStartsAt} onChange={(e) => set('saleStartsAt', e.target.value)} /></Field>
          <Field label="Sale ends"><Input type="datetime-local" value={form.saleEndsAt} min={form.saleStartsAt || undefined} onChange={(e) => set('saleEndsAt', e.target.value)} /></Field>
          <Field label="Seller SKU" hint="Your store-specific stock keeping unit.">
            <Input value={form.sellerSku} onChange={(e) => set('sellerSku', e.target.value)} />
          </Field>
          <Field label="Price basis" required hint="Example: ₹120 per 500 gram. Unit must belong to the master conversion policy.">
            <div className="flex gap-2">
              <Input className="!w-28" type="number" min="0.000001" step="any" value={form.priceBasisQuantity} onChange={(e) => set('priceBasisQuantity', e.target.value)} />
              {allowedUnits.length ? (
                <Select value={form.priceBasisUnit} onChange={(e) => set('priceBasisUnit', e.target.value)}>{allowedUnits.map((unit) => <option key={unit.code} value={unit.code}>{unit.label} ({unit.code})</option>)}</Select>
              ) : <Input value={form.priceBasisUnit} onChange={(e) => set('priceBasisUnit', e.target.value)} />}
            </div>
          </Field>
          <Field label="Storefront title override" hint="Tenant-specific title; canonical master title remains unchanged.">
            <Input maxLength={160} value={form.titleOverride} onChange={(e) => set('titleOverride', e.target.value)} />
          </Field>
          <Field className="sm:col-span-2" label="Storefront description override" hint="Optional local merchandising copy; max 1,000 characters."><Textarea maxLength={1000} value={form.descriptionOverride} onChange={(e) => set('descriptionOverride', e.target.value)} /></Field>
          <Field label="Badges" hint="Up to 10 comma-separated labels, such as Bestseller."><Input value={form.badges} onChange={(e) => set('badges', e.target.value)} /></Field>
          <Field label="Search boost" hint="-100 to 100; higher values increase store search prominence."><Input type="number" min="-100" max="100" value={form.searchBoost} onChange={(e) => set('searchBoost', e.target.value)} /></Field>
          <Field label="Curation"><label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"><input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} /> Featured offer</label></Field>
          <Field className="sm:col-span-2" label="Sales channels" hint="Choose every surface allowed to sell this offer.">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
              {[['storefront', 'Storefront'], ['marketplace', 'Marketplace'], ['pos', 'Point of sale'], ['wholesale', 'Wholesale']].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />{label}</label>)}
            </div>
          </Field>
          <Field label="Minimum order" hint="Blank inherits the master default."><Input type="number" min="1" value={form.minOrderQty} onChange={(e) => set('minOrderQty', e.target.value)} /></Field>
          <Field label="Maximum order" hint="Blank inherits the master default."><Input type="number" min="1" value={form.maxOrderQty} onChange={(e) => set('maxOrderQty', e.target.value)} /></Field>
          <Field label="Available from" hint="Optional offer availability window."><Input type="datetime-local" value={form.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} /></Field>
          <Field label="Available until"><Input type="datetime-local" value={form.availableUntil} min={form.availableFrom || undefined} onChange={(e) => set('availableUntil', e.target.value)} /></Field>
          <Field label="Lead time (days)"><Input type="number" min="0" max="365" value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} /></Field>
          <Field label="Selling policy"><div className="flex h-10 items-center gap-4 rounded-lg border border-slate-200 px-3"><Checkbox label="Backorder" checked={form.allowBackorder} onChange={(e) => set('allowBackorder', e.target.checked)} /><Checkbox label="Preorder" checked={form.preorder} onChange={(e) => set('preorder', e.target.checked)} /></div></Field>
          <Field label="Opening stock" hint="Creates the inventory row when > 0.">
            <Input type="number" min="0" step="1" value={form.stockQty} onChange={(e) => set('stockQty', e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {LISTING_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
            </Select>
          </Field>
        </div>
        </section>
        <Guidance title={form.status === 'active' ? 'Activation preflight' : 'Safe draft workflow'} tone={form.status === 'active' ? 'amber' : 'blue'}>
          {form.status === 'active'
            ? 'Saving as active asks the backend to verify master status, required compliance, price basis and channel policy immediately. If any gate fails, this form stays open and shows the exact server reason.'
            : 'Draft keeps the offer private while you finish compliance, merchandising and inventory. Activate from the listing workspace when every readiness gate is green.'}
        </Guidance>
      </form>
    </Modal>
  );
}

/**
 * Variant-listing wizard: pick a master, tick one / some / all of its
 * variants, give each its own price + stock, and list them in one shot.
 * Already-listed variants show their live price and cannot be re-ticked.
 */
function ListVariantsModal({ masters, onClose, onSaved }) {
  const { busy, run } = useAction();
  const [masterId, setMasterId] = useState('');
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({}); // variantKey -> { mrp, sellingPrice, stockQty }
  const [status, setStatus] = useState('active');
  const [defaults, setDefaults] = useState({ mrp: '', sellingPrice: '', stockQty: 0 });
  const [error, setError] = useState('');
  const restoringDraft = useRef(false);
  const actorId = useAuthStore((state) => state.user?.id || state.user?._id || 'anonymous');
  const draft = useRecoverableDraft({ key: `${actorId}:tenant-listing:bulk`, value: { masterId, sel, status, defaults }, initialValue: { masterId: '', sel: {}, status: 'active', defaults: { mrp: '', sellingPrice: '', stockQty: 0 } } });

  useEffect(() => {
    setGrid(null); setError('');
    if (restoringDraft.current) restoringDraft.current = false;
    else setSel({});
    if (!masterId) return;
    let live = true;
    setLoading(true);
    api.catalogTenant.masterVariants(masterId)
      .then((r) => { if (live) setGrid(r.data); })
      .catch((e) => { if (live) setError(errMsg(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [masterId]);

  const rows = grid?.variants || [];
  const keyOf = (row) => (row.variant ? String(row.variant.id) : 'master');
  const toggle = (row) => {
    const k = keyOf(row);
    setSel((s) => {
      if (s[k]) { const { [k]: _, ...rest } = s; return rest; }
      return { ...s, [k]: { mrp: defaults.mrp, sellingPrice: defaults.sellingPrice, stockQty: defaults.stockQty } };
    });
  };
  const setRow = (k, patch) => setSel((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const selectAllUnlisted = () => {
    const next = {};
    rows.filter((r) => !r.listing).forEach((r) => {
      next[keyOf(r)] = { mrp: defaults.mrp, sellingPrice: defaults.sellingPrice, stockQty: defaults.stockQty };
    });
    setSel(next);
  };
  const applyDefaults = () => {
    setSel((s) => Object.fromEntries(
      Object.keys(s).map((k) => [k, { mrp: defaults.mrp, sellingPrice: defaults.sellingPrice, stockQty: defaults.stockQty }])
    ));
  };

  const submit = async () => {
    setError('');
    const selections = [];
    for (const row of rows.filter((r) => sel[keyOf(r)])) {
      const k = keyOf(row);
      const s = sel[k];
      const sp = Number(s.sellingPrice);
      const mrp = s.mrp === '' ? null : Number(s.mrp);
      const name = row.variant ? (row.variant.displayLabel || row.variant.value) : 'master';
      if (!(sp > 0)) return setError(`“${name}” needs a selling price above zero.`);
      if (mrp == null || mrp < sp) return setError(`“${name}”: MRP is required and must be ≥ the selling price.`);
      selections.push({
        ...(row.variant ? { variantId: row.variant.id } : {}),
        price: { mrp, sellingPrice: sp, currency: 'INR' },
        stockQty: Math.max(0, Math.trunc(Number(s.stockQty) || 0)),
        status,
      });
    }
    if (!selections.length) return setError('Tick at least one unlisted variant.');
    try {
      const r = await run(() => api.catalogTenant.bulkCreateListings({ productMasterId: masterId, selections }));
      const { created = [], skipped = [] } = r.data || {};
      toast.success(`Listed ${created.length} variant${created.length === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} already listed` : ''}`);
      draft.clear();
      onClose();
      onSaved?.();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const chosen = Object.keys(sel).length;
  const unlisted = rows.filter((r) => !r.listing).length;

  return (
    <Modal
      open
      onClose={onClose}
      title="List variants"
      subtitle="One master, many shelf prices — tick what this store should sell."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={Layers} loading={busy} disabled={!chosen} onClick={submit}>
            List {chosen || ''} variant{chosen === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <RecoveryNotice draft={draft.recovered} onRestore={() => { const recovered = draft.recover(); if (recovered) { restoringDraft.current = true; setMasterId(recovered.masterId || ''); setSel(recovered.sel || {}); setStatus(recovered.status || 'active'); setDefaults(recovered.defaults || { mrp: '', sellingPrice: '', stockQty: 0 }); toast.success('Unfinished variant listing restored'); } }} onDiscard={draft.discard} />
        <SubmissionError message={error} />

        <Field label="Product master" required>
          <Select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            <option value="">Select master…</option>
            {(masters || []).map((m) => <option key={rid(m)} value={rid(m)}>{m.title} · {m.skuGlobal}</option>)}
          </Select>
        </Field>

        {masterId && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <Field label="Default MRP ₹"><Input className="!w-28" type="number" min="0" step="0.01" value={defaults.mrp} onChange={(e) => setDefaults({ ...defaults, mrp: e.target.value })} /></Field>
            <Field label="Default price ₹"><Input className="!w-28" type="number" min="0" step="0.01" value={defaults.sellingPrice} onChange={(e) => setDefaults({ ...defaults, sellingPrice: e.target.value })} /></Field>
            <Field label="Default stock"><Input className="!w-24" type="number" min="0" step="1" value={defaults.stockQty} onChange={(e) => setDefaults({ ...defaults, stockQty: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {LISTING_STATUS_OPTIONS.filter(([v]) => v === 'draft' || v === 'active').map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
              </Select>
            </Field>
            <span className="flex gap-2 pb-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={applyDefaults} disabled={!chosen}>Apply to ticked</Button>
              <Button type="button" size="sm" variant="ghost" onClick={selectAllUnlisted} disabled={!unlisted}>Select all {unlisted || ''}</Button>
            </span>
          </div>
        )}

        {loading && <p className="py-4 text-center text-xs text-slate-400">Loading variants…</p>}

        {!loading && grid && rows.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((row) => {
              const k = keyOf(row);
              const checked = Boolean(sel[k]);
              const v = row.variant;
              const label = v ? (v.displayLabel || v.value) : 'Whole product (no variants)';
              return (
                <div key={k} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-rose-600"
                    checked={checked}
                    disabled={Boolean(row.listing)}
                    onChange={() => toggle(row)}
                    aria-label={`List ${label}`}
                  />
                  {v?.primaryImageUrl ? (
                    <img src={v.primaryImageUrl} alt="" className="h-9 w-9 rounded-lg border border-slate-200 object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-400"><Layers className="h-4 w-4" /></span>
                  )}
                  <span className="min-w-36 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{label}</span>
                    <span className="block text-[11px] text-slate-400">
                      {v ? `${v.variantType}${v.sku ? ` · ${v.sku}` : ''}` : grid.master?.skuGlobal || ''}
                    </span>
                  </span>
                  {row.listing ? (
                    <span className="flex items-center gap-2">
                      <Badge tone={pickMeta(LISTING_STATUS_META, row.listing.status).tone}>{pickMeta(LISTING_STATUS_META, row.listing.status).label}</Badge>
                      <span className="text-sm font-semibold text-slate-700">{inr(row.listing.price?.sellingPrice)}</span>
                      <span className="text-xs text-slate-400">stock {row.listing.stockQty ?? 0}</span>
                    </span>
                  ) : checked ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Input className="!w-24" type="number" min="0" step="0.01" placeholder="MRP ₹" aria-label={`MRP for ${label}`} value={sel[k].mrp} onChange={(e) => setRow(k, { mrp: e.target.value })} />
                      <Input className="!w-24" type="number" min="0" step="0.01" placeholder="Price ₹" aria-label={`Price for ${label}`} value={sel[k].sellingPrice} onChange={(e) => setRow(k, { sellingPrice: e.target.value })} />
                      <Input className="!w-20" type="number" min="0" step="1" placeholder="Stock" aria-label={`Stock for ${label}`} value={sel[k].stockQty} onChange={(e) => setRow(k, { stockQty: e.target.value })} />
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">not listed</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ListingModal({ row, onClose, onSaved }) {
  const { busy, run } = useAction();
  const [priceForm, setPriceForm] = useState({
    mrp: row.price?.mrp ?? '', sellingPrice: row.price?.sellingPrice ?? '', costPrice: row.price?.costPrice ?? '',
    saleStartsAt: row.price?.saleStartsAt ? String(row.price.saleStartsAt).slice(0, 16) : '',
    saleEndsAt: row.price?.saleEndsAt ? String(row.price.saleEndsAt).slice(0, 16) : '',
    taxInclusive: row.price?.taxInclusive !== false, reason: 'manual',
  });
  const [offerForm, setOfferForm] = useState({
    sellerSku: row.sellerSku || '', titleOverride: row.merchandising?.titleOverride || '',
    descriptionOverride: row.merchandising?.descriptionOverride || '', badges: (row.merchandising?.badges || []).join(', '),
    featured: Boolean(row.merchandising?.featured), searchBoost: row.merchandising?.searchBoost ?? 0,
    priceBasisQuantity: row.priceBasis?.quantity ?? 1,
    priceBasisUnit: row.priceBasis?.unitCode || row.master?.unitPolicy?.baseUnit || row.master?.defaultSellingUnit || 'piece',
    minOrderQty: row.orderLimits?.minOrderQty ?? '', maxOrderQty: row.orderLimits?.maxOrderQty ?? '',
    storefront: row.channels?.storefront !== false, marketplace: row.channels?.marketplace !== false,
    pos: row.channels?.pos !== false, wholesale: Boolean(row.channels?.wholesale),
    allowBackorder: Boolean(row.sellingPolicy?.allowBackorder), preorder: Boolean(row.sellingPolicy?.preorder),
    availableFrom: row.sellingPolicy?.availableFrom ? String(row.sellingPolicy.availableFrom).slice(0, 16) : '',
    availableUntil: row.sellingPolicy?.availableUntil ? String(row.sellingPolicy.availableUntil).slice(0, 16) : '',
    leadTimeDays: row.sellingPolicy?.leadTimeDays ?? 0,
  });
  const [currentVersion, setCurrentVersion] = useState(row.version || 1);
  const [stockQty, setStockQty] = useState('0');
  const [stockData, setStockData] = useState(null);
  const [loadingStock, setLoadingStock] = useState(true);
  const [serverError, setServerError] = useState('');
  const [pane, setPane] = useState('commercial');
  const listingId = row.id || row._id;
  const version = currentVersion;
  const status = row.status || 'draft';
  const fail = (err) => { const message = errMsg(err); setServerError(message); toast.error(message); };

  const onChanged = () => { loadStock(); onSaved?.(); };

  const loadStock = async () => {
    setLoadingStock(true);
    try {
      const r = await api.catalogTenant.stock(listingId);
      setStockData(r.data);
      setStockQty(String(r.data.qtyOnHand ?? 0));
    } catch (e) {
      fail(e);
    } finally {
      setLoadingStock(false);
    }
  };

  useEffect(() => { loadStock(); return undefined; }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrice = async (e) => {
    e.preventDefault();
    setServerError('');
    const mrp = priceForm.mrp === '' ? null : Number(priceForm.mrp);
    if (mrp == null || mrp < Number(priceForm.sellingPrice)) return fail('MRP is required and must be greater than or equal to the selling price.');
    if (priceForm.saleStartsAt && priceForm.saleEndsAt && new Date(priceForm.saleEndsAt) <= new Date(priceForm.saleStartsAt)) return fail('Sale end must be after the sale start.');
    try {
      const response = await run(() => api.catalogTenant.updatePrice(listingId, {
        price: {
          mrp: mrp ?? 0, sellingPrice: Number(priceForm.sellingPrice),
          costPrice: priceForm.costPrice === '' ? null : Number(priceForm.costPrice),
          saleStartsAt: priceForm.saleStartsAt || null, saleEndsAt: priceForm.saleEndsAt || null,
          taxInclusive: priceForm.taxInclusive, currency: 'INR',
        },
        reason: priceForm.reason,
        expectedVersion: version,
      }));
      setCurrentVersion(response.data?.version || version + 1);
      toast.success('Listing price updated');
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const saveOffer = async (e) => {
    e.preventDefault();
    setServerError('');
    if (!(Number(offerForm.priceBasisQuantity) > 0)) return fail('Price-basis quantity must be greater than zero.');
    if (row.master?.unitPolicy?.units?.length && !row.master.unitPolicy.units.some((unit) => unit.code === offerForm.priceBasisUnit)) return fail('Choose a unit allowed by this product’s conversion policy.');
    if (offerForm.availableFrom && offerForm.availableUntil && new Date(offerForm.availableUntil) <= new Date(offerForm.availableFrom)) return fail('Offer availability end must be after its start.');
    if (offerForm.minOrderQty && offerForm.maxOrderQty && Number(offerForm.minOrderQty) > Number(offerForm.maxOrderQty)) return fail('Minimum order quantity cannot exceed maximum.');
    try {
      const response = await run(() => api.catalogTenant.updateOffer(listingId, {
        sellerSku: offerForm.sellerSku || null,
        priceBasis: { quantity: Number(offerForm.priceBasisQuantity), unitCode: offerForm.priceBasisUnit },
        merchandising: {
          titleOverride: offerForm.titleOverride || null,
          descriptionOverride: offerForm.descriptionOverride || null,
          badges: offerForm.badges.split(',').map((value) => value.trim()).filter(Boolean),
          featured: offerForm.featured,
          searchBoost: Number(offerForm.searchBoost || 0),
        },
        sellingPolicy: {
          allowBackorder: offerForm.allowBackorder, preorder: offerForm.preorder,
          availableFrom: offerForm.availableFrom || null, availableUntil: offerForm.availableUntil || null,
          leadTimeDays: Number(offerForm.leadTimeDays || 0),
        },
        orderLimits: {
          minOrderQty: offerForm.minOrderQty === '' ? null : Number(offerForm.minOrderQty),
          maxOrderQty: offerForm.maxOrderQty === '' ? null : Number(offerForm.maxOrderQty),
        },
        channels: { storefront: offerForm.storefront, marketplace: offerForm.marketplace, pos: offerForm.pos, wholesale: offerForm.wholesale },
        expectedVersion: version,
      }));
      setCurrentVersion(response.data?.version || version + 1);
      toast.success('Offer policy updated');
      onChanged();
    } catch (err) { fail(err); }
  };

  const saveStock = async (e) => {
    e.preventDefault();
    setServerError('');
    try {
      await run(() => api.catalogTenant.setStock(listingId, { qty: Math.max(0, Math.trunc(Number(stockQty) || 0)) }));
      toast.success('Stock snapshot set');
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const setStatus = async (next) => {
    try {
      const response = await run(() => api.catalogTenant.updateStatus(listingId, { status: next, expectedVersion: version }));
      setCurrentVersion(response.data?.version || version + 1);
      toast.success(`Listing ${next}`);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const deactivate = async () => {
    try {
      const response = await run(() => api.catalogTenant.deactivateListing(listingId, { expectedVersion: version }));
      setCurrentVersion(response.data?.version || version + 1);
      toast.success('Listing deactivated');
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const variantLabel = row.variant ? (row.variant.displayLabel || row.variant.value) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.master?.title || row.title || 'Listing'}${variantLabel ? ` — ${variantLabel}` : ''}`}
      subtitle={`SKU ${row.variant?.sku || row.master?.skuGlobal || row.skuGlobal || '—'} · v${version}`}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-slate-400">Backend enforces status transitions and version conflicts.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {status !== 'inactive'
              ? <Button variant="danger" onClick={deactivate}>Deactivate</Button>
              : <Button variant="success" onClick={() => setStatus('active')}>Activate</Button>}
          </div>
        </div>
      }
    >
      <SubmissionError message={serverError} />

      <div className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
        {[
          ['commercial', 'Price & inventory', Warehouse],
          ['offer', 'Offer & channels', Settings2],
          ['readiness', 'Readiness', CheckCircle2],
        ].map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => { setPane(value); setServerError(''); }} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${pane === value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
          <div className="mt-1"><Badge tone={pickMeta(LISTING_STATUS_META, status).tone} dot>{pickMeta(LISTING_STATUS_META, status).label}</Badge></div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">On hand</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyOnHand ?? row.stockQty ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Reserved</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyReserved ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Available</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyAvailable ?? row.stockQty ?? 0}</p>
        </div>
      </div>

      {pane === 'commercial' && <div className="grid gap-5 lg:grid-cols-2 animate-in">
        <form onSubmit={savePrice} className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Price</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Selling ₹" required><Input type="number" min="0" step="0.01" value={priceForm.sellingPrice} onChange={(e) => setPriceForm({ ...priceForm, sellingPrice: e.target.value })} /></Field>
            <Field label="MRP ₹"><Input type="number" min="0" step="0.01" value={priceForm.mrp} onChange={(e) => setPriceForm({ ...priceForm, mrp: e.target.value })} /></Field>
            <Field label="Cost ₹" hint="Private"><Input type="number" min="0" step="0.01" value={priceForm.costPrice} onChange={(e) => setPriceForm({ ...priceForm, costPrice: e.target.value })} /></Field>
            <Field label="Sale starts"><Input type="datetime-local" value={priceForm.saleStartsAt} onChange={(e) => setPriceForm({ ...priceForm, saleStartsAt: e.target.value })} /></Field>
            <Field label="Sale ends"><Input type="datetime-local" min={priceForm.saleStartsAt || undefined} value={priceForm.saleEndsAt} onChange={(e) => setPriceForm({ ...priceForm, saleEndsAt: e.target.value })} /></Field>
            <Field label="Reason"><Select value={priceForm.reason} onChange={(e) => setPriceForm({ ...priceForm, reason: e.target.value })}>{['manual', 'promotion', 'bulk', 'admin_override', 'reset'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</Select></Field>
          </div>
          <div className="mt-3"><Checkbox label="Displayed price includes tax" checked={priceForm.taxInclusive} onChange={(e) => setPriceForm({ ...priceForm, taxInclusive: e.target.checked })} /></div>
          <div className="mt-3 flex justify-end"><Button type="submit" size="sm" loading={busy}>Save price</Button></div>
        </form>

        <form onSubmit={saveStock} className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Stock</p>
          {loadingStock ? <p className="mt-3 text-xs text-slate-400">Loading inventory…</p> : (
            <>
              <div className="mt-3"><Field label="On-hand quantity" hint="Sets the absolute stock snapshot."><Input type="number" min="0" step="1" value={stockQty} onChange={(e) => setStockQty(e.target.value)} /></Field></div>
              <div className="mt-3 flex justify-end"><Button type="submit" size="sm" variant="secondary" icon={Warehouse} loading={busy}>Set stock</Button></div>
            </>
          )}
        </form>
      </div>}

      {pane === 'offer' && <form onSubmit={saveOffer} className="animate-in rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-800">Offer identity, quantity basis & channels</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Seller SKU"><Input value={offerForm.sellerSku} onChange={(e) => setOfferForm({ ...offerForm, sellerSku: e.target.value })} /></Field>
          <Field label="Storefront title"><Input value={offerForm.titleOverride} onChange={(e) => setOfferForm({ ...offerForm, titleOverride: e.target.value })} /></Field>
          <Field className="sm:col-span-2" label="Storefront description"><Textarea value={offerForm.descriptionOverride} onChange={(e) => setOfferForm({ ...offerForm, descriptionOverride: e.target.value })} /></Field>
          <Field label="Badges" hint="Comma-separated"><Input value={offerForm.badges} onChange={(e) => setOfferForm({ ...offerForm, badges: e.target.value })} /></Field>
          <Field label="Search boost"><Input type="number" min="-100" max="100" value={offerForm.searchBoost} onChange={(e) => setOfferForm({ ...offerForm, searchBoost: e.target.value })} /></Field>
          <Field label="Price basis" hint="Immutable commerce identity copied into cart, order and tax snapshots."><div className="flex gap-2"><Input className="!w-20" type="number" min="0.000001" step="any" value={offerForm.priceBasisQuantity} onChange={(e) => setOfferForm({ ...offerForm, priceBasisQuantity: e.target.value })} />{row.master?.unitPolicy?.units?.length ? <Select value={offerForm.priceBasisUnit} onChange={(e) => setOfferForm({ ...offerForm, priceBasisUnit: e.target.value })}>{row.master.unitPolicy.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.label} ({unit.code})</option>)}</Select> : <Input value={offerForm.priceBasisUnit} onChange={(e) => setOfferForm({ ...offerForm, priceBasisUnit: e.target.value })} />}</div></Field>
          <Field label="Min order" hint="Blank inherits master"><Input type="number" min="1" value={offerForm.minOrderQty} onChange={(e) => setOfferForm({ ...offerForm, minOrderQty: e.target.value })} /></Field>
          <Field label="Max order" hint="Blank inherits master"><Input type="number" min="1" value={offerForm.maxOrderQty} onChange={(e) => setOfferForm({ ...offerForm, maxOrderQty: e.target.value })} /></Field>
          <Field label="Available from"><Input type="datetime-local" value={offerForm.availableFrom} onChange={(e) => setOfferForm({ ...offerForm, availableFrom: e.target.value })} /></Field>
          <Field label="Available until"><Input type="datetime-local" min={offerForm.availableFrom || undefined} value={offerForm.availableUntil} onChange={(e) => setOfferForm({ ...offerForm, availableUntil: e.target.value })} /></Field>
          <Field label="Lead time (days)"><Input type="number" min="0" max="365" value={offerForm.leadTimeDays} onChange={(e) => setOfferForm({ ...offerForm, leadTimeDays: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl bg-slate-50 p-3">
          {[['storefront', 'Storefront'], ['marketplace', 'Marketplace'], ['pos', 'Point of sale'], ['wholesale', 'Wholesale'], ['allowBackorder', 'Allow backorder'], ['preorder', 'Preorder'], ['featured', 'Featured']].map(([key, label]) => <Checkbox key={key} label={label} checked={offerForm[key]} onChange={(e) => setOfferForm({ ...offerForm, [key]: e.target.checked })} />)}
          <Button className="ml-auto" type="submit" size="sm" loading={busy}>Save offer</Button>
        </div>
      </form>}

      {pane === 'readiness' && (
        <div className="animate-in space-y-4">
          <SectionIntro eyebrow="Publishability" title="Storefront readiness" description="Activation is a governed transition, not just a visibility toggle. These signals explain what customers and downstream systems will receive." icon={Eye} />
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Master status', row.master?.status === 'active', row.master?.status || 'unknown'],
              ['Compliance', !row.master?.complianceStatus || ['compliant', 'not_required'].includes(row.master.complianceStatus), row.master?.complianceStatus || 'checked on activation'],
              ['Valid selling price', Number(priceForm.sellingPrice) > 0, inr(Number(priceForm.sellingPrice) || 0)],
              ['Quantity identity', Number(offerForm.priceBasisQuantity) > 0 && Boolean(offerForm.priceBasisUnit), `${offerForm.priceBasisQuantity} ${offerForm.priceBasisUnit}`],
              ['Storefront channel', offerForm.storefront, offerForm.storefront ? 'enabled' : 'hidden'],
              ['Inventory or backorder', Number(stockData?.qtyAvailable ?? 0) > 0 || offerForm.allowBackorder, `${stockData?.qtyAvailable ?? 0} available`],
            ].map(([label, ready, value]) => (
              <div key={label} className={`flex items-center gap-3 rounded-2xl border p-3 ${ready ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-xl ${ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}><CheckCircle2 className="h-4 w-4" /></span>
                <div><p className="text-xs font-bold text-slate-800">{label}</p><p className="text-[11px] capitalize text-slate-500">{value}</p></div>
              </div>
            ))}
          </div>
          <Guidance title="Server-authoritative checks" tone="blue">Current compliance validity, product lifecycle, unit policy, status transition and optimistic version are revalidated by the backend when you activate. The console never guesses around a failed gate.</Guidance>
        </div>
      )}
    </Modal>
  );
}

export default function ListingPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [create, setCreate] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [selected, setSelected] = useState(null);
  const { busy: exporting, run: download } = useDownload();

  const { data, meta, loading, error, refetch } = useApi(
    () => api.catalogTenant.listings({
      page, limit: 20,
      search: search || undefined,
      status: status || undefined,
    }),
    [page, search, status, refreshKey],
  );
  // Store owners are intentionally forbidden from the global admin API.
  // Use the tenant-scoped, read-only active-master discovery endpoint.
  const masters = useApi(() => api.catalogTenant.availableMasters({ limit: 100 }), []);

  const refresh = () => setRefreshKey((k) => k + 1);
  const rows = data || [];
  const counts = { draft: 0, active: 0, inactive: 0, out_of_stock: 0 };
  rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

  const saveTemplate = () => download(
    () => api.catalogTenant.bulkTemplate('price'),
    'price-template.csv',
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={counts.active ?? 0} sub="on this page" icon={Boxes} tone="emerald" />
        <Stat label="Draft" value={counts.draft ?? 0} sub="not yet sellable" icon={Boxes} tone="slate" />
        <Stat label="Inactive" value={counts.inactive ?? 0} sub="paused / deactivated" icon={Boxes} tone="rose" />
        <Stat label="Out of stock" value={counts.out_of_stock ?? 0} sub="snapshot zeroed" icon={Boxes} tone="amber" />
      </div>

      {error && !rows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load listings</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <Card
          title="Tenant listings"
          subtitle="Price and stock changes append audit + price-history rows."
          bodyClassName="p-0!"
          actions={
            <>
              <Button variant="ghost" size="sm" icon={Download} loading={exporting} onClick={saveTemplate}>{exporting ? 'Preparing…' : 'Price template'}</Button>
              <Button variant="secondary" size="sm" icon={Layers} onClick={() => setWizard(true)}>List variants</Button>
              <Button variant="primary" size="sm" icon={PackagePlus} onClick={() => setCreate(true)}>Create listing</Button>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>
            </>
          }
        >
          <FilterBar
            search={search}
            onSearch={(v) => { setSearch(v); setPage(1); }}
            searchPlaceholder="Search title or SKU…"
            status={status}
            statusOptions={Object.entries(LISTING_STATUS_META).map(([v, m]) => [v, m.label])}
            onStatus={(v) => { setStatus(v); setPage(1); }}
            statusLabel="Status"
            onReset={() => { setSearch(''); setStatus(''); setPage(1); }}
          />

          <Table
            loading={loading && !rows.length}
            data={rows}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={Boxes} title="No listings found" message="Attach a global master to this store to start selling." />}
            columns={[
              { key: 'name', header: 'Listing', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">
                    {r.master?.title || r.title || 'Untitled'}
                    {r.variant && (
                      <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        {r.variant.displayLabel || r.variant.value}
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{r.variant?.sku || r.master?.skuGlobal || r.skuGlobal || '—'}</p>
                </div>
              ) },
              { key: 'price', header: 'Selling', align: 'right', render: (r) => <span className="text-sm">{inr(r.price?.sellingPrice)}</span> },
              { key: 'stock', header: 'Stock', align: 'right', render: (r) => <span className="text-xs text-slate-600">{r.stockQty ?? 0}</span> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(LISTING_STATUS_META, r.status).tone} dot>{pickMeta(LISTING_STATUS_META, r.status).label}</Badge> },
              { key: 'version', header: 'v', align: 'right', render: (r) => <span className="text-xs text-slate-400">{r.version ?? 1}</span> },
              { key: 'actions', header: '', align: 'right', render: (r) => (
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={(e) => { e.stopPropagation(); setSelected(r); }}>Manage</Button>
                  {r.status === 'active' && (
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={(e) => { e.stopPropagation(); (async () => { try { await api.catalogTenant.deactivateListing(r.id, { expectedVersion: r.version || 1 }); toast.success('Listing deactivated'); refresh(); } catch (err) { toast.error(errMsg(err)); } })(); }}>Deactivate</Button>
                  )}
                </div>
              ) },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <ListingModal row={selected} onClose={() => setSelected(null)} onSaved={refresh} />}
      {create && <CreateListingModal masters={masters.data || []} onClose={() => setCreate(false)} onSaved={refresh} />}
      {wizard && <ListVariantsModal masters={masters.data || []} onClose={() => setWizard(false)} onSaved={refresh} />}
    </div>
  );
}
