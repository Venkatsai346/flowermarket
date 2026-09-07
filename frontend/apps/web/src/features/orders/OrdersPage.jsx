import { useState } from 'react';
import { Banknote, Boxes, Eye, FileText, RefreshCw, Route, Search, SearchX, ShoppingCart } from 'lucide-react';
import { fmtDateTime, inr, num, pickMeta, ORDER_STATUS_META } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['confirmed', 'Confirmed'],
  ['picking', 'Picking'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
  ['return_requested', 'Return requested'],
];

/** Phase 10 — "follow the money": every fact about this order's trace,
 *  in time order, from the audit backbone. */
function TraceTimeline({ traceId }) {
  const { data, loading } = useApi(() => api.admin.trace(traceId), [traceId]);
  if (loading && !data) return <p className="text-xs text-slate-400">Assembling the money trail…</p>;
  if (!data) return null;
  const chain = data.chain || [];
  if (chain.length === 0) return <p className="text-xs text-slate-400">No steps recorded on this trace.</p>;
  const iconFor = (kind) => {
    if (kind.startsWith('journal.')) return Banknote;
    if (kind.startsWith('event.')) return FileText;
    if (kind === 'order.created') return ShoppingCart;
    return Boxes;
  };
  const labelFor = (s) => {
    const kind = s.kind;
    if (kind === 'order.created') return 'Order placed';
    if (kind.startsWith('order.status.')) return `Status → ${kind.slice('order.status.'.length)}`;
    if (kind === 'order.paid') return 'Payment confirmed';
    if (kind === 'payment.created') return `Payment · ${s.detail || ''}`;
    if (kind.startsWith('journal.')) return `Journal · ${kind.slice('journal.'.length)}`;
    if (kind.startsWith('event.')) return `Audit event · ${kind.slice('event.'.length)}`;
    if (kind.startsWith('payout.')) return `Payout · ${s.detail || ''}`;
    return kind;
  };
  return (
    <div>
      <p className="label flex items-center gap-1.5">
        <Route className="h-3.5 w-3.5" /> Follow the money
        <span className="ml-1 font-mono text-[10px] text-slate-400">{traceId}</span>
      </p>
      <ol className="mt-2 space-y-0">
        {chain.map((s, i) => {
          const Icon = iconFor(s.kind);
          return (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {i < chain.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />}
              <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
                <Icon className="h-3 w-3 text-slate-500" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{labelFor(s)}</p>
                <p className="text-[11px] text-slate-400">
                  {fmtDateTime(s.at)}
                  {s.paise ? ` · ${inr(s.paise)}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function OrderDetail({ orderId, onClose }) {
  const { data, loading, error } = useApi(() => api.admin.order(orderId), [orderId]);
  if (loading) return <Modal open onClose={onClose} title="Order"><LoadingBlock compact /></Modal>;
  const o = data || {};
  const order = o.order || o; // detail endpoint nests the order doc
  const items = o.items || o.orderItems || [];
  return (
    <Modal open onClose={onClose} title={`Order ${order.orderNumber || ''}`} subtitle={`Placed ${fmtDateTime(order.createdAt)}`} size="lg">
      {error ? (
        <p className="text-sm text-rose-600">{error.message}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
              <div className="mt-1">
                <Badge tone={pickMeta(ORDER_STATUS_META, order.status).tone}>{pickMeta(ORDER_STATUS_META, order.status).label}</Badge>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Customer</p>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{order.customerName || order.addressSnapshot?.name || '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Payment</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{order.paymentMethod || '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Total</p>
              <p className="mt-0.5 text-sm font-bold text-slate-900">{inr(order.totalAmount)}</p>
            </div>
          </div>

          <div>
            <p className="label">Items</p>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Price</th>
                    <th className="px-3 py-2 text-right font-semibold">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(items.length ? items : []).map((it, i) => (
                    <tr key={it.id || i}>
                      <td className="px-3 py-2 text-slate-800">{it.skuSnapshot?.title || it.title || 'Item'}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{num(it.qty)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{inr(it.priceAtOrder?.sellingPrice ?? it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{inr(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
            <Row label="Items subtotal" value={inr(order.itemsSubtotal)} />
            <Row label="Delivery fee" value={inr(order.deliveryFee)} />
            <Row label="Discount" value={`− ${inr(order.discount)}`} />
            <Row label="Tax (GST)" value={inr(order.taxAmount)} />
            <div className="mt-2! flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total</span><span>{inr(order.totalAmount)}</span>
            </div>
          </div>

          {order.slotSnapshot && (
            <p className="text-xs text-slate-400">
              Slot: {order.slotSnapshot.date} {order.slotSnapshot.startTime}–{order.slotSnapshot.endTime}
              {order.slotSnapshot.hubId ? ` · hub ${order.slotSnapshot.hubId}` : ''}
            </p>
          )}

          {order.traceId && <TraceTimeline traceId={order.traceId} />}
        </div>
      )}
    </Modal>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between text-slate-600">
    <span>{label}</span>
    <span className="font-medium text-slate-800">{value}</span>
  </div>
);

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [limit] = useState(20);

  const { data, meta, loading, refetch } = useApi(
    () => api.admin.orders({ page, limit, search: search || undefined, status: status || undefined }),
    [page, search, status]
  );

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every order placed in your store."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
      />
      <Card bodyClassName="p-0!">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Search order number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-48!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={SearchX} title="No orders found" message="Orders appear here after checkout." />}
          columns={[
            { key: 'orderNumber', header: 'Order', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.orderNumber}</span> },
            { key: 'customer', header: 'Customer', render: (r) => r.customerName || r.addressSnapshot?.name || '—' },
            { key: 'items', header: 'Items', align: 'right', render: (r) => num(r.itemsCount ?? 0) },
            { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.totalAmount)}</span> },
            { key: 'payment', header: 'Payment', render: (r) => <span className="capitalize">{r.paymentMethod || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(ORDER_STATUS_META, r.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'createdAt', header: 'Placed', render: (r) => fmtDateTime(r.createdAt) },
            { key: 'view', header: '', align: 'right', render: () => <Eye className="ml-auto h-4 w-4 text-slate-300" /> },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>
      {selected && <OrderDetail orderId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
