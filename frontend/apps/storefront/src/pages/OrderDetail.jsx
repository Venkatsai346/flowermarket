import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, MapPin, Receipt, Truck } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { Money, Skeleton, Empty } from '../components/ui.jsx';
import { STATUS_META, TRACK_STEPS } from '../lib/status.js';
import { cn } from '../lib/utils.js';

export default function OrderDetail() {
  const { id } = useParams();
  const { data, loading } = useApi(() => api.shop.order(id), [id]);
  const { data: timeline } = useApi(() => api.shop.orderTimeline(id), [id]);

  if (loading && !data) {
    return <div className="wrap space-y-3 py-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  }
  if (!data) return <div className="wrap py-16"><Empty icon={Receipt} title="Order not found" /></div>;

  const order = data.order || data;
  const items = data.items || order.items || [];
  const meta = STATUS_META[order.status] || { label: order.status, step: 0 };
  const cancelled = order.status === 'cancelled';

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
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${meta.tone}`}>{meta.label}</span>
      </div>

      {/* progress rail */}
      {!cancelled && (
        <div className="card mb-5 p-5">
          <ol className="flex items-center">
            {TRACK_STEPS.map((label, i) => {
              const done = meta.step >= i;
              const current = meta.step === i;
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
                  {STATUS_META[t.toStatus]?.label || t.toStatus}
                  {t.note && <span className="block text-xs text-slate-400">{t.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
