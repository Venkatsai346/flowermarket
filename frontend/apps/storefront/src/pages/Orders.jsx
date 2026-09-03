import { Link } from 'react-router-dom';
import { ChevronRight, Package, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import { STATUS_META } from '../lib/status.js';
import { canCancel, canReturn } from '../lib/afterSales.js';

/**
 * Orders — the customer's order history.
 *
 * The row opens the full order detail; the footer shows only actions the
 * backend might accept, as *hints* (the server is always the authority). Each
 * action deep-links to the detail page with a query flag so the right flow
 * opens without the customer hunting for a button.
 */
export default function Orders() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const openAuth = useShop((s) => s.openAuth);
  const { data, loading } = useApi(() => (isAuth ? api.shop.orders({ limit: 20 }) : Promise.resolve({ data: [] })), [isAuth]);

  if (!isAuth) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={Package}
          title="Sign in to see your orders"
          message="Your order history is tied to your mobile number."
          action={<Button onClick={openAuth}>Sign in</Button>}
        />
      </div>
    );
  }

  return (
    <div className="wrap py-8">
      <h1 className="mb-5 text-2xl font-bold tracking-tight text-slate-900">Your orders</h1>
      {loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
      ) : !data?.length ? (
        <Empty icon={Package} title="No orders yet" message="When you place an order it will appear here." action={<Button onClick={() => window.location.assign('/')}>Start shopping</Button>} />
      ) : (
        <ul className="space-y-3">
          {data.map((o) => {
            const m = STATUS_META[o.status] || { label: o.status, tone: 'bg-slate-100 text-slate-700' };
            const cancel = canCancel(o.status);
            const ret = canReturn(o, []);
            return (
              <li key={o.id} className="card overflow-hidden">
                <Link to={`/orders/${o.id}`} className="flex items-center gap-4 p-4 transition hover:bg-slate-50/50">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{o.orderNumber}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.tone}`}>{m.label}</span>
                    </p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {o.itemsCount} item{o.itemsCount === 1 ? '' : 's'}
                      {o.slotSnapshot?.displayLabel ? ` · ${o.slotSnapshot.displayLabel}` : ''}
                    </p>
                  </div>
                  <Money value={o.totalAmount} className="font-bold text-slate-900" />
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>

                {(cancel || ret) && (
                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
                    {ret && (
                      <Link
                        to={`/orders/${o.id}?return=1`}
                        className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold"
                        style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />Return items
                      </Link>
                    )}
                    {cancel && (
                      <Link
                        to={`/orders/${o.id}?cancel=1`}
                        className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                      >
                        Cancel
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
