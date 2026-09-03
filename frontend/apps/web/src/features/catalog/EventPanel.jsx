import { useState } from 'react';
import { Activity, CheckCircle2, Clock, RefreshCw, Send, XCircle } from 'lucide-react';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Stat from '../../components/ui/Stat.jsx';
import { EVENT_STATUS_META } from './catalogMeta.js';

export default function EventPanel() {
  const { data, loading, error, refetch } = useApi(() => api.catalogAdmin.eventStatus(), []);
  const { busy, run } = useAction();
  const [lastDrain, setLastDrain] = useState(null);

  const drain = async () => {
    try {
      const r = await run(() => api.catalogAdmin.drainEvents());
      setLastDrain(r.data || { scanned: 0, published: 0, failed: 0 });
      toast.success(`Drained ${r.data?.scanned ?? 0} event(s)`);
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const s = data || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending" value={s.pending ?? '—'} sub="waiting for dispatch" icon={Clock} tone="amber" />
        <Stat label="Publishing" value={s.publishing ?? '—'} sub="in-flight" icon={Activity} tone="sky" />
        <Stat label="Published" value={s.published ?? '—'} sub="delivered to handlers" icon={CheckCircle2} tone="emerald" />
        <Stat label="Failed" value={s.failed ?? '—'} sub="need operator attention" icon={XCircle} tone="rose" />
      </div>

      <Card
        title="Catalog event outbox"
        subtitle="Durable writes + async handlers. Drain dispatches pending events in order."
        actions={
          <>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refetch}>Refresh</Button>
            <Button variant="primary" size="sm" icon={Send} loading={busy} disabled={!s.pending} onClick={drain}>Drain pending</Button>
          </>
        }
      >
        {error ? (
          <p className="text-sm text-rose-600">{errMsg(error)}</p>
        ) : loading && !data ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading event pipeline…</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              {Object.entries(EVENT_STATUS_META).map(([k, m]) => (
                <div key={k} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">{m.label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{s[k] ?? 0}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Failed events retain their payload and retry on the next drain after the handler starts working again.
            </p>
            {lastDrain && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                Last drain: scanned <b>{lastDrain.scanned ?? 0}</b> · published <b>{lastDrain.published ?? 0}</b> · failed <b>{lastDrain.failed ?? 0}</b>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
