import { useState } from 'react';
import { Truck } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import {
  deliveryFeePayload, deliveryFeeToForm, emptyDeliveryFee,
} from './policiesMeta.js';

export default function DeliveryFeeModal({ onChange, onClose }) {
  const action = useAction();
  const [form, setForm] = useState(() => (onChange ? deliveryFeeToForm(onChange) : emptyDeliveryFee()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isEdit = Boolean(onChange);

  const submit = async () => {
    try {
      const body = deliveryFeePayload(form);
      await action.run(() =>
        isEdit
          ? api.policies.updateDeliveryFee(onChange.id || onChange._id, body)
          : api.policies.createDeliveryFee(body)
      );
      toast.success(isEdit ? 'Delivery fee policy updated' : 'Delivery fee policy created (now active)');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit · ${onChange.name || 'default'}` : 'New delivery fee policy'}
      subtitle="Creating a policy immediately deactivates the previous active one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Truck} loading={action.busy} disabled={form.baseFee === ''} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create & activate'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Base fee (₹)" required>
          <Input type="number" min="0" step="0.01" value={form.baseFee} onChange={(e) => set('baseFee', e.target.value)} />
        </Field>
        <Field label="Free-delivery threshold (₹)" hint="Blank = never free.">
          <Input type="number" min="0" step="0.01" value={form.freeDeliveryThreshold} onChange={(e) => set('freeDeliveryThreshold', e.target.value)} />
        </Field>
        <Field label="Express surge multiplier" hint="Used for express slots (blank = default, must be at least 1).">
          <Input type="number" min="1" step="0.1" value={form.expressSurgeMultiplier} onChange={(e) => set('expressSurgeMultiplier', e.target.value)} />
        </Field>
        <Field label="Distance fee per km (₹)" hint="Blank = not zone-priced.">
          <Input type="number" min="0" step="0.01" value={form.distanceFeePerKm} onChange={(e) => set('distanceFeePerKm', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from">
            <Input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          </Field>
          <Field label="Effective to">
            <Input type="date" min={form.effectiveFrom || undefined} value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          </Field>
        </div>
      </div>
      <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        Fee = base × express surge (when express) + distance fee (when zone-priced); fee is waived when the cart meets the free-delivery threshold.
      </p>
    </Modal>
  );
}
