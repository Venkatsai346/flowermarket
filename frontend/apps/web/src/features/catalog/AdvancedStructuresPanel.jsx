import { useEffect, useState } from 'react';
import { BadgeCheck, Boxes, FileCheck2, GitBranch, PackageOpen, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field.jsx';
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
  const [structures, setStructures] = useState({ packages: [], bundleComponents: [], compliance: [], variantAttributes: [] });
  const [integrity, setIntegrity] = useState(null);
  const [packages, setPackages] = useState([]);
  const [components, setComponents] = useState([]);
  const [compliance, setCompliance] = useState([]);
  const [attributeDraft, setAttributeDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const [structureResponse, integrityResponse] = await Promise.all([
      api.catalogAdmin.masterStructures(rid(master)), api.catalogAdmin.masterIntegrity(rid(master)),
    ]);
    const data = structureResponse.data || {};
    setStructures(data); setPackages(data.packages || []); setComponents(data.bundleComponents || []); setCompliance(data.compliance || []);
    setIntegrity(integrityResponse.data || null);
    const grouped = {};
    for (const attribute of data.variantAttributes || []) {
      const key = String(attribute.productVariantId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(`${attribute.attributeKey}=${Array.isArray(attribute.value) ? attribute.value.join('|') : String(attribute.value)}`);
    }
    setAttributeDraft(Object.fromEntries(Object.entries(grouped).map(([key, values]) => [key, values.join(', ')])));
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

  const saveVariantAttributes = (variant) => {
    const text = attributeDraft[String(rid(variant))] || '';
    const attributes = text.split(',').map((part) => {
      const [key, ...value] = part.split('=');
      return key.trim() && value.join('=').trim() ? { key: key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'), value: value.join('=').trim() } : null;
    }).filter(Boolean);
    return save(`variant-${rid(variant)}`, () => api.catalogAdmin.setVariantAttributes(rid(master), rid(variant), { attributes, expectedVersion: master.version }));
  };

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

      <Section icon={GitBranch} title="Variant EAV" description="Typed category specifications that differ by concrete SKU">
        <div className="space-y-3">{(master.variants || []).map((variant) => (
          <div key={rid(variant)} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <div><p className="text-sm font-semibold text-slate-800">{variant.displayLabel || variant.value}</p><p className="font-mono text-[11px] text-slate-400">{variant.combinationKey}</p></div>
            <Field label="Attributes" hint="key=value, comma separated"><Input value={attributeDraft[String(rid(variant))] || ''} onChange={(event) => setAttributeDraft((value) => ({ ...value, [String(rid(variant))]: event.target.value }))} placeholder="screen_size=6.7, waterproof=true" /></Field>
            <Button size="sm" loading={busy === `variant-${rid(variant)}`} onClick={() => saveVariantAttributes(variant)}>Save</Button>
          </div>
        ))}</div>
      </Section>

      <Section icon={PackageOpen} title="Pack hierarchy" description="Each → inner → case → pallet hierarchy with unit-safe quantities and independent identifiers" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setPackages([...packages, { code: '', label: '', level: 'each', containedPackageCode: '', quantity: 1, unitCode: master.unitPolicy?.baseUnit || master.defaultSellingUnit || 'piece' }])}>Add level</Button>}>
        <div className="mb-2 hidden grid-cols-[7rem_9rem_6rem_7rem_6rem_6rem_auto] gap-2 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 lg:grid"><span>Stable code</span><span>Customer label</span><span>Level</span><span>Contains pack</span><span>Quantity</span><span>Unit</span><span /></div>
        <div className="space-y-2">{packages.map((row, index) => <div key={row._id || index} className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-2 transition hover:bg-slate-100/80">
          <Input className="!w-28" placeholder="code" value={row.code || ''} onChange={(event) => setPackages(updateAt(packages, index, { code: event.target.value }))} />
          <Input className="!w-36" placeholder="label" value={row.label || ''} onChange={(event) => setPackages(updateAt(packages, index, { label: event.target.value }))} />
          <Select className="!w-24" value={row.level || 'each'} onChange={(event) => setPackages(updateAt(packages, index, { level: event.target.value }))}>{['each', 'inner', 'case', 'pallet', 'custom'].map((level) => <option key={level}>{level}</option>)}</Select>
          <Input className="!w-28" placeholder="contains code" value={row.containedPackageCode || ''} onChange={(event) => setPackages(updateAt(packages, index, { containedPackageCode: event.target.value }))} />
          <Input className="!w-24" type="number" min="0.000001" step="any" value={row.quantity ?? 1} onChange={(event) => setPackages(updateAt(packages, index, { quantity: event.target.value }))} />
          <Select className="!w-28" value={row.unitCode || master.unitPolicy?.baseUnit || ''} onChange={(event) => setPackages(updateAt(packages, index, { unitCode: event.target.value }))}>{(master.unitPolicy?.units || [{ code: master.defaultSellingUnit || 'piece', label: master.defaultSellingUnit || 'piece' }]).map((unit) => <option key={unit.code} value={unit.code}>{unit.label || unit.code}</option>)}</Select>
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setPackages(removeAt(packages, index))}><Trash2 className="h-4 w-4" /></button>
        </div>)}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'packages'} onClick={() => save('packages', () => api.catalogAdmin.setPackages(rid(master), { packages: packages.map((row, index) => ({ ...row, quantity: Number(row.quantity), sortOrder: index, containedPackageCode: row.containedPackageCode || null })), expectedVersion: master.version }))}>Save hierarchy</Button></div>
      </Section>

      {master.kind === 'bundle' && <Section icon={Boxes} title="Bundle components" description="Cycle-safe component graph with fixed and selectable groups" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setComponents([...components, { componentMasterId: '', componentVariantId: '', quantity: 1, unitCode: 'piece', selectionGroup: 'included', required: true, defaultSelected: true, minSelections: 1, maxSelections: 1, priceAdjustment: 0 }])}>Add component</Button>}>
        <div className="space-y-2">{components.map((row, index) => <div key={index} className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2">
          <Input className="min-w-[210px] flex-1" placeholder="Component master ID" value={row.componentMasterId || ''} onChange={(event) => setComponents(updateAt(components, index, { componentMasterId: event.target.value }))} />
          <Input className="!w-36" placeholder="Variant ID optional" value={row.componentVariantId || ''} onChange={(event) => setComponents(updateAt(components, index, { componentVariantId: event.target.value }))} />
          <Input className="!w-20" type="number" min="0.000001" step="any" value={row.quantity ?? 1} onChange={(event) => setComponents(updateAt(components, index, { quantity: event.target.value }))} />
          <Input className="!w-24" placeholder="unit" value={row.unitCode || ''} onChange={(event) => setComponents(updateAt(components, index, { unitCode: event.target.value }))} />
          <Input className="!w-28" placeholder="group" value={row.selectionGroup || ''} onChange={(event) => setComponents(updateAt(components, index, { selectionGroup: event.target.value }))} />
          <Checkbox label="Required" checked={row.required !== false} onChange={(event) => setComponents(updateAt(components, index, { required: event.target.checked }))} />
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setComponents(removeAt(components, index))}><Trash2 className="h-4 w-4" /></button>
        </div>)}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'bundle'} onClick={() => save('bundle', () => api.catalogAdmin.setBundleComponents(rid(master), { components: components.map((row, index) => ({ ...row, componentVariantId: row.componentVariantId || null, quantity: Number(row.quantity), minSelections: Number(row.minSelections ?? 1), maxSelections: Number(row.maxSelections ?? 1), priceAdjustment: Number(row.priceAdjustment || 0), sortOrder: index })), expectedVersion: master.version }))}>Save composition</Button></div>
      </Section>}

      <Section icon={FileCheck2} title="Compliance entities" description="Jurisdiction-aware licenses, standards, restrictions and verifiable evidence" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setCompliance([...compliance, { type: 'certificate', code: '', title: '', authority: '', status: 'draft', validFrom: '', validUntil: '', issuerReference: '', jurisdiction: { country: 'IN', state: '' }, documents: [] }])}>Add record</Button>}>
        <div className="space-y-3">{compliance.map((row, index) => {
          const evidence = row.documents?.[0] || {};
          const patchEvidence = (patch) => setCompliance(updateAt(compliance, index, { documents: [{ ...evidence, ...patch }] }));
          return <div key={row._id || index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Record type" required hint="The governance class used by category requirements."><Select value={row.type || 'certificate'} onChange={(event) => setCompliance(updateAt(compliance, index, { type: event.target.value }))}>{['certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental'].map((type) => <option key={type}>{type.replace('_', ' ')}</option>)}</Select></Field>
              <Field label="Code" required hint="Stable authority or certificate identifier."><Input placeholder="FSSAI-…" value={row.code || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { code: event.target.value.toUpperCase() }))} /></Field>
              <Field className="lg:col-span-2" label="Customer-facing title" required><Input placeholder="Food safety registration" value={row.title || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { title: event.target.value }))} /></Field>
              <Field label="Issuing authority"><Input placeholder="FSSAI, BIS, ISO…" value={row.authority || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { authority: event.target.value }))} /></Field>
              <Field label="Verification status" hint="Verified requires evidence below."><Select value={row.status || 'draft'} onChange={(event) => setCompliance(updateAt(compliance, index, { status: event.target.value }))}>{['draft', 'pending', 'verified', 'expired', 'rejected'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
              <Field label="Valid from"><Input type="date" value={row.validFrom ? String(row.validFrom).slice(0, 10) : ''} onChange={(event) => setCompliance(updateAt(compliance, index, { validFrom: event.target.value || null }))} /></Field>
              <Field label="Valid until"><Input type="date" value={row.validUntil ? String(row.validUntil).slice(0, 10) : ''} onChange={(event) => setCompliance(updateAt(compliance, index, { validUntil: event.target.value || null }))} /></Field>
              <Field label="Country" hint="ISO two-letter code."><Input maxLength={2} value={row.jurisdiction?.country || 'IN'} onChange={(event) => setCompliance(updateAt(compliance, index, { jurisdiction: { ...row.jurisdiction, country: event.target.value.toUpperCase() } }))} /></Field>
              <Field label="State / region"><Input value={row.jurisdiction?.state || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { jurisdiction: { ...row.jurisdiction, state: event.target.value || null } }))} /></Field>
              <Field className="lg:col-span-2" label="Issuer reference" hint="A verifiable registry reference can serve as evidence."><Input placeholder="Registry URL or reference number" value={row.issuerReference || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { issuerReference: event.target.value }))} /></Field>
              <Field label="Evidence name" hint="Required with an evidence URL."><Input placeholder="Certificate PDF" value={evidence.name || ''} onChange={(event) => patchEvidence({ name: event.target.value })} /></Field>
              <Field className="lg:col-span-3" label="Evidence URL" hint="Public or authorized document URL; never shown directly on storefront."><Input type="url" placeholder="https://…" value={evidence.url || ''} onChange={(event) => patchEvidence({ url: event.target.value })} /></Field>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><p className="text-[11px] text-slate-400">Only verified and unexpired public-safe fields are disclosed to customers.</p><Button type="button" size="sm" variant="ghost" icon={Trash2} onClick={() => setCompliance(removeAt(compliance, index))}>Remove</Button></div>
          </div>;
        })}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'compliance'} onClick={() => save('compliance', () => api.catalogAdmin.setCompliance(rid(master), { records: compliance.map((row) => ({ ...row, code: String(row.code).toUpperCase(), authority: row.authority || null, issuerReference: row.issuerReference || null, validFrom: row.validFrom || null, validUntil: row.validUntil || null, documents: (row.documents || []).filter((document) => document.name && document.url) })), expectedVersion: master.version }))}>Save compliance</Button></div>
      </Section>
    </div>
  );
}
