import { useState } from 'react';
import { Percent } from 'lucide-react';
import { fmtDate } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { emptyTax, taxPayload } from './policiesMeta.js';

export default function TaxPolicyModal({ categories = [], onClose }) {
  const action = useAction();
  const [form, setForm] = useState(emptyTax());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await action.run(() => api.policies.upsertTaxPolicy(taxPayload(form)));
      toast.success('Tax policy upserted (active for category)');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Set GST rate"
      subtitle="GST is a legal classification — one active slab per category."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Percent} loading={action.busy} disabled={!form.categoryId || form.gstSlabPct === ''} onClick={submit}>Upsert</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Select category</option>
            {categories.map((c) => <option key={rid(c)} value={rid(c)}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="GST slab (%)" required hint="0 = nil/exempt; enter the full slab">
          <Input type="number" min="0" max="100" step="0.01" value={form.gstSlabPct} onChange={(e) => set('gstSlabPct', e.target.value)} />
        </Field>
        <Field label="HSN code" hint="Optional statutory classification.">
          <Input value={form.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} placeholder="0603" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from">
            <Input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          </Field>
          <Field label="Effective to">
            <Input type="date" min={form.effectiveFrom || undefined} value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function TaxPolicyList({ data, categories, loading, onUpsert }) {
  const rows = data || [];
  const catName = (id) => categories.find((c) => rid(c) === id)?.name || id;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} rate policy version(s)</p>
        <Button variant="primary" icon={Percent} onClick={onUpsert}>Set GST rate</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((p, i) => (
          <div key={rid(p) || i} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-800">{catName(p.categoryId)}</p>
              {p.isActive && <Badge tone="emerald" dot>Active</Badge>}
              {!p.isActive && <Badge tone="slate">Inactive</Badge>}
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{p.gstSlabPct}%</p>
            <p className="mt-1 text-xs text-slate-500">
              HSN {p.hsnCode || '—'}
              {p.rateBps != null ? ` · ${p.rateBps} bps` : ''}
            </p>
            {(p.effectiveFrom || p.effectiveTo) && (
              <p className="mt-1 text-[11px] text-slate-400">
                {fmtDate(p.effectiveFrom)}{p.effectiveTo ? ` → ${fmtDate(p.effectiveTo)}` : ''}
              </p>
            )}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-400">No tax policies yet.</p>}
      </div>
    </div>
  );
}
