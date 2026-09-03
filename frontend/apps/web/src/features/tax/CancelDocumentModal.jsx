import { useState } from 'react';
import { Ban } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Textarea } from '../../components/ui/Field.jsx';

export default function CancelDocumentModal({ document, onClose }) {
  const action = useAction();
  const [reason, setReason] = useState('');
  const number = document?.number || document?.id;

  const submit = async () => {
    try {
      await action.run(() => api.tax.cancelDocument(document.id || document._id, { reason: reason.trim() }));
      toast.success(`Document ${number} cancelled`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel document"
      subtitle="Cancellation is irreversible and keeps the number for gapless series."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep document</Button>
          <Button variant="danger" icon={Ban} loading={action.busy} disabled={reason.trim().length < 3} onClick={submit}>Cancel document</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Cancelling <span className="font-mono font-semibold">{number}</span>. An invoice with an issued
          credit note cannot be cancelled — issue the correction instead.
        </p>
        <Field label="Reason" required hint="At least 3 characters; recorded for audit.">
          <Textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong buyer GSTIN, duplicate entry…" />
        </Field>
      </div>
    </Modal>
  );
}
