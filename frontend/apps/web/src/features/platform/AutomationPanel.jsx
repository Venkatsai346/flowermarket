import { useState } from 'react';
import { Activity, CalendarClock, Database, MoonStar, Play, RefreshCw, Send, ShieldAlert, Zap } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import { EXPORT_STATUS_META, EXPORT_TYPE_LABELS } from './platformMeta.js';

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function AutomationPanel() {
  const [range, setRange] = useState({ from: daysAgoISO(7), to: todayISO() });
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState('');
  const { busy, run } = useAction();
  const exportsApi = useApi(() => api.admin.exports({ page: 1, limit: 10 }), []);

  const record = (key, value) => {
    setHistory((h) => [{ key, at: new Date().toISOString(), value }, ...h].slice(0, 25));
  };

  const op = async (key, label, fn) => {
    setRunning(key);
    try {
      const r = await run(fn);
      record(key, r.data || { message: r.message });
      toast.success(`${label} completed`);
    } catch (e) {
      record(key, { error: errMsg(e) });
      toast.error(errMsg(e));
    } finally {
      setRunning('');
    }
  };

  const actions = [
    { key: 'nightly', label: 'Marketplace nightly', icon: MoonStar, hint: 'Billing, rollovers, payout sweep, events, notifications, ledger integrity.', fn: () => op('nightly', 'Marketplace nightly', () => api.marketplace.nightly({ days: 7 })) },
    { key: 'billing', label: 'Run billing cycle', icon: CalendarClock, hint: 'Idempotent invoice generation for due periods.', fn: () => op('billing', 'Billing cycle', () => api.marketplace.runBillingCycle({})) },
    { key: 'overdue', label: 'Overdue sweep', icon: Zap, hint: 'Past-due subscriptions and overdue invoices.', fn: () => op('overdue', 'Overdue sweep', () => api.marketplace.overdueSweep()) },
    { key: 'rollup', label: 'Rebuild platform rollup', icon: Database, hint: 'Recomputes the cross-tenant daily analytics window.', fn: () => op('rollup', 'Platform rollup', () => api.marketplace.rebuildPlatform(range)) },
    { key: 'eligibility', label: 'Payout eligibility sweep', icon: Send, hint: 'Promotes accrued payout lines once the return window closes.', fn: () => op('eligibility', 'Payout eligibility', () => api.payouts.admin.sweepEligibility()) },
    { key: 'reconcile', label: 'Reconcile in-flight', icon: ShieldAlert, hint: 'Resolves ambiguous provider submissions without retrying.', fn: () => op('reconcile', 'Reconciliation', () => api.payouts.admin.reconcile({})) },
    { key: 'drain', label: 'Drain catalog events', icon: Activity, hint: 'Dispatches the catalog event outbox.', fn: () => op('drain', 'Event drain', () => api.catalogAdmin.drainEvents()) },
    { key: 'exports', label: 'Run due exports', icon: Play, hint: 'Processes queued tenant export jobs.', fn: () => op('exports', 'Due exports', () => api.admin.runDueExports({ limit: 20 })) },
  ];

  return (
    <div className="space-y-4">
      <Card title="Ops automation" subtitle="Idempotent platform-wide passes. Every action can be re-run safely.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                type="button"
                disabled={busy}
                onClick={a.fn}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-slate-900 group-hover:text-white">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{a.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{a.hint}</span>
                </span>
                {running === a.key && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          <span>Rollup window</span>
          <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40!" />
          <span>→</span>
          <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40!" />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Automation history"
          subtitle="Results from this session."
          bodyClassName="p-0!"
        >
          {history.length ? (
            <Table
              data={history}
              rowKey="at"
              columns={[
                { key: 'key', header: 'Pass', render: (r) => <span className="text-sm font-medium text-slate-800">{r.key}</span> },
                { key: 'at', header: 'At', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.at)}</span> },
                { key: 'result', header: 'Result', render: (r) => {
                  const v = r.value || {};
                  if (v.error) return <span className="text-rose-600">{v.error}</span>;
                  if (typeof v === 'string') return <span className="text-slate-600">{v}</span>;
                  const summary = Object.keys(v).slice(0, 3).map((k) => `${k}=${summarize(v[k])}`).join(' · ');
                  return <span className="text-slate-600">{summary || 'ok'}</span>;
                } },
              ]}
            />
          ) : (
            <EmptyState icon={Zap} title="No automation runs yet" message="Run a pass above; the result stays here for the session." />
          )}
        </Card>

        <Card
          title="Recent export jobs"
          subtitle="Queued reports observed by the platform scope."
          bodyClassName="p-0!"
          actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={exportsApi.refetch}>Refresh</Button>}
        >
          {exportsApi.error && (
            <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">
              Export jobs could not be loaded — {errMsg(exportsApi.error)}.
            </div>
          )}
          <Table
            loading={exportsApi.loading && !exportsApi.data}
            data={exportsApi.data || []}
            empty={<EmptyState icon={Database} title="No export jobs" message="Queued tenant exports show here after the worker picks them up." />}
            columns={[
              { key: 'type', header: 'Type', render: (r) => <span className="text-sm text-slate-700">{EXPORT_TYPE_LABELS[r.type] || r.type}</span> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(EXPORT_STATUS_META, r.status).tone} dot>{pickMeta(EXPORT_STATUS_META, r.status).label}</Badge> },
              { key: 'attempts', header: 'Attempts', align: 'right', render: (r) => <span className="text-xs text-slate-500">{r.attempts ?? 0}</span> },
              { key: 'createdAt', header: 'Queued', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function summarize(value) {
  if (value == null) return '—';
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return 'object';
  return String(value);
}
