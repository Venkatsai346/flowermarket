import { useState } from 'react';
import { Banknote, Clock, Download, Eye, HandCoins, Hourglass, PauseCircle } from 'lucide-react';
import { inr, fmtDate } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PayoutWaterfall, PayoutLines, PayoutFacts } from './PayoutBreakdown.jsx';
import { PAYOUT_STATE_META } from './payoutMeta.js';

function StateBadge({ state }) {
  const m = PAYOUT_STATE_META[state] || { label: state, tone: 'slate' };
  const Icon = m.icon;
  return <Badge tone={m.tone}>{Icon && <Icon className="h-3 w-3" />}{m.label}</Badge>;
}

/**
 * The vendor's statement. This screen exists to turn "why is my payout less
 * than my sales?" from a support ticket into a self-serve answer, so the
 * deduction waterfall is the first thing shown, not the last.
 */
function StatementModal({ batchId, onClose }) {
  const { data, loading } = useApi(() => api.payouts.me.statement(batchId), [batchId]);
  const batch = data?.batch;

  const download = () => {
    const lines = data?.lines || [];
    const head = ['Order', 'Gross', 'Taxable', 'Your GST', 'Commission %', 'Commission', 'GST on commission', 'TCS', 'TDS', 'Net'];
    const rows = lines.map((l) => [
      l.orderNumber, l.gross, l.taxableValue, l.sellerGst, l.commissionRatePct,
      l.commission, l.gstOnCommission, l.tcs, l.tds, l.netPayable,
    ]);
    const csv = `\uFEFF${[head, ...rows].map((r) => r.join(',')).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${batch?.batchNumber || 'payout'}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={batch ? `Payout ${batch.batchNumber}` : 'Payout'}
      subtitle={batch ? `${inr(batch.rupees?.net)} · ${PAYOUT_STATE_META[batch.state]?.label}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="secondary" icon={Download} onClick={download} disabled={!data?.lines?.length}>
            Download CSV
          </Button>
        </>
      }
    >
      {loading && !batch ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : !batch ? (
        <p className="py-8 text-center text-sm text-slate-400">Not found.</p>
      ) : (
        <div className="space-y-4">
          <StateBadge state={batch.state} />
          <PayoutFacts batch={batch} />
          <PayoutWaterfall rupees={batch.rupees} />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {data.lines?.length || 0} order line{data.lines?.length === 1 ? '' : 's'}
            </p>
            <PayoutLines lines={data.lines} />
          </div>
          {(data.adjustments || []).length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <p className="mb-1 font-semibold text-amber-900">Adjustments</p>
              {data.adjustments.map((a, i) => (
                <p key={i} className="text-amber-800">
                  {a.reasonCode.replace(/_/g, ' ')}: {inr(a.amount)}{a.note ? ` — ${a.note}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function VendorPayoutsPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const { data, meta, loading } = useApi(() => api.payouts.me.list({ page, limit: 20 }), [page]);
  const { data: upcoming } = useApi(() => api.payouts.me.upcoming(), []);

  return (
    <div>
      <PageHeader title="My payouts" description="What you have been paid, and what is on the way." />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Ready for the next cycle"
          value={inr(upcoming?.eligible?.amount || 0)}
          sub={`${upcoming?.eligible?.lines || 0} order lines cleared`}
          icon={HandCoins}
          tone="emerald"
        />
        <Stat
          label="Still in the return window"
          value={inr(upcoming?.accruing?.amount || 0)}
          sub={`${upcoming?.accruing?.lines || 0} lines · paid out once the window closes`}
          icon={Hourglass}
          tone="sky"
        />
        <Stat
          label="On hold"
          value={inr(upcoming?.onHold?.amount || 0)}
          sub={`${upcoming?.onHold?.lines || 0} lines under review`}
          icon={PauseCircle}
          tone="amber"
        />
      </div>

      <Card bodyClassName="p-0!">
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id)}
          empty={(
            <EmptyState
              icon={Banknote}
              title="No payouts yet"
              message="Your earnings appear here once delivered orders clear their return window."
            />
          )}
          columns={[
            { key: 'batchNumber', header: 'Batch', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.batchNumber}</span> },
            { key: 'cycle', header: 'Period', render: (r) => <span className="text-xs text-slate-600">{fmtDate(r.cycle?.from)} → {fmtDate(r.cycle?.to)}</span> },
            { key: 'lineItemCount', header: 'Orders', align: 'right', render: (r) => r.lineItemCount ?? 0 },
            { key: 'net', header: 'Amount', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{inr(r.net)}</span> },
            { key: 'state', header: 'Status', render: (r) => <StateBadge state={r.state} /> },
            { key: 'settledAt', header: 'Settled', render: (r) => (r.settledAt ? fmtDate(r.settledAt) : <span className="text-slate-300">—</span>) },
            { key: 'view', header: '', align: 'right', render: () => <Eye className="ml-auto h-4 w-4 text-slate-300" /> },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Clock className="h-3.5 w-3.5" />
        Earnings become payable after the customer&apos;s return window closes — 7 days for most items, 1 day for perishables.
      </p>

      {selected && <StatementModal batchId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
