import { useState } from 'react';
import {
  AlertTriangle, Ban, BadgeCheck, Banknote, CalendarClock, CheckCircle2, CircleDollarSign,
  Eye, FileInput, Landmark, RefreshCw, Scale, Send, ShieldAlert, ThumbsDown, ToggleLeft, ToggleRight, Undo2, Wallet,
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

/**
 * The cash gate (Phase 12): where the customer money actually is.
 * `gateway_clearing` holds captured-but-unsettled sales; ingesting the PSP's
 * settlement report moves it into `bank` and — with the gate ON — is the only
 * thing that lets a vendor line for that order become payable.
 */
function SettlementCard() {
  const { data, loading, refetch } = useApi(() => api.payouts.admin.settlements(), []);
  const { busy, run } = useAction();
  const [lines, setLines] = useState('');
  const [result, setResult] = useState(null);

  const toggleGate = async () => {
    const on = !data?.policy?.requirePspSettlement;
    try {
      await run(() => api.payouts.admin.savePolicy({ scope: 'platform', requirePspSettlement: on }));
      toast.success(on
        ? 'Cash gate ON — vendors are paid only after the PSP settles the cash to us'
        : 'Cash gate OFF — the return window is the only gate');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const ingest = async () => {
    const rows = lines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [orderNumber, amount, utr] = l.split(',').map((s) => s?.trim());
      const row = { orderNumber };
      if (amount) row.amount = Number(amount);
      if (utr) row.utr = utr;
      return row;
    });
    if (!rows.length) return;
    try {
      const r = await run(() => api.payouts.admin.ingestSettlements({ rows, reference: 'payout-console' }));
      const d = r.data || {};
      setResult(d);
      toast.success(`Settlement ingested — ${d.posted ?? 0} posted, ${d.skipped ?? 0} skipped, ${(d.unmatched || []).length} unmatched`);
      setLines('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const gateOn = Boolean(data?.policy?.requirePspSettlement);

  return (
    <Card
      className="mb-5"
      title="Settlement — the cash gate"
      subtitle="Customer money sits in gateway_clearing until the PSP settles it to our bank. With the gate on, a vendor is paid for an order only after that order's cash is in."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
    >
      {loading && !data ? (
        <p className="text-sm text-slate-400">Loading the settlement picture…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400"><CircleDollarSign className="h-3.5 w-3.5" /> Gateway clearing</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{inr((data?.gatewayClearingPaise || 0) / 100)}</p>
              <p className="text-[11px] text-slate-400">captured, not yet settled in</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400"><Landmark className="h-3.5 w-3.5" /> Our bank</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{inr((data?.bankPaise || 0) / 100)}</p>
              <p className="text-[11px] text-slate-400">settled in, before payouts</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Settled in</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{inr((data?.settledPaise || 0) / 100)} <span className="text-xs font-normal text-slate-400">· {data?.settledOrders ?? 0} order(s)</span></p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Waiting to settle</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{inr((data?.unsettledPaise || 0) / 100)} <span className="text-xs font-normal text-slate-400">· {data?.unsettledOrders ?? 0} of {data?.paidOrders ?? 0} paid</span></p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <button
              type="button"
              onClick={toggleGate}
              disabled={busy}
              className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition',
                gateOn ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200')}
            >
              {gateOn ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
              Cash gate {gateOn ? 'ON' : 'OFF'}
            </button>
            <p className="text-xs text-slate-500">
              {gateOn
                ? 'Payout lines for an order only become eligible once its settlement is ingested.'
                : 'Only the return window gates payout eligibility.'}
            </p>
          </div>

          <div>
            <Field label="Ingest a PSP settlement report" hint="One order per line — FM-YYMMDD-##### [, amount in ₹] [, UTR]. Amount defaults to the order total.">
              <textarea
                value={lines}
                onChange={(e) => setLines(e.target.value)}
                rows={3}
                placeholder={'FM-260907-00045\nFM-260907-00046, 249.00, UTR123456'}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </Field>
            <div className="mt-2 flex items-center gap-3">
              <Button icon={FileInput} loading={busy} disabled={!lines.trim()} onClick={ingest}>
                Ingest settlement
              </Button>
              {result && (
                <p className="text-xs text-slate-500">
                  {result.posted} posted · {result.skipped} skipped · {(result.unmatched || []).length} unmatched
                  {(result.unmatched || []).length > 0 && (
                    <span className="text-rose-600">
                      {' '}({(result.unmatched || []).map((u) => (typeof u === 'string' ? u : u.order)).join(', ')})
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          {(data?.unsettledSample || []).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Oldest paid, not yet settled
              </p>
              <ul className="space-y-0.5">
                {data.unsettledSample.slice(0, 5).map((o) => (
                  <li key={o.orderNumber} className="flex justify-between text-xs text-slate-500">
                    <span className="font-mono">{o.orderNumber}</span>
                    <span className="tabular-nums">{inr((o.totalPaise || 0) / 100)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Statutory deposits (Phase 13): the closing entry for TCS (GST s.52) and
 * TDS (IT s.194-O) withheld from vendor payouts. Paid out to the government
 * with the deposit-channel UTR on the record; reverts (operator corrections)
 * are journaled, never deleted.
 */
function StatutoryCard() {
  const { data, loading, refetch } = useApi(() => api.payouts.admin.statutory(), []);
  const { busy, run } = useAction();
  const [statute, setStatute] = useState('tcs');
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [confirmingRevert, setConfirmingRevert] = useState(null);
  const [revertReason, setRevertReason] = useState('');

  const doDeposit = async () => {
    try {
      await run(() => api.payouts.admin.statutoryDeposit({ statute, amount: Number(amount), utr }));
      toast.success(`${String(statute).toUpperCase()} deposit recorded`);
      setAmount('');
      setUtr('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const doRevert = async () => {
    try {
      await run(() => api.payouts.admin.statutoryRevert(confirmingRevert, { reason: revertReason }));
      toast.success('Deposit reverted — the reversal is journaled and the liability is back');
      setConfirmingRevert(null);
      setRevertReason('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const rowFor = (statuteKey, label, sub) => {
    const d = data?.[statuteKey];
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <p className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
          <span className="flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" /> {label}</span>
          {d && d.outstandingPaise > 0 && <Badge tone="amber">{sub}</Badge>}
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
          {inr((d?.outstandingPaise || 0) / 100)} <span className="text-xs font-normal text-slate-400">still owed</span>
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          withheld {inr(((d?.depositedPaise || 0) + (d?.outstandingPaise || 0)) / 100)} · deposited (net) {inr((d?.netDepositedPaise || 0) / 100)} · {(d?.revertedPaise || 0) > 0 ? `reverted ${inr((d.revertedPaise || 0) / 100)}` : 'no reverts'}
        </p>
      </div>
    );
  };

  return (
    <Card
      className="mb-5"
      title="Statutory deposits — TCS & TDS"
      subtitle="Payouts withhold TCS (GST s.52) and TDS (IT s.194-O). This pays the government — every deposit carries its UTR, sits on the tamper-evident chain, and reverts are journaled, never deleted."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
    >
      {loading && !data ? (
        <p className="text-sm text-slate-400">Loading the statutory picture…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {rowFor('tcs', 'TCS — GST s.52', 'deposit due')}
            {rowFor('tds', 'TDS — IT s.194-O', 'deposit due')}
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Field label="Statute" className="w-28!">
              <Select value={statute} onChange={(e) => setStatute(e.target.value)}>
                <option value="tcs">TCS</option>
                <option value="tds">TDS</option>
              </Select>
            </Field>
            <Field label="Amount (₹)" className="w-32!">
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Deposit UTR / reference" className="w-52!">
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="CHAVS-… / 26Q-…" />
            </Field>
            <Button icon={Banknote} loading={busy} disabled={!Number(amount) || utr.trim().length < 3} onClick={doDeposit}>
              Record deposit
            </Button>
          </div>

          {(data?.recentDeposits || []).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent deposits</p>
              <ul className="divide-y divide-slate-100">
                {data.recentDeposits.slice(0, 8).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-1.5 text-xs">
                    <Badge tone={d.status === 'reverted' ? 'slate' : 'emerald'}>{d.status}</Badge>
                    <span className="font-medium uppercase">{d.statute}</span>
                    <span className="tabular-nums font-semibold">{inr((d.amountPaise || 0) / 100)}</span>
                    <span className="font-mono text-slate-400">{d.utr}</span>
                    <span className="text-slate-400">{fmtDate(d.createdAt)}</span>
                    {d.status === 'reverted' ? (
                      <span className="text-slate-400">— {d.revertReason}</span>
                    ) : (
                      <button type="button" className="ml-auto text-slate-400 hover:text-rose-600" onClick={() => setConfirmingRevert(d.id)}>
                        <Undo2 className="h-3.5 w-3.5" /> revert
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {confirmingRevert && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">Revert this deposit?</p>
              <p className="text-xs text-slate-500">
                A reversal journal (DR bank / CR payable) is posted — the liability returns to the balance and the
                deposit stays on the trail, marked reverted with your reason.
              </p>
              <Field label="Why is this reverted?" required>
                <Input value={revertReason} onChange={(e) => setRevertReason(e.target.value)} placeholder="Recorded on the audit trail" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { setConfirmingRevert(null); setRevertReason(''); }}>Back</Button>
                <Button variant="danger" loading={busy} disabled={revertReason.trim().length < 3} onClick={doRevert}>
                  Confirm revert
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
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
        const blocked = d.blocked || 0;
        toast.success(`Eligibility swept — ${d.promoted || 0} promoted, ${d.waiting || 0} in the return window${blocked ? `, ${blocked} blocked (cash not settled — see the settlement gate)` : ''}`);
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

      <SettlementCard />

      <StatutoryCard />

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
