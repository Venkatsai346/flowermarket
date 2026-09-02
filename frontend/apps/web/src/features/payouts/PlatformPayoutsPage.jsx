import { useState } from 'react';
import {
  AlertTriangle, Ban, BadgeCheck, Banknote, CalendarClock, CheckCircle2, Eye,
  RefreshCw, Send, ShieldAlert, ThumbsDown, Wallet,
} from 'lucide-react';
import { inr, fmtDate } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PayoutWaterfall, PayoutLines, PayoutFacts } from './PayoutBreakdown.jsx';
import { PAYOUT_STATE_META, IN_FLIGHT } from './payoutMeta.js';

/** ISO date (yyyy-mm-dd) N days ago — the default cycle window. */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function StateBadge({ state }) {
  const m = PAYOUT_STATE_META[state] || { label: state, tone: 'slate' };
  const Icon = m.icon;
  return (
    <Badge tone={m.tone}>
      {Icon && <Icon className="h-3 w-3" />}
      {m.label}
    </Badge>
  );
}

/**
 * The batch drawer. Actions are driven by `state`, and the in-flight case is
 * handled explicitly: when a batch is with the provider we offer RECONCILE and
 * nothing else. There is deliberately no "retry" button anywhere on this
 * screen — retrying an in-flight payout is how a marketplace pays twice, and
 * the API would reject it anyway.
 */
