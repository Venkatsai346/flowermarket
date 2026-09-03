import { useMemo, useState } from 'react';
import { FileCheck2, Tag } from 'lucide-react';
import { fmtDate, inr, pickMeta } from '@flower-market/shared';
import { rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import CouponModal from './CouponModal.jsx';
import CouponPreviewModal from './CouponPreviewModal.jsx';
import { COUPON_STATUS_META, DISCOUNT_TYPE_META } from './policiesMeta.js';

export default function CouponsPanel({ coupons, onChanged }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [couponModal, setCouponModal] = useState(false);
  const [previewModal, setPreviewModal] = useState(false);

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
          <Button variant="secondary" icon={FileCheck2} onClick={() => setPreviewModal(true)}>Preview coupon</Button>
          <Button variant="primary" icon={Tag} onClick={() => setCouponModal(true)}>New coupon</Button>
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

      {couponModal && (
        <CouponModal
          onClose={() => {
            setCouponModal(false);
            onChanged?.();
          }}
        />
      )}
      {previewModal && <CouponPreviewModal onClose={() => setPreviewModal(false)} />}
    </Card>
  );
}
