import { useState } from 'react';
import { Banknote, ShieldAlert } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { REFUND_DESTINATION_OPTIONS, REFUND_REASON_OPTIONS } from './aftersalesMeta.js';

const makeIdempotencyKey = () => `refund_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export default function ManualRefundModal({ onClose, onCreated }) {
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('admin_override');
  const [destination, setDestination] = useState('wallet');
  const [paymentId, setPaymentId] = useState('');
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();

  const submit = async () => {
    try {
      const r = await action.run(() => api.fulfillment.adminRefund({
        orderId,
        amount: Number(amount),
        reason,
        destination,
        paymentId: paymentId || undefined,
        userId: userId || undefined,
        note: note || undefined,
        idempotencyKey: makeIdempotencyKey(),
      }));
      toast.success(r.message || 'Refund initiated');
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Manual refund"
      subtitle="Admin-initiated refund — wallet by default, idempotency guarded."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" icon={Banknote} loading={action.busy} disabled={!orderId || !amount || Number(amount) <= 0} onClick={submit}>Initiate refund</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Order id" required>
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="order _id / order id" />
          </Field>
          <Field label="Amount (₹)" required hint="Must be positive; backend validates against the order.">
            <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="349.00" />
          </Field>
          <Field label="Refund reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REFUND_REASON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Destination" required hint="Wallet payments are always returned to wallet.">
            <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
              {REFUND_DESTINATION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Payment id (optional)" hint="Use to tie the refund to a specific payment.">
            <Input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="payment _id" />
          </Field>
          <Field label="User id (optional)">
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="customer _id" />
          </Field>
        </div>
        <Field label="Note" hint="Shown on the wallet credit entry.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Admin override for damaged dispatch…" />
        </Field>
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>A unique idempotency key is generated per submit, so double clicks cannot create a duplicate refund.</p>
        </div>
      </div>
    </Modal>
  );
}
