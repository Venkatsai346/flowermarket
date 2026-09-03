import { useEffect, useState } from 'react';
import { BrainCircuit, RefreshCw } from 'lucide-react';
import { todayISO } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field.jsx';
import Stat from '../../components/ui/Stat.jsx';

const fmtSeconds = (s) => {
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 60) return `${Math.round(v)}s`;
  return `${(Math.round(v / 10) / 6).toFixed(1)}m`;
};

export default function ForecastPanel() {
  const [hubId, setHubId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [pickerCount, setPickerCount] = useState('');
  const [riderCount, setRiderCount] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState(null);
  const action = useAction();

  const { data, loading, refetch } = useApi(() => Promise.all([
    api.admin.hubs(),
    api.fulfillment.forecastHistory({ hubId: hubId || undefined }),
  ]), [hubId]);

  const hubs = data?.[0] || [];
  const history = data?.[1] || {};

  useEffect(() => {
    if (!hubId && hubs.length) setHubId(hubs[0].id);
  }, [hubs, hubId]);

  const run = async () => {
    if (!hubId) return;
    try {
      const r = await action.run(() => api.fulfillment.forecastHub({
        hubId,
        date,
        pickerCount: pickerCount ? Number(pickerCount) : null,
        riderCount: riderCount ? Number(riderCount) : null,
        dryRun,
      }));
      setResult(r.data);
      toast.success(dryRun ? 'Dry-run forecast computed' : 'Forecast applied to slot metadata');
      if (!dryRun) refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card
      title="Slot forecast"
      subtitle="Forecasting sets the capacity number; the atomic lock stops overselling."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hub" required>
              <Select value={hubId} onChange={(e) => setHubId(e.target.value)}>
                <option value="">Select hub</option>
                {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.code}</option>)}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Pickers (optional)" hint="Default: active pickers at hub">
              <Input type="number" min="0" value={pickerCount} onChange={(e) => setPickerCount(e.target.value)} />
            </Field>
            <Field label="Riders (optional)" hint="Default: active riders at hub">
              <Input type="number" min="0" value={riderCount} onChange={(e) => setRiderCount(e.target.value)} />
            </Field>
          </div>
          <Checkbox label="Dry run (do not persist slot metadata)" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <Button variant="primary" icon={BrainCircuit} loading={action.busy} disabled={!hubId || !date} onClick={run}>Compute forecast</Button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Avg pick" value={fmtSeconds(history.avgPickSeconds)} sub={`${history.total || 0} logs`} tone="violet" />
            <Stat label="Avg pack" value={fmtSeconds(history.avgPackSeconds)} sub="packing time" tone="sky" />
            <Stat label="Avg delivery" value={fmtSeconds(history.avgDeliverySeconds)} sub="rider leg" tone="emerald" />
            <Stat label="Forecast loops" value={history.total || 0} sub="fulfillment-time samples" tone="slate" />
          </div>
          {result && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-sm font-semibold text-emerald-700">
                {result.hubName || result.hubId} · {result.date}
              </p>
              <p className="mt-1 text-xs text-emerald-600">
                Demand {result.predictedDemand?.normal ?? 0} · physical limit {result.physical?.physicalLimit ?? '—'}
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-white/70 p-3 text-[11px] text-slate-600">
                {JSON.stringify(result.recommendedCapacity || {}, null, 2)}
              </pre>
            </div>
          )}
          {!result && (
            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-400">
              Run a forecast to see predicted demand, physical throughput and recommended per-window capacity.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
