import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, MapPin, PackageX, Receipt, RotateCcw, Truck,
} from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import ReturnSheet from '../components/ReturnSheet.jsx';
import { STATUS_META, TRACK_STEPS } from '../lib/status.js';
import { CANCEL_REASONS, canCancel, canReturn, meta } from '../lib/afterSales.js';
import { cn, errMsg } from '../lib/utils.js';

export default function OrderDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useShop((s) => s.toast);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0].code);
  const [cancelText, setCancelText] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const { data, loading, refetch } = useApi(() => api.shop.order(id), [id]);
  const { data: timeline } = useApi(() => api.shop.orderTimeline(id), [id]);

  const clearActionParam = () => {
    if (!searchParams.get('return') && !searchParams.get('cancel')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('return');
    next.delete('cancel');
    setSearchParams(next, { replace: true });
  };

  const order = data?.order || data;
  const items = data?.items || order?.items || [];
  const orderMeta = STATUS_META[order?.status] || { label: order?.status, step: 0, tone: 'bg-slate-100 text-slate-700' };
  const cancelled = order?.status === 'cancelled';
  const cancelAllowed = canCancel(order?.status);
  const canRequestReturn = canReturn(order, items);

  // Deep-link support: /orders/:id?return=1 / ?cancel=1 opens the right flow.
  useEffect(() => {
    if (searchParams.get('return') === '1' && canRequestReturn) setReturnOpen(true);
    if (searchParams.get('cancel') === '1' && cancelAllowed) setConfirmCancel(true);
  }, [searchParams, canRequestReturn, cancelAllowed]);

  if (loading && !data) {
    return <div className="wrap space-y-3 py-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  }
  if (!data) return <div className="wrap py-16"><Empty icon={Receipt} title="Order not found" /></div>;

  const openReturn = () => setReturnOpen(true);

  const toggleCancel = () => {
    if (confirmCancel) { setConfirmCancel(false); clearActionParam(); }
    else setConfirmCancel(true);
  };

  const submitCancel = async () => {
    setCancelling(true);
    try {
      const reason = cancelReason === 'other' ? 'customer_requested' : cancelReason;
      const reasonText = cancelReason === 'other' ? cancelText.trim() : CANCEL_REASONS.find((r) => r.code === cancelReason)?.label;
      if (cancelReason === 'other' && !reasonText) {
        toast('Please describe why you are cancelling', 'error');
        return;
      }
      await api.shop.cancelOrder(order.id, { reason, reasonText });
      await refetch();
      setConfirmCancel(false);
      setCancelText('');
      clearActionParam();
      toast('Order cancelled', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="wrap max-w-3xl py-8">
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" />All orders
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold text-slate-900">{order.orderNumber}</h1>
          <p className="text-sm text-slate-500">{order.itemsCount} item{order.itemsCount === 1 ? '' : 's'}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${orderMeta.tone}`}>{orderMeta.label}</span>
      </div>

      {/* actions */}
      {(cancelAllowed || canRequestReturn) && !cancelled && (
        <div className="mb-5 flex flex-wrap gap-2">
          {canRequestReturn && (
            <Button variant="soft" size="sm" icon={RotateCcw} onClick={openReturn}>Request a return</Button>
          )}
          {cancelAllowed && (
            <Button
              variant="ghost"
              size="sm"
              icon={PackageX}
              className="!text-rose-600 hover:!bg-rose-50"
              onClick={toggleCancel}
            >
              {confirmCancel ? 'Close' : 'Cancel order'}
            </Button>
          )}
        </div>
      )}

      {confirmCancel && (
        <div className="card mb-5 space-y-3 border-rose-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Why are you cancelling this order?</p>
          <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="input" aria-label="Cancellation reason">
            {CANCEL_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          {cancelReason === 'other' && (
            <textarea
              value={cancelText}
              onChange={(e) => setCancelText(e.target.value)}
              placeholder="Tell us why (required)"
              className="input min-h-[72px] resize-y"
              maxLength={500}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setConfirmCancel(false); clearActionParam(); }}>Keep order</Button>
            <Button variant="outline" size="sm" loading={cancelling} className="!border-rose-200 !text-rose-600" onClick={submitCancel}>
              Cancel this order
            </Button>
          </div>
        </div>
      )}

      {/* progress rail */}
      {!cancelled && (
        <div className="card mb-5 p-5">
          <ol className="flex items-center">
            {TRACK_STEPS.map((label, i) => {
              const done = orderMeta.step >= i;
              const current = orderMeta.step === i;
              return (
                <li key={label} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    {done
                      ? <CheckCircle2 className="h-6 w-6" style={{ color: 'var(--brand)' }} />
                      : <Circle className="h-6 w-6 text-slate-200" />}
                    <span className={cn('text-center text-[11px] font-medium', current ? 'text-slate-900' : done ? 'text-slate-500' : 'text-slate-300')}>
                      {label}
                    </span>
                  </div>
                  {i < TRACK_STEPS.length - 1 && (
                    <span className={cn('mx-1 mb-5 h-0.5 flex-1 rounded', done ? '' : 'bg-slate-200')}
                      style={done ? { background: 'var(--brand)' } : undefined} />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {order.slotSnapshot && (
          <div className="card p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Truck className="h-3.5 w-3.5" />Delivery slot
            </p>
            <p className="text-sm font-medium text-slate-800">
              {order.slotSnapshot.date} · {order.slotSnapshot.displayLabel || `${order.slotSnapshot.startTime}–${order.slotSnapshot.endTime}`}
            </p>
          </div>
        )}
        {order.addressSnapshot && (
          <div className="card p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <MapPin className="h-3.5 w-3.5" />Delivering to
            </p>
            <p className="text-sm text-slate-700">
              {[order.addressSnapshot.line1, order.addressSnapshot.city, order.addressSnapshot.pincode].filter(Boolean).join(', ')}
            </p>
          </div>
        )}
      </div>

      <div className="card mt-4 divide-y divide-slate-100">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 p-4">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-50">
              {it.skuSnapshot?.imageUrl
                ? <img src={it.skuSnapshot.imageUrl} alt="" className="h-full w-full object-cover" />
                : <span className="flex h-full w-full items-center justify-center text-xl" aria-hidden>🌸</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{it.skuSnapshot?.title}</p>
              <p className="text-xs text-slate-500">{it.qty} × <Money value={it.priceAtOrder?.sellingPrice} /></p>
              {Boolean(it.returnedQty) && (
                <p className="text-[11px] font-medium text-emerald-600">{it.returnedQty} returned</p>
              )}
            </div>
            <Money value={it.lineTotal} className="text-sm font-semibold" />
          </div>
        ))}
        <dl className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between text-slate-600"><dt>Items</dt><dd><Money value={order.itemsSubtotal} /></dd></div>
          {Boolean(order.discount) && <div className="flex justify-between text-emerald-600"><dt>Discount</dt><dd>−<Money value={order.discount} /></dd></div>}
          <div className="flex justify-between text-slate-600"><dt>Delivery</dt><dd><Money value={order.deliveryFee} /></dd></div>
          <div className="flex justify-between text-slate-600"><dt>Tax</dt><dd><Money value={order.taxAmount} /></dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
            <dt>Total paid</dt><dd><Money value={order.totalAmount} /></dd>
          </div>
        </dl>
      </div>

      {Array.isArray(timeline) && timeline.length > 0 && (
        <div className="card mt-4 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Timeline</p>
          <ol className="space-y-3">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand)' }} />
                <span className="text-slate-600">
                  {meta(t.toStatus, STATUS_META).label || t.toStatus}
                  {t.note && <span className="block text-xs text-slate-400">{t.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ReturnSheet
        order={order}
        items={items}
        open={returnOpen}
        onClose={() => { setReturnOpen(false); clearActionParam(); }}
        onCreated={() => refetch()}
      />
    </div>
  );
}
