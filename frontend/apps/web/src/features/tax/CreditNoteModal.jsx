import { useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { CREDIT_NOTE_REASON_META } from './taxMeta.js';

export default function CreditNoteModal({ onClose }) {
  const action = useAction();
  const [mode, setMode] = useState('invoice'); // invoice | refund
  const [invoiceId, setInvoiceId] = useState('');
  const [refundTransactionId, setRefundTransactionId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('return');

  const canSave = mode === 'invoice'
    ? Boolean(invoiceId.trim()) && amount !== ''
    : Boolean(refundTransactionId.trim());

  const submit = async () => {
    try {
      const body = mode === 'invoice'
        ? { invoiceId: invoiceId.trim(), amount: Number(amount), reason }
        : { refundTransactionId: refundTransactionId.trim(), reason };
      const r = await action.run(() => api.tax.issueCreditNote(body));
      const docs = r.data?.documents || r.data?.document ? [r.data?.document || r.data?.documents].flat() : [];
      toast.success(`Issued ${docs.length || 1} credit note(s)`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Issue credit note"
      subtitle="A legal correction to an invoice or a refund transaction."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={ReceiptText} loading={action.busy} disabled={!canSave} onClick={submit}>Issue credit note</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {[['invoice', 'Against invoice'], ['refund', 'Against refund']].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${mode === v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {mode === 'invoice' ? (
          <div className="space-y-3">
            <Field label="Invoice ID" required>
              <Input className="font-mono" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
            </Field>
            <Field label="Amount (₹)" required hint="Partial and full credit notes are supported.">
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Refund transaction ID" required>
            <Input className="font-mono" value={refundTransactionId} onChange={(e) => setRefundTransactionId(e.target.value)} />
          </Field>
        )}

        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(CREDIT_NOTE_REASON_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
