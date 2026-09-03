import { useState } from 'react';
import { Percent } from 'lucide-react';
import { fmtDate } from '@flower-market/shared';
import { rid } from '../../lib/utils.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import TaxPolicyModal from './TaxPolicyModal.jsx';

export default function TaxPanel({ data, categories, loading, onChanged }) {
  const [modal, setModal] = useState(false);
  const rows = data || [];
  const catName = (id) => categories.find((c) => rid(c) === id)?.name || id;

  return (
    <Card title="GST rate policies" subtitle="Category-level legal classification; one active slab per category." bodyClassName="p-5!">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{rows.length} rate policy version(s)</p>
          <Button variant="primary" icon={Percent} onClick={() => setModal(true)}>Set GST rate</Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((p, i) => (
            <div key={rid(p) || i} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-800">{catName(p.categoryId)}</p>
                {p.isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Inactive</Badge>}
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">{p.gstSlabPct}%</p>
              <p className="mt-1 text-xs text-slate-500">
                HSN {p.hsnCode || '—'}
                {p.rateBps != null ? ` · ${p.rateBps} bps` : ''}
              </p>
              {(p.effectiveFrom || p.effectiveTo) && (
                <p className="mt-1 text-[11px] text-slate-400">
                  {p.effectiveFrom ? `From ${fmtDate(p.effectiveFrom)}` : ''}
                  {p.effectiveTo ? ` → ${fmtDate(p.effectiveTo)}` : ''}
                </p>
              )}
            </div>
          ))}
          {!rows.length && <p className="text-sm text-slate-400">No tax policies yet.</p>}
        </div>
      </div>

      {modal && (
        <TaxPolicyModal
          categories={categories}
          onClose={() => {
            setModal(false);
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}
