import { useState } from 'react';
import {
  AlertTriangle, BookOpenCheck, CheckCircle2, Landmark, Lock, LockOpen, RefreshCw, Scale, ShieldAlert, Wrench,
} from 'lucide-react';
import { inr, fmtDateTime } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const TYPE_TONE = { asset: 'sky', liability: 'amber', income: 'emerald', expense: 'rose' };

/** Human labels for the machine-readable account codes. */
function accountLabel(code) {
  const [prefix, owner] = String(code).split(':');
  const names = {
    gateway_clearing: 'Gateway clearing',
    bank: 'Settlement bank',
    platform_commission_income: 'Commission income',
    tcs_payable: 'TCS payable',
    tds_payable: 'TDS payable',
    customer_wallet_liability: 'Customer wallets',
    rounding_difference: 'Rounding difference',
    vendor_payable: 'Vendor payable',
    tenant_payable: 'Store payable',
    gst_output_payable: 'GST output payable',
    refund_clawback: 'Refund clawback',
  };
  return owner ? `${names[prefix] || prefix} · ${owner.slice(0, 8)}…` : (names[prefix] || prefix);
}

function StatementModal({ accountCode, onClose }) {
  const [page, setPage] = useState(1);
  const { data, loading } = useApi(() => api.ledger.statement({ accountCode, page, limit: 50 }), [accountCode, page]);
  const rows = data?.items || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={accountLabel(accountCode)}
      subtitle={<span className="font-mono text-xs">{accountCode}</span>}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-3">
        {data?.account && (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">Balance</span>
            <span className="text-lg font-bold tabular-nums text-slate-900">{inr(data.account.balance)}</span>
          </div>
        )}
        <Table
          loading={loading && !data}
          data={rows}
          rowKey="id"
          empty={<EmptyState icon={BookOpenCheck} title="No entries" message="Nothing has been posted to this account." />}
          columns={[
            { key: 'occurredAt', header: 'When', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.occurredAt)}</span> },
            { key: 'kind', header: 'Event', render: (r) => <span className="text-xs">{String(r.kind).replace(/_/g, ' ')}</span> },
            { key: 'memo', header: 'Memo', render: (r) => <span className="text-xs text-slate-500">{r.memo || '—'}</span> },
            { key: 'debit', header: 'Debit', align: 'right', render: (r) => (r.debit ? <span className="tabular-nums">{inr(r.debit)}</span> : <span className="text-slate-300">—</span>) },
            { key: 'credit', header: 'Credit', align: 'right', render: (r) => (r.credit ? <span className="tabular-nums">{inr(r.credit)}</span> : <span className="text-slate-300">—</span>) },
          ]}
          footer={<Pagination meta={data?.meta} onPage={setPage} />}
        />
      </div>
    </Modal>
  );
}

/** One subsystem row of the integrity report. */
function CheckRow({ name, check, detail }) {
  const okState = check?.ok === undefined ? null : !!check.ok;
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border px-3 py-2.5',
      okState === null ? 'border-slate-200 bg-white'
        : okState ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-200 bg-rose-50',
    )}>
      {okState === null
        ? <span className="mt-0.5 h-4 w-4 rounded-full border-2 border-slate-300" />
        : okState
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{name}</p>
        {detail && <p className="mt-0.5 break-words text-xs text-slate-500">{detail}</p>}
      </div>
    </div>
  );
}

