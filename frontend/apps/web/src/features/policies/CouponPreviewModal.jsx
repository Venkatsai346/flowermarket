import { useState } from 'react';
import { SearchCheck } from 'lucide-react';
import { inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import { DISCOUNT_TYPE_META } from './policiesMeta.js';

export default function CouponPreviewModal({ onClose }) {
  const action = useAction();
  const [code, setCode] = useState('');
  const [cartSubtotal, setCartSubtotal] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async () => {
    setError(null);
    setResult(null);
    try {
      const r = await action.run(() => api.policies.previewCoupon({ code: code.trim(), cartSubtotal: Number(cartSubtotal) }));
      setResult(r.data);
    } catch (e) {
      toast.error(errMsg(e));
      setError(errMsg(e));
    }
  };

  const discount = Number(result?.discountAmount ?? 0);
  const final = Math.max(0, Number(cartSubtotal) - discount);

  return (
    <Modal
      open
      onClose={onClose}
      title="Coupon preview"
      subtitle="Validate a code against a hypothetical cart before publishing it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={SearchCheck} loading={action.busy} disabled={!code || cartSubtotal === ''} onClick={submit}>Preview</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          <Input
            className="font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="WELCOME10"
          />
        </Field>
        <Field label="Cart subtotal (₹)" required>
          <Input type="number" min="0" step="0.01" value={cartSubtotal} onChange={(e) => setCartSubtotal(e.target.value)} />
        </Field>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {result && !error && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm">
          <div className="flex justify-between text-slate-700"><span>Cart subtotal</span><span>{inr(cartSubtotal)}</span></div>
          <div className="flex justify-between text-emerald-700">
            <span>Coupon {result.code || code}{result.discountType ? ` · ${pickMeta(DISCOUNT_TYPE_META, result.discountType).label}` : ''}</span>
            <span>− {inr(discount)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-emerald-100 pt-2 text-base font-bold text-slate-900">
            <span>Payable</span><span>{inr(final)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
