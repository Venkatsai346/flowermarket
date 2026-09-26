import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Image, Info, PackageCheck, Plus, Settings2, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import {
  PRODUCT_TYPE_META,
  SELLING_UNIT_LABEL,
  VARIANT_TYPE_LABEL,
  useAuthStore,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { useRecoverableDraft } from '../../lib/useRecoverableDraft.js';
import { toast } from '../../lib/toasts.js';
import { uploadFile, uploadErrorText, MEDIA_PURPOSE } from '../../lib/upload.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { Guidance, RecoveryNotice, ReviewItem, SectionIntro, SubmissionError, WizardNav } from './CatalogFormUX.jsx';
import { BrandPicker, CategoryPicker } from './CatalogPickers.jsx';

const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_META);
const UNITS = Object.keys(SELLING_UNIT_LABEL);
const VARIANT_TYPES = Object.keys(VARIANT_TYPE_LABEL);

const FORM_STEPS = [
  { id: 'identity', label: 'Identity', caption: 'Core product record' },
  { id: 'structure', label: 'Structure', caption: 'Attributes & options' },
  { id: 'variants', label: 'Variants', caption: 'Sellable combinations' },
  { id: 'media', label: 'Media', caption: 'Customer assets' },
  { id: 'review', label: 'Review', caption: 'Validate & publish' },
];


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
  isbn: '',
  hsn: '',
  warrantyDuration: '',
  warrantyUnit: 'month',
  warrantyDescription: '',
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
  weightValue: '',
  weightUnit: 'g',
  length: '',
  width: '',
  height: '',
  dimensionUnit: 'cm',
  requiresShipping: true,
  shippingClass: 'standard',
  fragile: false,
  hazardous: false,
  ageRestricted: false,
  requiresSerialTracking: false,
  tags: '',
  isPerishable: false,
  requiresColdChain: false,
  defaultSellingUnit: 'piece',
  minOrderQty: 1,
  maxOrderQty: 100,
  attributes: [],
  options: [],
  optionRules: [],
  unitDimension: 'count',
  baseUnit: 'piece',
  allowFractional: false,
  unitPrecision: 0,
  units: [{ code: 'piece', label: 'Piece', toBaseFactor: 1, precision: 0 }],
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
function RowsEditor({ rows, onChange, kind, definitions = [] }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, blankRow(kind)]);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          {kind === 'attribute' && (() => {
            const definition = definitions.find((field) => field.key === r.key);
            const type = definition?.type || 'string';
            const shown = Array.isArray(r.value) ? r.value.join(', ') : r.value && typeof r.value === 'object' ? JSON.stringify(r.value) : r.value ?? '';
            return <>
              {definitions.length ? <Select className="!w-44" value={r.key || ''} onChange={(e) => { const field = definitions.find((item) => item.key === e.target.value); upd(i, { key: e.target.value, value: '', unit: field?.unit || '' }); }}><option value="">Select specification…</option>{definitions.map((field) => <option key={field.key} value={field.key}>{field.label || field.key}{field.required ? ' *' : ''}</option>)}</Select> : <Input className="!w-36" placeholder="key" value={r.key || ''} onChange={(e) => upd(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />}
              {type === 'boolean' ? <Select className="min-w-40 flex-1" value={String(r.value ?? '')} onChange={(e) => upd(i, { value: e.target.value === 'true' })}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></Select>
                : type === 'select' ? <Select className="min-w-40 flex-1" value={shown} onChange={(e) => upd(i, { value: e.target.value })}><option value="">Select…</option>{(definition?.options || []).map((option) => <option key={option}>{option}</option>)}</Select>
                  : <Input className="min-w-40 flex-1" type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'} step={type === 'number' ? 'any' : undefined} placeholder={type === 'multi_select' ? 'Comma-separated values' : type === 'json' ? '{"key":"value"}' : 'Value'} value={shown} onChange={(e) => upd(i, { value: e.target.value })} />}
              <Input className="!w-24" placeholder="unit" value={r.unit || definition?.unit || ''} onChange={(e) => upd(i, { unit: e.target.value })} />
            </>;
          })()}
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
          {kind === 'rule' && (
            <>
              <Input className="!w-28" placeholder="when option" value={r.whenCode || ''} onChange={(e) => upd(i, { whenCode: e.target.value })} />
              <Input className="!w-36" placeholder="values: Red, Blue" value={r.whenValues || ''} onChange={(e) => upd(i, { whenValues: e.target.value })} />
              <Input className="!w-28" placeholder="target option" value={r.thenCode || ''} onChange={(e) => upd(i, { thenCode: e.target.value })} />
              <Input className="min-w-[180px] flex-1" placeholder="allowed values" value={r.allowedValues || ''} onChange={(e) => upd(i, { allowedValues: e.target.value })} />
              <Input className="min-w-[160px] flex-1" placeholder="excluded values" value={r.excludedValues || ''} onChange={(e) => upd(i, { excludedValues: e.target.value })} />
            </>
          )}
          {kind === 'unit' && (
            <>
              <Input className="!w-28" placeholder="code" value={r.code || ''} onChange={(e) => upd(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} />
              <Input className="!w-40" placeholder="label" value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })} />
              <Input className="!w-36" type="number" min="0.000000001" step="any" placeholder="to base factor" value={r.toBaseFactor ?? ''} onChange={(e) => upd(i, { toBaseFactor: e.target.value })} />
              <Input className="!w-24" type="number" min="0" max="6" placeholder="precision" value={r.precision ?? 3} onChange={(e) => upd(i, { precision: e.target.value })} />
            </>
          )}
          {kind === 'variant' && (
            <>
              <Select className="!w-32" value={r.variantType || ''} onChange={(e) => upd(i, { variantType: e.target.value })}>
                {VARIANT_TYPES.map((t) => <option key={t} value={t}>{VARIANT_TYPE_LABEL[t]}</option>)}
              </Select>
              <Input className="!w-32" placeholder="Legacy value" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />
              <Input className="min-w-[220px] flex-1" placeholder="Combination: color=Red, size=M" value={r.optionText || ''} onChange={(e) => upd(i, { optionText: e.target.value })} />
              <Input className="!w-28" type="number" min="0.000001" step="any" placeholder="qty" value={r.sellQuantityValue ?? 1} onChange={(e) => upd(i, { sellQuantityValue: e.target.value })} />
              <Input className="!w-24" placeholder="unit" value={r.sellQuantityUnit || ''} onChange={(e) => upd(i, { sellQuantityUnit: e.target.value })} />
              <Input className="!w-32" placeholder="label" value={r.displayLabel || ''} onChange={(e) => upd(i, { displayLabel: e.target.value })} />
              <Input className="!w-32" placeholder="SKU" value={r.sku || ''} onChange={(e) => upd(i, { sku: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-rose-600" checked={Boolean(r.isDefault)} onChange={(e) => upd(i, { isDefault: e.target.checked })} /> default
              </label>
              <div className="basis-full border-t border-slate-200 pt-2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">SKU identifiers & physical override</p>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Input placeholder="Barcode" value={r.barcode || ''} onChange={(e) => upd(i, { barcode: e.target.value })} />
                  <Input placeholder="Variant GTIN" value={r.gtin || ''} onChange={(e) => upd(i, { gtin: e.target.value })} />
                  <Input placeholder="Variant MPN" value={r.mpn || ''} onChange={(e) => upd(i, { mpn: e.target.value })} />
                  <div className="flex gap-1"><Input type="number" min="0" step="any" placeholder="Weight" value={r.weightValue ?? ''} onChange={(e) => upd(i, { weightValue: e.target.value })} /><Select className="!w-20" value={r.weightUnit || 'g'} onChange={(e) => upd(i, { weightUnit: e.target.value })}>{['mg', 'g', 'kg', 'oz', 'lb'].map((unit) => <option key={unit}>{unit}</option>)}</Select></div>
                  <Input type="number" min="0" step="any" placeholder="Length" value={r.length ?? ''} onChange={(e) => upd(i, { length: e.target.value })} />
                  <Input type="number" min="0" step="any" placeholder="Width" value={r.width ?? ''} onChange={(e) => upd(i, { width: e.target.value })} />
                  <Input type="number" min="0" step="any" placeholder="Height" value={r.height ?? ''} onChange={(e) => upd(i, { height: e.target.value })} />
                  <Select value={r.dimensionUnit || 'cm'} onChange={(e) => upd(i, { dimensionUnit: e.target.value })}>{['mm', 'cm', 'm', 'in', 'ft'].map((unit) => <option key={unit}>{unit}</option>)}</Select>
                  <Input type="number" min="0" step="1" placeholder="Sort order" value={r.sortOrder ?? i} onChange={(e) => upd(i, { sortOrder: e.target.value })} />
                  <Input className="sm:col-span-3" placeholder="Variant image URLs, comma-separated" value={r.imageUrls || ''} onChange={(e) => upd(i, { imageUrls: e.target.value })} />
                </div>
              </div>
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
              <div className="basis-full grid gap-2 sm:grid-cols-4 lg:grid-cols-7"><Input placeholder="MIME type" value={r.mimeType || ''} onChange={(e) => upd(i, { mimeType: e.target.value })} /><Input type="number" min="1" placeholder="Width px" value={r.width ?? ''} onChange={(e) => upd(i, { width: e.target.value })} /><Input type="number" min="1" placeholder="Height px" value={r.height ?? ''} onChange={(e) => upd(i, { height: e.target.value })} /><Input type="number" min="0" placeholder="File bytes" value={r.fileSize ?? ''} onChange={(e) => upd(i, { fileSize: e.target.value })} /><Input type="number" min="0" max="1" step="0.05" title="Focal X" value={r.focalX ?? 0.5} onChange={(e) => upd(i, { focalX: e.target.value })} /><Input type="number" min="0" max="1" step="0.05" title="Focal Y" value={r.focalY ?? 0.5} onChange={(e) => upd(i, { focalY: e.target.value })} /><Input type="number" min="0" placeholder="Sort order" value={r.sortOrder ?? i} onChange={(e) => upd(i, { sortOrder: e.target.value })} /></div>
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
  if (kind === 'rule') return { whenCode: '', whenValues: '', thenCode: '', allowedValues: '', excludedValues: '' };
  if (kind === 'unit') return { code: '', label: '', toBaseFactor: 1, precision: 3 };
  if (kind === 'variant') return { variantType: 'other', value: '', optionText: '', sellQuantityValue: 1, sellQuantityUnit: '', displayLabel: '', sku: '', barcode: '', gtin: '', mpn: '', weightValue: '', weightUnit: 'g', length: '', width: '', height: '', dimensionUnit: 'cm', sortOrder: 0, imageUrls: '', isDefault: false };
  return { url: '', altText: '', mediaType: 'image', role: 'gallery', mimeType: '', width: '', height: '', fileSize: '', focalX: 0.5, focalY: 0.5, sortOrder: 0, isPrimary: false };
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
  const [step, setStep] = useState('identity');
  const [errorCode, setErrorCode] = useState('');
  const imageInputRef = useRef(null);
  const isEdit = Boolean(initial);
  const actorId = useAuthStore((state) => state.user?.id || state.user?._id || 'anonymous');
  const draft = useRecoverableDraft({
    key: `${actorId}:product-master:${initial?.id || initial?._id || 'new'}`,
    value: form,
    initialValue: initial ? fromDoc(initial) : blank(),
    enabled: open,
  });

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

  const set = (k, v) => { setError(null); setForm((f) => ({ ...f, [k]: v })); };
  const selectCategory = (categoryId) => {
    const category = (categories || []).find((item) => rid(item) === categoryId);
    const allowedKeys = new Set((category?.attributeSchema || []).map((field) => field.key));
    const removed = form.attributes.filter((attribute) => attribute.key && !allowedKeys.has(attribute.key)).length;
    setError(null);
    setForm((current) => ({
      ...current,
      categoryId,
      attributes: current.attributes.filter((attribute) => allowedKeys.has(attribute.key)),
    }));
    if (removed) toast.info(`${removed} specification ${removed === 1 ? 'was' : 'were'} removed because the category changed`);
  };
  const fail = (message, targetStep = step, code = '') => {
    setError(message); setErrorCode(code); setStep(targetStep); toast.error(message);
    requestAnimationFrame(() => document.querySelector('[role=\"alert\"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return undefined;
  };

  // ---- category required-attribute guidance (schema is enforced server-side) ----
  const categorySchema = useMemo(() => {
    const cat = (categories || []).find((c) => rid(c) === form.categoryId);
    return cat?.attributeSchema || [];
  }, [categories, form.categoryId]);
  const masterDefinitions = useMemo(() => categorySchema.filter((field) => ['master', 'both'].includes(field.appliesTo || 'master')), [categorySchema]);
  const requiredFields = useMemo(() => masterDefinitions.filter((field) => field.required), [masterDefinitions]);

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
    setError(null); setErrorCode('');
    if (!isEdit && !form.skuGlobal.trim()) return fail('Add a unique global SKU before continuing.', 'identity');
    if (!form.title.trim()) return fail('Add a customer-facing product title before continuing.', 'identity');
    if (!form.categoryId) return fail('Choose a category so its attribute and compliance rules can be applied.', 'identity');
    if (form.attributes.some((a) => a.key && !/^[a-z0-9_]+$/.test(a.key))) {
      return fail('Attribute keys can only contain lowercase letters, numbers and underscores.', 'structure');
    }
    if (Number(form.minOrderQty) > Number(form.maxOrderQty)) return fail('Maximum order quantity must be greater than or equal to the minimum.', 'identity');
    const optionCodes = form.options.filter((item) => item.code).map((item) => item.code);
    if (new Set(optionCodes).size !== optionCodes.length) return fail('Every option dimension needs a unique stable code.', 'structure');
    const baseDefinition = form.units.find((unit) => unit.code === form.baseUnit);
    if (!baseDefinition || Number(baseDefinition.toBaseFactor) !== 1) return fail('The base unit must appear in allowed units with a conversion factor of exactly 1.', 'structure');
    if (form.units.some((unit) => !(Number(unit.toBaseFactor) > 0))) return fail('Every unit conversion factor must be greater than zero.', 'structure');
    const missing = requiredFields.filter((field) => {
      const value = form.attributes.find((attribute) => attribute.key === field.key)?.value;
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    });
    if (missing.length) {
      return fail(`${missing.map((f) => f.label || f.key).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for this category.`, 'structure');
    }
    const options = form.options.filter((o) => o.code && o.name).map((o, index) => ({
      code: o.code,
      name: o.name.trim(),
      values: String(o.values || '').split(',').map((v) => v.trim()).filter(Boolean),
      displayType: o.displayType || 'text',
      sortOrder: index,
    }));
    const csv = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    const optionRules = form.optionRules.filter((rule) => rule.whenCode && rule.thenCode).map((rule, index) => ({
      code: `rule_${index + 1}`,
      when: { code: rule.whenCode, values: csv(rule.whenValues) },
      then: { code: rule.thenCode, allowedValues: csv(rule.allowedValues), excludedValues: csv(rule.excludedValues), required: true },
      priority: index,
    }));
    const unitPolicy = {
      dimension: form.unitDimension,
      baseUnit: form.baseUnit,
      allowFractional: form.allowFractional,
      precision: Number(form.unitPrecision),
      units: form.units.filter((unit) => unit.code && unit.label).map((unit) => ({
        code: unit.code, label: unit.label, toBaseFactor: Number(unit.toBaseFactor), precision: Number(unit.precision),
      })),
    };
    const body = {
      ...(isEdit ? {} : { skuGlobal: form.skuGlobal.trim().toUpperCase() }),
      type: form.type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      kind: form.kind,
      options,
      optionRules,
      unitPolicy,
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
      identifiers: { gtin: form.gtin || null, mpn: form.mpn || null, isbn: form.isbn || null, hsn: form.hsn || null },
      warranty: {
        duration: form.warrantyDuration === '' ? null : Number(form.warrantyDuration),
        unit: form.warrantyUnit,
        description: form.warrantyDescription || null,
      },
      seo: {
        title: form.seoTitle || null,
        description: form.seoDescription || null,
        keywords: form.seoKeywords.split(',').map((value) => value.trim()).filter(Boolean),
      },
      fulfillmentProfile: {
        requiresShipping: form.kind === 'physical' ? form.requiresShipping : false,
        shippingClass: form.shippingClass || 'standard',
        weight: { value: form.weightValue === '' ? null : Number(form.weightValue), unit: form.weightUnit },
        dimensions: {
          length: form.length === '' ? null : Number(form.length),
          width: form.width === '' ? null : Number(form.width),
          height: form.height === '' ? null : Number(form.height),
          unit: form.dimensionUnit,
        },
        fragile: form.fragile,
        hazardous: form.hazardous,
        ageRestricted: form.ageRestricted,
        requiresSerialTracking: form.requiresSerialTracking,
      },
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      isPerishable: form.isPerishable,
      requiresColdChain: form.requiresColdChain,
      defaultSellingUnit: form.defaultSellingUnit,
      minOrderQty: Number(form.minOrderQty) || 1,
      maxOrderQty: Number(form.maxOrderQty) || 100,
      attributes: form.attributes.filter((attribute) => attribute.key && attribute.value !== '').map(({ key, value, unit }) => {
        const definition = masterDefinitions.find((field) => field.key === key);
        let typedValue = value;
        if (definition?.type === 'number') typedValue = Number(value);
        else if (definition?.type === 'boolean') typedValue = value === true || value === 'true';
        else if (definition?.type === 'multi_select') typedValue = Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
        else if (definition?.type === 'json') { try { typedValue = JSON.parse(value); } catch { typedValue = value; } }
        return { key, value: typedValue, unit: unit || definition?.unit || null };
      }),
      variants: form.variants.filter((v) => v.value || v.optionText).map((variant, index) => {
        const optionValues = parseOptionText(variant.optionText, options);
        return {
          variantType: variant.variantType,
          value: variant.value || undefined,
          ...(optionValues.length ? { optionValues } : {}),
          sellQuantity: { value: Number(variant.sellQuantityValue || 1), unitCode: variant.sellQuantityUnit || form.baseUnit },
          displayLabel: variant.displayLabel || null,
          sku: variant.sku || null,
          barcode: variant.barcode || null,
          identifiers: { gtin: variant.gtin || null, mpn: variant.mpn || null },
          weight: { value: variant.weightValue === '' ? null : Number(variant.weightValue), unit: variant.weightUnit || 'g' },
          dimensions: {
            length: variant.length === '' ? null : Number(variant.length), width: variant.width === '' ? null : Number(variant.width),
            height: variant.height === '' ? null : Number(variant.height), unit: variant.dimensionUnit || 'cm',
          },
          sortOrder: Number(variant.sortOrder ?? index),
          images: String(variant.imageUrls || '').split(',').map((url) => url.trim()).filter(Boolean).map((url, imageIndex) => ({ url, altText: variant.displayLabel || form.title, mediaType: 'image', role: 'gallery', isPrimary: imageIndex === 0, sortOrder: imageIndex })),
          isDefault: variant.isDefault,
        };
      }),
      images: form.images.filter((image) => image.url).map((image, index) => ({
        url: image.url, altText: image.altText || undefined, mediaType: image.mediaType || 'image', role: image.role || 'gallery',
        mimeType: image.mimeType || null, width: image.width === '' || image.width == null ? null : Number(image.width),
        height: image.height === '' || image.height == null ? null : Number(image.height), fileSize: image.fileSize === '' || image.fileSize == null ? null : Number(image.fileSize),
        focalPoint: { x: Number(image.focalX ?? 0.5), y: Number(image.focalY ?? 0.5) }, sortOrder: Number(image.sortOrder ?? index), isPrimary: image.isPrimary,
      })),
    };
    if (isEdit) body.expectedVersion = initial.version;
    try {
      const r = await run(() =>
        isEdit ? api.catalogAdmin.updateMaster(initial.id, body) : api.catalogAdmin.createMaster(body)
      );
      toast.success(isEdit ? 'Master updated (v' + (Number(r.data.version) || '') + ')' : `Master created — ${r.data?.skuGlobal}`);
      draft.clear();
      onSaved?.(r.data);
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') {
        toast.error('This master was changed by someone else — refreshing…');
        onSaved?.(null, true); // signal refetch
        onClose?.();
        return;
      }
      fail(errMsg(err), err.code === 'VALIDATION_ERROR' ? 'review' : step, err.code);
    }
  };

  const completed = [
    form.title && form.categoryId && (isEdit || form.skuGlobal) ? 'identity' : null,
    form.units.some((unit) => unit.code === form.baseUnit && Number(unit.toBaseFactor) === 1) ? 'structure' : null,
    form.variants.length || !form.options.length ? 'variants' : null,
    form.images.some((image) => image.url) ? 'media' : null,
  ].filter(Boolean);

  const go = (next) => { setError(null); setErrorCode(''); setStep(next); };
  const stepIndex = FORM_STEPS.findIndex((item) => item.id === step);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit master · ${initial.skuGlobal}` : 'New product master'}
      subtitle={isEdit ? `v${initial.version} — changes carry the current version (optimistic lock)` : 'Global catalog item — pricing/stock live on tenant listings'}
      size="xl"
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {stepIndex > 0 && <Button variant="ghost" onClick={() => go(FORM_STEPS[stepIndex - 1].id)}>Back</Button>}
          {step !== 'review'
            ? <Button onClick={() => go(FORM_STEPS[Math.min(stepIndex + 1, FORM_STEPS.length - 1)].id)}>Continue</Button>
            : <Button loading={busy} icon={PackageCheck} onClick={submit}>{isEdit ? 'Save changes' : 'Create master'}</Button>}
        </>
      }
    >
      <form onSubmit={(event) => {
        if (step === 'review') return submit(event);
        event.preventDefault();
        go(FORM_STEPS[Math.min(stepIndex + 1, FORM_STEPS.length - 1)].id);
        return undefined;
      }} className="space-y-5">
        <WizardNav steps={FORM_STEPS} active={step} completed={completed} onChange={go} />
        <RecoveryNotice draft={draft.recovered} onRestore={() => { const recovered = draft.recover(); if (recovered) { setForm(recovered); toast.success('Unfinished master restored'); } }} onDiscard={draft.discard} />
        <SubmissionError message={error} code={errorCode} />

        {step === 'identity' && <div className="space-y-6 animate-in">
        <div>
          <SectionIntro eyebrow="Product foundation" title="Identity & taxonomy" description="Create the durable catalog identity used by every store offer, SKU, search document and order snapshot." icon={Sparkles} />
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
            <Field label="Category" required hint="Choose a governed leaf category. It controls required specifications and compliance guidance.">
              <CategoryPicker
                value={form.categoryId}
                onChange={selectCategory}
                categories={categories}
                selectedCategory={initial?.category}
                required
              />
            </Field>
            <Field label="Brand" hint="Searches the complete registry. Leave empty for unbranded or commodity goods.">
              <BrandPicker
                value={form.brandId}
                onChange={(brandId) => set('brandId', brandId)}
                brands={brands}
                selectedBrand={initial?.brand}
              />
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
              <Field label="MPN" hint="Manufacturer part number"><Input value={form.mpn} onChange={(e) => set('mpn', e.target.value)} /></Field>
              <Field label="ISBN" hint="Books and publications"><Input value={form.isbn} onChange={(e) => set('isbn', e.target.value)} /></Field>
              <Field label="HSN code" hint="GST commodity classification"><Input value={form.hsn} onChange={(e) => set('hsn', e.target.value)} /></Field>
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
            <Field label="Tags" hint="Comma-separated discovery terms used by search and merchandising.">
              <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="roses, wedding, bulk" />
            </Field>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Warranty</p>
              <div className="grid gap-3 sm:grid-cols-[8rem_9rem_1fr]">
                <Field label="Duration" hint="Use 0 for lifetime"><Input type="number" min="0" value={form.warrantyDuration} onChange={(e) => set('warrantyDuration', e.target.value)} placeholder="12" /></Field>
                <Field label="Unit"><Select value={form.warrantyUnit} onChange={(e) => set('warrantyUnit', e.target.value)}><option value="day">Days</option><option value="month">Months</option><option value="year">Years</option></Select></Field>
                <Field label="Coverage summary" hint="What is covered, exclusions and claim path; max 500 characters."><Input maxLength={500} value={form.warrantyDescription} onChange={(e) => set('warrantyDescription', e.target.value)} placeholder="Manufacturer warranty against defects…" /></Field>
              </div>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wide text-violet-700">Search engine preview</p><p className="mt-1 text-xs text-slate-500">Optional metadata for the storefront product page. Blank values fall back to the product title and description.</p></div>
              <div className="space-y-3">
                <Field label="SEO title" hint={`${form.seoTitle.length}/70 · concise title shown in search results`}><Input maxLength={70} value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} placeholder={form.title || 'Product title'} /></Field>
                <Field label="Meta description" hint={`${form.seoDescription.length}/180 · explain the product and its value`}><Textarea maxLength={180} className="min-h-[72px]" value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} placeholder={form.shortDescription || 'A clear customer-focused summary…'} /></Field>
                <Field label="SEO keywords" hint="Up to 20 comma-separated phrases; use only genuinely relevant terms."><Input value={form.seoKeywords} onChange={(e) => set('seoKeywords', e.target.value)} placeholder="red roses, anniversary flowers" /></Field>
                <div className="rounded-xl border border-violet-100 bg-white p-3"><p className="truncate text-base font-medium text-blue-700">{form.seoTitle || form.title || 'Product title'}</p><p className="mt-0.5 truncate text-xs text-emerald-700">/{form.slug || slugify(form.title) || 'product-url'}</p><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{form.seoDescription || form.shortDescription || 'Your product description will appear here.'}</p></div>
              </div>
            </div>
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
                <div className="mt-3 max-w-xs"><Field label="Shipping class" hint="Normalized routing class used by fulfillment rules."><Input value={form.shippingClass} onChange={(e) => set('shippingClass', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'))} placeholder="standard" /></Field></div>
              </div>
            )}
            <div className="flex flex-wrap gap-5">
              {form.kind === 'physical' && <Checkbox label="Requires shipping" checked={form.requiresShipping} onChange={(e) => set('requiresShipping', e.target.checked)} />}
              {form.kind === 'physical' && <Checkbox label="Fragile" checked={form.fragile} onChange={(e) => set('fragile', e.target.checked)} />}
              {form.kind === 'physical' && <Checkbox label="Hazardous material" checked={form.hazardous} onChange={(e) => set('hazardous', e.target.checked)} />}
              <Checkbox label="Age restricted" checked={form.ageRestricted} onChange={(e) => set('ageRestricted', e.target.checked)} />
              <Checkbox label="Serial tracking required" checked={form.requiresSerialTracking} onChange={(e) => set('requiresSerialTracking', e.target.checked)} />
              <Checkbox label="Perishable" checked={form.isPerishable} onChange={(e) => set('isPerishable', e.target.checked)} />
              <Checkbox label="Requires cold chain" checked={form.requiresColdChain} onChange={(e) => set('requiresColdChain', e.target.checked)} />
            </div>
          </div>
        </div>

        </div>}

        {step === 'structure' && <div className="space-y-6 animate-in">
        <div>
          <SectionIntro eyebrow="Catalog intelligence" title="Attributes" description="Structured facts power search, filters, comparison, compliance and customer confidence. Category-required values cannot be skipped." icon={Settings2} />
          {requiredFields.length > 0 && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This category requires: <b>{requiredFields.map((f) => f.label || f.key).join(', ')}</b>.
                The server validates values, number ranges and dropdown options.
              </span>
            </p>
          )}
          {isEdit ? <Guidance title="Typed values use an atomic replacement endpoint" tone="blue">Save global master fields here, then use Replace attributes in the detail workspace. This prevents a general master patch from accidentally deleting typed EAV rows.</Guidance> : <RowsEditor kind="attribute" definitions={masterDefinitions} rows={form.attributes} onChange={(attributes) => set('attributes', attributes)} />}
        </div>

        <div>
          <SectionIntro title="Option dimensions" description="Define the vocabulary customers use to configure a product. Stable codes become part of canonical SKU identity." badge="Up to 6" icon={Boxes} />
          <p className="mb-2 text-xs text-slate-500">Define up to six reusable dimensions such as Color, Size, Material or Storage.</p>
          <RowsEditor kind="option" rows={form.options} onChange={(options) => set('options', options)} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
          <SectionIntro title="Unit & conversion policy" description="One canonical base unit keeps pricing, inventory, packs, checkout and tax documents mathematically consistent." icon={Settings2} />
          <p className="mb-3 text-xs text-slate-500">Define a canonical base unit and exact conversion factors. This governs variants, packs, bundles, pricing bases and quantity validation.</p>
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <Field label="Dimension"><Select value={form.unitDimension} onChange={(e) => set('unitDimension', e.target.value)}>{['count', 'mass', 'volume', 'length', 'area', 'time', 'digital', 'custom'].map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Base unit"><Input value={form.baseUnit} onChange={(e) => set('baseUnit', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'))} /></Field>
            <Field label="Precision"><Input type="number" min="0" max="6" value={form.unitPrecision} onChange={(e) => set('unitPrecision', e.target.value)} /></Field>
            <div className="pt-7"><Checkbox label="Allow fractional quantities" checked={form.allowFractional} onChange={(e) => set('allowFractional', e.target.checked)} /></div>
          </div>
          <RowsEditor kind="unit" rows={form.units} onChange={(units) => set('units', units)} />
        </div>

        <div>
          <SectionIntro title="Option dependencies" description="Express compatibility rules without creating impossible variants or dead-end storefront selections." icon={Settings2} />
          <p className="mb-2 text-xs text-slate-500">Model constraints such as “Storage 1 TB is available only when Color is Black”. Invalid SKU combinations are rejected server-side.</p>
          <RowsEditor kind="rule" rows={form.optionRules} onChange={(optionRules) => set('optionRules', optionRules)} />
        </div>

        </div>}

        {step === 'variants' && <div className="animate-in">
          <SectionIntro eyebrow="Sellable identity" title="Sellable variants" description="Each row is an exact, order-independent SKU combination with its own quantity basis and optional seller-facing code." icon={Boxes} />
          <p className="mb-2 text-xs text-slate-500">Build combinations with <code>color=Red, size=M</code>. Ordering never changes variant identity.</p>
          {isEdit ? <Guidance title="Protected sub-resource editing" tone="blue">Existing variants have listing and order references, so they are edited independently with their own optimistic version and lifecycle controls. Save global changes here, then open this master’s detail workspace to edit every variant identifier, measurement, sell quantity, specification and gallery.</Guidance> : <RowsEditor kind="variant" rows={form.variants} onChange={(variants) => set('variants', variants)} />}
        </div>}

        {step === 'media' && <div className="animate-in">
          <SectionIntro eyebrow="Customer experience" title="Media library" description="Use a primary image plus descriptive gallery, lifestyle, swatch, manual, video or 3D assets. Alt text keeps the catalog accessible." icon={Image} />
          <div className="mb-2 flex items-center justify-end">
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={uploadImage} />
            <Button type="button" variant="secondary" size="sm" icon={UploadCloud} loading={uploading} onClick={() => imageInputRef.current?.click()}>
              Upload from device
            </Button>
          </div>
          {isEdit ? <Guidance title="Audited media workspace" tone="blue">Existing media is managed from the master detail workspace, where each asset can be scoped to the master or a variant, ordered, promoted to primary, or retired without replacing unrelated gallery rows.</Guidance> : <RowsEditor kind="image" rows={form.images} onChange={(images) => set('images', images)} />}
        </div>}

        {step === 'review' && (
          <div className="animate-in space-y-5">
            <SectionIntro eyebrow="Preflight" title="Review catalog readiness" description="Confirm the canonical record now. Seller price, channels and stock are managed separately as tenant listings." icon={PackageCheck} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Identity</p>
                <ReviewItem label="Product" value={form.title} ready={Boolean(form.title)} />
                <ReviewItem label="Global SKU" value={form.skuGlobal} ready={Boolean(form.skuGlobal)} />
                <ReviewItem label="Kind / class" value={`${form.kind} · ${form.type}`} />
                <ReviewItem label="Category" value={(categories || []).find((c) => rid(c) === form.categoryId)?.name} ready={Boolean(form.categoryId)} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Structure</p>
                <ReviewItem label="Attributes" value={`${form.attributes.filter((item) => item.key && item.value).length} values`} />
                <ReviewItem label="Options / rules" value={`${form.options.length} dimensions · ${form.optionRules.length} rules`} />
                <ReviewItem label="Variants" value={`${form.variants.length} sellable combinations`} ready={!form.options.length || Boolean(form.variants.length)} />
                <ReviewItem label="Unit policy" value={`${form.baseUnit} · ${form.units.length} convertible units`} />
              </div>
            </div>
            <Guidance title="What happens after save" tone="emerald">The backend validates category schemas, option dependencies, canonical combinations, conversion factors and optimistic version. Then use Advanced structures for variant specifications, packs, bundle components and compliance evidence before activating store listings.</Guidance>
          </div>
        )}
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
    isbn: m.identifiers?.isbn || '',
    hsn: m.identifiers?.hsn || '',
    warrantyDuration: m.warranty?.duration ?? '',
    warrantyUnit: m.warranty?.unit || 'month',
    warrantyDescription: m.warranty?.description || '',
    seoTitle: m.seo?.title || '',
    seoDescription: m.seo?.description || '',
    seoKeywords: (m.seo?.keywords || []).join(', '),
    weightValue: m.fulfillmentProfile?.weight?.value ?? '',
    weightUnit: m.fulfillmentProfile?.weight?.unit || 'g',
    length: m.fulfillmentProfile?.dimensions?.length ?? '',
    width: m.fulfillmentProfile?.dimensions?.width ?? '',
    height: m.fulfillmentProfile?.dimensions?.height ?? '',
    dimensionUnit: m.fulfillmentProfile?.dimensions?.unit || 'cm',
    requiresShipping: m.fulfillmentProfile?.requiresShipping !== false,
    shippingClass: m.fulfillmentProfile?.shippingClass || 'standard',
    fragile: Boolean(m.fulfillmentProfile?.fragile),
    hazardous: Boolean(m.fulfillmentProfile?.hazardous),
    ageRestricted: Boolean(m.fulfillmentProfile?.ageRestricted),
    requiresSerialTracking: Boolean(m.fulfillmentProfile?.requiresSerialTracking),
    tags: (m.tags || []).join(', '),
    isPerishable: Boolean(m.isPerishable),
    requiresColdChain: Boolean(m.requiresColdChain),
    defaultSellingUnit: m.defaultSellingUnit || 'piece',
    minOrderQty: m.minOrderQty ?? 1,
    maxOrderQty: m.maxOrderQty ?? 100,
    attributes: (m.attributes || []).map((a) => ({ key: a.key, value: a.value, unit: a.unit || '' })),
    options: (m.options || []).map((o) => ({ code: o.code, name: o.name, values: (o.values || []).join(', '), displayType: o.displayType || 'text' })),
    optionRules: (m.optionRules || []).map((rule) => ({
      whenCode: rule.when?.code || '', whenValues: (rule.when?.values || []).join(', '),
      thenCode: rule.then?.code || '', allowedValues: (rule.then?.allowedValues || []).join(', '), excludedValues: (rule.then?.excludedValues || []).join(', '),
    })),
    unitDimension: m.unitPolicy?.dimension || 'count',
    baseUnit: m.unitPolicy?.baseUnit || m.defaultSellingUnit || 'piece',
    allowFractional: Boolean(m.unitPolicy?.allowFractional),
    unitPrecision: m.unitPolicy?.precision ?? 0,
    units: (m.unitPolicy?.units || [{ code: m.defaultSellingUnit || 'piece', label: SELLING_UNIT_LABEL[m.defaultSellingUnit] || 'Piece', toBaseFactor: 1, precision: 0 }]).map((unit) => ({ ...unit })),
    variants: (m.variants || []).map((v) => ({
      variantType: v.variantType || 'other', value: v.optionValues?.length ? '' : (v.value || ''),
      optionText: (v.optionValues || []).map((o) => `${o.code}=${o.value}`).join(', '),
      sellQuantityValue: v.sellQuantity?.value ?? 1, sellQuantityUnit: v.sellQuantity?.unitCode || m.unitPolicy?.baseUnit || m.defaultSellingUnit || 'piece',
      displayLabel: v.displayLabel || '', sku: v.sku || '', barcode: v.barcode || '',
      gtin: v.identifiers?.gtin || '', mpn: v.identifiers?.mpn || '',
      weightValue: v.weight?.value ?? '', weightUnit: v.weight?.unit || 'g',
      length: v.dimensions?.length ?? '', width: v.dimensions?.width ?? '', height: v.dimensions?.height ?? '', dimensionUnit: v.dimensions?.unit || 'cm',
      sortOrder: v.sortOrder ?? 0, imageUrls: v.imageSource === 'variant' ? (v.images || []).map((image) => image.url).join(', ') : '',
      isDefault: Boolean(v.isDefault),
    })),
    images: (m.images || []).map((image) => ({
      url: image.url, altText: image.altText || '', mediaType: image.mediaType || 'image', role: image.role || 'gallery', mimeType: image.mimeType || '',
      width: image.width ?? '', height: image.height ?? '', fileSize: image.fileSize ?? '', focalX: image.focalPoint?.x ?? 0.5, focalY: image.focalPoint?.y ?? 0.5,
      sortOrder: image.sortOrder ?? 0, isPrimary: Boolean(image.isPrimary),
    })),
  };
}
