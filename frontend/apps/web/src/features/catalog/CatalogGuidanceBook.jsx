import { useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Boxes, CheckCircle2, ChevronRight, ClipboardCheck,
  Copy, FileBadge, Layers3, ListChecks, Search, ShieldCheck, Sparkles, Store, Tag,
} from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { cn } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import {
  ATTRIBUTE_TYPE_GUIDE, CATEGORY_PLAYBOOKS, COMPLIANCE_NOTICE,
  LISTING_FIELD_GUIDE, MASTER_FIELD_GUIDE,
} from './catalogGuidance.js';

const VIEWS = [
  ['categories', 'Category playbooks', Layers3],
  ['master', 'Build a product master', Boxes],
  ['listing', 'List in your store', Store],
  ['quality', 'Pre-publish review', ClipboardCheck],
];

const TYPE_TONE = { string: 'slate', text: 'slate', number: 'blue', boolean: 'emerald', select: 'violet', multi_select: 'violet', date: 'amber', json: 'rose' };

function MiniStat({ value, label }) {
  return <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur"><p className="text-2xl font-bold text-white">{value}</p><p className="text-xs text-slate-300">{label}</p></div>;
}

function ChapterNav({ view, setView }) {
  return (
    <nav aria-label="Guidance chapters" className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      {VIEWS.map(([key, label, Icon]) => <button key={key} type="button" onClick={() => setView(key)} className={cn('flex min-w-max items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition', view === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}><Icon className="h-4 w-4" />{label}</button>)}
    </nav>
  );
}

function AttributeTable({ rows }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Schema field</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Controls</th><th className="px-4 py-3">Group</th></tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((field) => <tr key={field.key} className="align-top hover:bg-slate-50/60"><td className="px-4 py-3"><p className="font-semibold text-slate-800">{field.label}</p><code className="text-[11px] text-rose-600">{field.key}</code>{field.unit && <span className="ml-2 text-xs text-slate-400">unit: {field.unit}</span>}</td><td className="px-4 py-3"><Badge tone={TYPE_TONE[field.type] || 'slate'}>{field.type.replace('_', ' ')}</Badge></td><td className="px-4 py-3"><span className="font-medium text-slate-700">{field.appliesTo}</span><p className="mt-0.5 text-xs text-slate-400">{field.required ? 'Required' : 'Recommended / conditional'}</p></td><td className="max-w-xs px-4 py-3 text-xs leading-relaxed text-slate-600">{field.options?.length ? `Options: ${field.options.join(', ')}` : [field.min != null ? `min ${field.min}` : '', field.max != null ? `max ${field.max}` : '', field.regex ? `pattern ${field.regex}` : ''].filter(Boolean).join(' · ') || 'Free value within the selected type'}{(field.filterable || field.facetable || field.searchable) && <p className="mt-1 text-slate-400">{[field.filterable && 'filterable', field.facetable && 'facetable', field.searchable && 'searchable'].filter(Boolean).join(' · ')}</p>}</td><td className="px-4 py-3 text-xs font-medium text-slate-500">{field.group || 'General'}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryChapter() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [selectedId, setSelectedId] = useState('smartphones');
  const groups = useMemo(() => ['All', ...new Set(CATEGORY_PLAYBOOKS.map((item) => item.group))], []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORY_PLAYBOOKS.filter((item) => (group === 'All' || item.group === group) && (!q || `${item.name} ${item.group} ${item.aliases.join(' ')}`.toLowerCase().includes(q)));
  }, [query, group]);
  const selected = CATEGORY_PLAYBOOKS.find((item) => item.id === selectedId) || filtered[0] || CATEGORY_PLAYBOOKS[0];
  const copyTemplate = async () => {
    const payload = {
      name: selected.name,
      slug: selected.id,
      attributeSchema: selected.attributes,
      complianceRequirements: selected.compliance,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(`${selected.name} category template copied`);
    } catch {
      toast.error('Clipboard access is unavailable in this browser');
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
      <aside className="self-start rounded-2xl border border-slate-200 bg-white p-3 xl:sticky xl:top-4">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9!" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a category…" /></div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">{groups.map((item) => <button type="button" key={item} onClick={() => setGroup(item)} className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold', group === item ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{item}</button>)}</div>
        <div className="mt-3 max-h-[620px] space-y-1 overflow-y-auto pr-1">
          {filtered.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={cn('group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', selected?.id === item.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100')}><span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', selected?.id === item.id ? 'bg-white/10 text-rose-300' : 'bg-rose-50 text-rose-500')}><Tag className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.name}</span><span className={cn('block truncate text-[10px]', selected?.id === item.id ? 'text-slate-300' : 'text-slate-400')}>{item.group}</span></span><ChevronRight className="h-4 w-4 opacity-50" /></button>)}
          {!filtered.length && <p className="px-3 py-8 text-center text-xs text-slate-400">No playbook matches this search. Use the category design recipe below to create a precise schema.</p>}
        </div>
      </aside>

      <article className="min-w-0 space-y-5">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-rose-950 p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><Badge tone="rose">{selected.group}</Badge><h2 className="mt-3 text-2xl font-bold tracking-tight">{selected.name}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{selected.summary}</p></div><div className="flex flex-col items-end gap-2"><div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-widest text-slate-400">Product kind</p><p className="mt-1 font-semibold capitalize">{selected.kind}</p></div><button type="button" onClick={copyTemplate} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"><Copy className="h-3.5 w-3.5" />Copy category template</button></div></div>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Unit policy</p><p className="mt-2 text-sm leading-relaxed text-slate-700">{selected.unitPolicy}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Recommended variant axes</p><div className="mt-2 flex flex-wrap gap-1.5">{selected.variantAxes.map((axis) => <code key={axis} className="rounded-lg bg-white px-2 py-1 text-xs text-violet-700 ring-1 ring-slate-200">{axis}</code>)}</div></div>
          </div>
        </section>

        <section><div className="mb-3 flex items-end justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><ListChecks className="h-5 w-5 text-rose-500" />Recommended attribute schema</h3><p className="mt-1 text-xs text-slate-500">Create these on the leaf category. Adjust controlled options to your assortment without changing semantic keys.</p></div><Badge tone="slate">{selected.attributes.length} fields</Badge></div><AttributeTable rows={selected.attributes} /></section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h3 className="flex items-center gap-2 text-lg font-bold text-amber-950"><ShieldCheck className="h-5 w-5 text-amber-600" />Compliance requirements</h3><p className="mt-1 text-xs leading-relaxed text-amber-800/80">Configure requirements on the category, then attach authoritative records and evidence to each applicable master or variant.</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{selected.compliance.map((item) => <div key={item.code} className="rounded-xl border border-amber-200 bg-white p-3"><div className="flex flex-wrap items-center gap-2"><code className="text-xs font-bold text-amber-800">{item.code}</code><Badge tone={item.required === false ? 'slate' : 'amber'}>{item.required === false ? 'conditional' : 'required'}</Badge>{item.requiresExpiry && <Badge tone="rose">track expiry</Badge>}</div><p className="mt-2 text-sm leading-relaxed text-slate-700">{item.label}</p><p className="mt-1 text-[11px] text-slate-400">{item.type.replace('_', ' ')} · {item.jurisdictions.join(', ')}</p></div>)}</div></section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h3 className="flex items-center gap-2 font-bold text-emerald-950"><Sparkles className="h-4 w-4" />Worked example</h3><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs text-emerald-700">Title</dt><dd className="font-semibold text-emerald-950">{selected.example.title}</dd></div><div><dt className="text-xs text-emerald-700">Global SKU</dt><dd><code>{selected.example.sku}</code></dd></div><div><dt className="text-xs text-emerald-700">Variant</dt><dd>{selected.example.options}</dd></div><div><dt className="text-xs text-emerald-700">Tenant listing</dt><dd>{selected.example.listing}</dd></div></dl></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-900">Category design recipe</h3><ol className="mt-3 space-y-2 text-sm text-slate-600">{['Create broad parents only for navigation; attach detailed schemas to the most specific sellable leaf category.', 'Ask which facts customers compare, which facts change SKU/stock, and which facts affect safety, tax or fulfilment.', 'Make shared facts master attributes. Make customer-selectable, stock-bearing facts variant attributes/options.', 'Prefer controlled select values for facets. Use numbers plus units for range filters. Avoid duplicate synonyms.', 'Add only legally/operationally grounded compliance requirements and mark conditional records honestly.', 'Create one representative product and run search, filters, PDP, cart, fulfilment and return review before scaling.'].map((step, index) => <li key={step} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span><span className="leading-relaxed">{step}</span></li>)}</ol></div></section>
        {selected.notes?.length > 0 && <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><p className="font-semibold text-blue-900">Category-specific decisions</p><ul className="mt-2 space-y-1 text-sm text-blue-800">{selected.notes.map((note) => <li key={note}>• {note}</li>)}</ul></section>}
      </article>
    </div>
  );
}

