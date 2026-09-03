import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, RefreshCw, UploadCloud } from 'lucide-react';
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
import { BULK_JOB_STATUS_META, BULK_KIND_LABELS } from './catalogMeta.js';

const samplePrice = 'masterId,listingId,sku,price,mrp\n, ,ROS-RED,499,599';
const sampleStock = 'masterId,listingId,sku,qty\n, ,ROS-RED,25';

export default function BulkPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [kind, setKind] = useState('price');
  const [csv, setCsv] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [active, setActive] = useState(null);
  const fileRef = useRef(null);
  const { data: jobs, loading, error, refetch } = useApi(() => api.catalogTenant.bulkJobs(), [refreshKey], { toastOnError: false });
  const { busy, run } = useAction();
  const { busy: preparing, run: download } = useDownload();

  const refresh = () => setRefreshKey((k) => k + 1);

  // Poll while a job is queued/running; the backend processes in-process.
  useEffect(() => {
    const rows = jobs || [];
    const hasLive = rows.some((j) => j.status === 'queued' || j.status === 'running');
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
      const r = await run(() => api.catalogTenant.bulkUpload(kind, { csv }));
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

  const live = (jobs || []).filter((j) => j.status === 'queued' || j.status === 'running');
  const totalRows = (jobs || []).reduce((s, j) => s + (j.rows || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Live jobs</p><p className="mt-1 text-2xl font-bold text-slate-900">{live.length}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Queued rows</p><p className="mt-1 text-2xl font-bold text-slate-900">{totalRows}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Completed</p><p className="mt-1 text-2xl font-bold text-slate-900">{(jobs || []).filter((j) => j.status === 'completed').length}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Failed</p><p className="mt-1 text-2xl font-bold text-slate-900">{(jobs || []).filter((j) => j.status === 'failed').length}</p></div>
      </div>

      <Card title="Bulk price / stock" subtitle="Queued jobs validate and apply rows; dry-run writes nothing.">
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
        subtitle="Latest 50 jobs for this store."
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
            { key: 'progress', header: 'Progress', align: 'right', render: (r) => <span className="text-xs text-slate-600">{r.processed ?? 0} / {r.rows ?? 0}</span> },
            { key: 'result', header: 'Result', align: 'right', render: (r) => (
              <div className="text-right">
                <p className="text-xs text-emerald-600">{r.succeeded ?? 0} ok</p>
                <p className="text-xs text-rose-600">{r.failed ?? 0} failed</p>
              </div>
            ) },
            { key: 'startedAt', header: 'Started', render: (r) => <span className="text-xs text-slate-500">{r.startedAt ? fmtDateTime(r.startedAt) : '—'}</span> },
          ]}
        />
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
  const { data, loading, error } = useApi(() => api.catalogTenant.bulkJob(jobId), [jobId], { toastOnError: false });
  const isLive = data?.status === 'queued' || data?.status === 'running';

  useEffect(() => {
    if (!isLive) return undefined;
    const t = setInterval(() => onChanged(), 3000);
    return () => clearInterval(t);
  }, [isLive]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Bulk job · ${jobId}`}
      subtitle={data ? `${BULK_KIND_LABELS[data.kind] || data.kind} · ${data.rows ?? 0} rows` : 'Loading job…'}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {loading && !data ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading job…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{errMsg(error)}</p>
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
          <section className="rounded-xl border border-slate-200">
            <header className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Row errors</header>
            {data.errors?.length ? (
              <div className="max-h-[280px] overflow-auto divide-y divide-slate-100">
                {data.errors.map((e, i) => (
                  <div key={i} className="flex flex-wrap gap-2 px-4 py-2 text-xs">
                    <span className="font-mono text-slate-400">row {e.row ?? '?'}</span>
                    <span className="text-rose-600">{e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-5 text-center text-xs text-slate-400">No row errors.</p>
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
