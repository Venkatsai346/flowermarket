import { useState } from 'react';
import { Search, Store } from 'lucide-react';
import {
  bpsToPct,
  fmtDate,
  periodLabel,
  pickMeta,
  SUBSCRIPTION_STATUS_META,
  titleCase,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

export default function PlatformStoresPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [selected, setSelected] = useState(null);
  const [limit] = useState(20);

  const { data, meta, loading } = useApi(
    () => api.marketplace.adminTenants({ page, limit, search: search || undefined, plan: plan || undefined }),
    [page, search, plan]
  );

  const selectedTenant = (data || []).find((t) => t.id === selected);

  return (
    <div>
      <PageHeader
        title="Stores"
        description="Every tenant on the platform — plans, subscriptions and onboarding."
      />
      <Card bodyClassName="p-0!">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Search name or slug…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-40!" value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={Store} title="No stores found" message="Stores appear here after self-service registration." />}
          columns={[
            { key: 'name', header: 'Store', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.name}</p>
                <p className="text-[11px] text-slate-400">@{r.slug}</p>
              </div>
            ) },
            { key: 'plan', header: 'Plan', render: (r) => <Badge tone={r.plan === 'business' ? 'violet' : r.plan === 'pro' ? 'sky' : 'slate'}>{titleCase(r.plan)}</Badge> },
            { key: 'subscription', header: 'Subscription', render: (r) => {
              const s = r.subscription;
              if (!s) return <span className="text-xs text-slate-400">none</span>;
              const m = pickMeta(SUBSCRIPTION_STATUS_META, s.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'onboarding', header: 'Storefront', render: (r) => (
              <Badge tone={r.store?.isPublished ? 'emerald' : 'slate'}>
                {r.store?.isPublished ? 'Published' : 'Draft'}
              </Badge>
            ) },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'emerald' : 'rose'}>{r.status}</Badge> },
            { key: 'createdAt', header: 'Joined', render: (r) => fmtDate(r.createdAt) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      <Modal
        open={Boolean(selectedTenant)}
        onClose={() => setSelected(null)}
        title={selectedTenant?.name}
        subtitle={`@${selectedTenant?.slug}`}
      >
        {selectedTenant ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Plan</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{titleCase(selectedTenant.plan)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
                <p className="mt-0.5 text-sm font-bold capitalize text-slate-800">{selectedTenant.status}</p>
              </div>
            </div>
            {selectedTenant.subscription ? (
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-800">{selectedTenant.subscription.planSnapshot?.name} plan</p>
                  <Badge tone={pickMeta(SUBSCRIPTION_STATUS_META, selectedTenant.subscription.status).tone}>
                    {pickMeta(SUBSCRIPTION_STATUS_META, selectedTenant.subscription.status).label}
                  </Badge>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs text-slate-500">
                  <div className="flex justify-between"><dt>Period</dt><dd className="font-medium text-slate-700">{periodLabel({ from: selectedTenant.subscription.periodStart, to: selectedTenant.subscription.periodEnd })}</dd></div>
                  <div className="flex justify-between"><dt>Commission</dt><dd className="font-medium text-slate-700">{bpsToPct(selectedTenant.subscription.commissionRateBps)}</dd></div>
                  <div className="flex justify-between"><dt>Marketplace mode</dt><dd className="font-medium text-slate-700">{selectedTenant.features?.marketplaceEnabled ? 'On' : 'Off'}</dd></div>
                </dl>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No active subscription for this tenant.</p>
            )}
          </div>
        ) : (
          <LoadingBlock />
        )}
      </Modal>
    </div>
  );
}
