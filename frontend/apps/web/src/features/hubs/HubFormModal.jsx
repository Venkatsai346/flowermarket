import { useState } from 'react';
import { Store } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Field.jsx';
import { emptyHub, hubCreatePayload, hubToForm, hubUpdatePayload } from '../inventory/inventoryMeta.js';

export default function HubFormModal({ hub, onClose }) {
  const action = useAction();
  const isEdit = Boolean(hub);
  const [form, setForm] = useState(() => (hub ? hubToForm(hub) : emptyHub()));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.name.trim() && (!isEdit && form.code.trim() || isEdit);

  const submit = async () => {
    try {
      if (isEdit) {
        await action.run(() => api.admin.updateHub(hub.id || hub._id, hubUpdatePayload(form)));
        toast.success('Hub updated');
      } else {
        await action.run(() => api.admin.createHub(hubCreatePayload(form)));
        toast.success('Hub created');
      }
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit hub' : 'Create hub'}
      subtitle="The dark store that services a set of pincodes."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Store} loading={action.busy} disabled={!canSave} onClick={submit}>
            {isEdit ? 'Save hub' : 'Create hub'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Code" required={!isEdit} hint={isEdit ? 'Code is fixed after creation.' : 'Unique per store.'}>
          <Input className="font-mono uppercase" maxLength={40} value={form.code} disabled={isEdit} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Address line 1">
          <Input maxLength={160} value={form.line1} onChange={(e) => set('line1', e.target.value)} />
        </Field>
        <Field label="City">
          <Input maxLength={80} value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State">
          <Input maxLength={80} value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field label="Hub PIN">
          <Input maxLength={12} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} />
        </Field>
        <Field label="Longitude" hint="Used for nearest-node allocation.">
          <Input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} />
        </Field>
        <Field label="Latitude" hint="Used for nearest-node allocation.">
          <Input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} />
        </Field>
        <Field label="Default slot capacity" hint="Forecast can override this per day.">
          <Input type="number" min="1" step="1" value={form.defaultSlotCapacity} onChange={(e) => set('defaultSlotCapacity', e.target.value)} />
        </Field>
        <Field label="Fulfillment priority" hint="Lower values are preferred.">
          <Input type="number" min="0" step="1" value={form.fulfillmentPriority} onChange={(e) => set('fulfillmentPriority', e.target.value)} />
        </Field>
        <Field label="Handling time" hint="Minutes before dispatch readiness.">
          <Input type="number" min="0" step="1" value={form.handlingTimeMinutes} onChange={(e) => set('handlingTimeMinutes', e.target.value)} />
        </Field>
        <Field label="Overflow radius" hint="Maximum km for overflow orders; blank means unrestricted.">
          <Input type="number" min="0" step="0.1" value={form.maxDeliveryRadiusKm} onChange={(e) => set('maxDeliveryRadiusKm', e.target.value)} />
        </Field>
        <div className="space-y-2 pt-5">
          <Checkbox label="Fulfillment enabled" checked={form.isFulfillmentEnabled} onChange={(e) => set('isFulfillmentEnabled', e.target.checked)} />
          <Checkbox label="Accept overflow demand" checked={form.acceptsOverflow} onChange={(e) => set('acceptsOverflow', e.target.checked)} />
          <Checkbox label="Active hub" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        </div>
        <Field label="Serviceable pincodes" className="sm:col-span-2" hint="Comma or space-separated 6-digit PINs.">
          <Textarea value={form.pincodes} onChange={(e) => set('pincodes', e.target.value)} placeholder="500001, 500002" />
        </Field>
      </div>
    </Modal>
  );
}
