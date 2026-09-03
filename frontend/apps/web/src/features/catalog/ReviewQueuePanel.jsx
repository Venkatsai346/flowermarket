import { useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Table from '../../components/ui/Table.jsx';
import { CHANGE_REQUEST_STATUS_META, CHANGE_REQUEST_TYPE_META, fmtJson } from './catalogMeta.js';

const STATUSES = Object.entries(CHANGE_REQUEST_STATUS_META);
const TYPES = Object.entries(CHANGE_REQUEST_TYPE_META);

export default function ReviewQueuePanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState(null); // {request, decision}

  const { data, meta, loading, error, refetch } = useApi(
    () => api.catalogAdmin.changeRequests({
      page, limit: 20,
      status: status || undefined,
      type: type || undefined,
    }),
    [page, status, type, refreshKey],
  );

  const refresh = () => setRefreshKey((k) => k + 1);
  const rows = (data || []).map((r) => ({ ...r, id: rid(r) }));

  return (
    <div className="space-y-4">
      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load the review queue</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <Card
          title="Change request review queue"
          subtitle="Tenant proposals that mutate shared catalog fields need an operator decision."
          bodyClassName="p-0!"
          actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Select className="w-44!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              {STATUSES.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </Select>
            <Select className="w-52!" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">All request types</option>
              {TYPES.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </Select>
          </div>

          <Table
            loading={loading && !data}
            data={rows}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={Inbox} title="Review queue is clear" message="No change requests match these filters." />}
            columns={[
              { key: 'type', header: 'Request', render: (r) => (
                <div>
                  <Badge tone={pickMeta(CHANGE_REQUEST_TYPE_META, r.type).tone}>{pickMeta(CHANGE_REQUEST_TYPE_META, r.type).label}</Badge>
                  <p className="mt-1 text-[11px] text-slate-400">{pickMeta(CHANGE_REQUEST_TYPE_META, r.type).description}</p>
                </div>
              ) },
              { key: 'subject', header: 'Subject', render: (r) => <span className="max-w-[260px] truncate text-sm text-slate-700">{r.payload?.title || r.diff?.after?.title || r.productMasterId || '—'}</span> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(CHANGE_REQUEST_STATUS_META, r.status).tone} dot>{pickMeta(CHANGE_REQUEST_STATUS_META, r.status).label}</Badge> },
              { key: 'requestedBy', header: 'Requested by', render: (r) => <span className="font-mono text-xs text-slate-500">{r.requestedBy ? String(r.requestedBy) : '—'}</span> },
              { key: 'createdAt', header: 'Submitted', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span> },
              { key: 'actions', header: '', align: 'right', render: (r) => r.status === 'pending' && (
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setReview({ request: r, decision: 'reject' }); }}>Reject</Button>
                  <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); setReview({ request: r, decision: 'approve' }); }}>Review</Button>
                </div>
              ) },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <RequestDetailModal request={selected} onClose={() => setSelected(null)} onReview={setReview} />}
      {review && <ReviewModal review={review} onClose={() => setReview(null)} onDone={() => { setSelected(null); refresh(); }} />}
    </div>
  );
}

function RequestDetailModal({ request, onClose, onReview }) {
  const m = pickMeta(CHANGE_REQUEST_TYPE_META, request.type);
  return (
    <Modal
      open
      onClose={onClose}
      title={m.label}
      subtitle={m.description}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-slate-400">Review decisions are audited and published to the tenant immediately.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {request.status === 'pending' && (
              <>
                <Button variant="danger" onClick={() => onReview({ request, decision: 'reject' })}>Reject</Button>
                <Button variant="success" onClick={() => onReview({ request, decision: 'approve' })}>Approve</Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={m.tone}>{m.label}</Badge>
          <Badge tone={pickMeta(CHANGE_REQUEST_STATUS_META, request.status).tone} dot>{pickMeta(CHANGE_REQUEST_STATUS_META, request.status).label}</Badge>
        </div>

        {request.note && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><span className="font-semibold text-slate-800">Tenant note</span><p className="mt-1">{request.note}</p></div>}

        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Payload</p>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{fmtJson(request.payload)}</pre>
          </section>
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Diff · after</p>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{fmtJson(request.diff?.after)}</pre>
          </section>
        </div>

        {request.review?.note && (
          <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-xs text-sky-800">
            <p className="font-semibold">Previous review note</p>
            <p className="mt-1">{request.review.note}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReviewModal({ review, onClose, onDone }) {
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const decision = review.decision;
  const request = review.request;

  const submit = async () => {
    setError('');
    try {
      await run(() => api.catalogAdmin.reviewChangeRequest(rid(request), { decision, note: note.trim() || null }));
      toast.success(`Request ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'sent back for changes'}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={decision === 'approve' ? 'Approve request' : decision === 'reject' ? 'Reject request' : 'Request changes'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={decision === 'approve' ? 'success' : 'danger'} loading={busy} onClick={submit}>
            {decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Send back'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
      <p className="text-sm text-slate-600">
        {decision === 'approve' ? 'Approval applies the proposal to the shared catalog immediately.' : decision === 'reject' ? 'Rejecting closes this request without applying the proposed changes.' : 'Send back lets the tenant revise and resubmit this request.'}
      </p>
      <div className="mt-3">
        <Field label="Review note" hint="Stored on the request, shown in the tenant timeline.">
          <Textarea maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'approve' ? 'Looks correct — approved.' : 'Please add the missing category attributes…'} />
        </Field>
      </div>
    </Modal>
  );
}
