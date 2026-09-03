import { useState } from 'react';
import { CalendarDays, Gauge, RefreshCw } from 'lucide-react';
import { pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import SlotCapacityModal from './SlotCapacityModal.jsx';
import { SLOT_STATUS_META, SLOT_WINDOW_META, fmtPct } from '../inventory/inventoryMeta.js';

const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function SlotsPanel({ hubs = [], hubId = '', onHubChange }) {
  const action = useAction();
  const setHubId = (next) => onHubChange?.(next);
  const [from, setFrom] = useState(daysAgoISO(0));
  const [to, setTo] = useState(todayISO());
  const [refreshKey, setRefreshKey] = useState(0);
  const [overrideSlot, setOverrideSlot] = useState(null);
  const { data: slotRows, loading, refetch } = useApi(
    () => api.admin.slots({ hubId: hubId || undefined, from, to }),
    [hubId, from, to, refreshKey],
  );
  const { data: utilization } = useApi(
    () => api.admin.slotsUtilization({ hubId: hubId || undefined, from, to }),
    [hubId, from, to, refreshKey],
  );

  const refresh = () => setRefreshKey((k) => k + 1);
  const setStatus = async (slot, status) => {
    try {
      await action.run(() => api.admin.setSlotStatus(slot.id || slot._id, { status }));
      toast.success(`Slot ${status}`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const totalCapacity = (utilization || []).reduce((s, u) => s + (Number(u.capacity) || 0), 0);
  const totalReserved = (utilization || []).reduce((s, u) => s + (Number(u.reserved) || 0), 0);
  const fillRate = totalCapacity ? totalReserved / totalCapacity : 0;

  return (
    <Card
      title="Delivery slots"
      subtitle="Intraday capacity and open/close control."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
      bodyClassName="p-0!"
    >
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-4 py-3 sm:grid-cols-4">
        <Field label="Hub">
          <Select value={hubId} onChange={(e) => setHubId(e.target.value)}>
            <option value="">All hubs</option>
            {hubs.map((h) => <option key={rid(h)} value={rid(h)}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="flex items-end rounded-xl bg-slate-50 p-3">
          <div className="w-full">
            <p className="text-[11px] font-semibold uppercase text-slate-400">Fill</p>
            <p className="text-lg font-bold text-slate-900">{fmtPct(fillRate)}</p>
            <p className="text-[11px] text-slate-400">{totalReserved} / {totalCapacity} reserved</p>
          </div>
        </div>
      </div>

      <Table
        loading={loading && !slotRows}
        data={slotRows || []}
        rowKey="id"
        empty={<EmptyState icon={CalendarDays} title="No slots in range" message="Try a wider date range or another hub." />}
        columns={[
          { key: 'when', header: 'Slot', render: (r) => <span className="font-mono text-xs font-semibold text-slate-800">{r.date} <span className="text-slate-400">{r.startTime}–{r.endTime}</span></span> },
          { key: 'windowType', header: 'Type', render: (r) => <Badge tone={pickMeta(SLOT_WINDOW_META, r.windowType).tone}>{pickMeta(SLOT_WINDOW_META, r.windowType).label}</Badge> },
          { key: 'capacity', header: 'Capacity', render: (r) => <span className="text-sm">{r.effectiveCapacity ?? r.totalCapacity} {r.manualCapacity != null ? '· override' : ''}</span> },
          { key: 'remaining', header: 'Remaining', align: 'right', render: (r) => <span className={`font-semibold ${r.remaining === 0 ? 'text-rose-600' : 'text-slate-800'}`}>{r.remaining ?? 0}</span> },
          { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(SLOT_STATUS_META, r.status).tone} dot>{pickMeta(SLOT_STATUS_META, r.status).label}</Badge> },
          { key: 'actions', header: '', align: 'right', render: (r) => (
            <div className="flex justify-end gap-1.5">
              <Button variant="secondary" size="sm" icon={Gauge} onClick={() => setOverrideSlot(r)}>Override</Button>
              {r.status === 'closed' ? (
                <Button variant="ghost" size="sm" onClick={() => setStatus(r, 'open')}>Reopen</Button>
              ) : r.status === 'open' ? (
                <Button variant="danger" size="sm" onClick={() => setStatus(r, 'closed')}>Close</Button>
              ) : null}
            </div>
          ) },
        ]}
      />

      {overrideSlot && <SlotCapacityModal slot={overrideSlot} onClose={() => { setOverrideSlot(null); refresh(); }} />}
    </Card>
  );
}
