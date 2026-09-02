import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  IndianRupee,
  Package,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import {
  compact,
  daysUntil,
  dayRange,
  fmtDate,
  inr,
  inr0,
  num,
  periodLabel,
  SUBSCRIPTION_STATUS_META,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { pickMeta } from '@flower-market/shared';
import Stat from '../../components/ui/Stat.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import TrendChart from '../../components/charts/TrendChart.jsx';

const RANGE_DAYS = 30;

export default function StoreDashboard() {
  const range = dayRange(RANGE_DAYS);
  const dash = useApi(() => api.admin.analyticsDashboard({ from: range.from, to: range.to }), []);
  const top = useApi(() => api.admin.topProducts({ from: range.from, to: range.to, limit: 6 }), []);
  const store = useApi(() => api.marketplace.myStore(), []);

  if (dash.loading && !dash.data) return <LoadingBlock label="Loading your dashboard…" />;

  const d = dash.data || {};
  const k = d.kpis || {};
  const series = d.series || [];
  const orders = k.ordersCreated ?? k.orders ?? 0;
  const gmv = k.gmv ?? 0;
  const netRevenue = k.netRevenue ?? 0;
  const aov = k.aov ?? 0;
  const delivered = k.delivered ?? 0;
  const cancelled = k.cancelled ?? 0;
  const refunded = k.refunded ?? 0;

  const tenant = store.data?.tenant || null;
  const sub = store.data?.subscription || null;
  const subMeta = sub ? pickMeta(SUBSCRIPTION_STATUS_META, sub.status) : null;
  const trialDaysLeft = sub?.trialEndsAt ? daysUntil(sub.trialEndsAt) : null;

  return (
    <div className="space-y-6">
      {/* subscription banner */}
      {sub && sub.status === 'trial' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3.5">
          <p className="text-sm text-sky-800">
            <b>Free trial</b> — {trialDaysLeft != null ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left` : 'in progress'} on the <b>{sub.planSnapshot?.name}</b> plan. Trial ends {fmtDate(sub.trialEndsAt)}.
          </p>
          <Link to="/billing"><Button variant="secondary" size="sm">Manage plan</Button></Link>
        </div>
      )}
      {sub && sub.status === 'past_due' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4" /> <b>Subscription past due</b> — an invoice is overdue. Settle it in Billing to keep selling.
          </p>
          <Link to="/billing"><Button size="sm">Go to billing</Button></Link>
        </div>
      )}
      {!sub && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5">
          <p className="text-sm text-amber-800">
            <b>No active subscription.</b> Pick a plan to keep your store running and unlock marketplace mode.
          </p>
          <Link to="/billing"><Button size="sm">Choose a plan</Button></Link>
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="GMV (30d)" value={compact(gmv)} icon={IndianRupee} tone="rose" sub={inr(gmv)} />
        <Stat label="Orders (30d)" value={num(orders)} icon={ShoppingCart} tone="sky" sub={`${num(delivered)} delivered · ${num(cancelled)} cancelled`} />
        <Stat label="Net revenue" value={compact(netRevenue)} icon={TrendingUp} tone="emerald" sub={`after ${inr(refunded)} refunds`} />
        <Stat label="Avg order value" value={inr0(aov)} icon={Receipt} tone="violet" sub={`${RANGE_DAYS}-day window`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Daily trend" subtitle={`${fmtDate(range.from)} → ${fmtDate(range.to)}`} className="xl:col-span-2">
          <TrendChart
            data={series}
            series={[
              { key: 'gmv', name: 'GMV', color: '#e11d48' },
              { key: 'orders', name: 'Orders', color: '#0ea5e9' },
            ]}
          />
        </Card>

        <Card title="Top products" subtitle="By GMV in the last 30 days">
          {top.loading && !top.data ? (
            <LoadingBlock />
          ) : top.data?.length ? (
            <ul className="divide-y divide-slate-100">
              {top.data.slice(0, 6).map((p, i) => (
                <li key={p.id || i} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{p.title || p.name || 'Product'}</p>
                    <p className="text-[11px] text-slate-400">{num(p.qty ?? p.orders ?? 0)} units</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-800">{inr(p.revenue ?? p.gmv ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              No sales yet. Add products and spread the !word 🌷
            </p>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/catalog"><Button variant="secondary" icon={Package}>Manage catalog</Button></Link>
        <Link to="/orders"><Button variant="secondary" icon={ShoppingCart}>View orders</Button></Link>
        <Link to="/storefront"><Button variant="ghost">Brand your storefront <ArrowRight className="h-4 w-4" /></Button></Link>
      </div>

      {sub && (
        <p className="text-xs text-slate-400">
          Subscription: <b>{sub.planSnapshot?.name}</b> · {periodLabel({ from: sub.periodStart, to: sub.periodEnd })} ·
          commission {sub.commissionRateBps / 100}% · {tenant?.store?.isPublished ? 'storefront live' : 'storefront unpublished'}
        </p>
      )}
    </div>
  );
}
