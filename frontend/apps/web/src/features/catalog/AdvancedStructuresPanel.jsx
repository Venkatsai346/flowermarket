import { useEffect, useState } from 'react';
import { BadgeCheck, Boxes, FileCheck2, GitBranch, PackageOpen, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field.jsx';

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
    setBusy(key);
    try {
      await operation();
      toast.success('Universal product structure saved');
      await load();
      onChanged?.();
    } catch (error) { toast.error(errMsg(error)); } finally { setBusy(''); }
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
        <div className="space-y-2">{packages.map((row, index) => <div key={index} className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-2">
          <Input className="!w-28" placeholder="code" value={row.code || ''} onChange={(event) => setPackages(updateAt(packages, index, { code: event.target.value }))} />
          <Input className="!w-36" placeholder="label" value={row.label || ''} onChange={(event) => setPackages(updateAt(packages, index, { label: event.target.value }))} />
          <Select className="!w-24" value={row.level || 'each'} onChange={(event) => setPackages(updateAt(packages, index, { level: event.target.value }))}>{['each', 'inner', 'case', 'pallet', 'custom'].map((level) => <option key={level}>{level}</option>)}</Select>
          <Input className="!w-28" placeholder="contains code" value={row.containedPackageCode || ''} onChange={(event) => setPackages(updateAt(packages, index, { containedPackageCode: event.target.value }))} />
          <Input className="!w-24" type="number" min="0.000001" step="any" value={row.quantity ?? 1} onChange={(event) => setPackages(updateAt(packages, index, { quantity: event.target.value }))} />
          <Input className="!w-24" placeholder="unit" value={row.unitCode || ''} onChange={(event) => setPackages(updateAt(packages, index, { unitCode: event.target.value }))} />
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

      <Section icon={FileCheck2} title="Compliance entities" description="Jurisdiction-aware licenses, standards, restrictions and verifiable evidence" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setCompliance([...compliance, { type: 'certificate', code: '', title: '', authority: '', status: 'draft', validUntil: '', issuerReference: '', jurisdiction: { country: 'IN' }, documents: [] }])}>Add record</Button>}>
        <div className="space-y-2">{compliance.map((row, index) => <div key={index} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-7">
          <Select value={row.type || 'certificate'} onChange={(event) => setCompliance(updateAt(compliance, index, { type: event.target.value }))}>{['certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental'].map((type) => <option key={type}>{type}</option>)}</Select>
          <Input placeholder="Code" value={row.code || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { code: event.target.value }))} />
          <Input className="lg:col-span-2" placeholder="Title" value={row.title || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { title: event.target.value }))} />
          <Input placeholder="Authority" value={row.authority || ''} onChange={(event) => setCompliance(updateAt(compliance, index, { authority: event.target.value }))} />
          <Select value={row.status || 'draft'} onChange={(event) => setCompliance(updateAt(compliance, index, { status: event.target.value }))}>{['draft', 'pending', 'verified', 'expired', 'rejected'].map((status) => <option key={status}>{status}</option>)}</Select>
          <div className="flex gap-1"><Input type="date" value={row.validUntil ? String(row.validUntil).slice(0, 10) : ''} onChange={(event) => setCompliance(updateAt(compliance, index, { validUntil: event.target.value || null }))} /><button type="button" className="btn-ghost btn-sm" onClick={() => setCompliance(removeAt(compliance, index))}><Trash2 className="h-4 w-4" /></button></div>
        </div>)}</div>
        <div className="mt-3 flex justify-end"><Button loading={busy === 'compliance'} onClick={() => save('compliance', () => api.catalogAdmin.setCompliance(rid(master), { records: compliance.map((row) => ({ ...row, code: String(row.code).toUpperCase(), authority: row.authority || null, issuerReference: row.issuerReference || null, validUntil: row.validUntil || null })), expectedVersion: master.version }))}>Save compliance</Button></div>
      </Section>
    </div>
  );
}
