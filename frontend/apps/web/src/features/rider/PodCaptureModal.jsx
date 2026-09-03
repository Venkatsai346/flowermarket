import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { POD_OPTIONS } from './riderMeta.js';

export default function PodCaptureModal({ delivery, onClose, onDone }) {
  const [podType, setPodType] = useState('otp');
  const [podReference, setPodReference] = useState('');
  const action = useAction();

  const submit = async () => {
    const id = delivery.id || delivery._id;
    try {
      // Wire shape matches riderActionSchema: pod_type + pod_reference.
      await action.run(() => api.rider.complete(id, {
        pod_type: podType,
        pod_reference: podReference || undefined,
      }));
      toast.success('Delivered — POD captured');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Complete delivery"
      subtitle={`Order ${delivery.orderId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" icon={CheckCircle2} loading={action.busy} disabled={!podReference} onClick={submit}>Confirm delivery</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="POD type" required>
          <Select value={podType} onChange={(e) => setPodType(e.target.value)}>
            {POD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field
          label={podType === 'otp' ? 'OTP' : 'Photo / signature reference'}
          required
          hint={podType === 'otp' ? 'Enter the exact 4-digit OTP the customer shared.' : 'Paste the media URL captured from the customer.'}
        >
          <Input
            value={podReference}
            onChange={(e) => setPodReference(e.target.value)}
            placeholder={podType === 'otp' ? '1234' : 'https://…'}
          />
        </Field>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          OTPs are hashed by the backend for storage. Photo/signature references are kept as the proof-of-delivery record.
        </div>
      </div>
    </Modal>
  );
}
