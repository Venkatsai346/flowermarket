import { useState } from 'react';
import { RefreshCw, Search, SearchX, Truck } from 'lucide-react';
import { fmtDateTime, inr, num, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { OPS_ORDER_STATUS_META } from './opsMeta.js';

const FILTERS = [
  ['', 'All delivery'],
  ['packed', 'Packed (to dispatch)'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivery_failed', 'Delivery failed'],
  ['delivered', 'Delivered'],
];

export default function DeliveryQueue({ refreshKey = 0, onOpen }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { data, meta, loading, refetch } = useApi(
    () => api.fulfillment.listAll({
      page,
      limit: 15,
      search: search || undefined,
      status: status || undefined,
    }),
    [page, search, status, refreshKey],
  );

  return (
    <Card
      title="Delivery queue"
      subtitle="Dispatch, POD capture, failures and retries."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
      bodyClassName="p-0!"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9!" placeholder="Search order number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select className="w-56!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <Table
        loading={loading && !data}
        data={data || []}
        onRowClick={onOpen}
        empty={<EmptyState icon={SearchX} title="No delivery work" message="Packed orders and active deliveries will appear here." />}
        columns={[
          { key: 'orderNumber', header: 'Order', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.orderNumber}</span> },
          { key: 'customer', header: 'Customer', render: (r) => r.customerName || r.addressSnapshot?.name || '—' },
          { key: 'pincode', header: 'Pincode', render: (r) => r.addressSnapshot?.pincode || '—' },
          { key: 'items', header: 'Items', align: 'right', render: (r) => num(r.itemsCount) },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.totalAmount)}</span> },
          { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(OPS_ORDER_STATUS_META, r.status).tone} dot>{pickMeta(OPS_ORDER_STATUS_META, r.status).label}</Badge> },
          { key: 'placed', header: 'Placed', render: (r) => fmtDateTime(r.createdAt) },
        ]}
        footer={<Pagination meta={meta} onPage={setPage} />}
      />
    </Card>
  );
}
