import { useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';

const idOf = (value) => value?.id || value?._id || '';
const statusTone = { completed: 'text-emerald-700 bg-emerald-50', partial: 'text-amber-700 bg-amber-50', failed: 'text-rose-700 bg-rose-50', processing: 'text-sky-700 bg-sky-50' };

export default function WarehouseTransferPanel({ listings = [], onChanged }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: hubs = [] } = useApi(() => api.admin.hubs(), []);
  const { data: transfers = [], loading } = useApi(() => api.fulfillment.warehouseTransfers({ limit: 8 }), [refreshKey]);
  const enabledHubs = useMemo(() => hubs.filter((hub) => hub.isActive !== false && hub.isFulfillmentEnabled !== false), [hubs]);
  const [form, setForm] = useState({ fromHubId: '', toHubId: '', tenantProductId: '', qty: 1 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const canSubmit = form.fromHubId && form.toHubId && form.fromHubId !== form.toHubId && form.tenantProductId && Number(form.qty) > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setMessage('');
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api.fulfillment.transferWarehouseStock({
        idempotencyKey, fromHubId: form.fromHubId, toHubId: form.toHubId,
        items: [{ tenantProductId: form.tenantProductId, qty: Number(form.qty) }],
      });
      setMessage(result?.transfer?.status === 'completed' ? 'Transfer completed and network stock refreshed.' : 'Transfer recorded; review its line status below.');
      setRefreshKey((key) => key + 1); onChanged?.();
    } catch (error) { setMessage(errMsg(error)); } finally { setBusy(false); }
  };

  return (
    <Card title="Warehouse transfers" subtitle="Move physical stock between fulfillment nodes with a durable, idempotent audit record."
      actions={<Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setRefreshKey((key) => key + 1)}>Refresh</Button>}>
      <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">Source node
              <select className="input mt-1 w-full" value={form.fromHubId} onChange={(event) => set('fromHubId', event.target.value)}>
                <option value="">Choose source</option>{enabledHubs.map((hub) => <option key={idOf(hub)} value={idOf(hub)}>{hub.name} ({hub.code})</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Destination node
              <select className="input mt-1 w-full" value={form.toHubId} onChange={(event) => set('toHubId', event.target.value)}>
                <option value="">Choose destination</option>{enabledHubs.map((hub) => <option key={idOf(hub)} value={idOf(hub)} disabled={idOf(hub) === form.fromHubId}>{hub.name} ({hub.code})</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Listing
              <select className="input mt-1 w-full" value={form.tenantProductId} onChange={(event) => set('tenantProductId', event.target.value)}>
                <option value="">Choose listing</option>{listings.map((listing) => <option key={idOf(listing)} value={idOf(listing)}>{listing.title || listing.skuGlobal || idOf(listing)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Quantity
              <input className="input mt-1 w-full" type="number" min="1" max="100000" value={form.qty} onChange={(event) => set('qty', event.target.value)} />
            </label>
          </div>
          <Button className="mt-4 w-full" icon={ArrowRightLeft} loading={busy} disabled={!canSubmit} onClick={submit}>Transfer stock</Button>
          {message && <p className="mt-3 text-xs font-medium text-slate-600">{message}</p>}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Recent lifecycle records</p>
          <div className="space-y-2">
            {!loading && !transfers.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">No transfers recorded yet.</p>}
            {transfers.map((transfer) => (
              <div key={idOf(transfer)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="min-w-0"><p className="truncate font-mono text-xs text-slate-600">{transfer.requestKey}</p><p className="text-[11px] text-slate-400">{transfer.transferredCount || 0} completed · {transfer.failedCount || 0} failed</p></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusTone[transfer.status] || statusTone.processing}`}>{transfer.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
