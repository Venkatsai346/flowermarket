import { useState } from 'react';
import { Percent } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { emptyTax, taxPayload } from './policiesMeta.js';

export default function TaxPolicyModal({ categories = [], onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptyTax());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await action.run(() => api.policies.upsertTaxPolicy(taxPayload(form)));
      toast.success('Tax policy upserted (active for category)');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Set GST rate"
      subtitle="GST is a legal classification — one active slab per category."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Percent} loading={action.busy} disabled={!form.categoryId || form.gstSlabPct === ''} onClick={submit}>Upsert</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Select category</option>
            {categories.map((c) => <option key={rid(c)} value={rid(c)}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="GST slab (%)" required hint="0 = nil/exempt; enter the full slab">
          <Input type="number" min="0" max="100" step="0.01" value={form.gstSlabPct} onChange={(e) => set('gstSlabPct', e.target.value)} />
        </Field>
        <Field label="HSN code" hint="Optional statutory classification.">
          <Input value={form.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} placeholder="0603" />
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
    </Modal>
  );
}
