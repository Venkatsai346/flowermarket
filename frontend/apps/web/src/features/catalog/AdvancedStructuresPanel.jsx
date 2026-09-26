import { useEffect, useState } from 'react';
import { BadgeCheck, Boxes, FileCheck2, GitBranch, PackageOpen, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { Guidance, SubmissionError } from './CatalogFormUX.jsx';

const removeAt = (rows, index) => rows.filter((_, rowIndex) => rowIndex !== index);
const updateAt = (rows, index, patch) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);

function Section({ icon: Icon, title, description, children, action }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div><p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Icon className="h-4 w-4 text-rose-500" />{title}</p><p className="mt-0.5 text-xs text-slate-500">{description}</p></div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function AdvancedStructuresPanel({ master, onChanged }) {
  const [integrity, setIntegrity] = useState(null);
  const [packages, setPackages] = useState([]);
  const [components, setComponents] = useState([]);
  const [compliance, setCompliance] = useState([]);
  const [attributeDraft, setAttributeDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const availableMasters = useApi(() => api.catalogAdmin.masters({ status: 'active', limit: 100 }), []);

  const load = async () => {
    const [structureResponse, integrityResponse] = await Promise.all([
      api.catalogAdmin.masterStructures(rid(master)), api.catalogAdmin.masterIntegrity(rid(master)),
    ]);
    const data = structureResponse.data || {};
    setPackages(data.packages || []); setComponents(data.bundleComponents || []); setCompliance(data.compliance || []);
    setIntegrity(integrityResponse.data || null);
    const grouped = {};
    for (const attribute of data.variantAttributes || []) {
      const key = String(attribute.productVariantId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ key: attribute.attributeKey, value: attribute.value, unit: attribute.unit || '' });
    }
    setAttributeDraft(grouped);
  };

  useEffect(() => { load().catch((error) => toast.error(errMsg(error))); }, [master.id, master.version]);

  const save = async (key, operation) => {
    setBusy(key); setError('');
    try {
      await operation();
      toast.success('Universal product structure saved');
      await load();
      onChanged?.();
    } catch (saveError) { const message = errMsg(saveError); setError(message); toast.error(message); } finally { setBusy(''); }
  };

  const variantDefinitions = (master.category?.attributeSchema || []).filter((field) => ['variant', 'both'].includes(field.appliesTo || 'master'));
  const coerceAttribute = (field, value) => {
    if (field?.type === 'number') return value === '' ? '' : Number(value);
    if (field?.type === 'boolean') return value === true || value === 'true';
    if (field?.type === 'multi_select') return Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (field?.type === 'json') { try { return JSON.parse(value); } catch { return value; } }
    return value;
  };
  const saveVariantAttributes = (variant) => {
    const attributes = (attributeDraft[String(rid(variant))] || [])
      .filter((attribute) => attribute.key && attribute.value !== '')
      .map((attribute) => {
        const definition = variantDefinitions.find((field) => field.key === attribute.key);
        return { key: attribute.key, value: coerceAttribute(definition, attribute.value), unit: attribute.unit || definition?.unit || null };
      });
    return save(`variant-${rid(variant)}`, () => api.catalogAdmin.setVariantAttributes(rid(master), rid(variant), { attributes, expectedVersion: master.version }));
  };
  const updateVariantAttribute = (variantId, index, patch) => setAttributeDraft((current) => ({
    ...current, [variantId]: updateAt(current[variantId] || [], index, patch),
  }));
  const addVariantAttribute = (variantId) => setAttributeDraft((current) => ({
    ...current, [variantId]: [...(current[variantId] || []), { key: '', value: '', unit: '' }],
  }));
  const removeVariantAttribute = (variantId, index) => setAttributeDraft((current) => ({
    ...current, [variantId]: removeAt(current[variantId] || [], index),
  }));

  return (
    <div className="space-y-4">
      <SubmissionError message={error} />
      <Guidance title="Graph-safe editing" tone="blue">Every save replaces one bounded structure under an optimistic version claim. References, duplicate identities, package/bundle cycles, category schemas and compliance evidence are validated by the backend before old rows are replaced.</Guidance>
      <Section icon={integrity?.ok ? BadgeCheck : ShieldAlert} title="Structural integrity" description="Live graph validation across SKUs, packs, bundles, compliance and unit policy" action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => load()} loading={busy === 'integrity'}>Recheck</Button>}>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-900 text-xl font-bold text-white">{integrity?.score ?? '—'}</div>
          <div className="flex-1"><div className="flex flex-wrap gap-2"><Badge tone={integrity?.ok ? 'emerald' : 'rose'}>{integrity?.ok ? 'Integrity passed' : 'Action required'}</Badge>{Object.entries(integrity?.counts || {}).map(([key, value]) => <Badge key={key} tone="slate">{key}: {value}</Badge>)}</div>
          {(integrity?.issues || []).map((issue) => <p key={issue.code} className="mt-2 text-xs text-slate-600"><span className={issue.severity === 'error' ? 'font-semibold text-rose-600' : 'font-semibold text-amber-600'}>{issue.code}</span> · {issue.message}</p>)}</div>
        </div>
      </Section>

      <Section icon={GitBranch} title="Variant specifications (EAV)" description="Typed category-defined facts that differ between exact SKUs">
        {!variantDefinitions.length && <Guidance title="Define the schema first" tone="amber">This category has no fields scoped to Variant or Both. Add them in Categories → Attribute schema so values remain typed, filterable and reusable instead of becoming ad-hoc text.</Guidance>}
        <div className="space-y-3">{(master.variants || []).map((variant) => {
          const variantId = String(rid(variant));
          const rows = attributeDraft[variantId] || [];
          return <div key={variantId} className="rounded-2xl border border-slate-200 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">{variant.displayLabel || variant.value}</p><p className="font-mono text-[11px] text-slate-400">{variant.combinationKey}</p></div><Button type="button" size="sm" variant="ghost" icon={Plus} onClick={() => addVariantAttribute(variantId)}>Add specification</Button></div>
            <div className="space-y-2">{rows.map((attribute, index) => {
              const definition = variantDefinitions.find((field) => field.key === attribute.key);
              const type = definition?.type || 'string';
              return <div key={`${attribute.key}-${index}`} className="grid gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-[12rem_1fr_7rem_auto] sm:items-end">
                <Field label="Specification" required><Select value={attribute.key} onChange={(event) => updateVariantAttribute(variantId, index, { key: event.target.value, value: '', unit: variantDefinitions.find((field) => field.key === event.target.value)?.unit || '' })}><option value="">Select field…</option>{variantDefinitions.map((field) => <option key={field.key} value={field.key}>{field.label || field.key}{field.required ? ' *' : ''}</option>)}</Select></Field>
                <Field label={`Value · ${type}`} hint={definition?.options?.length ? `Allowed: ${definition.options.join(', ')}` : undefined}>
                  {type === 'boolean' ? <Select value={String(attribute.value)} onChange={(event) => updateVariantAttribute(variantId, index, { value: event.target.value === 'true' })}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></Select>
                    : type === 'select' ? <Select value={attribute.value || ''} onChange={(event) => updateVariantAttribute(variantId, index, { value: event.target.value })}><option value="">Select…</option>{(definition?.options || []).map((option) => <option key={option}>{option}</option>)}</Select>
                      : <Input type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'} step={type === 'number' ? 'any' : undefined} value={Array.isArray(attribute.value) ? attribute.value.join(', ') : typeof attribute.value === 'object' && attribute.value !== null ? JSON.stringify(attribute.value) : attribute.value ?? ''} onChange={(event) => updateVariantAttribute(variantId, index, { value: event.target.value })} placeholder={type === 'multi_select' ? 'Comma-separated values' : type === 'json' ? '{"key":"value"}' : 'Value'} />}
                </Field>
                <Field label="Unit"><Input value={attribute.unit || definition?.unit || ''} onChange={(event) => updateVariantAttribute(variantId, index, { unit: event.target.value })} /></Field>
                <button type="button" className="btn-ghost btn-sm mb-0.5" onClick={() => removeVariantAttribute(variantId, index)} aria-label="Remove specification"><Trash2 className="h-4 w-4" /></button>
              </div>;
            })}</div>
            {!rows.length && <p className="rounded-xl bg-slate-50 py-4 text-center text-xs text-slate-400">No SKU-specific specifications yet.</p>}
            <div className="mt-3 flex justify-end"><Button size="sm" loading={busy === `variant-${variantId}`} onClick={() => saveVariantAttributes(variant)}>Save specifications</Button></div>
          </div>;
        })}</div>
      </Section>

      <Section icon={PackageOpen} title="Pack hierarchy" description="Variant-aware each → inner → case → pallet graph with logistics measurements and identifiers" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setPackages([...packages, { code: '', label: '', level: 'each', variantId: '', containedPackageCode: '', quantity: 1, unitCode: master.unitPolicy?.baseUnit || master.defaultSellingUnit || 'piece', identifiers: {}, weight: { value: null, unit: 'g' }, dimensions: { length: null, width: null, height: null, unit: 'cm' }, status: 'active' }])}>Add level</Button>}>
        <div className="space-y-3">{packages.map((row, index) => <div key={row._id || index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 transition hover:border-slate-300">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Stable code" required><Input placeholder="case_12" value={row.code || ''} onChange={(event) => setPackages(updateAt(packages, index, { code: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') }))} /></Field>
            <Field label="Customer label" required><Input placeholder="Case of 12" value={row.label || ''} onChange={(event) => setPackages(updateAt(packages, index, { label: event.target.value }))} /></Field>
            <Field label="Level"><Select value={row.level || 'each'} onChange={(event) => setPackages(updateAt(packages, index, { level: event.target.value }))}>{['each', 'inner', 'case', 'pallet', 'custom'].map((level) => <option key={level}>{level}</option>)}</Select></Field>
            <Field label="Variant scope" hint="Blank applies to all variants."><Select value={row.variantId || ''} onChange={(event) => setPackages(updateAt(packages, index, { variantId: event.target.value || null }))}><option value="">All variants</option>{(master.variants || []).map((variant) => <option key={rid(variant)} value={rid(variant)}>{variant.displayLabel || variant.value}</option>)}</Select></Field>
            <Field label="Contains package" hint="Code of the immediate child pack."><Select value={row.containedPackageCode || ''} onChange={(event) => setPackages(updateAt(packages, index, { containedPackageCode: event.target.value || null }))}><option value="">None / base units</option>{packages.filter((_, childIndex) => childIndex !== index).map((pack) => pack.code && <option key={pack.code} value={pack.code}>{pack.label || pack.code}</option>)}</Select></Field>
            <Field label="Quantity" required><Input type="number" min="0.000001" step="any" value={row.quantity ?? 1} onChange={(event) => setPackages(updateAt(packages, index, { quantity: event.target.value }))} /></Field>
            <Field label="Quantity unit"><Select value={row.unitCode || master.unitPolicy?.baseUnit || ''} onChange={(event) => setPackages(updateAt(packages, index, { unitCode: event.target.value }))}>{(master.unitPolicy?.units || [{ code: master.defaultSellingUnit || 'piece', label: master.defaultSellingUnit || 'piece' }]).map((unit) => <option key={unit.code} value={unit.code}>{unit.label || unit.code}</option>)}</Select></Field>
            <Field label="Status"><Select value={row.status || 'active'} onChange={(event) => setPackages(updateAt(packages, index, { status: event.target.value }))}>{['active', 'inactive', 'archived'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
            <Field label="Package SKU"><Input value={row.identifiers?.sku || ''} onChange={(event) => setPackages(updateAt(packages, index, { identifiers: { ...row.identifiers, sku: event.target.value || null } }))} /></Field>
            <Field label="Barcode"><Input value={row.identifiers?.barcode || ''} onChange={(event) => setPackages(updateAt(packages, index, { identifiers: { ...row.identifiers, barcode: event.target.value || null } }))} /></Field>
            <Field label="GTIN"><Input value={row.identifiers?.gtin || ''} onChange={(event) => setPackages(updateAt(packages, index, { identifiers: { ...row.identifiers, gtin: event.target.value || null } }))} /></Field>
            <Field label="Shipping weight"><div className="flex gap-2"><Input type="number" min="0" step="any" value={row.weight?.value ?? ''} onChange={(event) => setPackages(updateAt(packages, index, { weight: { ...row.weight, value: event.target.value === '' ? null : Number(event.target.value) } }))} /><Select className="!w-24" value={row.weight?.unit || 'g'} onChange={(event) => setPackages(updateAt(packages, index, { weight: { ...row.weight, unit: event.target.value } }))}>{['mg', 'g', 'kg', 'oz', 'lb'].map((unit) => <option key={unit}>{unit}</option>)}</Select></div></Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5"><Field label="Length"><Input type="number" min="0" step="any" value={row.dimensions?.length ?? ''} onChange={(event) => setPackages(updateAt(packages, index, { dimensions: { ...row.dimensions, length: event.target.value === '' ? null : Number(event.target.value) } }))} /></Field><Field label="Width"><Input type="number" min="0" step="any" value={row.dimensions?.width ?? ''} onChange={(event) => setPackages(updateAt(packages, index, { dimensions: { ...row.dimensions, width: event.target.value === '' ? null : Number(event.target.value) } }))} /></Field><Field label="Height"><Input type="number" min="0" step="any" value={row.dimensions?.height ?? ''} onChange={(event) => setPackages(updateAt(packages, index, { dimensions: { ...row.dimensions, height: event.target.value === '' ? null : Number(event.target.value) } }))} /></Field><Field label="Dimension unit"><Select value={row.dimensions?.unit || 'cm'} onChange={(event) => setPackages(updateAt(packages, index, { dimensions: { ...row.dimensions, unit: event.target.value } }))}>{['mm', 'cm', 'm', 'in', 'ft'].map((unit) => <option key={unit}>{unit}</option>)}</Select></Field><div className="flex items-end justify-end"><Button type="button" size="sm" variant="ghost" icon={Trash2} onClick={() => setPackages(removeAt(packages, index))}>Remove</Button></div></div>
        </div>)}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'packages'} onClick={() => save('packages', () => api.catalogAdmin.setPackages(rid(master), { packages: packages.map((row, index) => ({ ...row, variantId: row.variantId || null, quantity: Number(row.quantity), sortOrder: index, containedPackageCode: row.containedPackageCode || null })), expectedVersion: master.version }))}>Save hierarchy</Button></div>
      </Section>

      {master.kind === 'bundle' && <Section icon={Boxes} title="Bundle components" description="Cycle-safe component graph with fixed or customer-selectable groups" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setComponents([...components, { componentMasterId: '', componentVariantId: '', quantity: 1, unitCode: 'piece', selectionGroup: 'included', required: true, defaultSelected: true, minSelections: 1, maxSelections: 1, priceAdjustment: 0, status: 'active' }])}>Add component</Button>}>
        <div className="space-y-3">{components.map((row, index) => <div key={row._id || index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field className="lg:col-span-2" label="Component product" required hint="Self-reference and recursive bundle cycles are rejected."><Select value={row.componentMasterId || ''} onChange={(event) => setComponents(updateAt(components, index, { componentMasterId: event.target.value, componentVariantId: '' }))}><option value="">Select active master…</option>{(availableMasters.data || []).filter((item) => rid(item) !== rid(master)).map((item) => <option key={rid(item)} value={rid(item)}>{item.title} · {item.skuGlobal}</option>)}</Select></Field>
            <Field label="Component variant ID" hint="Optional exact SKU; must belong to the selected product."><Input className="font-mono" value={row.componentVariantId || ''} onChange={(event) => setComponents(updateAt(components, index, { componentVariantId: event.target.value }))} /></Field>
            <Field label="Selection group" hint="Stable normalized group code."><Input value={row.selectionGroup || ''} onChange={(event) => setComponents(updateAt(components, index, { selectionGroup: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') }))} /></Field>
            <Field label="Quantity"><Input type="number" min="0.000001" step="any" value={row.quantity ?? 1} onChange={(event) => setComponents(updateAt(components, index, { quantity: event.target.value }))} /></Field>
            <Field label="Unit code"><Input value={row.unitCode || ''} onChange={(event) => setComponents(updateAt(components, index, { unitCode: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') }))} /></Field>
            <Field label="Minimum selections"><Input type="number" min="0" step="1" value={row.minSelections ?? 1} onChange={(event) => setComponents(updateAt(components, index, { minSelections: event.target.value }))} /></Field>
            <Field label="Maximum selections"><Input type="number" min="1" step="1" value={row.maxSelections ?? 1} onChange={(event) => setComponents(updateAt(components, index, { maxSelections: event.target.value }))} /></Field>
            <Field label="Price adjustment (₹)" hint="Positive surcharge or negative discount."><Input type="number" step="0.01" value={row.priceAdjustment ?? 0} onChange={(event) => setComponents(updateAt(components, index, { priceAdjustment: event.target.value }))} /></Field>
            <Field label="Status"><Select value={row.status || 'active'} onChange={(event) => setComponents(updateAt(components, index, { status: event.target.value }))}>{['active', 'inactive', 'archived'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
            <div className="flex flex-wrap items-end gap-4 pb-2"><Checkbox label="Required" checked={row.required !== false} onChange={(event) => setComponents(updateAt(components, index, { required: event.target.checked }))} /><Checkbox label="Selected by default" checked={row.defaultSelected !== false} onChange={(event) => setComponents(updateAt(components, index, { defaultSelected: event.target.checked }))} /></div>
            <div className="flex items-end justify-end"><Button type="button" size="sm" variant="ghost" icon={Trash2} onClick={() => setComponents(removeAt(components, index))}>Remove</Button></div>
          </div>
        </div>)}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'bundle'} onClick={() => save('bundle', () => api.catalogAdmin.setBundleComponents(rid(master), { components: components.map((row, index) => ({ ...row, componentVariantId: row.componentVariantId || null, quantity: Number(row.quantity), minSelections: Number(row.minSelections ?? 1), maxSelections: Number(row.maxSelections ?? 1), priceAdjustment: Number(row.priceAdjustment || 0), sortOrder: index })), expectedVersion: master.version }))}>Save composition</Button></div>
      </Section>}

      <Section icon={FileCheck2} title="Compliance entities" description="Jurisdiction-aware licenses, standards, restrictions and verifiable evidence" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setCompliance([...compliance, { variantId: '', type: 'certificate', code: '', title: '', authority: '', status: 'draft', validFrom: '', validUntil: '', issuerReference: '', jurisdiction: { country: 'IN', state: '', regions: [] }, documents: [], restrictionsText: '', metadataText: '' }])}>Add record</Button>}>
        <div className="space-y-3">{compliance.map((row, index) => {
          const evidence = row.documents?.[0] || {};
          const patchEvidence = (patch) => setCompliance(updateAt(compliance, index, { documents: [{ ...evidence, ...patch }] }));
          return <div key={row._id || index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Record type" required hint="The governance class used by category requirements."><Select value={row.type || 'certificate'} onChange={(event) => setCompliance(updateAt(compliance, index, { type: event.target.value }))}>{['certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental'].map((type) => <option key={type}>{type.replace('_', ' ')}</option>)}</Select></Field>
              <Field label="Variant scope" hint="Blank applies to the whole product."><Select value={row.variantId || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { variantId: event.target.value || null }))}><option value="">Whole product</option>{(master.variants || []).map((variant) => <option key={rid(variant)} value={rid(variant)}>{variant.displayLabel || variant.value}</option>)}</Select></Field>
              <Field label="Code" required hint="Stable authority or certificate identifier."><Input placeholder="FSSAI-…" value={row.code || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { code: event.target.value.toUpperCase() }))} /></Field>
              <Field className="lg:col-span-2" label="Customer-facing title" required><Input placeholder="Food safety registration" value={row.title || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { title: event.target.value }))} /></Field>
              <Field label="Issuing authority"><Input placeholder="FSSAI, BIS, ISO…" value={row.authority || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { authority: event.target.value }))} /></Field>
              <Field label="Verification status" hint="Verified requires evidence below."><Select value={row.status || 'draft'} onChange={(event) => setCompliance(updateAt(compliance, index, { status: event.target.value }))}>{['draft', 'pending', 'verified', 'expired', 'rejected'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
              <Field label="Valid from"><Input type="date" value={row.validFrom ? String(row.validFrom).slice(0, 10) : ''} onChange={(event) => setCompliance(updateAt(compliance, index, { validFrom: event.target.value || null }))} /></Field>
              <Field label="Valid until"><Input type="date" value={row.validUntil ? String(row.validUntil).slice(0, 10) : ''} onChange={(event) => setCompliance(updateAt(compliance, index, { validUntil: event.target.value || null }))} /></Field>
              <Field label="Country" hint="ISO two-letter code."><Input maxLength={2} value={row.jurisdiction?.country || 'IN'} onChange={(event) => setCompliance(updateAt(compliance, index, { jurisdiction: { ...row.jurisdiction, country: event.target.value.toUpperCase() } }))} /></Field>
              <Field label="State / region"><Input value={row.jurisdiction?.state || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { jurisdiction: { ...row.jurisdiction, state: event.target.value || null } }))} /></Field>
              <Field className="lg:col-span-2" label="Additional regions" hint="Comma-separated jurisdiction labels."><Input value={(row.jurisdiction?.regions || []).join(', ')} onChange={(event) => setCompliance(updateAt(compliance, index, { jurisdiction: { ...row.jurisdiction, regions: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } }))} /></Field>
              <Field className="lg:col-span-2" label="Issuer reference" hint="A verifiable registry reference can serve as evidence."><Input placeholder="Registry URL or reference number" value={row.issuerReference || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { issuerReference: event.target.value }))} /></Field>
              <Field label="Evidence name" hint="Required with an evidence URL."><Input placeholder="Certificate PDF" value={evidence.name || ''} onChange={(event) => patchEvidence({ name: event.target.value })} /></Field>
              <Field className="lg:col-span-3" label="Evidence URL" hint="Public or authorized document URL; never shown directly on storefront."><Input type="url" placeholder="https://…" value={evidence.url || ''} onChange={(event) => patchEvidence({ url: event.target.value })} /></Field>
              <Field label="Evidence MIME type"><Input placeholder="application/pdf" value={evidence.mimeType || ''} onChange={(event) => patchEvidence({ mimeType: event.target.value })} /></Field>
              <Field className="lg:col-span-3" label="Evidence checksum" hint="Optional SHA-256 or authority-provided digest."><Input className="font-mono" value={evidence.checksum || ''} onChange={(event) => patchEvidence({ checksum: event.target.value })} /></Field>
              <Field className="lg:col-span-2" label="Restrictions" hint="Comma-separated customer or fulfillment restrictions."><Textarea value={row.restrictionsText ?? (row.restrictions || []).join(', ')} onChange={(event) => setCompliance(updateAt(compliance, index, { restrictionsText: event.target.value }))} /></Field>
              <Field className="lg:col-span-2" label="Metadata JSON" hint="Optional structured authority metadata."><Textarea className="font-mono" value={row.metadataText ?? (row.metadata && Object.keys(row.metadata).length ? JSON.stringify(row.metadata) : '')} onChange={(event) => setCompliance(updateAt(compliance, index, { metadataText: event.target.value }))} /></Field>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><p className="text-[11px] text-slate-400">Only verified and unexpired public-safe fields are disclosed to customers.</p><Button type="button" size="sm" variant="ghost" icon={Trash2} onClick={() => setCompliance(removeAt(compliance, index))}>Remove</Button></div>
          </div>;
        })}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'compliance'} onClick={() => save('compliance', () => api.catalogAdmin.setCompliance(rid(master), { records: compliance.map((row) => {
          const fields = { ...row };
          ['restrictionsText', 'metadataText', '_id', 'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'isDeleted', 'deletedAt', '__v'].forEach((key) => delete fields[key]);
          let metadata = row.metadata || {};
          if (row.metadataText) { try { metadata = JSON.parse(row.metadataText); } catch { throw new Error(`Compliance record ${row.code || 'metadata'} contains invalid JSON`); } }
          return { ...fields, variantId: row.variantId || null, code: String(row.code).toUpperCase(), authority: row.authority || null, issuerReference: row.issuerReference || null, validFrom: row.validFrom || null, validUntil: row.validUntil || null, restrictions: String(row.restrictionsText ?? (row.restrictions || []).join(',')).split(',').map((value) => value.trim()).filter(Boolean), metadata, documents: (row.documents || []).filter((document) => document.name && document.url).map(({ name, url, mimeType, checksum }) => ({ name, url, mimeType: mimeType || null, checksum: checksum || null })) };
        }), expectedVersion: master.version }))}>Save compliance</Button></div>
      </Section>
    </div>
  );
}
