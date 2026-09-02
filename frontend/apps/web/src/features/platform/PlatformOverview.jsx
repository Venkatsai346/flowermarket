import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  IndianRupee,
  MoonStar,
  Percent,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { compact, dayRange, fmtDate, inr, num, titleCase } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';

const RANGES = [7, 30, 90];

export default function PlatformOverview() {
  const [days, setDays] = useState(30);
  const range = dayRange(days);
  const dash = useApi(() => api.marketplace.platformDashboard({ from: range.from, to: range.to }), [days]);
  const topTenants = useApi(() => api.marketplace.topTenants({ from: range.from, to: range.to, limit: 6 }), [days]);
  const topVendors = useApi(() => api.marketplace.topVendors({ from: range.from, to: range.to, limit: 6 }), [days]);
  const { busy, run } = useAction();

  const d = dash.data || {};
  const byPlan = d.byPlan || {};

  const rebuild = async () => {
    try {
      const r = await run(() => api.marketplace.rebuildPlatform({ from: range.from, to: range.to }));
      toast.success(`Platform rollup rebuilt — ${r.data?.dates?.length ?? 0} days written`);
      dash.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Platform overview"
        description="Cross-tenant health of the marketplace."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition',
                    days === r ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={rebuild}>
              Rebuild rollup
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="GMV" value={compact(d.gmv)} icon={IndianRupee} tone="rose" sub={`${fmtDate(range.from)} → ${fmtDate(range.to)}`} />
        <Stat label="Orders" value={num(d.orders)} icon={ShoppingCart} tone="sky" />
        <Stat label="Net revenue" value={compact(d.netRevenue)} icon={TrendingUp} tone="emerald" />
        <Stat label="Commissions accrued" value={compact(d.commissionsAccrued)} icon={Percent} tone="amber" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="MRR" value={inr(d.mrr)} icon={IndianRupee} tone="violet" sub="active subscriptions" />
        <Stat label="Active tenants" value={num(d.activeTenants)} icon={Store} tone="sky" />
        <Stat label="New tenants" value={num(d.newTenants)} icon={Building2} tone="emerald" sub={`in last ${days}d`} />
        <Stat label="New vendors" value={num(d.newVendors)} icon={Truck} tone="rose" sub={`in last ${days}d`} />
      </div>

      {Object.keys(byPlan).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Subscriptions by plan:</span>
          {Object.entries(byPlan).map(([plan, n]) => (
            <Badge key={plan} tone={plan === 'business' ? 'violet' : plan === 'pro' ? 'sky' : 'slate'}>
              {titleCase(plan)} · {n}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Top stores" subtitle="By GMV in the selected window" bodyClassName="p-0!">
          {(topTenants.data || []).length ? (
            <ul className="divide-y divide-slate-100">
              {topTenants.data.map((t, i) => (
                <li key={t.tenantId} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{t.name || t.slug}</p>
                    <p className="text-[11px] text-slate-400">@{t.slug} · {num(t.orders)} orders</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-800">{inr(t.gmv)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">No store GMV in this window yet.</p>
          )}
        </Card>

        <Card title="Top vendors" subtitle="By attributed order GMV" bodyClassName="p-0!">
          {(topVendors.data || []).length ? (
            <ul className="divide-y divide-slate-100">
              {topVendors.data.map((v, i) => (
                <li key={v.vendorId} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{v.businessName || v.slug}</p>
                    <p className="text-[11px] text-slate-400">@{v.slug} · {num(v.orders)} line items</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-800">{inr(v.gmv)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">No vendor GMV yet — approve applications to get sellers onboard.</p>
          )}
        </Card>
      </div>

      <Card title="Platform ops">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Users className="h-4 w-4" /> Nightly marketplace pass: rollovers → billing → platform rollup → notifications.
          </p>
          <Link to="/platform/billing"><Button variant="secondary">Open billing console</Button></Link>
        </div>
      </Card>
    </div>
  );
}
