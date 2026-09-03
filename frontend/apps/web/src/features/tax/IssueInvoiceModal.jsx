import { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input } from '../../components/ui/Field.jsx';

export default function IssueInvoiceModal({ onClose }) {
  const action = useAction();
  const [orderId, setOrderId] = useState('');
  const [force, setForce] = useState(false);

  const submit = async () => {
    try {
      const r = await action.run(() => api.tax.issueInvoice({ orderId: orderId.trim(), force }));
      const docs = r.data || [];
      toast.success(docs.length ? `Issued ${docs.length} invoice(s)` : 'Invoices already issued');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Issue tax invoice"
      subtitle="One document per selling entity. Already-issued orders return the existing invoices."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={FilePlus2} loading={action.busy} disabled={!orderId.trim()} onClick={submit}>Issue invoice</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Order ID" required>
          <Input className="font-mono" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order id from the orders screen" />
        </Field>
        <Checkbox
          label="Force issue (skip the confirmed-supply state check)"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
        />
        <p className="text-xs text-slate-400">
          The backend invoices only confirmed, picking, packed, out-for-delivery or delivered orders unless force is checked.
        </p>
      </div>
    </Modal>
  );
}
