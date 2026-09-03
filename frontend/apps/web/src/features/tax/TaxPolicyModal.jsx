import { useState } from 'react';
import { Percent } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { emptyTaxPolicy, taxPolicyPayload } from './taxMeta.js';

export default function TaxPolicyModal({ categories = [], onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptyTaxPolicy());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await action.run(() => api.tax.savePolicy(taxPolicyPayload(form)));
      toast.success('Tax rate policy version created');
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
      subtitle="GST classification is a legal fact — super admin only. A new version supersedes the open one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Percent} loading={action.busy} disabled={!form.categoryId || form.gstSlabPct === ''} onClick={submit}>Create version</Button>
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
        <Field label="GST slab (%)" required hint="18 = 1800 bps.">
          <Input type="number" min="0" max="100" step="0.01" value={form.gstSlabPct} onChange={(e) => set('gstSlabPct', e.target.value)} />
        </Field>
        <Field label="Nature of supply">
          <Select value={form.natureOfSupply} onChange={(e) => set('natureOfSupply', e.target.value)}>
            <option value="taxable">Taxable</option>
            <option value="nil_rated">Nil-rated</option>
            <option value="exempt">Exempt</option>
            <option value="zero_rated">Zero-rated (export/SEZ)</option>
            <option value="non_gst">Non-GST</option>
          </Select>
        </Field>
        <Field label="Cess (%)">
          <Input type="number" min="0" step="0.01" value={form.cessBps} onChange={(e) => set('cessBps', e.target.value)} />
        </Field>
        <Field label="HSN code">
          <Input maxLength={16} value={form.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} placeholder="0603" />
        </Field>
        <Field label="Effective from" hint="Defaults to today.">
          <Input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
