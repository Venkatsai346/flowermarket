import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { emptyStatutoryRate, statutoryRatePayload } from './taxMeta.js';

export default function StatutoryRateModal({ onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptyStatutoryRate());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await action.run(() => api.tax.saveStatutoryRate(statutoryRatePayload(form)));
      toast.success('Statutory rate version created');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add statutory rate"
      subtitle="Add a new effective-dated row when the rate changes — never edit a past one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Landmark} loading={action.busy} disabled={form.ratePct === ''} onClick={submit}>Create version</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rate kind" required>
          <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="tcs_gst_52">TCS — GST s.52</option>
            <option value="tds_194o">TDS — IT s.194-O</option>
          </Select>
        </Field>
        <Field label="Rate (%)" required hint="1% = 100 basis points; stored as bps.">
          <Input type="number" min="0" step="0.01" value={form.ratePct} onChange={(e) => set('ratePct', e.target.value)} />
        </Field>
        <Field label="Applies to">
          <Select value={form.appliesTo} onChange={(e) => set('appliesTo', e.target.value)}>
            <option value="net_taxable">Net taxable value</option>
            <option value="gross_sales">Gross sales</option>
          </Select>
        </Field>
        <Field label="Effective from" hint="Defaults to today.">
          <Input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        </Field>
        <Field label="Notification reference" className="sm:col-span-2">
          <Input maxLength={200} value={form.notificationRef} onChange={(e) => set('notificationRef', e.target.value)} />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Textarea maxLength={500} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>
      <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
        The existing open row is closed at this effective date, so historical documents keep their original rate.
      </p>
    </Modal>
  );
}
