import { useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import { parsePincodes } from '../inventory/inventoryMeta.js';

export default function PincodeEditorModal({ hub, onClose }) {
  const action = useAction();
  const existing = new Set((hub.serviceablePincodes || []).map(String));
  const [addValue, setAddValue] = useState('');
  const [pendingAdd, setPendingAdd] = useState([]);
  const [pendingRemove, setPendingRemove] = useState([]);

  const addAll = () => {
    const pins = parsePincodes(addValue);
    setPendingAdd((prev) => Array.from(new Set([...prev, ...pins.filter((p) => !existing.has(p) && !pendingRemove.includes(p))])));
    setPendingRemove((prev) => prev.filter((p) => !pins.includes(p)));
    setAddValue('');
  };
  const removePin = (pin) => {
    if (pendingAdd.includes(pin)) {
      setPendingAdd((prev) => prev.filter((p) => p !== pin));
      return;
    }
    setPendingRemove((prev) => [...prev, pin]);
  };
  const undoRemove = (pin) => setPendingRemove((prev) => prev.filter((p) => p !== pin));

  const submit = async () => {
    try {
      await action.run(() => api.admin.manageHubPincodes(hub.id || hub._id, { add: pendingAdd, remove: pendingRemove }));
      toast.success('Hub pincodes updated');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remaining = (hub.serviceablePincodes || []).filter((p) => !pendingRemove.includes(String(p)));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Service area · ${hub.name}`}
      subtitle="These PINs determine which hub serves a customer."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={MapPin} loading={action.busy} disabled={!pendingAdd.length && !pendingRemove.length} onClick={submit}>Save pincodes</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Add pincodes" hint="Comma or space-separated 6-digit codes.">
          <div className="flex gap-2">
            <Input className="font-mono" value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="500001, 500002" />
            <Button variant="secondary" icon={Plus} onClick={addAll}>Add</Button>
          </div>
        </Field>

        <div>
          <p className="label mb-2">Current service area</p>
          <div className="flex flex-wrap gap-1.5">
            {remaining.length ? remaining.map((p) => (
              <Badge key={p} tone="sky" className="gap-1.5">
                {p}
                <button type="button" onClick={() => removePin(String(p))} aria-label={`Remove ${p}`} className="ml-0.5 rounded-full text-slate-400 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
              </Badge>
            )) : <p className="text-sm text-slate-400" >No pincodes in range.</p>}
          </div>
        </div>

        {pendingRemove.length > 0 && (
          <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-3">
            <p className="mb-2 text-xs font-semibold text-rose-700">Will remove</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingRemove.map((p) => (
                <Badge key={p} tone="rose">
                  {p}
                  <button type="button" onClick={() => undoRemove(p)} className="ml-1 text-slate-400 hover:text-emerald-600">undo</button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {pendingAdd.length > 0 && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <p className="mb-2 text-xs font-semibold text-emerald-700">Will add</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingAdd.map((p) => (
                <Badge key={p} tone="emerald">{p}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
