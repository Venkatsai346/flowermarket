import { useState } from 'react';
import { RefreshCw, Timer, Truck } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Stat from '../../components/ui/Stat.jsx';
import { RIDER_AVAILABILITY_META, statsDuration } from './userMeta.js';

export default function RiderStatsPanel() {
  const [from, setFrom] = useState(statsDuration(30));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const { data, loading, refetch } = useApi(
    () => api.admin.riderStats({ from, to }),
    [from, to],
  );

  const rows = data || [];
  const delivered = rows.reduce((s, r) => s + (Number(r.delivered) || 0), 0);
  const rejections = rows.reduce((s, r) => s + (Number(r.rejections) || 0), 0);
  const avgSeconds = rows.reduce((s, r) => s + (Number(r.avgDeliverySeconds) || 0), 0) / Math.max(1, rows.filter((r) => r.avgDeliverySeconds).length);

  return (
    <Card
      title="Rider delivery"
      subtitle="Per-rider throughput over the selected window."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
      bodyClassName="p-0!"
    >
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
        <Stat label="Riders" value={rows.length} icon={Truck} tone="sky" />
        <Stat label="Delivered" value={delivered} sub="in window" icon={Truck} tone="emerald" />
        <Stat label="Rejections" value={rejections} sub="lifetime per rider" icon={Truck} tone="rose" />
        <Stat label="Avg delivery" value={avgSeconds ? `${Math.round(avgSeconds / 60)}m` : '—'} sub="from assigned to delivered" icon={Timer} tone="amber" />
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Table
        loading={loading && !data}
        data={rows}
        rowKey="riderId"
        empty={<EmptyState icon={Truck} title="No riders" message="Create rider staff accounts to start assigning deliveries." />}
        columns={[
          { key: 'name', header: 'Rider', render: (r) => <span className="font-medium text-slate-800">{r.name || 'Unnamed'} <span className="font-mono text-xs text-slate-400">{String(r.riderId).slice(-8)}</span></span> },
          { key: 'availability', header: 'Availability', render: (r) => <Badge tone={pickMeta(RIDER_AVAILABILITY_META, r.availability).tone} dot>{pickMeta(RIDER_AVAILABILITY_META, r.availability).label}</Badge> },
          { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'emerald' : r.status === 'blocked' ? 'rose' : 'slate'}>{r.status}</Badge> },
          { key: 'delivered', header: 'Delivered', align: 'right' },
          { key: 'rejections', header: 'Rejections', align: 'right', render: (r) => <span className={r.rejections > 3 ? 'font-semibold text-rose-600' : ''}>{r.rejections || 0}</span> },
          { key: 'avg', header: 'Avg delivery', align: 'right', render: (r) => r.avgDeliverySeconds ? `${Math.round(r.avgDeliverySeconds / 60)}m` : '—' },
          { key: 'timeLogs', header: 'Time logs', align: 'right' },
        ]}
      />

      <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        Last refresh {fmtDateTime(new Date())} · times from fulfillment time logs delivered in this window.
      </div>
    </Card>
  );
}
