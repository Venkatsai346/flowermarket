import { useState } from 'react';
import { PackageSearch, RefreshCw, Search, SearchX, ShieldCheck } from 'lucide-react';
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
import ReturnDetailDrawer from './ReturnDetailDrawer.jsx';
import { RETURN_CLAIM_TYPE_META, RETURN_FILTERS, RETURN_STATUS_META } from './aftersalesMeta.js';

export default function ReturnsPanel({ refreshKey = 0 }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [orderId, setOrderId] = useState('');
  const [selected, setSelected] = useState(null);
  const { data, meta, loading, refetch } = useApi(
    () => api.fulfillment.returns({
      page,
      limit: 15,
      status: status || undefined,
      orderId: orderId || undefined,
    }),
    [page, status, orderId, refreshKey],
  );

  return (
    <div>
      <Card
        title="Return requests"
        subtitle="Pickup+QC and instant claims, all in one queue."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
        bodyClassName="p-0!"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Filter by order id…" value={orderId} onChange={(e) => { setOrderId(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-56!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {RETURN_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id || r._id)}
          empty={<EmptyState icon={PackageSearch} title="No return requests" message="Customer return claims appear here." />}
          columns={[
            { key: 'id', header: 'Return', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.id || r._id}</span> },
            { key: 'orderId', header: 'Order', render: (r) => <span className="font-mono text-xs text-slate-600">{r.orderId}</span> },
            { key: 'claimType', header: 'Claim', render: (r) => <Badge tone={pickMeta(RETURN_CLAIM_TYPE_META, r.claimType).tone}>{pickMeta(RETURN_CLAIM_TYPE_META, r.claimType).label}</Badge> },
            { key: 'reason', header: 'Reason', render: (r) => <span className="block max-w-[220px] truncate">{r.reason || '—'}</span> },
            { key: 'refundAmount', header: 'Refund', align: 'right', render: (r) => <span className="font-semibold">{inr(r.refundAmount)}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(RETURN_STATUS_META, r.status).tone} dot>{pickMeta(RETURN_STATUS_META, r.status).label}</Badge> },
            { key: 'createdAt', header: 'Requested', render: (r) => fmtDateTime(r.createdAt) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-sky-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Instant claims are fraud-guarded by the backend and refund directly to the customer wallet. Pickup+QC claims require physical pickup before a QC decision.</p>
      </div>

      {selected && <ReturnDetailDrawer returnId={selected} onClose={() => setSelected(null)} onChanged={refetch} />}
    </div>
  );
}
