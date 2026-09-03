import { useState } from 'react';
import { Languages } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { emptySynonym, synonymPayload } from './searchMeta.js';

export default function SynonymModal({ onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptySynonym());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const terms = form.terms.split(',').map((s) => s.trim()).filter(Boolean);
  const canSave = terms.length >= 2 && (form.type !== 'oneway' || form.from.trim());

  const submit = async () => {
    try {
      await action.run(() => api.search.addSynonym(synonymPayload(form)));
      toast.success('Synonym added to the vocabulary');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add synonym"
      subtitle="Teach search the names customers actually type."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Languages} loading={action.busy} disabled={!canSave} onClick={submit}>Add synonym</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Terms" required hint="Comma-separated. Equivalent rules expand in every direction.">
          <Textarea value={form.terms} onChange={(e) => set('terms', e.target.value)} placeholder="gulab, rose, roses" />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="equivalent">Equivalent (bidirectional)</option>
            <option value="oneway">One-way (from → terms)</option>
          </Select>
        </Field>
        {form.type === 'oneway' && (
          <Field label="Match term" required hint="This term expands to the terms above, but not back.">
            <Input value={form.from} onChange={(e) => set('from', e.target.value)} placeholder="guldasta" />
          </Field>
        )}
        <Field label="Note">
          <Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Seen in zero-result log" />
        </Field>
      </div>
      <div className="mt-4">
        <Checkbox label="Active" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
      </div>
    </Modal>
  );
}
