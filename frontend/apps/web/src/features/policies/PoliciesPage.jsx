import { useEffect, useMemo, useState } from 'react';
import {
  FileCheck2, Percent, RefreshCw, Tag, Truck, WalletCards,
} from 'lucide-react';
import { fmtDate, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import Stat from '../../components/ui/Stat.jsx';
import DeliveryFeeModal, { DeliveryFeeList } from './DeliveryFeeModal.jsx';
import TaxPolicyModal, { TaxPolicyList } from './TaxPolicyModal.jsx';
import CouponModal from './CouponModal.jsx';
import CouponPreviewModal from './CouponPreviewModal.jsx';
import {
  COUPON_STATUS_META, DISCOUNT_TYPE_META, POLICIES_TABS, REFUND_FEE_POLICY_META,
} from './policiesMeta.js';

const TAB_ICONS = {
  deliveryFee: Truck,
  tax: Percent,
  coupons: Tag,
  refund: WalletCards,
};

export default function PoliciesPage() {
  const [tab, setTab] = useState('deliveryFee');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deliveryModal, setDeliveryModal] = useState(null); // {initial?}
  const [taxModal, setTaxModal] = useState(false);
  const [couponModal, setCouponModal] = useState(false);
  const [previewModal, setPreviewModal] = useState(false);

  const { data, loading } = useApi(
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

      {loading && !data ? (
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
        <Card
          title="Delivery fee policies"
          subtitle="Versioned with at-most-one-active. A new policy replaces the previous active one."
          bodyClassName="p-5!"
        >
          <DeliveryFeeList
            data={deliveryFees}
            loading={loading}
            onNew={() => setDeliveryModal({})}
            onEdit={(p) => setDeliveryModal({ initial: p })}
          />
        </Card>
      )}

      {tab === 'tax' && (
        <Card title="GST rate policies" subtitle="Category-level legal classification; one active slab per category." bodyClassName="p-5!">
          <TaxPolicyList data={taxPolicies} categories={categories} loading={loading} onUpsert={() => setTaxModal(true)} />
        </Card>
      )}

      {tab === 'coupons' && <CouponsTab coupons={coupons} onNew={() => setCouponModal(true)} onPreview={() => setPreviewModal(true)} />}

      {tab === 'refund' && <RefundTab policy={refund} onChanged={refresh} />}

      {deliveryModal && (
        <DeliveryFeeModal
          onChange={deliveryModal.initial}
          onClose={() => {
            setDeliveryModal(null);
            refresh();
          }}
        />
      )}
      {taxModal && (
        <TaxPolicyModal
          categories={categories}
          onClose={() => {
            setTaxModal(false);
            refresh();
          }}
        />
      )}
      {couponModal && (
        <CouponModal
          onClose={() => {
            setCouponModal(false);
            refresh();
          }}
        />
      )}
      {previewModal && <CouponPreviewModal onClose={() => setPreviewModal(false)} />}
        </>
      )}
    </div>
  );
}

function CouponsTab({ coupons, onNew, onPreview }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const rows = useMemo(
    () => (coupons || []).filter((c) => {
      if (status && c.status !== status) return false;
      if (search && !String(c.code || '').toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    }),
    [coupons, search, status],
  );

  const copy = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error('Copy failed — clipboard unavailable');
    }
  };

  return (
    <Card
      title="Coupons"
      subtitle="Tenant-scoped and platform-wide discount codes."
      actions={
        <>
          <Button variant="secondary" icon={FileCheck2} onClick={onPreview}>Preview coupon</Button>
          <Button variant="primary" icon={Tag} onClick={onNew}>New coupon</Button>
        </>
      }
      bodyClassName="p-0!"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <Input
          className="min-w-[220px] flex-1!"
          placeholder="Search coupon code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select className="w-48!" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(COUPON_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </Select>
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map((c, i) => (
          <div key={rid(c) || i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-xs font-bold text-white">{c.code}</span>
                <Badge tone={pickMeta(DISCOUNT_TYPE_META, c.discountType).tone}>
                  {pickMeta(DISCOUNT_TYPE_META, c.discountType).label}
                </Badge>
                <Badge tone={pickMeta(COUPON_STATUS_META, c.status).tone} dot>
                  {pickMeta(COUPON_STATUS_META, c.status).label}
                </Badge>
                {c.tenantId === null && <Badge tone="violet">Platform-wide</Badge>}
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-800">
                {c.discountType === 'flat' ? inr(c.value) : `${c.value}%`}
                {c.maxDiscountCap != null ? ` · cap ${inr(c.maxDiscountCap)}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Min cart {inr(c.minCartValue || 0)}
                {c.usageLimitPerCustomer ? ` · ${c.usageLimitPerCustomer}/customer` : ' · unlimited per customer'}
                {(c.validFrom || c.validTo) ? ` · ${c.validFrom ? fmtDate(c.validFrom) : '—'}${c.validTo ? ` → ${fmtDate(c.validTo)}` : ''}` : ''}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => copy(c.code)}>Copy code</Button>
          </div>
        ))}
        {!rows.length && (
          <div className="p-6">
            <EmptyState icon={Tag} title="No coupons found" message="Create your first coupon or clear the filters." />
          </div>
        )}
      </div>
    </Card>
  );
}

function RefundTab({ policy, onChanged }) {
  const action = useAction();
  const [when, setWhen] = useState(policy?.refundDeliveryFeeWhen || 'full_order_return_only');
  const [pct, setPct] = useState(policy?.refundFeePct ?? 100);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setWhen(policy?.refundDeliveryFeeWhen || 'full_order_return_only');
    setPct(policy?.refundFeePct ?? 100);
    setDirty(false);
  }, [policy]);

  const setWhenValue = (v) => { setWhen(v); setDirty(true); };
  const setPctValue = (v) => { setPct(v); setDirty(true); };

  const submit = async () => {
    try {
      await action.run(() => api.policies.updateRefund({ refundDeliveryFeeWhen: when, refundFeePct: Number(pct) }));
      toast.success('Refund policy updated');
      setDirty(false);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card title="Refund policy" subtitle="Whether the delivery fee is refunded when an order is returned.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Refund delivery fee when" required>
          <Select value={when} onChange={(e) => setWhenValue(e.target.value)}>
            {Object.entries(REFUND_FEE_POLICY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Fee refund %" required hint="How much of the delivery fee is refunded.">
          <Input
            type="number"
            min="0"
            max="100"
            step="1"
            value={pct}
            onChange={(e) => setPctValue(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <Badge tone={pickMeta(REFUND_FEE_POLICY_META, when).tone} dot>{pickMeta(REFUND_FEE_POLICY_META, when).label}</Badge>
        <span>Applies to future return calculations · {pct}% of fee</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={WalletCards} loading={action.busy} disabled={!dirty} onClick={submit}>
          Save refund policy
        </Button>
        {!dirty && <span className="text-xs text-slate-400">No unsaved changes</span>}
      </div>
    </Card>
  );
}
