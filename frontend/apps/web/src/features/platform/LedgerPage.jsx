import { useState } from 'react';
import {
  BookOpenCheck, CheckCircle2, Landmark, RefreshCw, Scale, ShieldAlert, Wrench,
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
