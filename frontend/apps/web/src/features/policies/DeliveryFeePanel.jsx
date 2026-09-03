import { useState } from 'react';
import { Truck } from 'lucide-react';
import { fmtDate } from '@flower-market/shared';
import { rid } from '../../lib/utils.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DeliveryFeeModal from './DeliveryFeeModal.jsx';

export default function DeliveryFeePanel({ data, loading, onChanged }) {
  const [modal, setModal] = useState(null);
  const rows = data || [];

  return (
    <Card
      title="Delivery fee policies"
      subtitle="Versioned with at-most-one-active. A new policy replaces the previous active one."
      bodyClassName="p-5!"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{rows.length} policy version(s) · at most one active</p>
          <Button variant="primary" icon={Truck} onClick={() => setModal({})}>New policy</Button>
        </div>

        {rows.map((p, i) => (
          <div key={rid(p) || i} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">{p.name || 'default'}</p>
                {p.isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                <span className="text-xs text-slate-400">v{p.version || 1}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                ₹{p.baseFee}
                {p.freeDeliveryThreshold != null ? ` · free over ₹${p.freeDeliveryThreshold}` : ' · never free'}
                {p.expressSurgeMultiplier != null ? ` · express ×${p.expressSurgeMultiplier}` : ''}
                {p.distanceFeePerKm != null ? ` · +₹${p.distanceFeePerKm}/km` : ''}
              </p>
              {(p.effectiveFrom || p.effectiveTo) && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {p.effectiveFrom ? `From ${fmtDate(p.effectiveFrom)}` : ''}
                  {p.effectiveTo ? ` → ${fmtDate(p.effectiveTo)}` : ''}
                </p>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setModal({ initial: p })}>Edit</Button>
          </div>
        ))}

        {!rows.length && <p className="text-sm text-slate-400">No delivery fee policies yet — create the first one.</p>}
      </div>

      {modal && (
        <DeliveryFeeModal
          onChange={modal.initial}
          onClose={() => {
            setModal(null);
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}
