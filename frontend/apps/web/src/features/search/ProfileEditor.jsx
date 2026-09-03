import { useState } from 'react';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Field.jsx';
import {
  RANKING_SIGNALS, emptyProfile, profilePayload, profileToForm, trafficProjection,
} from './searchMeta.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export default function ProfileEditor({ profile, defaults, profiles, onClose }) {
  const action = useAction();
  const isEdit = Boolean(profile);
  const [form, setForm] = useState(() => (profile ? profileToForm(profile, defaults) : emptyProfile(defaults)));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWeight = (k, v) => setForm((f) => ({ ...f, weights: { ...f.weights, [k]: clamp(Number(v), 0, 5) } }));
  const setTuning = (k, v) => setForm((f) => ({ ...f, tuning: { ...f.tuning, [k]: v } }));

  const projected = trafficProjection({ profiles, current: profile, trafficPct: form.trafficPct });
  const trafficOver = projected > 100;
  const canSave = form.code.trim() && form.name.trim() && !trafficOver;

  const submit = async () => {
    try {
      await action.run(() => api.search.saveProfile(profilePayload(form)));
      toast.success(isEdit ? `Ranking profile ${form.code} updated` : `Ranking profile ${form.code} created`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const addPin = () => set('pins', [...(form.pins || []), { query: '', listingIds: '' }]);
  const setPin = (i, k, v) => set('pins', (form.pins || []).map((pin, idx) => (idx === i ? { ...pin, [k]: v } : pin)));
  const removePin = (i) => set('pins', (form.pins || []).filter((_, idx) => idx !== i));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${profile.code}` : 'New ranking profile'}
      subtitle="Weights are always 0–5. The higher a signal, the more it moves the list."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={action.busy} disabled={!canSave} onClick={submit}>
            {isEdit ? 'Save profile' : 'Create profile'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required hint="Lowercase, unique per store.">
          <Input className="font-mono lowercase" maxLength={40} value={form.code} disabled={isEdit} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Name" required>
          <Input maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea maxLength={400} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Traffic %" required hint="0 = off. 100 = every session. Between is an A/B experiment.">
          <Input type="number" min="0" max="100" step="1" value={form.trafficPct} onChange={(e) => set('trafficPct', e.target.value)} />
        </Field>
        <div className="flex items-end gap-3 pb-1">
          <Checkbox label="Active" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          <Checkbox label="Store default" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
        </div>
      </div>

      {trafficOver && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Active profiles would route {projected}% of traffic — keep the total at or under 100%.
        </p>
      )}

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Signal weights</p>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {RANKING_SIGNALS.map(([key, label, hint]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700" title={hint}>{label}</span>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{Number(form.weights[key]).toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={Number(form.weights[key]) || 0}
                onChange={(e) => setWeight(key, e.target.value)}
                className="w-full accent-rose-600"
              />
              <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Signal tuning</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Popularity reference">
            <Input type="number" min="1" value={form.tuning.popularityReference} onChange={(e) => setTuning('popularityReference', e.target.value)} />
          </Field>
          <Field label="CTR prior" hint="Platform-average CTR (0–1).">
            <Input type="number" min="0" max="1" step="0.01" value={form.tuning.ctrPrior} onChange={(e) => setTuning('ctrPrior', e.target.value)} />
          </Field>
          <Field label="CTR weight" hint="Impressions of evidence before a CTR is trusted.">
            <Input type="number" min="1" value={form.tuning.ctrWeight} onChange={(e) => setTuning('ctrWeight', e.target.value)} />
          </Field>
          <Field label="Freshness half-life (hrs)">
            <Input type="number" min="1" value={form.tuning.freshnessHalfLifeHours} onChange={(e) => setTuning('freshnessHalfLifeHours', e.target.value)} />
          </Field>
          <Field label="Low-stock threshold">
            <Input type="number" min="0" value={form.tuning.lowStockThreshold} onChange={(e) => setTuning('lowStockThreshold', e.target.value)} />
          </Field>
          <Field label="Promoted boost">
            <Input type="number" min="0" max="2" step="0.01" value={form.tuning.promotedBoost} onChange={(e) => setTuning('promotedBoost', e.target.value)} />
          </Field>
          <Field label="Return penalty">
            <Input type="number" min="0" max="2" step="0.01" value={form.tuning.returnPenalty} onChange={(e) => setTuning('returnPenalty', e.target.value)} />
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox label="Out-of-stock floor" checked={Boolean(form.tuning.outOfStockFloor)} onChange={(e) => setTuning('outOfStockFloor', e.target.checked)} />
          </div>
        </div>
      </div>

      <details className="mt-5 group">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
          <GitBranch className="h-4 w-4" />
          Editorial control — pins and buries
        </summary>
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">
            Pin a product to the top for a query, or bury it for every query. Listing IDs are the
            <span className="font-mono"> listingId</span> from search results.
          </p>
          <div className="space-y-2">
            {(form.pins || []).map((pin, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-[140px] flex-1!" placeholder="Query (blank = all)" value={pin.query} onChange={(e) => setPin(i, 'query', e.target.value)} />
                <Input className="min-w-[220px] flex-[2]" placeholder="Listing IDs, comma-separated" value={pin.listingIds} onChange={(e) => setPin(i, 'listingIds', e.target.value)} />
                <Button variant="ghost" size="sm" icon={Trash2} aria-label="Remove pin" onClick={() => removePin(i)} />
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" icon={Plus} onClick={addPin}>Add pin</Button>
          <Field label="Bury listing IDs" hint="Comma-separated or newline-separated. These never rank towards the top.">
            <Textarea value={form.buries} onChange={(e) => set('buries', e.target.value)} placeholder="abc…, def…" />
          </Field>
        </div>
      </details>
    </Modal>
  );
}