function PayoutDetail({ batchId, onClose, onChanged }) {
  const { data, loading, refetch } = useApi(() => api.payouts.admin.get(batchId), [batchId]);
  const { busy, run } = useAction();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(null);

  const batch = data?.batch;
  const state = batch?.state;
  const inFlight = IN_FLIGHT.includes(state);

  const act = async (kind) => {
    try {
      if (kind === 'submitApproval') {
        await run(() => api.payouts.admin.submitForApproval(batchId));
        toast.success('Sent for approval');
      } else if (kind === 'approve') {
        const r = await run(() => api.payouts.admin.approve(batchId, {}));
        toast.success(r.message || 'Approved');
      } else if (kind === 'reject') {
        await run(() => api.payouts.admin.reject(batchId, { reason }));
        toast.success('Rejected');
      } else if (kind === 'cancel') {
        await run(() => api.payouts.admin.cancel(batchId, { reason }));
        toast.success('Cancelled — lines released to the next cycle');
      } else if (kind === 'send') {
        const r = await run(() => api.payouts.admin.submitToProvider(batchId));
        const st = r.data?.state;
        if (st === 'processing') toast.info(r.message || 'Submitted — awaiting confirmation');
        else toast.success(r.message || 'Payout sent');
      } else if (kind === 'reconcile') {
        const r = await run(() => api.payouts.admin.reconcile({ olderThanMinutes: 0 }));
        const d = r.data || {};
        toast.success(`Reconciled — ${d.resolvedPaid || 0} paid, ${d.resolvedFailed || 0} failed, ${d.stillUnknown || 0} still unknown`);
      }
      setConfirming(null);
      setReason('');
      refetch();
      onChanged?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={batch ? `Payout ${batch.batchNumber}` : 'Payout'}
      subtitle={batch ? `${inr(batch.rupees?.net)} to vendor ${String(batch.vendorId).slice(0, 10)}…` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {state === 'draft' && (
            <Button loading={busy} icon={CalendarClock} onClick={() => act('submitApproval')}>Send for approval</Button>
          )}
          {state === 'pending_approval' && (
            <>
              <Button variant="danger" loading={busy} icon={ThumbsDown} onClick={() => setConfirming('reject')}>Reject</Button>
              <Button variant="success" loading={busy} icon={BadgeCheck} onClick={() => act('approve')}>Approve</Button>
            </>
          )}
          {state === 'approved' && (
            <Button variant="success" loading={busy} icon={Send} onClick={() => setConfirming('send')}>Send to bank</Button>
          )}
          {state === 'failed' && (
            <Button loading={busy} icon={Send} onClick={() => setConfirming('send')}>Retry (provider rejected it)</Button>
          )}
          {inFlight && (
            <Button variant="secondary" loading={busy} icon={RefreshCw} onClick={() => act('reconcile')}>
              Reconcile with provider
            </Button>
          )}
          {['draft', 'pending_approval', 'approved'].includes(state) && (
            <Button variant="ghost" loading={busy} icon={Ban} onClick={() => setConfirming('cancel')}>Cancel</Button>
          )}
        </>
      }
    >
      {loading && !batch ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : !batch ? (
        <p className="py-8 text-center text-sm text-slate-400">Not found.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={state} />
            {batch.requiresDualApproval && (
              <Badge tone="violet">Needs 2 approvers ({(batch.approvals || []).length}/2)</Badge>
            )}
            {batch.needsReconciliation && <Badge tone="orange">Needs reconciliation</Badge>}
          </div>

          {batch.needsReconciliation && (
            <div className="flex gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">The bank did not confirm this instruction.</p>
                <p className="mt-0.5 text-orange-700">
                  Money may or may not have moved, so this batch will <strong>not</strong> be retried.
                  Reconcile to ask the provider what actually happened.
                  {batch.failureReason ? ` Reported: ${batch.failureReason}` : ''}
                </p>
              </div>
            </div>
          )}

          {state === 'failed' && !batch.needsReconciliation && (
            <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Rejected before any money moved — safe to retry.</p>
                <p className="mt-0.5 text-rose-700">{batch.failureReason}</p>
              </div>
            </div>
          )}

          <PayoutFacts batch={batch} />
          <PayoutWaterfall rupees={batch.rupees} />

          {(batch.approvals || []).length > 0 && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {batch.approvals.map((a, i) => (
                <p key={i}>Approved by {String(a.userId).slice(0, 10)}… on {fmtDate(a.at)}{a.note ? ` — ${a.note}` : ''}</p>
              ))}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {data.lines?.length || 0} line{data.lines?.length === 1 ? '' : 's'}
            </p>
            <PayoutLines lines={data.lines} />
          </div>

          {confirming && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              {confirming === 'send' ? (
                <>
                  <p className="text-sm font-semibold text-slate-800">
                    Send {inr(batch.rupees?.net)} to {batch.payoutAccount?.maskedAccount || batch.payoutAccount?.vpa}?
                  </p>
                  <p className="text-xs text-slate-500">
                    This instructs the bank immediately. If the response is ambiguous the batch stays in flight
                    and can only be resolved by reconciliation.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setConfirming(null)}>Back</Button>
                    <Button variant="success" loading={busy} icon={Banknote} onClick={() => act('send')}>Confirm transfer</Button>
                  </div>
                </>
              ) : (
                <>
                  <Field label={confirming === 'reject' ? 'Why is this rejected?' : 'Why is this cancelled?'} required>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the audit trail" />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setConfirming(null)}>Back</Button>
                    <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => act(confirming)}>
                      Confirm
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Compute a cycle: the only way batches come into existence. */
function ComputeCycleModal({ onClose, onDone }) {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { busy, run } = useAction();

  const go = async () => {
    try {
      const r = await run(() => api.payouts.admin.computeCycle({ from, to }));
      const d = r.data || {};
      toast.success(`Cycle computed — ${d.created ?? 0} batch(es) created, ${d.skipped ?? 0} skipped, ${d.failed ?? 0} failed`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Compute payout cycle"
      subtitle="Builds one DRAFT batch per vendor from lines whose return window closed in this window."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} icon={CalendarClock} onClick={go}>Compute</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Recomputing the same window is safe — batches are unique per vendor and cycle, so nothing is duplicated.
      </p>
    </Modal>
  );
}

export default function PlatformPayoutsPage() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [selected, setSelected] = useState(null);
  const [computing, setComputing] = useState(false);
  const [running, setRunning] = useState('');

  const { data, meta, loading, refetch } = useApi(
    () => api.payouts.admin.list({ page, limit: 20, state: state || undefined }),
    [page, state]
  );
  const { run } = useAction();

  const rows = data || [];
  const needsAttention = rows.filter((r) => r.needsReconciliation || r.state === 'pending_approval');
  const inFlightTotal = rows.filter((r) => IN_FLIGHT.includes(r.state)).reduce((a, r) => a + (r.net || 0), 0);

  const op = async (kind) => {
    setRunning(kind);
    try {
      if (kind === 'sweep') {
        const r = await run(() => api.payouts.admin.sweepEligibility());
        const d = r.data || {};
        toast.success(`Eligibility swept — ${d.promoted || 0} promoted, ${d.waiting || 0} still in the return window`);
      } else {
        const r = await run(() => api.payouts.admin.reconcile({}));
        const d = r.data || {};
        toast.success(`Reconciled — ${d.resolvedPaid || 0} paid, ${d.resolvedFailed || 0} failed, ${d.stillUnknown || 0} unknown`);
      }
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRunning('');
    }
  };

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Vendor disbursement. Nothing leaves the bank without an explicit approval here."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} loading={running === 'sweep'} onClick={() => op('sweep')}>
              Sweep eligibility
            </Button>
            <Button variant="secondary" icon={ShieldAlert} loading={running === 'reconcile'} onClick={() => op('reconcile')}>
              Reconcile in-flight
            </Button>
            <Button icon={CalendarClock} onClick={() => setComputing(true)}>Compute cycle</Button>
          </>
        }
      />

      {(needsAttention.length > 0 || inFlightTotal > 0) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {needsAttention.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-amber-600" />
              <div className="text-sm">
                <p className="font-semibold text-amber-900">{needsAttention.length} batch(es) waiting on you</p>
                <p className="text-amber-700">Approvals and unresolved submissions on this page.</p>
              </div>
            </div>
          )}
          {inFlightTotal > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
              <Wallet className="h-5 w-5 text-orange-600" />
              <div className="text-sm">
                <p className="font-semibold text-orange-900">{inr(inFlightTotal)} in flight</p>
                <p className="text-orange-700">Outcome unconfirmed — resolve by reconciling, never by retrying.</p>
              </div>
            </div>
          )}
        </div>
      )}

      <Card bodyClassName="p-0!">
        <div className="border-b border-slate-100 px-4 py-3">
          <Select className="w-52!" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
            <option value="">All states</option>
            {Object.entries(PAYOUT_STATE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={rows}
          onRowClick={(r) => setSelected(r.id)}
          empty={(
            <EmptyState
              icon={Banknote}
              title="No payout batches"
              message="Sweep eligibility, then compute a cycle to build batches from delivered orders past their return window."
            />
          )}
          columns={[
            {
              key: 'batchNumber',
              header: 'Batch',
              render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.batchNumber}</span>,
            },
            {
              key: 'vendorId',
              header: 'Vendor',
              render: (r) => <span className="font-mono text-xs text-slate-500">{String(r.vendorId).slice(0, 10)}…</span>,
            },
            {
              key: 'cycle',
              header: 'Cycle',
              render: (r) => <span className="text-xs text-slate-600">{fmtDate(r.cycle?.from)} → {fmtDate(r.cycle?.to)}</span>,
            },
            { key: 'lineItemCount', header: 'Lines', align: 'right', render: (r) => r.lineItemCount ?? 0 },
            {
              key: 'net',
              header: 'Net',
              align: 'right',
              render: (r) => <span className="font-semibold tabular-nums">{inr(r.net)}</span>,
            },
            {
              key: 'state',
              header: 'State',
              render: (r) => (
                <div className="flex items-center gap-1.5">
                  <StateBadge state={r.state} />
                  {r.needsReconciliation && <Badge tone="orange">!</Badge>}
                </div>
              ),
            },
            { key: 'view', header: '', align: 'right', render: () => <Eye className="ml-auto h-4 w-4 text-slate-300" /> },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {selected && <PayoutDetail batchId={selected} onClose={() => setSelected(null)} onChanged={refetch} />}
      {computing && <ComputeCycleModal onClose={() => setComputing(false)} onDone={refetch} />}
    </div>
  );
}
