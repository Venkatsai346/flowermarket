import { useState } from 'react';
import { Banknote, RefreshCw, Search, SearchX } from 'lucide-react';
import { fmtDateTime, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Stat from '../../components/ui/Stat.jsx';
import ManualRefundModal from './ManualRefundModal.jsx';
import {
  REFUND_DESTINATION_META, REFUND_FILTERS, REFUND_REASON_META, REFUND_STATUS_META,
} from './aftersalesMeta.js';

export default function RefundsPanel({ refreshKey = 0 }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [orderId, setOrderId] = useState('');
  const [showManual, setShowManual] = useState(false);

  const { data, meta, loading, refetch } = useApi(
    () => api.fulfillment.refunds({
      page,
      limit: 15,
      status: status || undefined,
      orderId: orderId || undefined,
    }),
    [page, status, orderId, refreshKey],
  );

  const { data: counts, refetch: refetchCounts } = useApi(
    () => Promise.all([
      api.fulfillment.refunds({ status: 'pending', page: 1, limit: 1 }),
      api.fulfillment.refunds({ status: 'success', page: 1, limit: 1 }),
      api.fulfillment.refunds({ status: 'failed', page: 1, limit: 1 }),
    ]),
    [refreshKey],
  );

  const count = (i) => counts?.[i]?.meta?.total || 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pending" value={count(0)} sub="awaiting completion" tone="amber" />
        <Stat label="Success" value={count(1)} sub="settled" tone="emerald" />
        <Stat label="Failed" value={count(2)} sub="needs review" tone="rose" />
      </div>

      <Card
        title="Refunds"
        subtitle="Return/instant-claim refunds plus admin overrides."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => { refetch(); refetchCounts(); }}>Refresh</Button>
            <Button variant="primary" icon={Banknote} onClick={() => setShowManual(true)}>Manual refund</Button>
          </>
        }
        bodyClassName="p-0!"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Refund by order id…" value={orderId} onChange={(e) => { setOrderId(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-56!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {REFUND_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          empty={<EmptyState icon={SearchX} title="No refunds found" message="Refunds appear here once initiated." />}
          columns={[
            { key: 'orderId', header: 'Order', render: (r) => <span className="font-mono text-xs text-slate-700">{r.orderId}</span> },
            { key: 'userId', header: 'Customer', render: (r) => r.userId || '—' },
            { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{inr(r.amount)}</span> },
            { key: 'destination', header: 'Destination', render: (r) => <Badge tone={pickMeta(REFUND_DESTINATION_META, r.destination).tone}>{pickMeta(REFUND_DESTINATION_META, r.destination).label}</Badge> },
            { key: 'reason', header: 'Reason', render: (r) => <Badge tone={pickMeta(REFUND_REASON_META, r.reason).tone}>{pickMeta(REFUND_REASON_META, r.reason).label}</Badge> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(REFUND_STATUS_META, r.status).tone} dot>{pickMeta(REFUND_STATUS_META, r.status).label}</Badge> },
            { key: 'createdAt', header: 'Initiated', render: (r) => fmtDateTime(r.initiatedAt || r.createdAt) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {showManual && <ManualRefundModal onClose={() => setShowManual(false)} onCreated={() => { refetch(); refetchCounts(); }} />}
    </div>
  );
}
