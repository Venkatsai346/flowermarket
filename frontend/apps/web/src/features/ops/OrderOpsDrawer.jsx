import { useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, MapPin, PackageCheck, RefreshCw, Truck,
} from 'lucide-react';
import { fmtDateTime, fmtTime, inr, num, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import {
  ASSIGNMENT_STATUS_META, OPS_ORDER_STATUS_META, POD_OPTIONS, TASK_STATUS_META,
} from './opsMeta.js';

function DetailTile({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}>{value}</span>
    </div>
  );
}

function Timeline({ rows }) {
  if (!rows?.length) return <p className="text-xs text-slate-400">No status history yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((h, i) => (
        <div key={h.id || i} className="flex items-start gap-3">
          <div className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100">
            <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">{pickMeta(OPS_ORDER_STATUS_META, h.status || h.to).label}</p>
            <p className="text-xs text-slate-400">{fmtDateTime(h.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OrderOpsDrawer({ order, onClose, onChanged }) {
  const [deliverFormOpen, setDeliverFormOpen] = useState(false);
  const [podType, setPodType] = useState('otp');
  const [podValue, setPodValue] = useState('');
  const [failReason, setFailReason] = useState('');
  const [showFail, setShowFail] = useState(false);
  const action = useAction();
  const { data, loading, error, refetch } = useApi(() => api.admin.order(order?.id), [order?.id]);

  const detail = data || {};
  const o = detail.order || detail || {};
  const items = detail.items || [];
  const delivery = detail.delivery || null;
  const task = detail.fulfillmentTask || null;
  const timeline = detail.timeline || [];

  const runAction = async (fn, message, after) => {
    try {
      await action.run(fn);
      toast.success(message);
      await refetch();
      after?.();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const actionProps = (fn, label, message) => ({
    disabled: action.busy,
    loading: action.busy,
    onClick: () => runAction(fn, message),
    children: label,
  });

  if (loading && !data) return <Modal open onClose={onClose} title="Order ops" size="lg"><LoadingBlock /></Modal>;

  const confirm = () => runAction(() => api.fulfillment.dispatch(o.id), 'Rider assigned — order is out for delivery');
  const pick = () => runAction(() => api.fulfillment.startPicking(o.id), 'Picking started');
  const pack = () => runAction(() => api.fulfillment.markPacked(o.id), 'Order packed');
  const retry = () => runAction(() => api.fulfillment.retryDelivery(o.id), 'Delivery retry dispatched');
  const deliver = () => runAction(
    () => api.fulfillment.deliver(o.id, { podType, podValue: podValue || undefined }),
    'Delivered — POD captured',
    () => { setDeliverFormOpen(false); setPodValue(''); },
  );
  const fail = () => runAction(
    () => api.fulfillment.deliveryFailed(o.id, { reason: failReason || undefined }),
    'Delivery failure recorded',
    () => { setShowFail(false); setFailReason(''); },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ops · ${o.orderNumber || 'Order'}`}
      subtitle={fmtDateTime(o.createdAt)}
      size="lg"
    >
      {error ? (
        <p className="text-sm text-rose-600">{error.message}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailTile label="Status" value={<Badge tone={pickMeta(OPS_ORDER_STATUS_META, o.status).tone} dot>{pickMeta(OPS_ORDER_STATUS_META, o.status).label}</Badge>} />
            <DetailTile label="Customer" value={o.addressSnapshot?.name || o.customerName || '—'} sub={o.addressSnapshot?.phone || 'no phone'} />
            <DetailTile label="Payment" value={o.paymentMethod || '—'} sub={`${o.paymentSummary?.status || 'not paid'}`} />
            <DetailTile label="Total" value={inr(o.totalAmount)} sub={`${num(o.itemsCount)} items`} />
          </div>

          {delivery && (
            <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-sky-600" />
                  <p className="text-sm font-semibold text-slate-800">Delivery assignment</p>
                </div>
                <Badge tone={pickMeta(ASSIGNMENT_STATUS_META, delivery.status).tone} dot>
                  {pickMeta(ASSIGNMENT_STATUS_META, delivery.status).label}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <p className="text-xs text-slate-500">Assigned <span className="block font-medium text-slate-700">{fmtDateTime(delivery.assignedAt)}</span></p>
                <p className="text-xs text-slate-500">Accepted <span className="block font-medium text-slate-700">{fmtDateTime(delivery.acceptedAt)}</span></p>
                <p className="text-xs text-slate-500">Arrived <span className="block font-medium text-slate-700">{fmtDateTime(delivery.arrivedAt)}</span></p>
                <p className="text-xs text-slate-500">Rider <span className="block font-medium text-slate-700">{delivery.riderId || 'Unassigned'}</span></p>
                <p className="text-xs text-slate-500">POD type <span className="block font-medium text-slate-700">{delivery.podType || '—'}</span></p>
                <p className="text-xs text-slate-500">Verification <span className="block font-medium text-slate-700">{delivery.packageVerified ? 'verified' : 'not verified'}</span></p>
              </div>
              {delivery.status === 'pending_accept' && delivery.pendingAcceptExpiresAt && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Accept window ends {fmtTime(delivery.pendingAcceptExpiresAt)}
                </p>
              )}
            </div>
          )}

          {task && (
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-violet-600" />
                  <p className="text-sm font-semibold text-slate-800">Pick task</p>
                </div>
                <Badge tone={pickMeta(TASK_STATUS_META, task.status).tone} dot>{pickMeta(TASK_STATUS_META, task.status).label}</Badge>
              </div>
              <p className="text-xs text-slate-500">
                {task.pickerId ? `Picker ${task.pickerId}` : 'No picker assigned'} · {num(task.itemsCount)} items
              </p>
            </div>
          )}

          <div>
            <p className="label">Items</p>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Price</th>
                    <th className="px-3 py-2 text-right font-semibold">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(items.length ? items : []).map((it, i) => (
                    <tr key={it.id || i}>
                      <td className="px-3 py-2 text-slate-800">{it.skuSnapshot?.title || it.title || 'Item'}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{num(it.qty)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{inr(it.priceAtOrder?.sellingPrice ?? it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{inr(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
            <Row label="Items subtotal" value={inr(o.itemsSubtotal)} />
            <Row label="Delivery fee" value={inr(o.deliveryFee)} />
            <Row label="Discount" value={`− ${inr(o.discount)}`} />
            <Row label="Tax (GST)" value={inr(o.taxAmount)} />
            <div className="mt-2! flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total</span><span>{inr(o.totalAmount)}</span>
            </div>
          </div>

          {o.slotSnapshot && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-500">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                Slot · {o.slotSnapshot.date} {o.slotSnapshot.startTime}–{o.slotSnapshot.endTime}
                {o.slotSnapshot.hubId ? ` · hub ${o.slotSnapshot.hubId}` : ''}
              </span>
            </div>
          )}

          {o.addressSnapshot && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-500">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                {[o.addressSnapshot.line1, o.addressSnapshot.line2].filter(Boolean).join(', ')}
                {o.addressSnapshot.city ? ` · ${o.addressSnapshot.city}` : ''}
                {o.addressSnapshot.pincode ? ` · ${o.addressSnapshot.pincode}` : ''}
              </span>
            </div>
          )}

          <div>
            <p className="label">Timeline</p>
            <Timeline rows={timeline.slice(-6)} />
          </div>

          <div className="rounded-xl border border-slate-100 p-4">
            <p className="label mb-3">Ops actions</p>
            <div className="flex flex-wrap gap-2">
              {o.status === 'confirmed' && (
                <Button variant="primary" icon={ArrowRight} {...actionProps(pick, 'Start picking', 'Picking started')} />
              )}
              {o.status === 'picking' && (
                <Button variant="primary" icon={PackageCheck} {...actionProps(pack, 'Mark packed', 'Order packed')} />
              )}
              {o.status === 'packed' && (
                <Button variant="success" icon={Truck} {...actionProps(confirm, 'Dispatch / assign rider', 'Rider assigned')} />
              )}
              {o.status === 'out_for_delivery' && !deliverFormOpen && (
                <Button variant="success" icon={CheckCircle2} onClick={() => setDeliverFormOpen(true)}>Deliver (capture POD)</Button>
              )}
              {o.status === 'out_for_delivery' && !showFail && (
                <Button variant="danger" icon={AlertTriangle} onClick={() => setShowFail(true)}>Record failure</Button>
              )}
              {o.status === 'delivery_failed' && (
                <Button variant="secondary" icon={RefreshCw} {...actionProps(retry, 'Retry delivery', 'Delivery retry dispatched')} />
              )}
              {o.status === 'out_for_delivery' && !deliverFormOpen && !showFail && (
                <span className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">Choose an action above</span>
              )}
              {o.status !== 'confirmed' && o.status !== 'picking' && o.status !== 'packed' && o.status !== 'out_for_delivery' && o.status !== 'delivery_failed' && (
                <span className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">No ops action in this state</span>
              )}
            </div>

            {deliverFormOpen && (
              <div className="mt-4 space-y-3 rounded-xl bg-emerald-50/60 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-semibold text-slate-800">Capture proof of delivery</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="POD type">
                    <Select value={podType} onChange={(e) => setPodType(e.target.value)}>
                      {POD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                  <Field label={podType === 'otp' ? 'OTP' : 'Photo / signature reference'} hint={podType === 'otp' ? '4 digits' : 'URL after upload'}>
                    <Input value={podValue} onChange={(e) => setPodValue(e.target.value)} placeholder={podType === 'otp' ? '1234' : 'https://…'} />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button variant="success" icon={CheckCircle2} loading={action.busy} disabled={!podValue} onClick={deliver}>Confirm delivery</Button>
                  <Button variant="secondary" onClick={() => setDeliverFormOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {showFail && (
              <div className="mt-4 space-y-3 rounded-xl bg-rose-50/70 p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  <p className="text-sm font-semibold text-slate-800">Record delivery failure</p>
                </div>
                <Field label="Reason" required>
                  <Input value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Customer unavailable, address wrong…" />
                </Field>
                <div className="flex gap-2">
                  <Button variant="danger" loading={action.busy} disabled={!failReason} onClick={fail}>Save failure</Button>
                  <Button variant="secondary" onClick={() => setShowFail(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
