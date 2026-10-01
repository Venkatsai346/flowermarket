import { useEffect, useState } from 'react';
import { Boxes, MapPin, Network, ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';

const defaults = {
  strategy: 'nearest_available', splitPolicy: 'never', reserveSafetyStock: 0,
  allowLegacyDefaultStock: true, requirePincodeForPromise: true,
  maxCandidateHubs: 12, defaultHandlingMinutes: 30,
};

export default function WarehousePolicyPanel({ onChanged }) {
  const { data, loading, refetch } = useApi(() => api.fulfillment.warehousePolicy(), []);
  const [form, setForm] = useState(defaults);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (data) setForm({ ...defaults, ...data }); }, [data]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      await api.fulfillment.saveWarehousePolicy({
        strategy: form.strategy, splitPolicy: form.splitPolicy,
        reserveSafetyStock: Number(form.reserveSafetyStock || 0),
        allowLegacyDefaultStock: Boolean(form.allowLegacyDefaultStock),
        requirePincodeForPromise: Boolean(form.requirePincodeForPromise),
        maxCandidateHubs: Number(form.maxCandidateHubs || 12),
        defaultHandlingMinutes: Number(form.defaultHandlingMinutes || 30),
        expectedVersion: form.id ? form.version : null,
      });
      setMessage('Allocation policy published. New promises use it immediately.');
      await refetch(); onChanged?.();
    } catch (error) { setMessage(errMsg(error)); } finally { setSaving(false); }
  };
  return (
    <Card
      title="Fulfillment allocation"
      subtitle="Control which physical stock is promiseable, how nodes are ranked, and the buffer protected from checkout."
      actions={<Button icon={ShieldCheck} loading={saving} onClick={save}>Save policy</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">Node selection
            <select className="input mt-1 w-full" value={form.strategy} onChange={(event) => set('strategy', event.target.value)} disabled={loading}>
              <option value="nearest_available">Nearest node with the full basket</option>
              <option value="priority_then_distance">Operational priority, then distance</option>
              <option value="service_hub">Mapped service hub only</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Shipment policy
            <select className="input mt-1 w-full" value={form.splitPolicy} onChange={(event) => set('splitPolicy', event.target.value)}>
              <option value="never">One node per order</option>
              <option value="allow">Allow future split planning</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Network safety buffer
            <input className="input mt-1 w-full" type="number" min="0" value={form.reserveSafetyStock} onChange={(event) => set('reserveSafetyStock', event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">Default handling time
            <div className="relative mt-1"><input className="input w-full pr-16" type="number" min="0" value={form.defaultHandlingMinutes} onChange={(event) => set('defaultHandlingMinutes', event.target.value)} /><span className="absolute right-3 top-2.5 text-xs text-slate-400">minutes</span></div>
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.requirePincodeForPromise} onChange={(event) => set('requirePincodeForPromise', event.target.checked)} />Require a delivery pincode before promising stock</label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.allowLegacyDefaultStock} onChange={(event) => set('allowLegacyDefaultStock', event.target.checked)} />Use legacy default stock while migrating nodes</label>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-slate-950 to-indigo-950 p-5 text-white">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-200"><Network className="h-4 w-4" />Promise contract</div>
          <p className="mt-4 text-xl font-semibold">Serviceability → stock buffer → full-basket node → delivery promise</p>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/10 p-3"><MapPin className="mx-auto h-4 w-4 text-cyan-300" /><p className="mt-1 text-[10px] text-slate-300">Pincode-aware</p></div>
            <div className="rounded-xl bg-white/10 p-3"><Boxes className="mx-auto h-4 w-4 text-amber-300" /><p className="mt-1 text-[10px] text-slate-300">Race-safe</p></div>
            <div className="rounded-xl bg-white/10 p-3"><ShieldCheck className="mx-auto h-4 w-4 text-emerald-300" /><p className="mt-1 text-[10px] text-slate-300">Buffered</p></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-300">Aggregate network stock is shown separately from stock that one node can actually allocate. Checkout always re-plans against the held slot’s hub.</p>
        </div>
      </div>
      {message && <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${message.startsWith('Allocation') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message}</p>}
    </Card>
  );
}
