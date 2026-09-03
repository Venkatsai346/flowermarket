import { useState } from 'react';
import { Banknote, RefreshCw, Search, SearchX } from 'lucide-react';
import { fmtDateTime, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Stat from '../../components/ui/Stat.jsx';
import OpsPaymentDrawer from './OpsPaymentDrawer.jsx';
import { PAYMENT_METHOD_META, PAYMENT_STATUS_META } from './opsMeta.js';

const FILTERS = [
  ['', 'All statuses'],
  ['pending', 'Pending'],
  ['success', 'Success'],
  ['failed', 'Failed'],
  ['refunded', 'Refunded'],
  ['partially_refunded', 'Partially refunded'],
];

export default function PaymentsPanel({ refreshKey = 0 }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [orderId, setOrderId] = useState('');
  const [selected, setSelected] = useState(null);
  const action = useAction();

  const { data, meta, loading, refetch } = useApi(
    () => api.fulfillment.payments({
      page,
      limit: 15,
      status: status || undefined,
      orderId: orderId || undefined,
    }),
    [page, status, orderId, refreshKey],
  );

  const { data: counts, refetch: refetchCounts } = useApi(
    () => Promise.all([
      api.fulfillment.payments({ status: 'pending', page: 1, limit: 1 }),
      api.fulfillment.payments({ status: 'success', page: 1, limit: 1 }),
      api.fulfillment.payments({ status: 'failed', page: 1, limit: 1 }),
      api.fulfillment.payments({ status: 'refunded', page: 1, limit: 1 }),
    ]),
    [refreshKey],
  );

  const reconcile = async () => {
    try {
      const r = await action.run(() => api.fulfillment.reconcilePayments({ limit: 50 }));
      toast.success(r.message || 'Payment reconciliation complete');
      refetch();
      refetchCounts();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const total = (i) => counts?.[i]?.meta?.total || 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Pending" value={total(0)} sub="needs reconcile/action" tone="amber" />
        <Stat label="Success" value={total(1)} sub="captured" tone="emerald" />
        <Stat label="Failed" value={total(2)} sub="held for review" tone="rose" />
        <Stat label="Refunded" value={total(3)} sub="closed out" tone="slate" />
      </div>

      <Card
        title="Payments"
        subtitle="Order payments, wallet debits and reconciliation."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => { refetch(); refetchCounts(); }}>Refresh</Button>
            <Button variant="primary" icon={Banknote} loading={action.busy} onClick={reconcile}>Reconcile pending</Button>
          </>
        }
        bodyClassName="p-0!"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Payment by order id…" value={orderId} onChange={(e) => { setOrderId(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-56!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          rowKey="_id"
          onRowClick={(r) => setSelected({ ...r, id: r._id })}
          empty={<EmptyState icon={SearchX} title="No payments found" message="Payments appear here after checkout." />}
          columns={[
            { key: 'orderId', header: 'Order', render: (r) => <span className="font-mono text-xs text-slate-700">{r.orderId}</span> },
            { key: 'userId', header: 'Customer', render: (r) => r.userId || '—' },
            { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{inr(r.amount)}</span> },
            { key: 'method', header: 'Method', render: (r) => <Badge tone={pickMeta(PAYMENT_METHOD_META, r.method).tone}>{pickMeta(PAYMENT_METHOD_META, r.method).label}</Badge> },
            { key: 'provider', header: 'Provider', render: (r) => <span className="capitalize">{r.provider || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(PAYMENT_STATUS_META, r.status).tone} dot>{pickMeta(PAYMENT_STATUS_META, r.status).label}</Badge> },
            { key: 'createdAt', header: 'Created', render: (r) => fmtDateTime(r.createdAt) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {selected && <OpsPaymentDrawer payment={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
