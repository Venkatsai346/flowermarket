import { useState } from 'react';
import { Percent, RefreshCw, Tag, Truck, WalletCards } from 'lucide-react';
import { inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Stat from '../../components/ui/Stat.jsx';
import DeliveryFeePanel from './DeliveryFeePanel.jsx';
import TaxPanel from './TaxPanel.jsx';
import CouponsPanel from './CouponsPanel.jsx';
import RefundPolicyPanel from './RefundPolicyPanel.jsx';
import { POLICIES_TABS, REFUND_FEE_POLICY_META } from './policiesMeta.js';

const TAB_ICONS = {
  deliveryFee: Truck,
  tax: Percent,
  coupons: Tag,
  refund: WalletCards,
};

export default function PoliciesPage() {
  const [tab, setTab] = useState('deliveryFee');
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useApi(
    () => Promise.all([
      api.policies.deliveryFees(),
      api.policies.taxPolicies(),
      api.policies.coupons(),
      api.policies.refund(),
      api.catalogAdmin.categories({ limit: 100, includeInactive: true }),
    ]).then(([fee, tax, coupon, refundPolicy, cats]) => ({
      deliveryFees: fee.data || [],
      taxPolicies: tax.data || [],
      coupons: coupon.data || [],
      refund: refundPolicy.data || {},
      categories: cats.data || [],
    })),
    [refreshKey],
  );

  const { deliveryFees = [], taxPolicies = [], coupons = [], refund = {}, categories = [] } = data || {};
  const activeFee = deliveryFees.find((x) => x.isActive);
  const activeCoupons = coupons.filter((x) => x.status === 'active').length;
  const activeTax = taxPolicies.filter((x) => x.isActive).length;
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Policies & coupons"
        description="Delivery fees, GST classification, coupon codes and the refund fee rule."
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load policies</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Active delivery fee"
              value={activeFee ? inr(activeFee.baseFee) : '—'}
              sub={activeFee ? `free over ₹${activeFee.freeDeliveryThreshold ?? 'never'}` : 'none configured'}
              icon={Truck}
              tone="sky"
            />
            <Stat label="Active tax policies" value={activeTax} sub="categories with a live slab" icon={Percent} tone="violet" />
            <Stat label="Active coupons" value={activeCoupons} sub={`${coupons.length} total`} icon={Tag} tone="emerald" />
            <Stat
              label="Delivery-fee refund"
              value={pickMeta(REFUND_FEE_POLICY_META, refund.refundDeliveryFeeWhen).label}
              sub={`${refund.refundFeePct ?? 100}% of fee`}
              icon={WalletCards}
              tone="amber"
            />
          </div>

          <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
            {POLICIES_TABS.map(([key, label]) => {
              const Icon = TAB_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                    tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </nav>

          {tab === 'deliveryFee' && (
            <DeliveryFeePanel data={deliveryFees} loading={loading} onChanged={refresh} />
          )}
          {tab === 'tax' && (
            <TaxPanel data={taxPolicies} categories={categories} loading={loading} onChanged={refresh} />
          )}
          {tab === 'coupons' && (
            <CouponsPanel coupons={coupons} onChanged={refresh} />
          )}
          {tab === 'refund' && (
            <RefundPolicyPanel policy={refund} onChanged={refresh} />
          )}
        </>
      )}
    </div>
  );
}
