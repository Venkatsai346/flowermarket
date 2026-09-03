import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

export default function SlotCapacityModal({ slot, onClose }) {
  const action = useAction();
  const [manualCapacity, setManualCapacity] = useState(slot.effectiveCapacity ?? slot.totalCapacity ?? 50);
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState('');
  const canSave = Number(manualCapacity) >= 1 && reason.trim().length >= 3;

  const submit = async () => {
    setServerError('');
    try {
      await action.run(() => api.admin.overrideSlot(slot.id || slot._id, { manualCapacity: Number(manualCapacity), reason: reason.trim() }));
      toast.success('Slot capacity overridden');
      onClose();
    } catch (e) {
      const belowReserved = e?.code === 'CAPACITY_BELOW_RESERVED' || /CAPACITY_BELOW_RESERVED|below/.test(errMsg(e));
      if (belowReserved) setServerError(errMsg(e));
      else toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Capacity · ${slot.date} ${slot.startTime}`}
      subtitle="The atomic reservation gate honors this value immediately."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Gauge} loading={action.busy} disabled={!canSave} onClick={submit}>Override capacity</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center">
          <div><p className="text-xs text-slate-400">Base</p><p className="font-semibold">{slot.totalCapacity ?? '—'}</p></div>
          <div><p className="text-xs text-slate-400">Reserved</p><p className="font-semibold">{slot.reservedCapacity ?? 0}</p></div>
          <div><p className="text-xs text-slate-400">Remaining</p><p className="font-semibold">{slot.remaining ?? 0}</p></div>
        </div>
        <Field
          label="Manual capacity"
          required
          hint="Must be at least the number already reserved."
          error={serverError || undefined}
        >
          <Input type="number" min="1" step="1" value={manualCapacity} onChange={(e) => { setManualCapacity(e.target.value); setServerError(''); }} />
        </Field>
        <Field label="Reason" required hint="At least 3 characters; recorded for audit.">
          <Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Eid rush — temporarily increase capacity" />
        </Field>
        {Number(manualCapacity) < (slot.reservedCapacity || 0) && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Setting this below {slot.reservedCapacity} reserved unit(s) will be rejected as CAPACITY_BELOW_RESERVED.
          </p>
        )}
      </div>
    </Modal>
  );
}
