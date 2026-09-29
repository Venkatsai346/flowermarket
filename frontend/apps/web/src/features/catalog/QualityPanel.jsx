import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Gauge, RefreshCw, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Modal from '../../components/ui/Modal.jsx';

const gradeTone = {
  A: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  B: 'bg-lime-100 text-lime-800 ring-lime-200',
  C: 'bg-amber-100 text-amber-800 ring-amber-200',
  D: 'bg-orange-100 text-orange-800 ring-orange-200',
  F: 'bg-rose-100 text-rose-800 ring-rose-200',
};
const severityTone = {
  blocker: 'border-rose-200 bg-rose-50 text-rose-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
};

function ScoreCard({ label, value, note, icon: Icon, tone = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700', violet: 'bg-violet-100 text-violet-700',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={cn('rounded-xl p-2', colors[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function Grade({ value }) {
  return <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ring-1', gradeTone[value] || gradeTone.F)}>{value}</span>;
}

function QualityDetail({ row, loading, onClose }) {
  return (
    <Modal open={Boolean(row) || loading} onClose={onClose} title={row?.snapshot?.title || 'Loading assessment…'} subtitle={row ? `${row.snapshot?.skuGlobal || 'No global SKU'} · evaluated ${new Date(row.evaluatedAt).toLocaleString()}` : undefined} size="lg">
      {loading && !row ? <div className="py-16 text-center text-sm text-slate-500">Opening quality evidence…</div> : row && (
        <div className="space-y-6">
          {row.isStale && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /><span>This assessment is over 24 hours old. Re-evaluate before making a launch decision.</span></div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-xs text-slate-400">Quality score</p><p className="mt-1 text-3xl font-black">{row.score}<span className="text-base text-slate-400">/100</span></p></div>
            <div className={cn('rounded-2xl p-4', row.publishable ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}><p className="text-xs opacity-70">Technical publishability</p><p className="mt-2 font-bold">{row.publishable ? 'Publishable' : 'Blocked'}</p></div>
            <div className={cn('rounded-2xl p-4', row.launchReady ? 'bg-violet-50 text-violet-900' : 'bg-slate-100 text-slate-800')}><p className="text-xs opacity-70">Launch standard</p><p className="mt-2 font-bold">{row.launchReady ? 'Launch ready' : 'Needs refinement'}</p></div>
          </div>

          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-900">Dimension evidence</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {row.dimensions?.map((dimension) => (
                <div key={dimension.code} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex justify-between text-xs"><span className="font-semibold text-slate-700">{dimension.label}</span><span className="text-slate-500">{dimension.score}/{dimension.maxScore}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', dimension.percent >= 80 ? 'bg-emerald-500' : dimension.percent >= 55 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${dimension.percent}%` }} /></div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">Remediation plan</h3><span className="text-xs text-slate-500">{row.issues?.length || 0} findings</span></div>
            {row.issues?.length ? <div className="space-y-3">{row.issues.map((item, index) => (
              <article key={`${item.code}-${index}`} className={cn('rounded-xl border p-4', severityTone[item.severity])}>
                <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider">{item.severity}</span><span className="rounded bg-white/60 px-2 py-0.5 text-[10px] font-semibold uppercase">{item.owner}</span><code className="text-[10px] opacity-60">{item.code}</code></div>
                <h4 className="mt-2 text-sm font-bold">{item.label}</h4><p className="mt-1 text-xs leading-5 opacity-90">{item.message}</p><p className="mt-2 text-xs font-semibold">Next: {item.action}</p>{item.field && <p className="mt-1 text-[10px] opacity-60">Field: {item.field}</p>}
              </article>
            ))}</div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-800">No quality findings. This family meets every evaluated rule.</div>}
          </section>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4"><Link to="/catalog/masters"><Button variant="secondary" size="sm" icon={ArrowRight}>Open product masters</Button></Link><Link to="/catalog/ops"><Button variant="ghost" size="sm">Open listing workspace</Button></Link></div>
        </div>
      )}
    </Modal>
  );
}

export default function QualityPanel() {
  const [filters, setFilters] = useState({ search: '', grade: '', readiness: '', issueCode: '', page: 1 });
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { data: summary, loading: summaryLoading, refetch: refetchSummary } = useApi(() => api.catalogTenant.qualitySummary(), []);
  const query = useMemo(() => ({
    page: filters.page, limit: 20,
    search: filters.search || undefined,
    grade: filters.grade || undefined,
    readiness: filters.readiness || undefined,
    issueCode: filters.issueCode || undefined,
  }), [filters]);
  const { data: rows, meta, loading, error, refetch } = useApi(() => api.catalogTenant.qualityAssessments(query), [query]);
  const { busy, run } = useAction();

  const evaluate = async () => {
    try {
      const response = await run(() => api.catalogTenant.evaluateQuality());
      toast.success(`Evaluated ${response.data?.evaluated || 0} product families`);
      await Promise.all([refetchSummary(), refetch()]);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const openDetail = async (masterId) => {
    setDetailLoading(true);
    try { const response = await api.catalogTenant.qualityAssessment(masterId); setSelected(response.data); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setDetailLoading(false); }
  };
  const s = summary || {};
  const lastRun = s.lastEvaluatedAt ? new Date(s.lastEvaluatedAt).toLocaleString() : 'Never evaluated';

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-200 sm:p-8">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-violet-200"><Sparkles className="h-3.5 w-3.5" />Catalog quality control plane</div><h2 className="max-w-2xl text-2xl font-black tracking-tight sm:text-3xl">Make every product family launch-worthy.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Explainable evidence across identity, taxonomy, variants, media, content, commerce and search freshness—without silently changing catalog data.</p><p className="mt-3 text-xs text-slate-400">Last complete evaluation: {lastRun}</p></div>
          <Button variant="primary" icon={RefreshCw} loading={busy} onClick={evaluate}>Run complete evaluation</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreCard label="Average score" value={summaryLoading ? '—' : `${s.averageScore || 0}%`} note={`${s.total || 0} assessed families`} icon={Gauge} tone="violet" />
        <ScoreCard label="Launch ready" value={summaryLoading ? '—' : s.launchReady || 0} note="score ≥85, no blockers" icon={CheckCircle2} tone="emerald" />
        <ScoreCard label="Publish blockers" value={summaryLoading ? '—' : s.blocked || 0} note="technical blockers to resolve" icon={ShieldAlert} tone="rose" />
        <ScoreCard label="Refresh due" value={summaryLoading ? '—' : s.stale || 0} note="older than 24 hours" icon={RefreshCw} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card title="Product family assessments" subtitle="Prioritized by blockers, then lowest score.">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Search title or global SKU" /></label>
            <select className="input sm:w-32" value={filters.grade} onChange={(e) => setFilters((f) => ({ ...f, grade: e.target.value, page: 1 }))}><option value="">All grades</option>{['A', 'B', 'C', 'D', 'F'].map((g) => <option key={g} value={g}>Grade {g}</option>)}</select>
            <select className="input sm:w-40" value={filters.readiness} onChange={(e) => setFilters((f) => ({ ...f, readiness: e.target.value, page: 1 }))}><option value="">All readiness</option><option value="ready">Launch ready</option><option value="blocked">Publish blocked</option></select>
          </div>
          {filters.issueCode && <div className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800"><span>Issue filter: <b>{filters.issueCode}</b></span><button type="button" className="ml-auto font-bold" onClick={() => setFilters((f) => ({ ...f, issueCode: '', page: 1 }))}>Clear</button></div>}
          {error ? <p className="py-10 text-center text-sm text-rose-600">{errMsg(error)}</p> : loading && !rows ? <p className="py-12 text-center text-sm text-slate-500">Loading assessments…</p> : !rows?.length ? <div className="py-14 text-center"><ClipboardCheck className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No assessments found</p><p className="mt-1 text-xs text-slate-500">Run an evaluation or change the filters.</p></div> : <div className="divide-y divide-slate-100">{rows.map((row) => (
            <button key={row.id || row._id} type="button" onClick={() => openDetail(row.productMasterId)} className="flex w-full items-center gap-3 py-4 text-left transition hover:bg-slate-50 sm:px-2">
              <Grade value={row.grade} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold text-slate-900">{row.snapshot?.title}</p>{row.isStale && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">stale</span>}</div><p className="mt-0.5 truncate text-xs text-slate-500">{row.snapshot?.categoryName || 'Uncategorised'} · {row.snapshot?.skuGlobal || 'No SKU'}</p></div><div className="hidden text-right sm:block"><p className="text-lg font-black text-slate-900">{row.score}</p><p className="text-[10px] uppercase text-slate-400">score</p></div><div className="w-24 text-right"><p className={cn('text-xs font-bold', row.blockerCount ? 'text-rose-700' : 'text-emerald-700')}>{row.blockerCount ? `${row.blockerCount} blocker${row.blockerCount === 1 ? '' : 's'}` : 'No blockers'}</p><p className="mt-1 text-[10px] text-slate-400">{row.warningCount} warnings</p></div><ArrowRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}</div>}
          {(meta?.totalPages || 0) > 1 && <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4"><Button size="sm" variant="ghost" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button><span className="text-xs text-slate-500">Page {meta.page} of {meta.totalPages}</span><Button size="sm" variant="ghost" disabled={!meta.hasMore} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button></div>}
        </Card>

        <Card title="Highest-impact gaps" subtitle="Frequent issues across families.">
          {s.topIssues?.length ? <div className="space-y-3">{s.topIssues.map((item) => <button key={item.code} type="button" onClick={() => setFilters((f) => ({ ...f, issueCode: item.code, page: 1 }))} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-violet-300 hover:bg-violet-50/40"><div className="flex items-center justify-between gap-2"><span className={cn('rounded px-2 py-0.5 text-[9px] font-black uppercase', item.severity === 'blocker' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>{item.severity}</span><span className="text-xs font-black text-slate-900">{item.count}</span></div><p className="mt-2 text-xs font-semibold text-slate-800">{item.label}</p><p className="mt-1 text-[10px] uppercase text-slate-400">Owner · {item.owner}</p></button>)}</div> : <div className="py-8 text-center text-xs text-slate-500"><AlertTriangle className="mx-auto mb-2 h-7 w-7 text-slate-300" />Evaluate the catalog to rank recurring gaps.</div>}
        </Card>
      </div>
      <QualityDetail row={selected} loading={detailLoading} onClose={() => { setSelected(null); setDetailLoading(false); }} />
    </div>
  );
}