function IntegrityCard() {
  const { data, loading, refetch } = useApi(() => api.ledger.integrity(), []);
  const { busy, run } = useAction();
  const report = data;
  const c = report?.checks || {};

  const replay = async () => {
    try {
      const r = await run(() => api.ledger.replay());
      if (r.data) {
        toast.success(`Replay: ${r.data.journalsReposted} journal(s) re-posted, ${r.data.eventsRestored} audit row(s) restored`);
        refetch();
      }
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const coverage = c.ledger?.eventJournalCoverage;
  const driftCount =
    (coverage?.missingJournals || 0) + (coverage?.missingEvents || 0) + (c.payouts?.missingJournals || 0);

  return (
    <Card
      className="mb-5"
      title="System integrity"
      subtitle="Cross-subsystem consistency: the journal, the audit store, the indexes, slots, payouts and webhooks — one report."
      actions={
        <>
          <Button variant="secondary" icon={RefreshCw} onClick={refetch}>Re-check</Button>
          <Button
            variant={driftCount > 0 ? 'danger' : 'secondary'}
            icon={Wrench}
            loading={busy}
            disabled={!driftCount}
            onClick={replay}
          >
            Replay{driftCount > 0 ? ` (${driftCount})` : ''}
          </Button>
        </>
      }
    >
      {loading && !report ? (
        <p className="text-sm text-slate-400">Running the checks…</p>
      ) : !report ? (
        <p className="text-sm text-slate-400">No report yet.</p>
      ) : (
        <div className="space-y-3">
          <div className={cn(
            'flex items-center gap-3 rounded-xl border px-4 py-3',
            report.overall === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50',
          )}>
            {report.overall === 'ok'
              ? <Scale className="h-5 w-5 text-emerald-600" />
              : <ShieldAlert className="h-5 w-5 text-rose-600" />}
            <div>
              <p className={cn('text-sm font-semibold', report.overall === 'ok' ? 'text-emerald-900' : 'text-rose-900')}>
                {report.overall === 'ok' ? 'All subsystems consistent' : 'DRIFT DETECTED'}
              </p>
              <p className={cn('text-xs', report.overall === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>
                {c.ledger?.ok
                  ? `${coverage?.eventsScanned ?? 0} audit events ↔ journals matched · trial ${c.ledger?.trial?.balanced ? 'balanced' : 'UNBALANCED'}`
                  : `${driftCount} posting(s) need replay`}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CheckRow name="Ledger" check={c.ledger} detail={c.ledger ? `${c.ledger.trial?.entries ?? 0} entries · trial ${c.ledger.trial?.balanced ? 'balanced' : 'unbalanced'} · ${c.ledger.balances?.ok ? 'balances match' : 'balances drifted'} · ${coverage?.missingJournals || 0} missing journals / ${coverage?.missingEvents || 0} missing audit rows` : ''} />
            <CheckRow name="Search index" check={c.searchIndex} detail={c.searchIndex ? `${c.searchIndex.indexedDocuments} indexed · ${c.searchIndex.missing} listing(s) not in index · ${c.searchIndex.orphanDocuments} orphan doc(s)` : ''} />
            <CheckRow name="Delivery slots" check={c.slots} detail={c.slots ? `${c.slots.checked} slot(s) checked · ${c.slots.overReserved} over-reservation(s)` : ''} />
            <CheckRow name="Payments & webhooks" check={c.payments} detail={c.payments ? `${c.payments.total} webhook event(s) · ${c.payments.processed} processed · ${c.payments.duplicate} duplicate · ${c.payments.mismatches} mismatch(es)` : ''} />
            <CheckRow name="Payouts" check={c.payouts} detail={c.payouts ? `${c.payouts.batchesChecked} batch(es) · ${c.payouts.missingJournals} missing payout journal(s)` : ''} />
            <CheckRow name="Audit event store" check={c.events} detail={c.events ? `${c.events.total} events · newest ${c.events.newestOccurredAt ? fmtDateTime(c.events.newestOccurredAt) : '—'}` : ''} />
            <CheckRow name="Notifications" check={c.notifications} detail={c.notifications ? `${c.notifications.pending} pending · oldest ${Math.round((c.notifications.oldestPendingAgeMs || 0) / 60000)} min · ${c.notifications.deadLetters} dead-lettered` : ''} />
            <CheckRow name="Audit chain (tamper-evidence)" check={c.auditChain} detail={c.auditChain ? `${c.auditChain.eventsVerified} event(s) re-hashed · ${c.auditChain.unanchored} unanchored · ${c.auditChain.breaks.length} break(s)` : ''} />
            {c.auditChain?.breaks?.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 sm:col-span-2">
                <p className="text-xs font-semibold text-rose-900">Chain breaks — the audit log does not verify. Investigate; a rebuild re-links the chain but is itself recorded.</p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-rose-800">
                  {c.auditChain.breaks.slice(0, 8).map((b, i) => (
                    <li key={i}>seq {b.seq}: {b.type}{b.idempotencyKey ? ` — ${b.idempotencyKey}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {coverage?.samples?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">Drift samples</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-800">
                {coverage.samples.slice(0, 8).map((s, i) => (
                  <li key={i} className="truncate">
                    {s.type === 'journal_missing' ? 'journal' : 'event'} {s.kind}: <span className="text-amber-600">{s.idempotencyKey}</span>
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

function PeriodReport({ periodKey, onClose }) {
  const { data, loading } = useApi(() => api.ledger.periodReport(periodKey), [periodKey]);
  if (loading && !data) return <p className="text-xs text-slate-400">Reading the period from the journal…</p>;
  if (!data) return null;
  const kindLabel = {
    sale_captured: 'Sales captured', refund_issued: 'Refunds issued',
    payout_initiated: 'Payouts initiated', payout_reversed: 'Payouts reversed',
  };
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">Period {periodKey} — from the journal</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">close</button>
      </div>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
        <div><p className="text-[11px] uppercase text-slate-400">Gross captured</p><p className="font-semibold text-slate-900">{inr(data.grossCapturedPaise)}</p></div>
        <div><p className="text-[11px] uppercase text-slate-400">Refunds</p><p className="font-semibold text-slate-900">{inr(data.refundsPaise)}</p></div>
        <div><p className="text-[11px] uppercase text-slate-400">Net captured</p><p className={cn('font-semibold', data.netCapturedPaise < 0 ? 'text-rose-600' : 'text-slate-900')}>{inr(data.netCapturedPaise)}</p></div>
        <div><p className="text-[11px] uppercase text-slate-400">Payouts out</p><p className="font-semibold text-slate-900">{inr(data.payoutsInitiatedPaise)}{data.payoutsReversedPaise ? ` (−${inr(data.payoutsReversedPaise)} reversed)` : ''}</p></div>
        <div><p className="text-[11px] uppercase text-slate-400">Journals</p><p className="font-semibold text-slate-900">{data.journals} · {data.periodBalanced ? 'balanced' : 'UNBALANCED'}</p></div>
      </div>
      {Object.keys(data.byKind || {}).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
          {Object.entries(data.byKind).map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span>{kindLabel[k] || k}</span>
              <span className="tabular-nums">{v.count} · {inr(v.totalPaise)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PeriodsCard() {
  const { data, loading, refetch } = useApi(() => api.ledger.periods(), []);
  const { busy, run } = useAction();
  const [open, setOpen] = useState(null);
  const items = data?.items || [];

  const act = async (periodKey, fn, verb) => {
    try {
      await run(fn);
      toast.success(`${verb} ${periodKey}`);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Card
      className="mb-5"
      title="Fiscal periods"
      subtitle="Close a month to freeze its books — the ledger refuses new journals dated inside it until it is reopened."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
    >
      {loading && !data ? (
        <p className="text-sm text-slate-400">Loading periods…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">No periods recorded yet. Closing the current month creates the record and freezes its books.</p>
          <Button variant="danger" icon={Lock} loading={busy}
            onClick={() => act(new Date().toISOString().slice(0, 7), () => api.ledger.closePeriod(new Date().toISOString().slice(0, 7)), 'Closed')}>
            Close current month
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => {
            const closed = p.state === 'closed';
            return (
              <div key={p.id || p.periodKey}>
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  {closed ? <Lock className="h-4 w-4 shrink-0 text-rose-500" /> : <LockOpen className="h-4 w-4 shrink-0 text-emerald-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{p.periodKey} <Badge tone={closed ? 'rose' : 'emerald'}>{closed ? 'closed' : 'open'}</Badge></p>
                    <p className="text-[11px] text-slate-400">
                      {closed ? `closed ${fmtDateTime(p.closedAt)}` : 'accepting postings'}
                      {p.reopenedAt ? ` · reopened ${fmtDateTime(p.reopenedAt)}` : ''}
                    </p>
                  </div>
                  <Button variant="secondary" icon={open === p.periodKey ? null : BookOpenCheck} onClick={() => setOpen(open === p.periodKey ? null : p.periodKey)}>
                    Report
                  </Button>
                  {closed ? (
                    <Button variant="secondary" icon={LockOpen} loading={busy}
                      onClick={() => act(p.periodKey, () => api.ledger.reopenPeriod(p.periodKey), 'Reopened')}>
                      Reopen
                    </Button>
                  ) : (
                    <Button variant="danger" icon={Lock} loading={busy}
                      onClick={() => act(p.periodKey, () => api.ledger.closePeriod(p.periodKey), 'Closed')}>
                      Close
                    </Button>
                  )}
                </div>
                {open === p.periodKey && <PeriodReport periodKey={p.periodKey} onClose={() => setOpen(null)} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function LedgerPage() {
  const [selected, setSelected] = useState(null);
  const { data: accounts, loading, refetch } = useApi(() => api.ledger.accounts(), []);
  const { data: trial, refetch: refetchTrial } = useApi(() => api.ledger.trialBalance(), []);
  const { busy, run } = useAction();
  const [drift, setDrift] = useState(null);

  const verify = async (repair) => {
    try {
      const r = await run(() => api.ledger.verify({ repair }));
      setDrift(r.data);
      if (r.data?.ok) toast.success('No drift — the materialized balances match the entries exactly');
      else if (repair) toast.success(`Repaired ${r.data.repaired} account(s) from the journal`);
      else toast.error(`${r.data.drifted.length} account(s) drifted`);
      refetch();
      refetchTrial();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const balanced = trial?.balanced;

  return (
    <div>
      <PageHeader
        title="Ledger"
        description="Every rupee the platform holds, owes or has earned — derived from the journal, never typed in."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={() => verify(false)}>Check drift</Button>
            <Button variant="secondary" icon={Wrench} loading={busy} onClick={() => verify(true)}>Verify &amp; repair</Button>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-4',
          balanced === undefined ? 'border-slate-200 bg-white'
            : balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
        )}
        >
          {balanced ? <Scale className="h-6 w-6 text-emerald-600" /> : <ShieldAlert className="h-6 w-6 text-rose-600" />}
          <div>
            <p className={cn('text-sm font-semibold', balanced ? 'text-emerald-900' : 'text-rose-900')}>
              {balanced === undefined ? 'Checking…' : balanced ? 'Trial balance holds' : 'LEDGER IS UNBALANCED'}
            </p>
            <p className={cn('text-xs', balanced ? 'text-emerald-700' : 'text-rose-700')}>
              {trial
                ? `${inr(trial.totalDebit)} debits vs ${inr(trial.totalCredit)} credits across ${trial.entries} entries`
                : '—'}
            </p>
          </div>
        </div>

        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-4',
          !drift ? 'border-slate-200 bg-white' : drift.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
        )}
        >
          <CheckCircle2 className={cn('h-6 w-6', !drift ? 'text-slate-300' : drift.ok ? 'text-emerald-600' : 'text-amber-600')} />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {!drift ? 'Drift not checked yet' : drift.ok ? 'No drift' : `${drift.drifted.length} account(s) drifted`}
            </p>
            <p className="text-xs text-slate-600">
              {drift
                ? `${drift.checked} accounts recomputed from the entries${drift.repaired ? `, ${drift.repaired} repaired` : ''}`
                : 'Compares the fast balances against a full recompute of the journal.'}
            </p>
          </div>
        </div>
      </div>

      <IntegrityCard />

      <PeriodsCard />

      {drift && !drift.ok && (
        <Card className="mb-5 ring-1 ring-amber-200" title="Drifted accounts" subtitle="The journal is the truth — repair rewrites the view from it.">
          <ul className="space-y-1 text-sm">
            {drift.drifted.map((d) => (
              <li key={d.accountCode} className="flex justify-between font-mono text-xs">
                <span>{d.accountCode}</span>
                <span className="text-amber-700">{d.driftPaise > 0 ? '+' : ''}{(d.driftPaise / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card bodyClassName="p-0!">
        <Table
          loading={loading && !accounts}
          data={accounts || []}
          rowKey="accountCode"
          onRowClick={(r) => setSelected(r.accountCode)}
          empty={<EmptyState icon={Landmark} title="No accounts yet" message="Accounts appear as soon as the first order is confirmed." />}
          columns={[
            { key: 'accountCode', header: 'Account', render: (r) => (
              <div>
                <span className="font-medium text-slate-800">{accountLabel(r.accountCode)}</span>
                <span className="block font-mono text-[11px] text-slate-400">{r.accountCode}</span>
              </div>
            ) },
            { key: 'type', header: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> },
            { key: 'debit', header: 'Debits', align: 'right', render: (r) => <span className="tabular-nums text-slate-500">{inr(r.debit)}</span> },
            { key: 'credit', header: 'Credits', align: 'right', render: (r) => <span className="tabular-nums text-slate-500">{inr(r.credit)}</span> },
            { key: 'balance', header: 'Balance', align: 'right', render: (r) => (
              <span className={cn('font-semibold tabular-nums', r.balance < 0 ? 'text-rose-600' : 'text-slate-900')}>{inr(r.balance)}</span>
            ) },
            { key: 'entryCount', header: 'Entries', align: 'right', render: (r) => <span className="text-xs text-slate-400">{r.entryCount}</span> },
          ]}
        />
      </Card>

      {selected && <StatementModal accountCode={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
