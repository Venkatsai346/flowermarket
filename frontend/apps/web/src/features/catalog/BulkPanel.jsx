import { useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, Download, FileUp, RefreshCw, RotateCcw, ShieldCheck, UploadCloud } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { useDownload } from '../../lib/useDownload.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Checkbox, Field, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { BULK_JOB_STATUS_META, BULK_KIND_LABELS } from './catalogMeta.js';

const samplePrice = 'masterId,listingId,sku,price,mrp\n, ,ROS-RED,499,599';
const sampleStock = 'masterId,listingId,sku,qty\n, ,ROS-RED,25';

export default function BulkPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [jobPage, setJobPage] = useState(1);
  const [kind, setKind] = useState('price');
  const [csv, setCsv] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [active, setActive] = useState(null);
  const fileRef = useRef(null);
  const { data: jobs, meta: jobsMeta, loading } = useApi(() => api.catalogTenant.bulkJobs({ page: jobPage, limit: 20 }), [refreshKey, jobPage], { toastOnError: false });
  const { busy, run } = useAction();
  const { busy: preparing, run: download } = useDownload();

  const refresh = () => setRefreshKey((k) => k + 1);

  // Poll while the durable worker owns or is stopping a job.
  useEffect(() => {
    const rows = jobs || [];
    const hasLive = rows.some((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
    if (!hasLive) return undefined;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [jobs]);

  const readFile = async (file) => {
    const text = await file.text();
    setCsv(text);
    toast.success(`Loaded ${file.name} (${text.length.toLocaleString()} characters)`);
  };

  const submit = async () => {
    try {
      const r = await run(() => api.catalogTenant.bulkUpload(kind, { csv }, { dryRun }));
      toast.success(dryRun ? 'Dry-run queued — nothing was written' : 'Bulk job queued');
      setCsv('');
      setActive(r.data?.jobId || null);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const downloadTemplate = (k) => download(
    () => api.catalogTenant.bulkTemplate(k),
    `${k}-template.csv`,
  );

  const live = (jobs || []).filter((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
  const totalRows = live.reduce((sum, job) => sum + Math.max(0, (job.rows || 0) - (job.processed || 0)), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Live jobs</p><p className="mt-1 text-2xl font-bold text-slate-900">{live.length}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Rows remaining</p><p className="mt-1 text-2xl font-bold text-slate-900">{totalRows}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Completed</p><p className="mt-1 text-2xl font-bold text-slate-900">{(jobs || []).filter((j) => j.status === 'completed').length}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Row failures</p><p className="mt-1 text-2xl font-bold text-rose-700">{(jobs || []).reduce((sum, job) => sum + (job.failed || 0), 0)}</p></div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-sky-50 p-4 sm:flex-row sm:items-center"><span className="rounded-xl bg-violet-100 p-2.5 text-violet-700"><ShieldCheck className="h-5 w-5" /></span><div><p className="text-sm font-bold text-slate-900">Restart-safe, multi-worker imports</p><p className="mt-0.5 text-xs leading-5 text-slate-600">Rows are durably checkpointed, tenant-isolated and processed in CSV order with reclaimable worker leases. History and failures remain available for 30 days.</p></div></div>

      <Card title="Bulk price / stock" subtitle="Durable jobs validate and apply up to 5,000 rows; dry-run writes nothing.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select className="w-40!" value={kind} onChange={(e) => { setKind(e.target.value); setCsv(''); }}>
              <option value="price">Price</option>
              <option value="stock">Stock</option>
            </Select>
            <Button variant="secondary" size="sm" icon={Download} loading={preparing} onClick={() => downloadTemplate(kind)}>{preparing ? 'Preparing…' : 'Download template'}</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
            <Button variant="secondary" size="sm" icon={FileUp} onClick={() => fileRef.current?.click()}>Upload CSV</Button>
          </div>
          <Field label="CSV payload" hint={`Columns: ${kind === 'price' ? 'masterId, listingId, sku, price, mrp' : 'masterId, listingId, sku, qty'}.`}>
            <Textarea
              className="min-h-[160px]! font-mono text-xs"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={kind === 'price' ? samplePrice : sampleStock}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox label="Dry run (validate without writing)" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <Button icon={UploadCloud} loading={busy} disabled={!csv.trim()} onClick={submit}>Queue {kind} job</Button>
          </div>
        </div>
      </Card>

      <Card
        title="Bulk job history"
        subtitle="Durable 30-day history for this store."
        bodyClassName="p-0!"
        actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
      >
        <Table
          loading={loading && !jobs}
          data={jobs || []}
          onRowClick={(j) => setActive(j.id)}
          empty={<EmptyState icon={UploadCloud} title="No bulk jobs yet" message="Queue a CSV above to see validation and results." />}
          columns={[
            { key: 'id', header: 'Job', render: (r) => <span className="font-mono text-xs text-slate-500">{r.id}</span> },
            { key: 'kind', header: 'Kind', render: (r) => <Badge tone={r.kind === 'price' ? 'violet' : 'amber'}>{BULK_KIND_LABELS[r.kind] || r.kind}</Badge> },
            { key: 'rows', header: 'Rows', align: 'right', render: (r) => <span className="text-sm">{r.rows ?? 0}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(BULK_JOB_STATUS_META, r.status).tone} dot>{pickMeta(BULK_JOB_STATUS_META, r.status).label}</Badge> },
            { key: 'progress', header: 'Progress', render: (r) => <div className="min-w-28"><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>{r.processed ?? 0}/{r.rows ?? 0}</span><span>{r.progress ?? 0}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${r.progress ?? 0}%` }} /></div></div> },
            { key: 'result', header: 'Result', align: 'right', render: (r) => (
              <div className="text-right">
                <p className="text-xs text-emerald-600">{r.succeeded ?? 0} ok</p>
                <p className="text-xs text-rose-600">{r.failed ?? 0} failed</p>
              </div>
            ) },
            { key: 'startedAt', header: 'Started', render: (r) => <span className="text-xs text-slate-500">{r.startedAt ? fmtDateTime(r.startedAt) : '—'}</span> },
          ]}
        />
        <div className="border-t border-slate-100 px-4 py-3"><Pagination meta={jobsMeta} onPage={setJobPage} /></div>
      </Card>

      {active && (
        <JobModal
          jobId={typeof active === 'object' ? active.id : active}
          onClose={() => setActive(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function JobModal({ jobId, onClose, onChanged }) {
  const job = useApi(() => api.catalogTenant.bulkJob(jobId), [jobId], { toastOnError: false });
  const failures = useApi(() => api.catalogTenant.bulkJobFailures(jobId, { limit: 100 }), [jobId], { toastOnError: false });
  const { busy, run } = useAction();
  const data = job.data;
  const isLive = ['queued', 'running', 'cancel_requested'].includes(data?.status);

  useEffect(() => {
    if (!isLive) return undefined;
    const refresh = () => { job.refetch(); failures.refetch(); onChanged(); };
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [isLive, job.refetch, failures.refetch, onChanged]);

  const cancel = async () => {
    try { await run(() => api.catalogTenant.cancelBulkJob(jobId)); toast.success('Cancellation requested'); await job.refetch(); onChanged(); }
    catch (requestError) { toast.error(errMsg(requestError)); }
  };
  const retry = async () => {
    try { await run(() => api.catalogTenant.retryBulkFailures(jobId)); toast.success('Failed rows re-queued'); await Promise.all([job.refetch(), failures.refetch()]); onChanged(); }
    catch (requestError) { toast.error(errMsg(requestError)); }
  };
  const failureRows = failures.data || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Bulk job · ${jobId}`}
      subtitle={data ? `${BULK_KIND_LABELS[data.kind] || data.kind} · ${data.rows ?? 0} rows` : 'Loading job…'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{['queued', 'running'].includes(data?.status) && <Button variant="danger" icon={Ban} loading={busy} onClick={cancel}>Cancel safely</Button>}{(data?.failed > 0 || data?.status === 'failed') && ['completed', 'failed'].includes(data.status) && <Button variant="primary" icon={RotateCcw} loading={busy} onClick={retry}>Retry failed rows</Button>}</>}
    >
      {job.loading && !data ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading durable checkpoint…</p>
      ) : job.error ? (
        <p className="text-sm text-rose-600">{errMsg(job.error)}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge tone={pickMeta(BULK_JOB_STATUS_META, data.status).tone} dot>{pickMeta(BULK_JOB_STATUS_META, data.status).label}</Badge>
            <p className="text-xs text-slate-500">
              processed {data.processed ?? 0} · succeeded <span className="text-emerald-600">{data.succeeded ?? 0}</span> · failed <span className="text-rose-600">{data.failed ?? 0}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Rows" value={data.rows ?? 0} />
            <Metric label="Succeeded" value={data.succeeded ?? 0} tone="emerald" />
            <Metric label="Failed" value={data.failed ?? 0} tone="rose" />
          </div>
          <div className="rounded-xl bg-slate-50 p-4"><div className="mb-2 flex justify-between text-xs font-semibold text-slate-600"><span>Durable row checkpoint</span><span>{data.progress ?? 0}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-500 transition-all" style={{ width: `${data.progress ?? 0}%` }} /></div><p className="mt-2 text-[10px] text-slate-500">Attempt {data.attempts || 0} · next CSV row {data.nextRow || 2} · {data.dryRun ? 'validation only' : 'writes enabled'}</p></div>
          <section className="rounded-xl border border-slate-200">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-sm font-semibold text-slate-800">Failed row evidence</span><span className="text-xs text-slate-400">{failures.meta?.total ?? data.failed ?? 0}</span></header>
            {failureRows.length ? (
              <div className="max-h-[320px] divide-y divide-slate-100 overflow-auto">
                {failureRows.map((failure) => (
                  <div key={failure.rowNumber} className="px-4 py-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-slate-500">row {failure.rowNumber}</span>{failure.errorCode && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">{failure.errorCode}</span>}<span className="text-rose-700">{failure.errorMessage}</span></div><p className="mt-1 truncate font-mono text-[10px] text-slate-400">{JSON.stringify(failure.payload)}</p></div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />No failed rows.</div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Metric({ label, value, tone = 'slate' }) {
  const colors = { slate: 'text-slate-900', emerald: 'text-emerald-600', rose: 'text-rose-600' };
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[tone]}`}>{value}</p>
    </div>
  );
}