function MasterChapter() {
  return <div className="space-y-5"><div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><h2 className="text-lg font-bold text-blue-950">Global truth, not a store offer</h2><p className="mt-2 max-w-4xl text-sm leading-relaxed text-blue-800">A product master is shared identity and factual structure. Price, stock, seller SKU, tenant merchandising and channels belong to listings. Nested resources use dedicated versioned editors so a global PATCH cannot silently replace them.</p></div><div className="grid gap-4 lg:grid-cols-2">{MASTER_FIELD_GUIDE.map((row, index) => <section key={row.section} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">{index + 1}</span><div><h3 className="font-bold text-slate-900">{row.section}</h3><p className="mt-0.5 text-xs font-medium text-rose-600">{row.fields}</p></div></div><p className="mt-3 text-sm leading-relaxed text-slate-600">{row.guidance}</p><p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600"><strong>Example:</strong> {row.example}</p></section>)}</div><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-900">Choosing an attribute type</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{ATTRIBUTE_TYPE_GUIDE.map(([type, use, example]) => <div key={type} className="rounded-xl bg-slate-50 p-3"><Badge tone={TYPE_TONE[type]}>{type.replace('_', ' ')}</Badge><p className="mt-2 text-xs font-medium text-slate-700">{use}</p><code className="mt-1 block text-[11px] text-slate-400">{example}</code></div>)}</div></section></div>;
}

