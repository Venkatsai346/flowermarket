import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw, Truck,
} from 'lucide-react';
import { fmtDateTime, inr, num, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Textarea } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import {
  QC_STATUS_META, RETURN_CLAIM_TYPE_META, RETURN_STATUS_META,
} from './aftersalesMeta.js';

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function ReturnDetailDrawer({ returnId, onClose, onChanged }) {
  const [confirmPickup, setConfirmPickup] = useState(false);
  const [confirmQc, setConfirmQc] = useState(false);
  const [qcDecision, setQcDecision] = useState('pass');
  const [qcNote, setQcNote] = useState('');
  const action = useAction();
  const { data, loading, error, refetch } = useApi(() => api.returns.detail(returnId), [returnId]);

  if (loading && !data) return <Modal open onClose={onClose} title="Return request" size="lg"><LoadingBlock compact /></Modal>;
  if (error) return <Modal open onClose={onClose} title="Return request" size="lg"><p className="text-sm text-rose-600">{error.message}</p></Modal>;

  const rr = data?.returnRequest || data || {};
  const items = data?.items || [];
  const review = rr.review || {};
  const eligibility = rr.eligibility || {};

  const run = async (fn, message, after) => {
    try {
      await action.run(fn);
      toast.success(message);
      await refetch();
      after?.();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const pickup = () => run(
    () => api.returns.markPickedUp(rr.id || rr._id),
    'Return pickup confirmed',
    () => setConfirmPickup(false),
  );
  const qc = () => run(
    () => api.returns.qcDecision(rr.id || rr._id, { decision: qcDecision, note: qcNote || undefined }),
    qcDecision === 'pass' ? 'QC passed — refund initiated' : 'QC failed recorded',
    () => { setConfirmQc(false); setQcNote(''); },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Return ${rr.id || rr._id || ''}`}
      subtitle={fmtDateTime(rr.createdAt)}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Status" value={<Badge tone={pickMeta(RETURN_STATUS_META, rr.status).tone} dot>{pickMeta(RETURN_STATUS_META, rr.status).label}</Badge>} />
          <Tile label="Claim" value={<Badge tone={pickMeta(RETURN_CLAIM_TYPE_META, rr.claimType).tone}>{pickMeta(RETURN_CLAIM_TYPE_META, rr.claimType).label}</Badge>} sub={rr.autoApproved ? 'auto-approved' : 'ops handled'} />
          <Tile label="Order" value={<span className="font-mono text-xs">{rr.orderId}</span>} />
          <Tile label="Customer" value={<span className="font-mono text-xs">{rr.userId}</span>} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Refund" value={inr(rr.refundAmount)} />
          <Tile label="Reviewer" value={review.reviewedBy ? <span className="font-mono text-xs">{review.reviewedBy}</span> : '—'} />
          <Tile label="Picked up" value={rr.pickedUpAt ? fmtDateTime(rr.pickedUpAt) : '—'} />
          <Tile label="QC done" value={rr.qcCompletedAt ? fmtDateTime(rr.qcCompletedAt) : '—'} />
        </div>

        <div className="rounded-xl border border-slate-100 p-4">
          <p className="label mb-1">Customer reason</p>
          <p className="text-sm text-slate-700">{rr.reason || '—'}</p>
          {rr.reasonCode && <p className="mt-1 text-xs text-slate-400">Code · {rr.reasonCode}</p>}
          {rr.customerNote && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{rr.customerNote}</p>}
        </div>

        {eligibility.reason && (
          <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-xs text-amber-700">
            Eligibility · {eligibility.reason}
          </div>
        )}

        <div>
          <p className="label">Items</p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Refund</th>
                  <th className="px-3 py-2 font-semibold">QC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(items.length ? items : []).map((it, i) => (
                  <tr key={it.id || i}>
                    <td className="px-3 py-2 text-slate-800">{it.skuSnapshot?.title || it.title || it.tenantProductId || 'Item'}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{num(it.qty)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{inr(it.refundAmount)}</td>
                    <td className="px-3 py-2"><Badge tone={pickMeta(QC_STATUS_META, it.qcStatus).tone} dot>{pickMeta(QC_STATUS_META, it.qcStatus).label}</Badge></td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan="4" className="px-3 py-4 text-center text-xs text-slate-400">No return items.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-100 p-4">
          <p className="label mb-3">Admin actions</p>
          <div className="flex flex-wrap gap-2">
            {rr.status === 'approved' && (
              confirmPickup ? (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Confirm physical pickup?</span>
                  <Button variant="primary" icon={Truck} loading={action.busy} onClick={pickup}>Yes, confirm pickup</Button>
                  <Button variant="secondary" onClick={() => setConfirmPickup(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="primary" icon={Truck} onClick={() => setConfirmPickup(true)}>Confirm pickup</Button>
              )
            )}
            {rr.status === 'picked_up' && (
              confirmQc ? (
                <div className="w-full space-y-3 rounded-xl bg-slate-50 p-4">
                  <div className="flex gap-2">
                    <Button variant={qcDecision === 'pass' ? 'success' : 'secondary'} size="sm" onClick={() => setQcDecision('pass')} icon={CheckCircle2}>QC pass</Button>
                    <Button variant={qcDecision === 'fail' ? 'danger' : 'secondary'} size="sm" onClick={() => setQcDecision('fail')} icon={AlertTriangle}>QC fail</Button>
                  </div>
                  <Field label="QC note" hint={qcDecision === 'fail' ? 'Required so the customer sees why refund was rejected.' : 'Optional for pass.'}>
                    <Textarea value={qcNote} onChange={(e) => setQcNote(e.target.value)} placeholder={qcDecision === 'fail' ? 'Wilted stems, damaged packaging…' : 'Passed quality check'} />
                  </Field>
                  <div className="flex gap-2">
                    <Button variant={qcDecision === 'pass' ? 'success' : 'danger'} icon={ClipboardCheck} loading={action.busy} disabled={qcDecision === 'fail' && !qcNote} onClick={qc}>Submit QC decision</Button>
                    <Button variant="secondary" onClick={() => setConfirmQc(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button variant="primary" icon={ClipboardCheck} onClick={() => setConfirmQc(true)}>Run QC decision</Button>
              )
            )}
            {rr.status === 'qc_failed' && <span className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">QC failed — no refund</span>}
            {rr.status === 'refund_initiated' && <span className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-600">Refund processing</span>}
            {rr.status === 'refunded' && <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-600">Refunded</span>}
            {rr.status === 'refund_rejected' && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">Refund rejected</span>}
            {rr.status === 'rejected' && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">Rejected</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
          <RotateCcw className="h-4 w-4 shrink-0" />
          <p>Instant claims refund straight to the customer wallet. Pickup+QC claims follow pickup → QC → refund.</p>
        </div>
      </div>
    </Modal>
  );
}
