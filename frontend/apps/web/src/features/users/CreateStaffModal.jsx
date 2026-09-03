import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { emptyStaff, staffPayload, STAFF_ROLE_OPTIONS } from './userMeta.js';

export default function CreateStaffModal({ onClose }) {
  const { data: hubs } = useApi(() => api.admin.hubs(), []);
  const action = useAction();
  const [form, setForm] = useState(emptyStaff());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.phoneNumber.trim() || form.email.trim();

  const submit = async () => {
    try {
      await action.run(() => api.admin.createStaff(staffPayload(form)));
      toast.success('Staff user created');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create staff user"
      subtitle="Role is limited to admin, picker or rider — super_admin can never be minted here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={UserPlus} loading={action.busy} disabled={!canSave} onClick={submit}>Create staff</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" required>
          <Select value={form.role} onChange={(e) => set('role', e.target.value)}>
            {STAFF_ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Phone country code">
          <Input value={form.phoneCountryCode} onChange={(e) => set('phoneCountryCode', e.target.value)} placeholder="+91" />
        </Field>
        <Field label="Phone number" hint="One of phone or email is required.">
          <Input inputMode="numeric" maxLength={15} value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} />
        </Field>
        <Field label="Email" hint="One of phone or email is required.">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="First name">
          <Input maxLength={60} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input maxLength={60} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Password" hint="Optional. Requires at least 8 characters if set.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        {form.role === 'rider' && (
          <Field label="Assigned hub">
            <Select value={form.hubId} onChange={(e) => set('hubId', e.target.value)}>
              <option value="">No hub yet</option>
              {(hubs || []).map((h) => <option key={h.id || h._id} value={h.id || h._id}>{h.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
