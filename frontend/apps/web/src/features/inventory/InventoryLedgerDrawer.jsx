import { useState } from 'react';
import { History } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import AdjustStockModal from './AdjustStockModal.jsx';
import { ADJUSTMENT_TYPE_META } from './inventoryMeta.js';

export default function InventoryLedgerDrawer({ row, onClose, onChanged }) {
  const [adjust, setAdjust] = useState(false);
  const { data, loading, error, refetch } = useApi(() => api.admin.inventoryLedger(row.listingId || row.id), [row.listingId, row.id]);

  if (loading && !data) return <Modal open onClose={onClose} title="Inventory ledger" size="lg"><LoadingBlock /></Modal>;
  if (error) return <Modal open onClose={onClose} title="Inventory ledger" size="lg"><p className="text-sm text-rose-600">{errMsg(error)}</p></Modal>;

  const inventory = data?.inventory;
  const adjustments = data?.adjustments || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Inventory ${row.title || row.skuGlobal || row.listingId}`}
      subtitle="Append-only movements — the audit trail behind current stock."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-slate-400">{adjustments.length} movement(s) shown</p>
          <Button variant="primary" icon={History} onClick={() => setAdjust(true)}>Adjust stock</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {['qtyOnHand', 'qtyReserved', 'available'].map((k) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">{k.replace('qty', '').replace('On', 'On-hand').replace('Reserved', 'Reserved') || k}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{inventory?.[k] ?? 0}</p>
            </div>
          ))}
          <div className="rounded-xl bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase text-slate-400">Version</p>
            <p className="mt-1 text-lg font-bold text-slate-900">v{inventory?.version ?? '—'}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Movements</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 text-right font-semibold">Change</th>
                <th className="px-4 py-2 text-right font-semibold">After</th>
                <th className="px-4 py-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adjustments.map((a) => (
                <tr key={a.id || a._id} className="text-slate-700">
                  <td className="px-4 py-2 text-xs">{fmtDateTime(a.createdAt)}</td>
                  <td className="px-4 py-2"><Badge tone={pickMeta(ADJUSTMENT_TYPE_META, a.type).tone}>{pickMeta(ADJUSTMENT_TYPE_META, a.type).label}</Badge></td>
                  <td className={`px-4 py-2 text-right font-mono ${Number(a.qtyChange) > 0 ? 'text-emerald-600' : Number(a.qtyChange) < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                    {Number(a.qtyChange) > 0 ? '+' : ''}{a.qtyChange}
                  </td>
                  <td className="px-4 py-2 text-right">{a.qtyAfter ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{a.reason || a.note || '—'}</td>
                </tr>
              ))}
              {!adjustments.length && <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-400">No movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {adjust && (
        <AdjustStockModal
          row={row}
          onClose={() => { setAdjust(false); refetch(); onChanged?.(); }}
        />
      )}
    </Modal>
  );
}
