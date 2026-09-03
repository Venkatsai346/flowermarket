import { useState } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import { fmtDateTime, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import CancelDocumentModal from './CancelDocumentModal.jsx';
import {
  CREDIT_NOTE_REASON_META, EINVOICE_STATUS_META, TAX_DOC_STATUS_META, TAX_DOC_TYPE_META,
} from './taxMeta.js';

function Tile({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

export default function DocumentDetailDrawer({ documentId, onClose, onChanged }) {
  const action = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { data, loading, error, refetch } = useApi(() => api.tax.document(documentId), [documentId]);

  if (loading && !data) return <Modal open onClose={onClose} title="Tax document" size="lg"><LoadingBlock /></Modal>;
  if (error) return <Modal open onClose={onClose} title="Tax document" size="lg"><p className="text-sm text-rose-600">{errMsg(error)}</p></Modal>;

  const doc = data || {};
  const totals = doc.totalsRupees || {};
  const supplier = doc.supplier || {};
  const recipient = doc.recipient || {};
  const einvoice = doc.einvoice || {};
  const statusMeta = pickMeta(TAX_DOC_STATUS_META, doc.status);
  const typeMeta = pickMeta(TAX_DOC_TYPE_META, doc.docType);

  const cancel = () => {
    setConfirmCancel(true);
  };

  const retry = async () => {
    try {
      const r = await action.run(() => api.tax.retryEinvoice(doc.id || doc._id));
      const e = r.data?.einvoice || {};
      toast.success(e.status === 'generated' ? `IRN generated${e.irn ? ` · ${e.irn}` : ''}` : 'e-invoice retry attempted');
      await refetch();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${typeMeta.label} · ${doc.number || doc.id || ''}`}
      subtitle={doc.issuedAt ? `Issued ${fmtDateTime(doc.issuedAt)}` : doc.fyLabel}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-slate-400">Document {doc.id || doc._id}</p>
          <div className="flex gap-2">
            {doc.status === 'issued' && einvoice.status !== 'not_applicable' && einvoice.status !== 'generated' && (
              <Button variant="secondary" icon={RefreshCw} loading={action.busy} onClick={retry}>Retry e-invoice</Button>
            )}
            {doc.status === 'issued' && (
              <Button variant="danger" icon={Ban} onClick={cancel}>Cancel document</Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Type" value={<Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>} />
          <Tile label="Status" value={<Badge tone={statusMeta.tone} dot>{statusMeta.label}</Badge>} />
          <Tile label="Financial year" value={<span className="font-mono text-xs">{doc.fyLabel}</span>} />
          <Tile label="Sequence" value={<span className="font-mono text-xs">#{doc.sequence}</span>} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Order" value={<span className="font-mono text-xs">{doc.orderNumber || doc.orderId || '—'}</span>} />
          <Tile label="Original" value={<span className="font-mono text-xs">{doc.originalNumber || '—'}</span>} />
          <Tile label="Reason" value={doc.reason ? pickMeta(CREDIT_NOTE_REASON_META, doc.reason).label : '—'} />
          <Tile label="Reverse charge" value={doc.reverseCharge ? 'Yes' : 'No'} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Supplier</p>
            <p className="text-sm font-medium text-slate-800">{supplier.name} {supplier.gstin && <span className="font-mono text-xs text-slate-500">· {supplier.gstin}</span>}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {supplier.address?.line1}{supplier.address?.city ? `, ${supplier.address.city}` : ''}{supplier.stateCode ? ` · ${supplier.stateCode}` : ''}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Recipient</p>
            <p className="text-sm font-medium text-slate-800">{recipient.name} {recipient.gstin && <span className="font-mono text-xs text-slate-500">· {recipient.gstin}</span>}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {recipient.address?.line1}{recipient.address?.city ? `, ${recipient.address.city}` : ''} · POS {doc.placeOfSupplyStateCode}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <p className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Lines</p>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
                <th className="px-4 py-2 text-right font-semibold">Taxable</th>
                <th className="px-4 py-2 text-right font-semibold">Rate</th>
                <th className="px-4 py-2 text-right font-semibold">Tax</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(doc.lines || []).map((l, i) => (
                <tr key={l.orderItemId || i} className="text-slate-700">
                  <td className="px-4 py-2">{l.description || 'Item'}</td>
                  <td className="px-4 py-2 text-right">{l.qty} {l.uom}</td>
                  <td className="px-4 py-2 text-right">{inr((l.taxableValuePaise || 0) / 100)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{(l.rateBps || 0) / 100}%</td>
                  <td className="px-4 py-2 text-right">{inr(((l.cgstPaise || 0) + (l.sgstPaise || 0) + (l.igstPaise || 0) + (l.cessPaise || 0)) / 100)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{inr((l.lineTotalPaise || 0) / 100)}</td>
                </tr>
              ))}
              {!doc.lines?.length && <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">No line items</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">HSN summary</p>
            <div className="space-y-1.5">
              {(doc.hsnSummary || []).map((h, i) => (
                <div key={h.hsnCode || i} className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-mono">{h.hsnCode || '—'} · {(h.rateBps || 0) / 100}%</span>
                  <span>{inr((h.taxableValuePaise || 0) / 100)}</span>
                </div>
              ))}
              {!doc.hsnSummary?.length && <p className="text-xs text-slate-400">No HSN summary</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Totals</p>
            <div className="space-y-1 text-xs text-slate-600">
              <div className="flex justify-between"><span>Taxable value</span><span>{inr(totals.taxableValue)}</span></div>
              <div className="flex justify-between"><span>CGST</span><span>{inr(totals.cgst)}</span></div>
              <div className="flex justify-between"><span>SGST</span><span>{inr(totals.sgst)}</span></div>
              <div className="flex justify-between"><span>IGST</span><span>{inr(totals.igst)}</span></div>
              <div className="flex justify-between border-t border-slate-100 pt-1 font-bold text-slate-900"><span>Grand total</span><span>{inr(totals.grandTotal)}</span></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="label mb-2">e-Invoice</p>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Tile label="Status" value={<Badge tone={pickMeta(EINVOICE_STATUS_META, einvoice.status).tone} dot>{pickMeta(EINVOICE_STATUS_META, einvoice.status).label}</Badge>} />
            <Tile label="IRN" value={<span className="break-all font-mono text-[10px]">{einvoice.irn || '—'}</span>} />
            <Tile label="Ack" value={<span className="font-mono text-[10px]">{einvoice.ackNo || '—'}</span>} />
            <Tile label="Last error" value={<span className="break-all text-[10px]">{einvoice.lastError || '—'}</span>} />
          </div>
        </div>

        {doc.cancelReason && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Cancelled · {doc.cancelReason} · {doc.cancelledAt ? fmtDateTime(doc.cancelledAt) : ''}
          </div>
        )}
      </div>

      {confirmCancel && (
        <CancelDocumentModal
          document={doc}
          onClose={() => {
            setConfirmCancel(false);
            refetch();
            onChanged?.();
          }}
        />
      )}
    </Modal>
  );
}
