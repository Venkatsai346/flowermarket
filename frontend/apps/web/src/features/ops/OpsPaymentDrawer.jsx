import { fmtDateTime, inr, num, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import {
  PAYMENT_METHOD_META, PAYMENT_PROVIDER_META, PAYMENT_STATUS_META,
} from './opsMeta.js';

const TXN_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  success: { label: 'Success', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

const TXN_TYPE_META = {
  charge: { label: 'Charge', tone: 'sky' },
  refund: { label: 'Refund', tone: 'violet' },
};

function Tile({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

export default function OpsPaymentDrawer({ payment, onClose }) {
  const { data, loading, error } = useApi(() => api.fulfillment.payment(payment?.id), [payment?.id]);
  if (loading && !data) return <Modal open onClose={onClose} title="Payment" size="lg"><LoadingBlock /></Modal>;
  if (error) return <Modal open onClose={onClose} title="Payment" size="lg"><p className="text-sm text-rose-600">{error.message}</p></Modal>;

  const p = data?.payment || data || {};
  const txns = data?.transactions || [];
  return (
    <Modal open onClose={onClose} title={`Payment ${p.id || payment?.order || ''}`} subtitle={fmtDateTime(p.createdAt || payment?.createdAt)} size="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Amount" value={inr(p.amount ?? payment?.amount)} />
          <Tile label="Method" value={<Badge tone={pickMeta(PAYMENT_METHOD_META, p.method).tone}>{pickMeta(PAYMENT_METHOD_META, p.method).label}</Badge>} />
          <Tile label="Provider" value={pickMeta(PAYMENT_PROVIDER_META, p.provider).label} />
          <Tile label="Status" value={<Badge tone={pickMeta(PAYMENT_STATUS_META, p.status).tone} dot>{pickMeta(PAYMENT_STATUS_META, p.status).label}</Badge>} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Order" value={p.orderId || '—'} />
          <Tile label="Customer" value={p.userId || '—'} />
          <Tile label="Refunded" value={inr(p.refundedAmount)} />
          <Tile label="Paid" value={p.paidAt ? fmtDateTime(p.paidAt) : '—'} />
        </div>

        {p.failureReason && (
          <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
            <p className="font-semibold">Failure reason</p>
            <p className="mt-1 text-xs">{p.failureReason}</p>
          </div>
        )}

        <div>
          <p className="label">Transactions</p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Ref</th>
                  <th className="px-3 py-2 font-semibold">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(txns.length ? txns : []).map((t, i) => (
                  <tr key={t.id || i}>
                    <td className="px-3 py-2"><Badge tone={pickMeta(TXN_TYPE_META, t.type).tone}>{pickMeta(TXN_TYPE_META, t.type).label}</Badge></td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{inr(t.amount)}</td>
                    <td className="px-3 py-2"><Badge tone={pickMeta(TXN_STATUS_META, t.status).tone} dot>{pickMeta(TXN_STATUS_META, t.status).label}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{t.gatewayRef || t.idempotencyKey}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDateTime(t.completedAt || t.createdAt)}</td>
                  </tr>
                ))}
                {!txns.length && <tr><td colSpan="5" className="px-3 py-4 text-center text-xs text-slate-400">No transactions recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
          <p>Idempotency key <span className="block font-mono font-medium text-slate-700">{p.idempotencyKey || '—'}</span></p>
          <p>Gateway order <span className="block font-medium text-slate-700">{p.gatewayOrderId || '—'}</span></p>
          <p>Gateway payment <span className="block font-medium text-slate-700">{p.gatewayPaymentId || '—'}</span></p>
          <p>Wallet claim <span className="block font-medium text-slate-700">{p.walletClaimToken ? 'claimed' : 'not claimed'}</span></p>
        </div>
      </div>
    </Modal>
  );
}
