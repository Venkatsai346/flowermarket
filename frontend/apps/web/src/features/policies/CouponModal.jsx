import { useState } from 'react';
import { Tag } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field.jsx';
import { couponPayload, DISCOUNT_TYPE_OPTIONS, emptyCoupon } from './policiesMeta.js';

export default function CouponModal({ onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptyCoupon());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      const r = await action.run(() => api.policies.createCoupon(couponPayload(form)));
      toast.success(`Coupon ${r.data?.code || ''} created`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New coupon"
      subtitle="Code is stored uppercase; platform-wide coupons apply to every tenant."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Tag} loading={action.busy} disabled={!form.code || form.value === ''} onClick={submit}>Create coupon</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          <Input className="font-mono uppercase" maxLength={32} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="WELCOME10" />
        </Field>
        <Field label="Discount type" required>
          <Select value={form.discountType} onChange={(e) => set('discountType', e.target.value)}>
            {DISCOUNT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label={form.discountType === 'flat' ? 'Flat discount (₹)' : 'Discount (%)'} required>
          <Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => set('value', e.target.value)} />
        </Field>
        <Field label="Min cart value (₹)" hint="Blank = no minimum.">
          <Input type="number" min="0" step="0.01" value={form.minCartValue} onChange={(e) => set('minCartValue', e.target.value)} />
        </Field>
        <Field label="Max discount cap (₹)" hint="Blank = uncapped. Useful for percent coupons.">
          <Input type="number" min="0" step="0.01" value={form.maxDiscountCap} onChange={(e) => set('maxDiscountCap', e.target.value)} />
        </Field>
        <Field label="Usage limit per customer" hint="Blank = unlimited.">
          <Input type="number" min="1" step="1" value={form.usageLimitPerCustomer} onChange={(e) => set('usageLimitPerCustomer', e.target.value)} />
        </Field>
        <Field label="Valid from">
          <Input type="date" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
        </Field>
        <Field label="Valid to">
          <Input type="date" min={form.validFrom || undefined} value={form.validTo} onChange={(e) => set('validTo', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <Checkbox label="Platform-wide (usable in every tenant)" checked={form.isPlatformWide} onChange={(e) => set('isPlatformWide', e.target.checked)} />
      </div>
    </Modal>
  );
}
