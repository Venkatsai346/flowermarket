import { Link } from 'react-router-dom';
import { ChevronRight, Package } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import { STATUS_META } from '../lib/status.js';

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
            return (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="card flex items-center gap-4 p-4 transition hover:shadow-lift">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
