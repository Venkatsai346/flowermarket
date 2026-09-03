import { useState } from 'react';
import { CalendarRange, Sparkles } from 'lucide-react';
import { addDays, todayISO } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field.jsx';

export default function SlotGeneratorModal({ hubs = [], onClose, onGenerated }) {
  const [hubId, setHubId] = useState(hubs[0]?.id || '');
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [capacity, setCapacity] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [forecast, setForecast] = useState(false);
  const [result, setResult] = useState(null);
  const action = useAction();

  const submit = async () => {
    if (!hubId) return;
    try {
      const r = await action.run(() => api.fulfillment.generateSlots({
        hubId,
        fromDate,
        toDate,
        capacity: capacity ? Number(capacity) : null,
        overwrite,
        forecast,
      }));
      setResult(r.data);
      toast.success(r.message || 'Slots generated');
      onGenerated?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Generate delivery slots"
      subtitle="Forecast sets capacity; the atomic gate prevents overselling."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={CalendarRange} loading={action.busy} disabled={!hubId || !fromDate || !toDate} onClick={submit}>
            Generate slots
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hub" required>
            <Select value={hubId} onChange={(e) => setHubId(e.target.value)}>
              <option value="">Select hub</option>
              {(hubs || []).map((h) => <option key={h.id} value={h.id}>{h.name} · {h.code}</option>)}
            </Select>
          </Field>
          <Field label="Capacity per slot" hint="Leave blank to use the hub default / forecast recommendation.">
            <Input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="25" />
          </Field>
          <Field label="From" required>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="To" required>
            <Input type="date" min={fromDate} max={addDays(fromDate, 45).toLocaleDateString('en-CA')} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2 rounded-xl bg-slate-50 p-4">
          <Checkbox label="Use forecast capacity (nightly-style batch)" checked={forecast} onChange={(e) => setForecast(e.target.checked)} />
          <Checkbox label="Overwrite existing slots in this window" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-xs text-violet-700">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Forecast mode recalculates capacity from historical volume, picker throughput and rider capacity for every slot in the window.</p>
        </div>

        {result && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm">
            <p className="font-semibold text-emerald-700">{result.created} slots created</p>
            <p className="mt-1 text-xs text-emerald-600">
              {result.window?.fromDate} → {result.window?.toDate} · hub {result.hubId} · forecast {result.forecast ? 'on' : 'off'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
