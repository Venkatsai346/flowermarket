import { useEffect, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import {
  TAX_REGISTRATION_TYPE_META, emptyRegistration, registrationPayload, registrationToForm,
} from './taxMeta.js';

export default function RegistrationPanel({ data, loading, refreshKey, onChanged }) {
  const action = useAction();
  const [form, setForm] = useState(() => (data ? registrationToForm(data) : emptyRegistration()));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(data ? registrationToForm(data) : emptyRegistration());
    setDirty(false);
  }, [data, loading]);

  const registration = data || {};
  const hasRegistration = Boolean(registration.legalName);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setNested = (group, k, v) => {
    setForm((f) => ({ ...f, [group]: { ...f[group], [k]: v } }));
    setDirty(true);
  };

  const submit = async () => {
    try {
      await action.run(() => api.tax.saveRegistration(registrationPayload(form)));
      toast.success('GST registration saved');
      setDirty(false);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const stateHint = form.gstin ? 'State code derives from the GSTIN when left blank.' : 'Leave blank if unregistered; the backend resolves state from the address.';

  return (
    <Card
      title="GST registration"
      subtitle="The legal supplier identity stamped on every issued document."
      actions={
        <Button variant="primary" icon={Save} loading={action.busy} disabled={!form.legalName || !dirty} onClick={submit}>
          Save registration
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Legal name" required>
          <Input maxLength={160} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="Trade name">
          <Input maxLength={160} value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} />
        </Field>
        <Field label="GSTIN" hint={stateHint}>
          <Input className="font-mono uppercase" maxLength={15} value={form.gstin} onChange={(e) => set('gstin', e.target.value)} placeholder="37AAACB1234C1Z5" />
        </Field>
        <Field label="PAN">
          <Input className="font-mono uppercase" maxLength={10} value={form.pan} onChange={(e) => set('pan', e.target.value)} />
        </Field>
        <Field label="State code">
          <Input className="font-mono" maxLength={2} value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)} placeholder="37" />
        </Field>
        <Field label="Registration type">
          <Select value={form.registrationType} onChange={(e) => set('registrationType', e.target.value)}>
            {Object.entries(TAX_REGISTRATION_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Turnover band">
          <Select value={form.turnoverBand} onChange={(e) => set('turnoverBand', e.target.value)}>
            <option value="lt_5cr">Below ₹5 crore</option>
            <option value="gte_5cr">At or above ₹5 crore</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox label="E-invoice enabled" checked={form.einvoiceEnabled} onChange={(e) => set('einvoiceEnabled', e.target.checked)} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Address line 1">
          <Input maxLength={200} value={form.address.line1} onChange={(e) => setNested('address', 'line1', e.target.value)} />
        </Field>
        <Field label="Address line 2">
          <Input maxLength={200} value={form.address.line2} onChange={(e) => setNested('address', 'line2', e.target.value)} />
        </Field>
        <Field label="City">
          <Input maxLength={80} value={form.address.city} onChange={(e) => setNested('address', 'city', e.target.value)} />
        </Field>
        <Field label="State">
          <Input maxLength={80} value={form.address.state} onChange={(e) => setNested('address', 'state', e.target.value)} />
        </Field>
        <Field label="PIN code">
          <Input maxLength={10} value={form.address.pincode} onChange={(e) => setNested('address', 'pincode', e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Billing email">
          <Input type="email" maxLength={160} value={form.contact.email} onChange={(e) => setNested('contact', 'email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input maxLength={20} value={form.contact.phone} onChange={(e) => setNested('contact', 'phone', e.target.value)} />
        </Field>
        <Field label="Invoice footer" className="sm:col-span-2">
          <Textarea maxLength={1000} value={form.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder="Registered office …" />
        </Field>
        <Field label="Invoice terms" className="sm:col-span-2">
          <Textarea maxLength={2000} value={form.invoiceTerms} onChange={(e) => set('invoiceTerms', e.target.value)} />
        </Field>
        <Field label="Signature URL">
          <Input type="url" value={form.signatureUrl} onChange={(e) => set('signatureUrl', e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Landmark className="h-4 w-4 shrink-0 text-slate-400" />
        <span>
          {hasRegistration
            ? registration.status === 'active'
              ? 'Registration is active — documents will be issued under this legal identity.'
              : 'Registration is inactive. Recheck before issuing documents.'
            : 'No registration yet. Unregistered documents are produced with a synthetic supplier and flagged for review.'}
        </span>
      </div>
    </Card>
  );
}
