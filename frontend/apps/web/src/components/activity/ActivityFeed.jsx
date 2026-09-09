import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { timeAgo } from '@flower-market/shared';
import Badge from '../ui/Badge.jsx';
import { Activity, ShoppingCart, Package, CreditCard, Truck, User, AlertTriangle } from 'lucide-react';

const EVENT_ICONS = {
  order_created: ShoppingCart,
  order_confirmed: Package,
  payment_success: CreditCard,
  payment_failed: AlertTriangle,
  delivery_assigned: Truck,
  delivery_completed: Package,
  user_registered: User,
  refund_issued: CreditCard,
};

const EVENT_COLORS = {
  order_created: 'sky',
  order_confirmed: 'emerald',
  payment_success: 'emerald',
  payment_failed: 'rose',
  delivery_assigned: 'violet',
  delivery_completed: 'emerald',
  user_registered: 'slate',
  refund_issued: 'amber',
};

/**
 * Activity Feed — live-updating list of recent store activity.
 * Polls every 30s for new events.
 */
export default function ActivityFeed({ limit = 15, pollInterval = 30000 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.admin.events?.({ limit }) ||
        await api.admin.analyticsDashboard?.({ recent: true }) ||
        { data: [] };
      const items = r.data?.events || r.data?.recentActivity || r.data || [];
      if (Array.isArray(items)) setEvents(items);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, pollInterval);
    return () => clearInterval(t);
  }, [limit, pollInterval]);

  if (loading && !events.length) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1">
              <div className="skeleton h-3 w-3/4 rounded" />
              <div className="skeleton h-2.5 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Activity className="h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No recent activity</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {events.map((ev, i) => {
        const Icon = EVENT_ICONS[ev.type || ev.kind] || Activity;
        const color = EVENT_COLORS[ev.type || ev.kind] || 'slate';
        return (
          <li key={ev.id || i} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-${color}-50`}>
              <Icon className={`h-3.5 w-3.5 text-${color}-500`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-800">
                {ev.message || ev.description || ev.type || 'Activity'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {ev.createdAt ? timeAgo(ev.createdAt) : ev.time || ''}
                {ev.actorName && <span className="ml-1">· {ev.actorName}</span>}
              </p>
            </div>
            {ev.amount && (
              <span className="text-xs font-semibold text-slate-700">₹{Number(ev.amount).toLocaleString('en-IN')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
