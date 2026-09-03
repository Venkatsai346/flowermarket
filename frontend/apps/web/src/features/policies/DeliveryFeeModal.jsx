import { useState } from 'react';
import { Truck } from 'lucide-react';
import { fmtDate } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
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

export function DeliveryFeeList({ data, loading, onNew, onEdit }) {
  const rows = data || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} policy version(s) · at most one active</p>
        <Button variant="primary" icon={Truck} onClick={onNew}>New policy</Button>
      </div>
      {rows.map((p, i) => (
        <div key={rid(p) || i} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-800">{p.name || 'default'}</p>
              {p.isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Inactive</Badge>}
              <span className="text-xs text-slate-400">v{p.version || 1}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              ₹{p.baseFee}
              {p.freeDeliveryThreshold != null ? ` · free over ₹${p.freeDeliveryThreshold}` : ' · never free'}
              {p.expressSurgeMultiplier != null ? ` · express ×${p.expressSurgeMultiplier}` : ''}
              {p.distanceFeePerKm != null ? ` · +₹${p.distanceFeePerKm}/km` : ''}
            </p>
            {(p.effectiveFrom || p.effectiveTo) && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                {p.effectiveFrom ? `From ${fmtDate(p.effectiveFrom)}` : ''}{p.effectiveTo ? ` → ${fmtDate(p.effectiveTo)}` : ''}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => onEdit(p)}>Edit</Button>
        </div>
      ))}
      {!rows.length && <p className="text-sm text-slate-400">No delivery fee policies yet — create the first one.</p>}
    </div>
  );
}
