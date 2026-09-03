import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { TAX_DOC_TYPE_META } from './taxMeta.js';

function currentFyLabel() {
  const now = new Date();
  const year = now.getMonth() + 1 >= 4 ? now.getFullYear() + 1 : now.getFullYear();
  return `${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
}

export default function SeriesAuditPanel() {
  const action = useAction();
  const [form, setForm] = useState({ ownerType: 'tenant', ownerId: '', docType: 'invoice', fyLabel: currentFyLabel() });
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setResult(null);
    try {
      const r = await action.run(() => api.tax.auditSeries({
        ownerType: form.ownerType,
        ownerId: form.ownerId || undefined,
        docType: form.docType,
        fyLabel: form.fyLabel.trim(),
      }));
      setResult(r.data || {});
      toast.success('Series audit completed');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const gaps = result?.gaps || [];

  return (
    <Card title="Series audit" subtitle="Every reserved number must have a document; holes are questions an auditor will ask.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Owner type">
          <Select value={form.ownerType} onChange={(e) => set('ownerType', e.target.value)}>
            <option value="tenant">Store (tenant)</option>
            <option value="vendor">Vendor</option>
            <option value="platform">Platform</option>
          </Select>
        </Field>
        <Field label="Owner ID" hint="Blank uses this store for tenant audits.">
          <Input className="font-mono" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} />
        </Field>
        <Field label="Document type">
          <Select value={form.docType} onChange={(e) => set('docType', e.target.value)}>
            {Object.entries(TAX_DOC_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Financial year">
          <Input className="font-mono" value={form.fyLabel} onChange={(e) => set('fyLabel', e.target.value)} placeholder="24-25" />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={ShieldCheck} loading={action.busy} onClick={submit}>Audit series</Button>
        {result && gaps.length === 0 && <Badge tone="emerald" dot>No gaps</Badge>}
        {result && gaps.length > 0 && <Badge tone="amber" dot>{gaps.length} gap(s)</Badge>}
      </div>

      {result && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-slate-400">Series</p><p className="font-mono font-semibold text-slate-800">{result.series || form.fyLabel}</p></div>
            <div><p className="text-xs text-slate-400">Issued</p><p className="font-semibold text-slate-800">{result.issued ?? 0}</p></div>
            <div><p className="text-xs text-slate-400">Expected</p><p className="font-semibold text-slate-800">{result.expected ?? 0}</p></div>
            <div><p className="text-xs text-slate-400">Gaps</p><p className="font-semibold text-slate-800">{gaps.length}</p></div>
          </div>
          {gaps.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Missing sequence numbers: <span className="font-mono">{gaps.join(', ')}</span>. These were reserved but never written — check for aborted issuances.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
