import { useState } from 'react';
import { Landmark, Plus, RefreshCw } from 'lucide-react';
import { fmtDate, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import {
  STATUTORY_RATE_KIND_META, STATUTORY_APPLIES_TO_META, TAX_NATURE_OF_SUPPLY_META, bpsToPct,
} from './taxMeta.js';
import TaxPolicyModal from './TaxPolicyModal.jsx';
import StatutoryRateModal from './StatutoryRateModal.jsx';

export default function RatePoliciesPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [policyModal, setPolicyModal] = useState(false);
  const [statModal, setStatModal] = useState(false);
  const { data, loading, error } = useApi(
    () => Promise.all([
      api.tax.policies(),
      api.tax.statutoryRates(),
      api.catalogAdmin.categories({ limit: 100, includeInactive: true }),
    ]).then(([policies, rates, cats]) => ({
      policies: policies.data || [],
      statutoryRates: rates.data || [],
      categories: cats.data || [],
    })),
    [refreshKey],
  );

  const categories = data?.categories || [];
  const catName = (id) => categories.find((c) => rid(c) === id)?.name || id;

  if (loading && !data) return <Card title="Rates & policies"><LoadingBlock /></Card>;
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-700">Rate policies are platform-only</p>
        <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card
        title="GST rate policies"
        subtitle="Category-level legal classification — one active slab per category, effective-dated."
        actions={<Button variant="primary" icon={Plus} onClick={() => setPolicyModal(true)}>Set rate</Button>}
        bodyClassName="p-0!"
      >
        <div className="divide-y divide-slate-100">
          {(data?.policies || []).map((p, i) => (
            <div key={p.id || i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{catName(p.categoryId)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  HSN {p.hsnCode || '—'} · {p.rateBps != null ? `${bpsToPct(p.rateBps)}%` : `${p.gstSlabPct}%`}
                  {p.cessBps ? ` · cess ${bpsToPct(p.cessBps)}%` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={pickMeta(TAX_NATURE_OF_SUPPLY_META, p.natureOfSupply).tone}>{pickMeta(TAX_NATURE_OF_SUPPLY_META, p.natureOfSupply).label}</Badge>
                {p.isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Superseded</Badge>}
                <span className="text-xs text-slate-400">{p.effectiveFrom ? `from ${fmtDate(p.effectiveFrom)}` : ''}</span>
              </div>
            </div>
          ))}
          {!data?.policies?.length && <div className="px-5 py-6 text-sm text-slate-400">No GST rate policies configured.</div>}
        </div>
      </Card>

      <Card
        title="Statutory rates"
        subtitle="TCS/TDS timelines are data, updated by notification — add a new row, never edit a past one."
        actions={
          <>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => setRefreshKey((k) => k + 1)}>Refresh</Button>
            <Button variant="primary" icon={Landmark} onClick={() => setStatModal(true)}>Add rate</Button>
          </>
        }
        bodyClassName="p-0!"
      >
        <div className="divide-y divide-slate-100">
          {(data?.statutoryRates || []).map((r, i) => (
            <div key={r.id || i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{pickMeta(STATUTORY_RATE_KIND_META, r.kind).label}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {pickMeta(STATUTORY_APPLIES_TO_META, r.appliesTo).label} · {r.notificationRef || 'no notification ref'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900">{bpsToPct(r.rateBps)}%</span>
                <span className="text-xs text-slate-400">{r.effectiveFrom ? `from ${fmtDate(r.effectiveFrom)}` : ''}{r.effectiveTo ? ` → ${fmtDate(r.effectiveTo)}` : ''}</span>
              </div>
            </div>
          ))}
          {!data?.statutoryRates?.length && <div className="px-5 py-6 text-sm text-slate-400">No statutory rates configured.</div>}
        </div>
      </Card>

      {policyModal && <TaxPolicyModal categories={categories} onClose={() => { setPolicyModal(false); setRefreshKey((k) => k + 1); }} />}
      {statModal && <StatutoryRateModal onClose={() => { setStatModal(false); setRefreshKey((k) => k + 1); }} />}
    </div>
  );
}
