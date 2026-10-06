import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Banknote, Boxes, CheckCircle2, Circle, Clock3, Download, MapPin, PackageX, Receipt, Repeat, RotateCcw, Truck,
} from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import ReturnSheet from '../components/ReturnSheet.jsx';
import ProductImage from '../components/ProductImage.jsx';
import { STATUS_META, TRACK_STEPS, customerStatusMeta, fulfillmentStatusMeta } from '../lib/status.js';
import { CANCEL_REASONS, canCancel, canInstantClaim, canPickupReturn, canReturn, isDeliveredForReturn, meta } from '../lib/afterSales.js';
import { cn, errMsg } from '../lib/utils.js';
import { openRazorpayCheckout } from '../lib/razorpay.js';

const SHIPMENT_META = {
  planned: { label: 'Planned', step: 0 }, queued: { label: 'Confirmed', step: 0 },
  picking: { label: 'Being picked', step: 1 }, packed: { label: 'Packed', step: 2 },
  out_for_delivery: { label: 'Out for delivery', step: 3 }, delivered: { label: 'Delivered', step: 4 },
  delivery_failed: { label: 'Delivery needs attention', step: 3 },
  return_to_origin: { label: 'Returning to sender', step: 3 },
  returned_to_origin: { label: 'Returned to sender', step: 3 },
  cancelled: { label: 'Cancelled', step: -1 },
};
const SHIPMENT_STEPS = ['Confirmed', 'Picking', 'Packed', 'On the way', 'Delivered'];
const dateTime = (value) => value
  ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : null;