function ListingChapter() {
  const sections = [...new Set(LISTING_FIELD_GUIDE.map((item) => item.section))];
  return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-bold uppercase text-violet-600">1 · Select truth</p><p className="mt-2 text-sm text-violet-900">Choose the approved master and exact variant you physically or contractually supply.</p></div><div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs font-bold uppercase text-rose-600">2 · Define offer</p><p className="mt-2 text-sm text-rose-900">Set quantity identity, price, stock, availability, order rules and tenant presentation.</p></div><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold uppercase text-emerald-600">3 · Publish safely</p><p className="mt-2 text-sm text-emerald-900">Start draft, verify margin and fulfilment, select channels, then activate.</p></div></div>{sections.map((section) => <section key={section}><h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{section}</h3><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="divide-y divide-slate-100">{LISTING_FIELD_GUIDE.filter((item) => item.section === section).map((item) => <div key={item.field} className="grid gap-2 p-4 md:grid-cols-[190px_110px_1fr_260px]"><p className="font-semibold text-slate-900">{item.field}</p><div><Badge tone={item.who === 'Required' ? 'rose' : item.who === 'Private' ? 'violet' : 'slate'}>{item.who}</Badge></div><p className="text-sm leading-relaxed text-slate-600">{item.usage}</p><p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"><strong>Example:</strong> {item.example}</p></div>)}</div></div></section>)}</div>;
}

