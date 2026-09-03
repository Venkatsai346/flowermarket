import { useEffect, useState } from 'react';
import { Building2, RefreshCw, ShieldAlert, ShieldCheck, Store, Truck } from 'lucide-react';
import { bpsToPct, fmtDate, pickMeta, SUBSCRIPTION_STATUS_META, titleCase } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { KYC_STATUS_META, TENANT_STATUS_META, VENDOR_STATUS_LIFECYCLE_META } from './platformMeta.js';

const kycLifecycleMeta = (v) => {
  const m = pickMeta(KYC_STATUS_META, v);
  return { ...m, label: m.label || 'Not submitted' };
};

export default function LifecyclePanel() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const tenants = useApi(() => api.marketplace.adminTenants({ page: 1, limit: 20, search: debouncedSearch || undefined }), [debouncedSearch, refreshKey]);
  const vendors = useApi(() => api.marketplace.adminVendors({ page: 1, limit: 20, search: debouncedSearch || undefined }), [debouncedSearch, refreshKey]);
  const kyc = useApi(() => api.payouts.admin.kyc({ page: 1, limit: 100, search: debouncedSearch || undefined }), [debouncedSearch, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const tenantsRows = tenants.data || [];
  const vendorsRows = vendors.data || [];
  const kycRows = kyc.data || [];
  const kycByVendor = new Map(kycRows.map((r) => [String(r.vendorId), r]));

  const blocked = kycRows.filter((r) => !r.payable);
  const pastDue = tenantsRows.filter((t) => t.subscription?.status === 'past_due');
  const activeStores = tenantsRows.filter((t) => t.status === 'active').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Stores (page)" value={tenantsRows.length} sub={`${activeStores} active`} icon={Store} tone="sky" />
        <Stat label="Subscription at risk" value={pastDue.length} sub="past due / overdue on this page" icon={Building2} tone="amber" />
        <Stat label="Vendors (page)" value={vendorsRows.length} sub="approved sellers" icon={Truck} tone="emerald" />
        <Stat label="KYC blocked" value={blocked.length} sub="not payable yet" icon={ShieldAlert} tone="rose" />
        <Stat label="KYC pending" value={kycRows.filter((r) => r.kyc?.status === 'pending').length} sub="in review" icon={ShieldCheck} tone="amber" />
      </div>

      {tenants.error || vendors.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load lifecycle</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(tenants.error || vendors.error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <>
          <Card
            title="Tenant lifecycle"
            subtitle="Subscription, storefront and billing posture."
            bodyClassName="p-0!"
            actions={
              <div className="flex items-center gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter both lists…" className="w-56!" />
                <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>
              </div>
            }
          >
            <Table
              loading={tenants.loading && !tenants.data}
              data={tenantsRows}
              empty={<EmptyState icon={Store} title="No stores" message="Register a store to see it in the lifecycle." />}
              columns={[
                { key: 'store', header: 'Store', render: (r) => (
                  <div>
                    <p className="font-medium text-slate-800">{r.name}</p>
                    <p className="text-[11px] text-slate-400">@{r.slug}</p>
                  </div>
                ) },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(TENANT_STATUS_META, r.status).tone} dot>{pickMeta(TENANT_STATUS_META, r.status).label}</Badge> },
                { key: 'plan', header: 'Plan', render: (r) => <Badge tone={r.plan === 'business' ? 'violet' : r.plan === 'pro' ? 'sky' : 'slate'}>{titleCase(r.plan)}</Badge> },
                { key: 'sub', header: 'Subscription', render: (r) => {
                  const s = r.subscription;
                  const m = pickMeta(SUBSCRIPTION_STATUS_META, s?.status);
                  return <Badge tone={s ? m.tone : 'slate'} dot>{s ? m.label : 'None'}</Badge>;
                } },
                { key: 'storefront', header: 'Storefront', render: (r) => <Badge tone={r.store?.isPublished ? 'emerald' : 'slate'}>{r.store ? (r.store.isPublished ? 'Published' : 'Draft') : '—'}</Badge> },
                { key: 'createdAt', header: 'Joined', render: (r) => <span className="text-xs text-slate-500">{fmtDate(r.createdAt)}</span> },
              ]}
            />
          </Card>

          <Card
            title="Vendor lifecycle"
            subtitle="Marketplace participation and the payout KYC gate."
            bodyClassName="p-0!"
          >
            {kyc.error && (
              <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">
                KYC data for the payout gate could not be loaded — {errMsg(kyc.error)}. Vendor statuses are still accurate.
              </div>
            )}
            <Table
              loading={vendors.loading && !vendors.data}
              data={vendorsRows.map((v) => ({ ...v, kyc: kycByVendor.get(String(v.id)) }))}
              empty={<EmptyState icon={Truck} title="No vendors" message="Approve vendor applications to see them here." />}
              columns={[
                { key: 'vendor', header: 'Vendor', render: (r) => (
                  <div>
                    <p className="font-medium text-slate-800">{r.businessName}</p>
                    <p className="text-[11px] text-slate-400">@{r.slug} · {r.city || ''}</p>
                  </div>
                ) },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(VENDOR_STATUS_LIFECYCLE_META, r.status).tone} dot>{pickMeta(VENDOR_STATUS_LIFECYCLE_META, r.status).label}</Badge> },
                { key: 'commission', header: 'Commission', render: (r) => <span className="font-mono text-xs">{bpsToPct(r.commissionRateBps)}</span> },
                { key: 'kyc', header: 'KYC', render: (r) => kyc.loading && !kyc.data ? <Badge tone="slate">Loading</Badge> : <Badge tone={kycLifecycleMeta(r.kyc?.kyc?.status).tone}>{kycLifecycleMeta(r.kyc?.kyc?.status).label}</Badge> },
                { key: 'gate', header: 'Gate', render: (r) => kyc.loading && !kyc.data ? <Badge tone="slate">Loading</Badge> : <Badge tone={r.kyc?.payable ? 'emerald' : 'rose'}>{r.kyc?.payable ? 'Payable' : 'Blocked'}</Badge> },
                { key: 'joinedAt', header: 'Joined', render: (r) => <span className="text-xs text-slate-500">{fmtDate(r.joinedAt)}</span> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
