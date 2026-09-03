import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

export default function FailDeliveryModal({ delivery, onClose, onDone }) {
  const [failReason, setFailReason] = useState('');
  const action = useAction();

  const submit = async () => {
    const id = delivery.id || delivery._id;
    try {
      // Wire shape matches riderActionSchema: fail_reason.
      await action.run(() => api.rider.fail(id, { fail_reason: failReason || undefined }));
      toast.success('Delivery failure recorded');
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
      title="Record delivery failure"
      subtitle={`Order ${delivery.orderId} · the saga will retry or cancel automatically`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" icon={AlertTriangle} loading={action.busy} disabled={!failReason} onClick={submit}>Save failure</Button>
        </>
      }
    >
      <Field label="Failure reason" required hint="Describe what happened at the door — customer unavailable, wrong address, refused package…">
        <Input value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Customer unavailable" />
      </Field>
    </Modal>
  );
}