const QA = [
  ['Identity', 'The master represents one coherent product/model; no tenant price, stock or promotion leaked into global data.'],
  ['Category', 'The most specific leaf category is selected and every required typed attribute is present.'],
  ['Variants', 'Every combination is valid and unique; each stock-bearing choice has its own variant and identifiers where applicable.'],
  ['Quantity', 'Unit policy, sell quantity, package hierarchy, listing price basis and stock all describe the same commercial quantity.'],
  ['Media', 'Primary and variant assets show the exact item, have useful alt text and no unsupported claims/watermarks.'],
  ['Compliance', 'Category requirements are satisfied for the correct master/variant scope; evidence, jurisdiction and expiry are current.'],
  ['Fulfilment', 'Packed weight/dimensions and fragile, hazardous, serial, age, perishable and cold-chain flags are accurate.'],
  ['Offer', 'MRP/selling/cost relationship, tax mode, sale dates, order limits and margin have been reviewed.'],
  ['Availability', 'Stock unit, backorder/preorder policy, lead time and availability dates can be operationally honoured.'],
  ['Channels', 'Only intended channels are enabled; title/description overrides remain factual and readiness gates pass.'],
  ['Customer view', 'Search card, filters, PDP, selected variant, cart line, invoice quantity and return record were checked end to end.'],
  ['Lifecycle', 'Work stays draft until review; edits respect optimistic conflicts; retirement is used instead of destructive history changes.'],
];

function QualityChapter() {
  const [checked, setChecked] = useState({});
  const count = Object.values(checked).filter(Boolean).length;
  return <div className="grid gap-5 lg:grid-cols-[1fr_330px]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-slate-900">Pre-publish review</h2><p className="mt-1 text-xs text-slate-500">Use this for one representative listing, then repeat whenever structure or regulated facts change.</p></div><Badge tone={count === QA.length ? 'emerald' : 'blue'}>{count}/{QA.length}</Badge></div><div className="mt-4 space-y-2">{QA.map(([title, text]) => <label key={title} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 transition', checked[title] ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50')}><input type="checkbox" checked={Boolean(checked[title])} onChange={(event) => setChecked({ ...checked, [title]: event.target.checked })} className="mt-1 accent-emerald-600" /><span><span className="block text-sm font-semibold text-slate-800">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{text}</span></span></label>)}</div></section><aside className="space-y-4"><div className="rounded-2xl bg-slate-900 p-5 text-white"><CheckCircle2 className="h-7 w-7 text-emerald-400" /><h3 className="mt-3 font-bold">Definition of ready</h3><p className="mt-2 text-sm leading-relaxed text-slate-300">A listing is ready only when identity, quantity, evidence, price, stock, fulfilment and customer presentation all agree. A technically valid payload can still be commercially wrong.</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${count / QA.length * 100}%` }} /></div></div><div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><AlertTriangle className="h-6 w-6 text-rose-600" /><h3 className="mt-2 font-bold text-rose-950">Stop publication when</h3><ul className="mt-2 space-y-2 text-xs leading-relaxed text-rose-800"><li>• Required evidence is absent, expired, mismatched or unverifiable.</li><li>• Variant identity does not match stocked packaging or barcode.</li><li>• Price basis and inventory unit disagree.</li><li>• Hazard, age, cold-chain or serial controls are uncertain.</li><li>• Claims exceed the approved label, certificate or warranty.</li></ul></div><Button variant="secondary" className="w-full" onClick={() => setChecked({})}>Reset checklist</Button></aside></div>;
}

export default function CatalogGuidanceBook() {
  const [view, setView] = useState('categories');
  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-rose-600/20 blur-3xl" /><div className="absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6"><div className="max-w-3xl"><div className="flex items-center gap-2 text-rose-300"><BookOpen className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[0.2em]">Catalog guidance book</span></div><h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">From category schema to a trustworthy offer.</h1><p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">A practical, field-by-field operating manual for platform catalog teams and tenant sellers—complete with category schemas, compliance starting points, worked examples and publication checks.</p></div><div className="grid grid-cols-3 gap-2"><MiniStat value={CATEGORY_PLAYBOOKS.length} label="category playbooks" /><MiniStat value={CATEGORY_PLAYBOOKS.reduce((sum, item) => sum + item.attributes.length, 0)} label="schema fields" /><MiniStat value={LISTING_FIELD_GUIDE.length} label="listing fields" /></div></div>
      </header>
      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><FileBadge className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><p className="text-xs leading-relaxed text-amber-900"><strong>Compliance guardrail:</strong> {COMPLIANCE_NOTICE}</p></div>
      <ChapterNav view={view} setView={setView} />
      {view === 'categories' && <CategoryChapter />}
      {view === 'master' && <MasterChapter />}
      {view === 'listing' && <ListingChapter />}
      {view === 'quality' && <QualityChapter />}
    </div>
  );
}
