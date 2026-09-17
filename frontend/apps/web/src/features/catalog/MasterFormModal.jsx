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
  kind: 'physical',
  title: '',
  slug: '',
  categoryId: '',
  brandId: '',
  shortDescription: '',
  description: '',
  barcode: '',
  manufacturer: '',
  modelNumber: '',
  countryOfOrigin: '',
  condition: 'new',
  gtin: '',
  mpn: '',
  hsn: '',
  weightValue: '',
  weightUnit: 'g',
  length: '',
  width: '',
  height: '',
  dimensionUnit: 'cm',
  requiresShipping: true,
  fragile: false,
  tags: '',
  isPerishable: false,
  requiresColdChain: false,
  defaultSellingUnit: 'piece',
  minOrderQty: 1,
  maxOrderQty: 100,
  attributes: [],
  options: [],
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
          {kind === 'option' && (
            <>
              <Input className="!w-32" placeholder="code (color)" value={r.code || ''} onChange={(e) => upd(i, { code: slugify(e.target.value).replace(/-/g, '_') })} />
              <Input className="!w-36" placeholder="Name (Color)" value={r.name || ''} onChange={(e) => upd(i, { name: e.target.value })} />
              <Input className="min-w-[240px] flex-1" placeholder="Values, comma separated: Red, Blue" value={r.values || ''} onChange={(e) => upd(i, { values: e.target.value })} />
              <Select className="!w-28" value={r.displayType || 'text'} onChange={(e) => upd(i, { displayType: e.target.value })}>
                <option value="text">Text</option><option value="swatch">Swatch</option><option value="image">Image</option>
              </Select>
            </>
          )}
          {kind === 'variant' && (
            <>
              <Select className="!w-32" value={r.variantType || ''} onChange={(e) => upd(i, { variantType: e.target.value })}>
                {VARIANT_TYPES.map((t) => <option key={t} value={t}>{VARIANT_TYPE_LABEL[t]}</option>)}
              </Select>
              <Input className="!w-32" placeholder="Legacy value" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />
              <Input className="min-w-[220px] flex-1" placeholder="Combination: color=Red, size=M" value={r.optionText || ''} onChange={(e) => upd(i, { optionText: e.target.value })} />
              <Input className="!w-32" placeholder="label" value={r.displayLabel || ''} onChange={(e) => upd(i, { displayLabel: e.target.value })} />
              <Input className="!w-32" placeholder="SKU" value={r.sku || ''} onChange={(e) => upd(i, { sku: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-rose-600" checked={Boolean(r.isDefault)} onChange={(e) => upd(i, { isDefault: e.target.checked })} /> default
              </label>
            </>
          )}
          {kind === 'image' && (
            <>
              <Select className="!w-28" value={r.mediaType || 'image'} onChange={(e) => upd(i, { mediaType: e.target.value })}>
                <option value="image">Image</option><option value="video">Video</option><option value="model_3d">3D model</option><option value="document">Document</option>
              </Select>
              <Select className="!w-28" value={r.role || 'gallery'} onChange={(e) => upd(i, { role: e.target.value })}>
                {['gallery', 'thumbnail', 'swatch', 'lifestyle', 'size_chart', 'manual'].map((role) => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}
              </Select>
              <Input className="!w-64 flex-1" placeholder="https://…/asset" value={r.url || ''} onChange={(e) => upd(i, { url: e.target.value })} />
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

const blankRow = (kind) => {
  if (kind === 'attribute') return { key: '', value: '', unit: '' };
  if (kind === 'option') return { code: '', name: '', values: '', displayType: 'text' };
  if (kind === 'variant') return { variantType: 'other', value: '', optionText: '', displayLabel: '', sku: '', isDefault: false };
  return { url: '', altText: '', mediaType: 'image', role: 'gallery', isPrimary: false };
};

const parseOptionText = (text, definitions) => String(text || '').split(',').map((part) => {
  const [rawCode, ...rest] = part.split('=');
  const code = rawCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const value = rest.join('=').trim();
  const definition = definitions.find((o) => o.code === code);
  return code && value ? { code, name: definition?.name || code, value } : null;
}).filter(Boolean);

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
    const options = form.options.filter((o) => o.code && o.name).map((o, index) => ({
      code: o.code,
      name: o.name.trim(),
      values: String(o.values || '').split(',').map((v) => v.trim()).filter(Boolean),
      displayType: o.displayType || 'text',
      sortOrder: index,
    }));
    const body = {
      ...(isEdit ? {} : { skuGlobal: form.skuGlobal.trim().toUpperCase() }),
      type: form.type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      kind: form.kind,
      options,
      title: form.title.trim(),
      slug: form.slug || undefined,
      categoryId: form.categoryId,
      brandId: form.brandId || null,
      shortDescription: form.shortDescription || null,
      description: form.description || null,
      barcode: form.barcode || null,
      manufacturer: form.manufacturer || null,
      modelNumber: form.modelNumber || null,
      countryOfOrigin: form.countryOfOrigin || null,
      condition: form.condition,
      identifiers: { gtin: form.gtin || null, mpn: form.mpn || null, hsn: form.hsn || null },
      fulfillmentProfile: {
        requiresShipping: form.kind === 'physical' ? form.requiresShipping : false,
        shippingClass: 'standard',
        weight: { value: form.weightValue === '' ? null : Number(form.weightValue), unit: form.weightUnit },
        dimensions: {
          length: form.length === '' ? null : Number(form.length),
          width: form.width === '' ? null : Number(form.width),
          height: form.height === '' ? null : Number(form.height),
          unit: form.dimensionUnit,
        },
        fragile: form.fragile,
      },
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      isPerishable: form.isPerishable,
      requiresColdChain: form.requiresColdChain,
      defaultSellingUnit: form.defaultSellingUnit,
      minOrderQty: Number(form.minOrderQty) || 1,
      maxOrderQty: Number(form.maxOrderQty) || 100,
      attributes: form.attributes.filter((a) => a.key && a.value).map(({ key, value, unit }) => ({ key, value, unit: unit || null })),
      variants: form.variants.filter((v) => v.value || v.optionText).map(({ variantType, value, optionText, displayLabel, sku, isDefault }) => {
        const optionValues = parseOptionText(optionText, options);
        return {
          variantType,
          value: value || undefined,
          ...(optionValues.length ? { optionValues } : {}),
          displayLabel: displayLabel || null,
          sku: sku || null,
          isDefault,
        };
      }),
      images: form.images.filter((i) => i.url).map(({ url, altText, mediaType, role, isPrimary }) => ({
        url, altText: altText || null, mediaType: mediaType || 'image', role: role || 'gallery', isPrimary,
      })),
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
            <Field label="Product class" required hint="Choose a preset or enter any normalized class">
              <Input list="universal-product-types" value={form.type} onChange={(e) => set('type', e.target.value)} placeholder="electronics" />
              <datalist id="universal-product-types">
                {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_META[t].label}</option>)}
              </datalist>
            </Field>
            <Field label="Product kind" required hint="Controls shipping and fulfilment semantics">
              <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="physical">Physical</option><option value="digital">Digital</option>
                <option value="service">Service</option><option value="bundle">Bundle</option>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Manufacturer"><Input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></Field>
              <Field label="Model number"><Input value={form.modelNumber} onChange={(e) => set('modelNumber', e.target.value)} /></Field>
              <Field label="Country of origin"><Input value={form.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} /></Field>
              <Field label="Condition"><Select value={form.condition} onChange={(e) => set('condition', e.target.value)}><option value="new">New</option><option value="refurbished">Refurbished</option><option value="used">Used</option></Select></Field>
              <Field label="GTIN / EAN / UPC"><Input value={form.gtin} onChange={(e) => set('gtin', e.target.value)} /></Field>
              <Field label="MPN"><Input value={form.mpn} onChange={(e) => set('mpn', e.target.value)} /></Field>
              <Field label="HSN code"><Input value={form.hsn} onChange={(e) => set('hsn', e.target.value)} /></Field>
            </div>
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
            {form.kind === 'physical' && (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Shipping measurements</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <Field label="Weight"><Input type="number" min="0" step="any" value={form.weightValue} onChange={(e) => set('weightValue', e.target.value)} /></Field>
                  <Field label="Unit"><Select value={form.weightUnit} onChange={(e) => set('weightUnit', e.target.value)}>{['mg', 'g', 'kg', 'oz', 'lb'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
                  <Field label="Length"><Input type="number" min="0" step="any" value={form.length} onChange={(e) => set('length', e.target.value)} /></Field>
                  <Field label="Width"><Input type="number" min="0" step="any" value={form.width} onChange={(e) => set('width', e.target.value)} /></Field>
                  <Field label="Height"><Input type="number" min="0" step="any" value={form.height} onChange={(e) => set('height', e.target.value)} /></Field>
                  <Field label="Unit"><Select value={form.dimensionUnit} onChange={(e) => set('dimensionUnit', e.target.value)}>{['mm', 'cm', 'm', 'in', 'ft'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-5">
              {form.kind === 'physical' && <Checkbox label="Requires shipping" checked={form.requiresShipping} onChange={(e) => set('requiresShipping', e.target.checked)} />}
              {form.kind === 'physical' && <Checkbox label="Fragile" checked={form.fragile} onChange={(e) => set('fragile', e.target.checked)} />}
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
          <p className="label !mb-2">Option dimensions</p>
          <p className="mb-2 text-xs text-slate-500">Define up to six reusable dimensions such as Color, Size, Material or Storage.</p>
          <RowsEditor kind="option" rows={form.options} onChange={(options) => set('options', options)} />
        </div>

        <div>
          <p className="label !mb-2">Sellable variants</p>
          <p className="mb-2 text-xs text-slate-500">Build combinations with <code>color=Red, size=M</code>. Ordering never changes variant identity.</p>
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
    type: m.type || 'other',
    kind: m.kind || 'physical',
    title: m.title || '',
    slug: m.slug || '',
    categoryId: m.categoryId || '',
    brandId: m.brandId || '',
    shortDescription: m.shortDescription || '',
    description: m.description || '',
    barcode: m.barcode || '',
    manufacturer: m.manufacturer || '',
    modelNumber: m.modelNumber || '',
    countryOfOrigin: m.countryOfOrigin || '',
    condition: m.condition || 'new',
    gtin: m.identifiers?.gtin || '',
    mpn: m.identifiers?.mpn || '',
    hsn: m.identifiers?.hsn || '',
    weightValue: m.fulfillmentProfile?.weight?.value ?? '',
    weightUnit: m.fulfillmentProfile?.weight?.unit || 'g',
    length: m.fulfillmentProfile?.dimensions?.length ?? '',
    width: m.fulfillmentProfile?.dimensions?.width ?? '',
    height: m.fulfillmentProfile?.dimensions?.height ?? '',
    dimensionUnit: m.fulfillmentProfile?.dimensions?.unit || 'cm',
    requiresShipping: m.fulfillmentProfile?.requiresShipping !== false,
    fragile: Boolean(m.fulfillmentProfile?.fragile),
    tags: (m.tags || []).join(', '),
    isPerishable: Boolean(m.isPerishable),
    requiresColdChain: Boolean(m.requiresColdChain),
    defaultSellingUnit: m.defaultSellingUnit || 'piece',
    minOrderQty: m.minOrderQty ?? 1,
    maxOrderQty: m.maxOrderQty ?? 100,
    attributes: (m.attributes || []).map((a) => ({ key: a.key, value: a.value, unit: a.unit || '' })),
    options: (m.options || []).map((o) => ({ code: o.code, name: o.name, values: (o.values || []).join(', '), displayType: o.displayType || 'text' })),
    variants: (m.variants || []).map((v) => ({
      variantType: v.variantType || 'other', value: v.optionValues?.length ? '' : (v.value || ''),
      optionText: (v.optionValues || []).map((o) => `${o.code}=${o.value}`).join(', '),
      displayLabel: v.displayLabel || '', sku: v.sku || '', isDefault: Boolean(v.isDefault),
    })),
    images: (m.images || []).map((i) => ({
      url: i.url, altText: i.altText || '', mediaType: i.mediaType || 'image', role: i.role || 'gallery', isPrimary: Boolean(i.isPrimary),
    })),
  };
}
