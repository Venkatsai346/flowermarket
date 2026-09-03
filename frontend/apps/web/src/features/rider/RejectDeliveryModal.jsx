import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

export default function RejectDeliveryModal({ delivery, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const action = useAction();

  const submit = async () => {
    const id = delivery.id || delivery._id;
    try {
      await action.run(() => api.rider.reject(id, { reason: reason || null }));
      toast.success('Delivery rejected — reassigned');
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
      title="Reject delivery"
      subtitle={`Order ${delivery.orderId} · the assignment is offered to the next available rider`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" icon={RotateCcw} loading={action.busy} onClick={submit}>Reject & reassign</Button>
        </>
      }
    >
      <Field label="Reason (optional)" hint="Repeat rejections can escalate an assignment to manual ops.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hub too far, wrong zone…" />
      </Field>
    </Modal>
  );
}