export default function OrderDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useShop((s) => s.toast);
  const store = useShop((s) => s.store);
  const setCart = useShop((s) => s.setCart);
  const widgetOpened = useRef(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0].code);
  const [cancelText, setCancelText] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancellingShipment, setCancellingShipment] = useState(null);

  const [payStatus, setPayStatus] = useState(null);
  const [checkingPay, setCheckingPay] = useState(false);
  const [reordering, setReordering] = useState(false);

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
  const shipments = data?.shipments || order?.shipments || [];
  const multiDelivery = shipments.length > 1;
  const orderMeta = customerStatusMeta(order);
  const fulfillmentMeta = fulfillmentStatusMeta(order);
  const hasAfterSales = order?.lifecycle?.afterSales?.status && order.lifecycle.afterSales.status !== 'none';
  const cancelled = order?.status === 'cancelled';
  const cancelAllowed = canCancel(order?.status);
  const shipmentStatusById = new Map(shipments.map((shipment) => [String(shipment.id || shipment._id), shipment.status]));
  const deliveredItems = items.filter((item) => isDeliveredForReturn({
    orderStatus: order?.status,
    shipmentId: item.shipmentId,
    shipmentStatus: item.shipmentId ? shipmentStatusById.get(String(item.shipmentId)) : null,
  }));
  const eligibleDeliveredItems = deliveredItems.filter((item) => canPickupReturn(item) || canInstantClaim(item));
  const canRequestReturn = canReturn(order, eligibleDeliveredItems);

  // Deep-link support: /orders/:id?return=1 / ?cancel=1 opens the right flow.
  useEffect(() => {
    if (searchParams.get('return') === '1' && canRequestReturn) setReturnOpen(true);
    if (searchParams.get('cancel') === '1' && cancelAllowed) setConfirmCancel(true);
  }, [searchParams, canRequestReturn, cancelAllowed]);

  // Async gateway payments (Razorpay): checkout returns an order stuck at
  // `payment_pending` until the webhook captures it. Poll the payment status
  // every 5s so the page flips to "confirmed" the moment the bank confirms —
  // no manual refresh needed for the customer.
  const awaitingPayment = order?.status === 'payment_pending';

  /**
   * Cash on delivery: the order is confirmed and the flowers are moving, but no
   * money has changed hands. This is NOT `awaitingPayment` — nothing needs to be
   * paid online, and showing the gateway widget here would invite the customer
   * to pay twice. It gets its own banner: keep cash ready for the rider.
   */
  const cashDue = order?.paymentSummary?.status === 'awaiting_collection';
  const isCod = order?.paymentMethod === 'cod' || order?.paymentSummary?.method === 'cod';
  const totalLabel = cashDue ? 'Due on delivery' : isCod ? 'Paid in cash' : 'Total paid';
  useEffect(() => {
    if (!awaitingPayment) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.shop.orderPayment(id);
        if (!alive) return;
        setPayStatus(r.data);
        if (r.data?.order?.status !== 'payment_pending') {
          const cancelled = r.data.order.status === 'cancelled';
          toast(
            cancelled
              ? 'Payment was not completed in time — the order was cancelled'
              : 'Payment confirmed — your order is confirmed',
            cancelled ? 'error' : 'success',
          );
          refetch();
        }
      } catch { /* network blip — keep polling */ }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [awaitingPayment, id]);

  useEffect(() => {
    if (!awaitingPayment || widgetOpened.current) return undefined;
    let alive = true;
    const open = async () => {
      try {
        const r = await api.shop.orderPayment(id);
        if (!alive) return;
        const d = r.data || {};
        const keyId = d.keyId;
        const gatewayOrderId = d.payment?.gatewayOrderId;
        if (!keyId || !gatewayOrderId) return;
        widgetOpened.current = true;
        await openRazorpayCheckout({
          keyId,
          gatewayOrderId,
          amountPaise: d.amountPaise,
          currency: d.currency || 'INR',
          name: store?.name,
          description: d.order?.orderNumber,
          customer: d.customer || {},
          onSuccess: () => { toast('Payment submitted — waiting for confirmation', 'success'); refetch(); },
        });
      } catch {
        /* mock / no key — polling UI is enough */
      }
    };
    if (searchParams.get('pay') === '1' || awaitingPayment) open();
    return () => { alive = false; };
  }, [awaitingPayment, id]);

  const checkNow = async () => {
    setCheckingPay(true);
    try {
      const r = await api.shop.orderPayment(id);
      setPayStatus(r.data);
      if (r.data?.order?.status !== 'payment_pending') {
        const cancelled = r.data.order.status === 'cancelled';
        toast(
          cancelled
            ? 'Payment was not completed in time — the order was cancelled'
            : 'Payment confirmed — your order is confirmed',
          cancelled ? 'error' : 'success',
        );
        refetch();
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCheckingPay(false);
    }
  };

  if (loading && !data) {
    return <div className="wrap space-y-3 py-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  }
  if (!data) return <div className="wrap py-16"><Empty icon={Receipt} title="Order not found" /></div>;

  const openReturn = () => setReturnOpen(true);

  // 7.1.10: Reorder — add all items from this order to the cart
  const reorder = async () => {
    setReordering(true);
    try {
      let added = 0;
      for (const it of items) {
        try {
          await api.shop.addToCart({ listingId: it.listingId || it.skuSnapshot?.listingId, qty: it.qty || 1 });
          added += 1;
        } catch { /* item may be out of stock — skip */ }
      }
      if (added > 0) {
        const r = await api.shop.cart();
        setCart(r.data);
        toast(`${added} item${added === 1 ? '' : 's'} added to basket`, 'success');
      } else {
        toast('No items could be added — they may be out of stock', 'error');
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setReordering(false);
    }
  };

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

  const cancelShipment = async (shipment) => {
    const shipmentId = shipment.id || shipment._id;
    if (!window.confirm(`Cancel ${shipment.shipmentNumber}? Only the items in this delivery will be refunded.`)) return;
    setCancellingShipment(shipmentId);
    try {
      await api.shop.cancelShipment(order.id, shipmentId, { reason: 'customer_requested', reasonText: 'Customer cancelled this delivery' });
      await refetch();
      toast('Delivery cancelled — your partial refund has been initiated', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCancellingShipment(null);
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

      {hasAfterSales && (
        <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-sm" aria-label="Order lifecycle">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 px-5 py-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Current outcome</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{orderMeta.label}</p>
              <p className="mt-1 text-sm text-slate-600">Delivery and after-sales are tracked independently, so your delivery record remains intact after a return.</p>
            </div>
            <Link to="/returns" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-200 transition hover:bg-emerald-50">View return activity</Link>
          </div>
          <div className="grid grid-cols-3 divide-x divide-emerald-100 bg-white/70">
            <div className="p-4"><Truck className="mb-2 h-4 w-4 text-indigo-500" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Delivery</p><p className="mt-1 text-xs font-semibold text-slate-800">{fulfillmentMeta.label}</p></div>
            <div className="p-4"><RotateCcw className="mb-2 h-4 w-4 text-violet-500" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">After-sales</p><p className="mt-1 text-xs font-semibold text-slate-800">{orderMeta.label}</p></div>
            <div className="p-4"><Banknote className="mb-2 h-4 w-4 text-emerald-500" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Payment</p><p className="mt-1 text-xs font-semibold capitalize text-slate-800">{order.lifecycle.payment.status.replaceAll('_', ' ')}</p></div>
          </div>
        </section>
      )}

      {multiDelivery && (
        <div className="relative mb-5 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5 shadow-sm">
          <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-indigo-200/30" aria-hidden />
          <div className="relative flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm"><Boxes className="h-5 w-5" /></span>
            <div>
              <p className="font-bold text-slate-900">Your order arrives in {shipments.length} deliveries</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                We are sending each item from the best available fulfillment centre. You can follow every package separately below; you will only pay the delivery total shown on your order.
              </p>
            </div>
          </div>
        </div>
      )}

      {shipments.length > 0 && (
        <section className="mb-5 space-y-3" aria-label="Deliveries">
          {shipments.map((shipment, shipmentIndex) => {
            const shipmentMeta = SHIPMENT_META[shipment.status] || { label: shipment.status, step: 0 };
            const shipmentItemIds = new Set((shipment.items || []).map((entry) => String(entry.orderItemId)));
            const shipmentItems = items.filter((item) => shipmentItemIds.has(String(item.id || item._id)));
            const promise = dateTime(shipment.promiseMaxAt);
            return (
              <article key={shipment.id || shipment._id} className="card overflow-hidden border-slate-200 shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">
                        Delivery {shipmentIndex + 1} of {shipments.length}
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold text-slate-900">{shipment.shipmentNumber}</p>
                      <p className="mt-1 text-xs text-slate-500">From {shipment.hub?.name || shipment.warehouseCode || 'fulfillment centre'}</p>
                    </div>
                    <span className={cn(
                      'rounded-full px-3 py-1 text-xs font-bold',
                      shipment.status === 'delivered' ? 'bg-emerald-100 text-emerald-700'
                        : shipment.status === 'cancelled' || shipment.status === 'delivery_failed' ? 'bg-rose-100 text-rose-700'
                          : 'bg-indigo-100 text-indigo-700',
                    )}>{shipmentMeta.label}</span>
                  </div>
                  {promise && shipment.status !== 'delivered' && shipment.status !== 'cancelled' && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <Clock3 className="h-3.5 w-3.5 text-indigo-500" /> Expected by {promise}
                    </p>
                  )}
                  {shipment.status === 'delivery_failed' && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      We could not complete this attempt. Operations is arranging a retry or safe return to the fulfillment centre.
                    </p>
                  )}
                </div>

                {shipment.status !== 'cancelled' && (
                  <div className="px-4 pt-4">
                    <div className="flex gap-1" aria-label={`Delivery progress: ${shipmentMeta.label}`}>
                      {SHIPMENT_STEPS.map((step, stepIndex) => (
                        <span key={step} className="flex-1">
                          <span className={cn('block h-1.5 rounded-full', shipmentMeta.step >= stepIndex ? 'bg-indigo-500' : 'bg-slate-200')} />
                          <span className="sr-only">{step}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="divide-y divide-slate-100 px-4 py-2">
                  {shipmentItems.map((item) => (
                    <div key={item.id || item._id} className="flex items-center gap-3 py-3">
                      <ProductImage src={item.skuSnapshot?.imageUrl} alt={item.skuSnapshot?.title || 'Product'} fallbackCompact className="h-11 w-11 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{item.skuSnapshot?.title}</p>
                        <p className="text-xs text-slate-500">Qty {item.qty}</p>
                        {Boolean(item.returnRequestedQty) && <p className="text-[11px] font-semibold text-violet-600">{item.returnRequestedQty} in return request</p>}
                        {Boolean(item.returnedQty) && <p className="text-[11px] font-semibold text-emerald-600">{item.returnedQty} returned</p>}
                        {Boolean(item.returnRejectedQty) && <p className="text-[11px] font-semibold text-rose-600">{item.returnRejectedQty} return declined</p>}
                      </div>
                      <Money value={item.lineTotal} className="text-sm font-semibold" />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
                  <span>Tracking <strong className="font-mono text-slate-700">{shipment.trackingCode}</strong></span>
                  <span>Delivery fee <Money value={shipment.deliveryFee} className="font-semibold text-slate-700" /></span>
                  {shipment.status === 'cancelled' && shipment.cancellation?.refundStatus && (
                    <span className={cn('font-semibold', shipment.cancellation.refundStatus === 'failed' ? 'text-rose-600' : 'text-emerald-600')}>
                      Refund {shipment.cancellation.refundStatus}
                      {shipment.cancellation.refundAmount > 0 && <> · <Money value={shipment.cancellation.refundAmount} /></>}
                    </span>
                  )}
                  {multiDelivery && ['planned', 'queued', 'picking', 'packed'].includes(shipment.status) && !cashDue && (
                    <Button
                      variant="ghost" size="sm" icon={PackageX}
                      loading={cancellingShipment === (shipment.id || shipment._id)}
                      className="!text-rose-600 hover:!bg-rose-50"
                      onClick={() => cancelShipment(shipment)}
                    >
                      Cancel this delivery
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* cash on delivery: nothing to pay online, but the rider needs the cash */}
      {cashDue && (
        <div className="card mb-5 border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-start gap-3">
            <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-900">
                Keep <Money value={order.totalAmount} className="text-base font-bold text-amber-900" /> ready for the rider
              </p>
              <p className="mt-1 text-xs text-amber-800">
                This is a cash-on-delivery order — nothing is due online. Your rider will collect the
                amount above when your flowers arrive, and this page will show it as paid the moment
                they record it.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* async payment: the order exists but the gateway hasn't captured it yet */}
      {awaitingPayment && (
        <div className="card mb-5 border-amber-200 bg-amber-50/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
              </span>
              <div>
                <p className="text-sm font-bold text-amber-900">Complete your payment</p>
                <p className="mt-0.5 max-w-md text-xs leading-relaxed text-amber-700">
                  {payStatus?.payment?.status === 'failed'
                    ? `The last attempt failed${payStatus.payment.failureReason ? ` — ${payStatus.payment.failureReason}` : ''}. The order is still open; try paying again from the gateway.`
                    : payStatus?.payment?.status === 'success'
                      ? 'Payment confirmed — finalising your order…'
                      : 'We are waiting for your bank or UPI app to confirm. This page updates automatically, so you can stay right here.'}
                </p>
                {order.fulfillmentPlan?.reservationExpiresAt && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-800">
                    Your exact fulfillment-node stock is held until {new Date(order.fulfillmentPlan.reservationExpiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <Money value={order.totalAmount} className="text-base font-bold text-amber-900" />
              {payStatus?.payment?.gatewayOrderId && (
                <p className="font-mono text-[10px] text-amber-600">ref {payStatus.payment.gatewayOrderId}</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" loading={checkingPay} onClick={checkNow} className="!border-amber-300 !text-amber-800">
              Check payment status
            </Button>
            <Button
              size="sm"
              onClick={() => {
                widgetOpened.current = false;
                api.shop.orderPayment(id).then((r) => {
                  const d = r.data || {};
                  if (!d.keyId || !d.payment?.gatewayOrderId) {
                    toast('Payment widget is not configured for this store');
                    return;
                  }
                  widgetOpened.current = true;
                  return openRazorpayCheckout({
                    keyId: d.keyId,
                    gatewayOrderId: d.payment.gatewayOrderId,
                    amountPaise: d.amountPaise,
                    currency: d.currency || 'INR',
                    name: store?.name,
                    description: d.order?.orderNumber,
                    customer: d.customer || {},
                    onSuccess: () => { toast('Payment submitted — waiting for confirmation', 'success'); refetch(); },
                  });
                }).catch((e) => toast(errMsg(e), 'error'));
              }}
            >
              Pay now
            </Button>
          </div>
        </div>
      )}

      {/* actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="soft" size="sm" icon={Repeat} loading={reordering} onClick={reorder}>
          Reorder
        </Button>
        {(cancelAllowed || canRequestReturn) && !cancelled && (
          <>
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
          </>
        )}
      </div>

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
              const done = fulfillmentMeta.step >= i;
              const current = fulfillmentMeta.step === i;
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
        {shipments.length === 0 && items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 p-4">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-50">
              <ProductImage src={it.skuSnapshot?.imageUrl} alt={it.skuSnapshot?.title || 'Product'} fallbackCompact className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{it.skuSnapshot?.title}</p>
              <p className="text-xs text-slate-500">{it.qty} × <Money value={it.priceAtOrder?.sellingPrice} /></p>
              {Boolean(it.returnRequestedQty) && <p className="text-[11px] font-medium text-violet-600">{it.returnRequestedQty} in return request</p>}
              {Boolean(it.returnedQty) && <p className="text-[11px] font-medium text-emerald-600">{it.returnedQty} returned</p>}
              {Boolean(it.returnRejectedQty) && <p className="text-[11px] font-medium text-rose-600">{it.returnRejectedQty} return declined</p>}
            </div>
            <Money value={it.lineTotal} className="text-sm font-semibold" />
          </div>
        ))}
        <dl className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between text-slate-600"><dt>Items</dt><dd><Money value={order.itemsSubtotal} /></dd></div>
          {Boolean(order.discount) && <div className="flex justify-between text-emerald-600"><dt>Discount</dt><dd>−<Money value={order.discount} /></dd></div>}
          <div className="flex justify-between text-slate-600"><dt>Delivery</dt><dd><Money value={order.deliveryFee} /></dd></div>
          <div className="flex justify-between text-slate-600"><dt>GST (included)</dt><dd><Money value={order.taxAmount} /></dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
            {/* "Total paid" would be a lie on a cash order nobody has collected
                yet — the label follows the money, not the layout. */}
            <dt>{totalLabel}</dt><dd><Money value={order.totalAmount} /></dd>
          </div>
        </dl>
      </div>

      {!cancelled && order?.status && order.status !== 'payment_pending' && order.status !== 'created' && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            icon={Download}
            loading={invoiceBusy}
            onClick={async () => {
              setInvoiceBusy(true);
              try {
                const r = await api.shop.orderInvoice(id);
                const list = Array.isArray(r.data) ? r.data : r.data?.items || [];
                const doc = list[0];
                if (doc?.pdfBase64) {
                  const bin = atob(doc.pdfBase64);
                  const bytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
                  const blob = new Blob([bytes], { type: doc.pdfMime || 'application/pdf' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${doc.number || 'invoice'}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  return;
                }
                if (!doc?.html) {
                  toast('Invoice will appear once the order is confirmed');
                  return;
                }
                const w = window.open('', '_blank', 'noopener');
                if (!w) { toast('Allow pop-ups to download the invoice', 'error'); return; }
                w.document.write(doc.html);
                w.document.close();
              } catch (e) {
                toast(errMsg(e), 'error');
              } finally {
                setInvoiceBusy(false);
              }
            }}
          >
            Download GST invoice
          </Button>
        </div>
      )}

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
        shipments={shipments}
        open={returnOpen}
        onClose={() => { setReturnOpen(false); clearActionParam(); }}
        onCreated={() => refetch()}
      />
    </div>
  );
}
