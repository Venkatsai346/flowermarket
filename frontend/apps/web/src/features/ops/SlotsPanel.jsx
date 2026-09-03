import { useEffect, useState } from 'react';
import { CalendarPlus, RefreshCw, Settings2, SlidersHorizontal, XCircle } from 'lucide-react';
import { addDays, fmtDate, pct, pickMeta, todayISO } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import SlotGeneratorModal from './SlotGeneratorModal.jsx';
import { SLOT_STATUS_META } from './opsMeta.js';

function SlotActionModal({ slot, onClose, onChanged }) {
  const [mode, setMode] = useState('capacity');
  const [manualCapacity, setManualCapacity] = useState(slot.effectiveCapacity ?? slot.totalCapacity ?? 25);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(slot.status === 'open' ? 'closed' : 'open');
  const action = useAction();

  const submit = async () => {
    try {
      if (mode === 'capacity') {
        await action.run(() => api.admin.overrideSlot(slot.id, {
          manualCapacity: Number(manualCapacity),
          reason: reason || undefined,
        }));
        toast.success('Slot capacity overridden');
      } else {
        await action.run(() => api.admin.setSlotStatus(slot.id, { status, reason: reason || undefined }));
        toast.success(`Slot ${status}`);
      }
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Slot · ${slot.date} ${slot.startTime}`}
      subtitle={slot.displayLabel || `${slot.startTime}–${slot.endTime}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={action.busy} disabled={mode === 'capacity' && !manualCapacity} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="mb-3 flex gap-2">
          <Button variant={mode === 'capacity' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('capacity')} icon={Settings2}>Capacity</Button>
          <Button variant={mode === 'status' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('status')} icon={XCircle}>{slot.status === 'open' ? 'Close slot' : 'Reopen slot'}</Button>
        </div>
        {mode === 'capacity' ? (
          <Field label="Effective capacity" hint="Honoured atomically — cannot go below currently reserved.">
            <Input type="number" min="1" value={manualCapacity} onChange={(e) => setManualCapacity(e.target.value)} />
          </Field>
        ) : (
          <Field label="Slot status" required>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </Select>
          </Field>
        )}
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Peak load, rain, rider shortage…" />
        </Field>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Reserved {slot.reservedCapacity ?? slot.remaining ?? 0} / effective {slot.effectiveCapacity ?? slot.totalCapacity}
        </div>
      </div>
    </Modal>
  );
}

export default function SlotsPanel({ refreshKey = 0 }) {
  const [hubId, setHubId] = useState('');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const action = useAction();

  const { data, loading, refetch } = useApi(
    () => Promise.all([
      api.admin.hubs(),
      api.admin.slots({ hubId: hubId || undefined, from, to }),
      api.admin.slotsUtilization({ hubId: hubId || undefined, from, to }),
    ]),
    [hubId, from, to, refreshKey],
  );

  const hubs = data?.[0] || [];
  const slots = data?.[1] || [];
  const utilization = data?.[2] || [];

  useEffect(() => {
    if (!hubId && hubs.length) setHubId(hubs[0].id);
  }, [hubs, hubId]);

  const capacity = utilization.reduce((a, s) => a + (s.capacity || 0), 0);
  const reserved = utilization.reduce((a, s) => a + (s.reserved || 0), 0);
  const fillRate = capacity ? Math.round((reserved / capacity) * 100) : 0;

  const onGenerated = () => refetch();

  const sweepHolds = async () => {
    try {
      const r = await action.run(() => api.fulfillment.sweepExpiredHolds({ limit: 50 }));
      toast.success(`${r.data?.released ?? 0} expired holds swept`);
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sweepAssignments = async () => {
    try {
      const r = await action.run(() => api.fulfillment.sweepExpiredAssignments({ limit: 50 }));
      toast.success(`${r.data?.reassigned ?? 0} reassigned · ${r.data?.escalated ?? 0} escalated`);
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Capacity / day" value={capacity} sub={utilization.length ? `${utilization.length} days in range` : 'No slots generated'} icon={CalendarPlus} tone="sky" />
        <Stat label="Reserved" value={reserved} sub={`${fillRate}% fill rate`} icon={SlidersHorizontal} tone="amber" />
        <Stat label="Slots" value={slots.length} sub={hubId ? 'Current hub' : 'All hubs'} icon={Settings2} tone="violet" />
      </div>

      <Card
        title="Slots & utilization"
        subtitle="Effective capacity = manual override when present, otherwise forecast/base capacity."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>
            <Button variant="secondary" loading={action.busy} onClick={sweepAssignments}>Sweep assignments</Button>
            <Button variant="secondary" loading={action.busy} onClick={sweepHolds}>Sweep holds</Button>
            <Button variant="primary" icon={CalendarPlus} onClick={() => setShowGenerator(true)}>Generate slots</Button>
          </>
        }
        bodyClassName="p-0!"
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <Field label="Hub" className="w-56!">
            <Select value={hubId} onChange={(e) => setHubId(e.target.value)}>
              <option value="">All hubs</option>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.code}</option>)}
            </Select>
          </Field>
          <Field label="From" className="w-44!">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" className="w-44!">
            <Input type="date" min={from} max={addDays(from, 45).toLocaleDateString('en-CA')} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Table
          loading={loading && !data}
          data={slots}
          onRowClick={(r) => setSelectedSlot(r)}
          empty={<EmptyState title="No slots" message="Generate slots for this hub/date range first." />}
          columns={[
            { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'window', header: 'Window', render: (r) => `${r.startTime}–${r.endTime}` },
            { key: 'label', header: 'Label', render: (r) => r.displayLabel || '—' },
            { key: 'effectiveCapacity', header: 'Capacity', align: 'right', render: (r) => r.effectiveCapacity ?? r.totalCapacity },
            { key: 'reservedCapacity', header: 'Reserved', align: 'right', render: (r) => r.reservedCapacity || 0 },
            { key: 'remaining', header: 'Available', align: 'right', render: (r) => <span className={r.remaining > 0 ? 'text-emerald-600' : 'text-rose-600'}>{r.remaining}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(SLOT_STATUS_META, r.status).tone} dot>{pickMeta(SLOT_STATUS_META, r.status).label}</Badge> },
            { key: 'manual', header: 'Override', render: (r) => r.manualCapacity ? <Badge tone="violet">{r.manualCapacity}</Badge> : '—' },
          ]}
        />
      </Card>

      {showGenerator && (
        <SlotGeneratorModal hubs={hubs} onClose={() => setShowGenerator(false)} onGenerated={onGenerated} />
      )}
      {selectedSlot && (
        <SlotActionModal slot={selectedSlot} onClose={() => setSelectedSlot(null)} onChanged={refetch} />
      )}
    </div>
  );
}
