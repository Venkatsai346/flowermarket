import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Plus, Trash2, UploadCloud } from 'lucide-react';
import {
  PRODUCT_TYPE_META,
  SELLING_UNIT_LABEL,
  VARIANT_TYPE_LABEL,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import { uploadFile, uploadErrorText, MEDIA_PURPOSE } from '../../lib/upload.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';

const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_META);
const UNITS = Object.keys(SELLING_UNIT_LABEL);
const VARIANT_TYPES = Object.keys(VARIANT_TYPE_LABEL);

const blank = () => ({
  skuGlobal: '',
  type: 'fresh_flower',
  title: '',
  slug: '',
  categoryId: '',
  brandId: '',
  shortDescription: '',
  description: '',
  barcode: '',
  tags: '',
  isPerishable: true,
  requiresColdChain: false,
  defaultSellingUnit: 'piece',
  minOrderQty: 1,
  maxOrderQty: 100,
  attributes: [],
  variants: [],
  images: [],
});

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** Dynamic row editor for attributes / variants / images. */
function RowsEditor({ rows, onChange, kind }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, blankRow(kind)]);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          {kind === 'attribute' && (
            <>
              <Input className="!w-36" placeholder="key" value={r.key || ''} onChange={(e) => upd(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              <Input className="!w-40 flex-1" placeholder="value" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />
              <Input className="!w-24" placeholder="unit" value={r.unit || ''} onChange={(e) => upd(i, { unit: e.target.value })} />
            </>
          )}
          {kind === 'variant' && (
            <>
              <Select className="!w-36" value={r.variantType || ''} onChange={(e) => upd(i, { variantType: e.target.value })}>
                {VARIANT_TYPES.map((t) => <option key={t} value={t}>{VARIANT_TYPE_LABEL[t]}</option>)}
              </Select>
              <Input className="!w-36" placeholder="value (e.g. 10 stems)" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />
              <Input className="!w-32" placeholder="label" value={r.displayLabel || ''} onChange={(e) => upd(i, { displayLabel: e.target.value })} />
              <Input className="!w-32" placeholder="SKU" value={r.sku || ''} onChange={(e) => upd(i, { sku: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-rose-600" checked={Boolean(r.isDefault)} onChange={(e) => upd(i, { isDefault: e.target.checked })} /> default
              </label>
            </>
          )}
          {kind === 'image' && (
            <>
              <Input className="!w-64 flex-1" placeholder="https://…/image.jpg" value={r.url || ''} onChange={(e) => upd(i, { url: e.target.value })} />
              <Input className="!w-40" placeholder="alt text" value={r.altText || ''} onChange={(e) => upd(i, { altText: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-rose-600" checked={Boolean(r.isPrimary)} onChange={(e) => upd(i, { isPrimary: e.target.checked })} /> primary
              </label>
            </>
          )}
          <button type="button" className="btn-ghost btn-sm !p-1.5 ml-auto" onClick={() => del(i)} aria-label="Remove row">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={add}>
        Add {kind}
      </Button>
    </div>
  );
}

const blankRow = (kind) =>
  kind === 'attribute'
    ? { key: '', value: '', unit: '' }
    : kind === 'variant'
      ? { variantType: 'weight', value: '', displayLabel: '', sku: '', isDefault: false }
      : { url: '', altText: '', isPrimary: false };

/**
 * Create / edit product master.
 * Edit mode carries `expectedVersion` from the last-fetched doc (optimistic lock).
 */
export default function MasterFormModal({ open, onClose, initial, categories, brands, onSaved }) {
  const { busy, run } = useAction();
  const [form, setForm] = useState(() => (initial ? fromDoc(initial) : blank()));
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef(null);
  const isEdit = Boolean(initial);

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadFile({ file, purpose: MEDIA_PURPOSE.productImage });
      setForm((f) => ({
        ...f,
        images: [...f.images, { url: asset.url, altText: '', isPrimary: f.images.length === 0 }],
      }));
      toast.success('Image uploaded ✓');
    } catch (err) {
      toast.error(uploadErrorText(err));
    } finally {
      setUploading(false);
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---- category required-attribute guidance (schema is enforced server-side) ----
  const categorySchema = useMemo(() => {
    const cat = (categories || []).find((c) => rid(c) === form.categoryId);
    return cat?.attributeSchema || [];
  }, [categories, form.categoryId]);
  const requiredFields = useMemo(() => categorySchema.filter((f) => f.required), [categorySchema]);

  useEffect(() => {
    // ensure a row exists for every required schema field once a category is chosen
    const keys = new Set(form.attributes.map((a) => a.key));
    const missing = requiredFields.filter((f) => !keys.has(f.key));
    if (missing.length) {
      setForm((f) => ({
        ...f,
        attributes: [
          ...f.attributes,
          ...missing.map((f2) => ({ key: f2.key, value: '', unit: f2.unit || '', _label: f2.label || f2.key, _required: true })),
        ],
      }));
    }
  }, [form.categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!isEdit && !form.skuGlobal.trim()) return setError('SKU is required');
    if (!form.title.trim()) return setError('Title is required');
    if (!form.categoryId) return setError('Category is required');
    if (form.attributes.some((a) => a.key && !/^[a-z0-9_]+$/.test(a.key))) {
      return setError('Attribute keys can only contain lowercase letters, numbers and underscores');
    }
    const missing = requiredFields.filter((f) => !(form.attributes.find((a) => a.key === f.key)?.value || '').trim());
    if (missing.length) {
      return setError(`${missing.map((f) => f.label || f.key).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for this category`);
    }
    const body = {
      ...(isEdit ? {} : { skuGlobal: form.skuGlobal.trim().toUpperCase() }),
      type: form.type,
      title: form.title.trim(),
      slug: form.slug || undefined,
      categoryId: form.categoryId,
      brandId: form.brandId || null,
      shortDescription: form.shortDescription || null,
      description: form.description || null,
      barcode: form.barcode || null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      isPerishable: form.isPerishable,
      requiresColdChain: form.requiresColdChain,
      defaultSellingUnit: form.defaultSellingUnit,
      minOrderQty: Number(form.minOrderQty) || 1,
      maxOrderQty: Number(form.maxOrderQty) || 100,
      attributes: form.attributes.filter((a) => a.key && a.value).map(({ key, value, unit }) => ({ key, value, unit: unit || null })),
      variants: form.variants.filter((v) => v.value).map(({ variantType, value, displayLabel, sku, isDefault }) => ({
        variantType, value, displayLabel: displayLabel || null, sku: sku || null, isDefault,
      })),
      images: form.images.filter((i) => i.url).map(({ url, altText, isPrimary }) => ({ url, altText: altText || null, isPrimary })),
    };
    if (isEdit) body.expectedVersion = initial.version;
    try {
      const r = await run(() =>
        isEdit ? api.catalogAdmin.updateMaster(initial.id, body) : api.catalogAdmin.createMaster(body)
      );
      toast.success(isEdit ? 'Master updated (v' + (Number(r.data.version) || '') + ')' : `Master created — ${r.data?.skuGlobal}`);
      onSaved?.(r.data);
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') {
        toast.error('This master was changed by someone else — refreshing…');
        onSaved?.(null, true); // signal refetch
        onClose?.();
        return;
      }
      setError(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit master · ${initial.skuGlobal}` : 'New product master'}
      subtitle={isEdit ? `v${initial.version} — changes carry the current version (optimistic lock)` : 'Global catalog item — pricing/stock live on tenant listings'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}>{isEdit ? 'Save changes' : 'Create master'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}

        <div>
          <p className="label !mb-2">Identity</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <Input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Red Roses (Bunch of 20)" />
            </Field>
            <Field label="SKU" required hint={isEdit ? 'SKU is immutable' : 'Unique, uppercase — auto-normalized'}>
              <Input required disabled={isEdit} value={form.skuGlobal} onChange={(e) => set('skuGlobal', e.target.value.toUpperCase())} placeholder="ROS-RED-BUNCH" className="font-mono" />
            </Field>
            <Field label="Type" required>
              <Select value={form.type} onChange={(e) => set('type', e.target.value)} disabled={isEdit}>
                {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_META[t].label}</option>)}
              </Select>
            </Field>
            <Field label="Slug" hint="Auto-generated from title when blank">
              <Input value={form.slug} onChange={(e) => set('slug', slugify(e.target.value))} placeholder="red-roses-bunch-20" className="font-mono" />
            </Field>
            <Field label="Category" required>
              <Select required value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Select category…</option>
                {(categories || []).map((c) => <option key={rid(c)} value={rid(c)}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Brand" hint="Optional — unverified brands can still be assigned">
              <Select value={form.brandId} onChange={(e) => set('brandId', e.target.value)}>
                <option value="">No brand</option>
                {(brands || []).map((b) => <option key={rid(b)} value={rid(b)}>{b.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div>
          <p className="label !mb-2">Details</p>
          <div className="space-y-4">
            <Field label="Short description">
              <Textarea value={form.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} placeholder="One-line description shown in lists…" />
            </Field>
            <Field label="Full description">
              <Textarea className="min-h-[110px]" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Full product story, care instructions…" />
            </Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Selling unit">
                <Select value={form.defaultSellingUnit} onChange={(e) => set('defaultSellingUnit', e.target.value)}>
                  {UNITS.map((u) => <option key={u} value={u}>{SELLING_UNIT_LABEL[u]}</option>)}
                </Select>
              </Field>
              <Field label="Min order qty"><Input type="number" min={1} value={form.minOrderQty} onChange={(e) => set('minOrderQty', e.target.value)} /></Field>
              <Field label="Max order qty"><Input type="number" min={1} value={form.maxOrderQty} onChange={(e) => set('maxOrderQty', e.target.value)} /></Field>
              <Field label="Barcode"><Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="EAN/UPC" /></Field>
            </div>
            <Field label="Tags" hint="Comma-separated">
              <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="roses, wedding, bulk" />
            </Field>
            <div className="flex flex-wrap gap-5">
              <Checkbox label="Perishable" checked={form.isPerishable} onChange={(e) => set('isPerishable', e.target.checked)} />
              <Checkbox label="Requires cold chain" checked={form.requiresColdChain} onChange={(e) => set('requiresColdChain', e.target.checked)} />
            </div>
          </div>
        </div>

        <div>
          <p className="label !mb-2">Attributes</p>
          {requiredFields.length > 0 && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This category requires: <b>{requiredFields.map((f) => f.label || f.key).join(', ')}</b>.
                The server validates values, number ranges and dropdown options.
              </span>
            </p>
          )}
          <RowsEditor kind="attribute" rows={form.attributes} onChange={(attributes) => set('attributes', attributes)} />
        </div>

        <div>
          <p className="label !mb-2">Variants</p>
          <RowsEditor kind="variant" rows={form.variants} onChange={(variants) => set('variants', variants)} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="label !mb-0">Images</p>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={uploadImage} />
            <Button type="button" variant="secondary" size="sm" icon={UploadCloud} loading={uploading} onClick={() => imageInputRef.current?.click()}>
              Upload from device
            </Button>
          </div>
          <RowsEditor kind="image" rows={form.images} onChange={(images) => set('images', images)} />
        </div>
      </form>
    </Modal>
  );
}

function fromDoc(m) {
  return {
    skuGlobal: m.skuGlobal || '',
    type: m.type || 'fresh_flower',
    title: m.title || '',
    slug: m.slug || '',
    categoryId: m.categoryId || '',
    brandId: m.brandId || '',
    shortDescription: m.shortDescription || '',
    description: m.description || '',
    barcode: m.barcode || '',
    tags: (m.tags || []).join(', '),
    isPerishable: m.isPerishable !== false,
    requiresColdChain: Boolean(m.requiresColdChain),
    defaultSellingUnit: m.defaultSellingUnit || 'piece',
    minOrderQty: m.minOrderQty ?? 1,
    maxOrderQty: m.maxOrderQty ?? 100,
    attributes: (m.attributes || []).map((a) => ({ key: a.key, value: a.value, unit: a.unit || '' })),
    variants: (m.variants || []).map((v) => ({ variantType: v.variantType || 'other', value: v.value, displayLabel: v.displayLabel || '', sku: v.sku || '', isDefault: Boolean(v.isDefault) })),
    images: (m.images || []).map((i) => ({ url: i.url, altText: i.altText || '', isPrimary: Boolean(i.isPrimary) })),
  };
}
