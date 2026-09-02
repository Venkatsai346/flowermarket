import { useState } from 'react';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { fmtDateTime, pickMeta, APPLICATION_STATUS_META } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Select, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

export default function VendorApplicationsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [review, setReview] = useState(null); // { id, decision }
  const [note, setNote] = useState('');
  const { busy, run } = useAction();

  const { data, meta, loading, refetch } = useApi(
    () => api.marketplace.adminVendorApplications({ page, limit: 20, status: status || undefined }),
    [page, status]
  );

  const openReview = (id, decision) => {
    setNote('');
    setReview({ id, decision });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!review) return;
    try {
      const r = await run(() => api.marketplace.reviewApplication(review.id, { decision: review.decision, note: note || null }));
      toast.success(
        review.decision === 'approve'
          ? `${r.data?.application?.businessName || 'Vendor'} approved — vendor role granted`
          : 'Application rejected'
      );
      setReview(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Vendor applications"
        description="Review sellers who want to join the marketplace. Approval grants the vendor role."
      />
      <Card bodyClassName="p-0!">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Select className="w-48!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          empty={<EmptyState icon={ClipboardCheck} title="No applications" message="Seller applications land here for review." />}
          columns={[
            { key: 'business', header: 'Business', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.businessName}</p>
                <p className="text-[11px] text-slate-400">@{r.slug}</p>
              </div>
            ) },
            { key: 'contact', header: 'Contact', render: (r) => (
              <div className="text-xs text-slate-600">
                <p>{r.contactPhone || '—'}</p>
                <p className="text-slate-400">{r.city || ''}</p>
              </div>
            ) },
            { key: 'categories', header: 'Categories', render: (r) => (r.categories || []).slice(0, 2).join(', ') || '—' },
            { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(APPLICATION_STATUS_META, r.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'submittedAt', header: 'Submitted', render: (r) => fmtDateTime(r.submittedAt) },
            { key: 'actions', header: '', align: 'right', render: (r) =>
              r.status === 'submitted' || r.status === 'under_review' ? (
                <div className="flex justify-end gap-1.5">
                  <button className="btn-success btn-sm" onClick={(e) => { e.stopPropagation(); openReview(r.id, 'approve'); }}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button className="btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); openReview(r.id, 'reject'); }}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              ) : <span className="text-xs text-slate-400">{r.reviewedAt ? fmtDateTime(r.reviewedAt) : '—'}</span>
            },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title={review?.decision === 'approve' ? 'Approve vendor application' : 'Reject vendor application'}
        subtitle="This decision is audited."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button>
            <Button
              variant={review?.decision === 'approve' ? 'success' : 'danger'}
              loading={busy}
              onClick={submit}
            >
              {review?.decision === 'approve' ? 'Approve & grant vendor role' : 'Reject application'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <p className="text-sm text-slate-500">
            {review?.decision === 'approve'
              ? 'This creates the vendor profile and grants the user the vendor role. They can then list products for marketplace review.'
              : 'The applicant keeps their current account; no vendor profile is created.'}
          </p>
          {review?.decision === 'approve' && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              Heads-up: approval sets the applicant's role to <b>vendor</b>. If this user is
              currently a store admin, they'll lose console access to their store — use a
              dedicated seller account where possible.
            </p>
          )}
          <div className="mt-4">
            <label className="label">Note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Verified GSTIN, quality check passed…" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
