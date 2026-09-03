import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { ADJUSTMENT_TYPE_OPTIONS, adjustPayload, emptyAdjust } from './inventoryMeta.js';

export default function AdjustStockModal({ row, onClose }) {
  const action = useAction();
  const [form, setForm] = useState(() => emptyAdjust(row));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const qty = Number(form.qtyChange);
  const invalidQty = !Number.isInteger(qty) || qty === 0 || (form.type !== 'restock' && form.type !== 'return_restock' && qty > 0);
  const canSave = form.reason.trim().length >= 3 && !invalidQty;

  const submit = async () => {
    try {
      await action.run(() => api.admin.adjustInventory(row.listingId || row.id, adjustPayload(form)));
      toast.success('Inventory adjusted — ledger row appended');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust stock"
      subtitle="Atomic adjustment with an append-only ledger row."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={SlidersHorizontal} loading={action.busy} disabled={!canSave} onClick={submit}>Apply adjustment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">{row.title || row.skuGlobal || row.listingId}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            On hand {row.qtyOnHand ?? 0} · reserved {row.qtyReserved ?? 0} · available {row.available ?? 0}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Adjustment type" required>
            <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
              {ADJUSTMENT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Quantity change" required hint="Positive for restock, negative for shrinkage/audit.">
            <Input type="number" step="1" value={form.qtyChange} onChange={(e) => set('qtyChange', e.target.value)} placeholder="+10 or -2" />
          </Field>
        </div>

        {invalidQty && form.qtyChange !== '' && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Enter a non-zero whole number. Restock/return must be positive; shrinkage/audit must be negative.
          </p>
        )}

        <Field label="Reason" required hint="At least 3 characters — recorded for audit.">
          <Input maxLength={300} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="New stock arrived, damaged in transit…" />
        </Field>
        <Field label="Note">
          <Textarea maxLength={500} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
