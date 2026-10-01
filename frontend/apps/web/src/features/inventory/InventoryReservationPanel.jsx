import { useState } from 'react';
import { Clock3, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';

const tones = {
  active: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-amber-50 text-amber-700', released: 'bg-slate-100 text-slate-600',
  failed: 'bg-rose-50 text-rose-700', allocating: 'bg-violet-50 text-violet-700',
};
const idOf = (row) => row?.id || row?._id;

export default function InventoryReservationPanel({ onChanged }) {
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const { data: rows = [], meta, loading } = useApi(
    () => api.fulfillment.inventoryReservations({ status: status || undefined, limit: 12 }),
    [status, refreshKey],
  );
  const summary = meta?.summary || {};
  const run = async (kind) => {
    setBusy(kind); setMessage('');
    try {
      const result = kind === 'sweep'
        ? await api.fulfillment.sweepInventoryReservations({ limit: 250 })
        : await api.fulfillment.reconcileInventoryReservations({ limit: 500, repair: true });
      setMessage(kind === 'sweep'
        ? `${result.expired || 0} expired reservation line(s) released.`
        : `${result.issues?.length || 0} integrity issue(s) found; safe repairs applied.`);
      setRefreshKey((key) => key + 1); onChanged?.();
    } catch (error) { setMessage(errMsg(error)); } finally { setBusy(''); }
  };
  return (
    <Card title="Reservation control tower" subtitle="Exact-node stock held during payment, with expiry, idempotency and reconciliation visibility."
      actions={<div className="flex gap-2"><Button variant="secondary" size="sm" icon={Clock3} loading={busy === 'sweep'} onClick={() => run('sweep')}>Sweep expired</Button><Button variant="secondary" size="sm" icon={ShieldCheck} loading={busy === 'reconcile'} onClick={() => run('reconcile')}>Reconcile</Button></div>}>
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.4fr]">
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {['active', 'confirmed', 'expired', 'released', 'failed', 'allocating'].map((key) => (
              <button type="button" key={key} onClick={() => setStatus(status === key ? '' : key)} className={`rounded-2xl border p-3 text-left transition ${status === key ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-slate-200'}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{key}</p>
                <p className="mt-1 text-xl font-black text-slate-800">{summary[key]?.count || 0}</p>
                <p className="text-[10px] text-slate-400">{summary[key]?.quantity || 0} units</p>
              </button>
            ))}
          </div>
          {message && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-medium text-slate-600">{message}</p>}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Recent holds</p><button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="text-slate-400 hover:text-indigo-600"><RefreshCw className="h-4 w-4" /></button></div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {!loading && !rows.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">No reservation records match this view.</p>}
            {rows.map((row) => (
              <div key={idOf(row)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="min-w-0"><p className="truncate font-mono text-xs text-slate-600">Order {String(row.orderId).slice(-8)} · {row.qty} unit(s)</p><p className="text-[11px] text-slate-400">Node {row.warehouseId ? String(row.warehouseId).slice(-8) : 'legacy'}{row.status === 'active' ? ` · expires ${new Date(row.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${tones[row.status] || tones.failed}`}>{row.status}</span>
              </div>
            ))}
          </div>
          {(summary.failed?.count > 0 || summary.allocating?.count > 0) && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />Run reconciliation and inspect unresolved drift before adjusting stock.</p>}
        </div>
      </div>
    </Card>
  );
}
