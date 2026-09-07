import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  IndianRupee,
  Landmark,
  Percent,
  RefreshCw,
  Scale,
  ShieldAlert,
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

function paiseToInr(p) {
  const n = Number(p) || 0;
  return `₹${(n / 100).toLocaleString('en-IN')}`;
}

function MoneyHealthStrip({ trial, integrity, kyc }) {
  const tb = trial.data || {};
  const report = integrity.data || {};
  const kycItems = Array.isArray(kyc.data) ? kyc.data : kyc.data?.items || [];
  const kycPending = kyc.meta?.total ?? kycItems.length;
  const pspOk = report.payments?.ok !== false;
  const ledgerOk = report.ok !== false && tb.balanced !== false;
  const pills = [
    {
      label: 'Trial balance',
      ok: tb.balanced !== false && !trial.error,
      value: trial.loading ? '…' : (tb.balanced ? 'Balanced' : `Off ${paiseToInr(tb.differencePaise)}`),
      icon: Scale,
      to: '/platform/ledger',
    },
    {
      label: 'Ledger integrity',
      ok: ledgerOk && !integrity.error,
      value: integrity.loading ? '…' : (report.ok ? 'OK' : 'Issues'),
      icon: Landmark,
      to: '/platform/ledger',
    },
    {
      label: 'Unsettled PSP',
      ok: pspOk && !integrity.error,
      value: integrity.loading ? '…' : (pspOk ? 'Clear' : `${report.payments?.mismatches ?? '—'} mismatch`),
      icon: IndianRupee,
      to: '/platform/payouts',
    },
    {
      label: 'KYC blocked',
      ok: kycPending === 0 && !kyc.error,
      value: kyc.loading ? '…' : `${kycPending} pending`,
      icon: ShieldAlert,
      to: '/platform/lifecycle',
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {pills.map((p) => (
        <Link
          key={p.label}
          to={p.to}
          className={cn(
            'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition hover:bg-white',
            p.ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'
          )}
        >
          <p.icon className={cn('h-4 w-4 shrink-0', p.ok ? 'text-emerald-700' : 'text-amber-700')} />
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{p.label}</span>
            <span className="block truncate text-sm font-semibold text-slate-900">{p.value}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function PlatformOverview() {
  const [days, setDays] = useState(30);
  const range = dayRange(days);
  const dash = useApi(() => api.marketplace.platformDashboard({ from: range.from, to: range.to }), [days]);
  const topTenants = useApi(() => api.marketplace.topTenants({ from: range.from, to: range.to, limit: 6 }), [days]);
  const topVendors = useApi(() => api.marketplace.topVendors({ from: range.from, to: range.to, limit: 6 }), [days]);
  const trial = useApi(() => api.ledger.trialBalance(), [], { toastOnError: false });
  const integrity = useApi(() => api.ledger.integrity(), [], { toastOnError: false });
  const kyc = useApi(() => api.payouts.admin.kyc({ status: 'pending', limit: 1 }), [], { toastOnError: false });
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

      <MoneyHealthStrip trial={trial} integrity={integrity} kyc={kyc} />

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
