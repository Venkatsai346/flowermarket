import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Flower2, Package, Search, ShoppingBag, User, X } from 'lucide-react';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { cn } from '../lib/utils.js';

export default function Header({ query, onQuery }) {
  const store = useShop((s) => s.store);
  const count = useShop((s) => s.itemCount());
  const openCart = useShop((s) => s.openCart);
  const openAuth = useShop((s) => s.openAuth);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const [local, setLocal] = useState(query || '');
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const submit = (e) => {
    e.preventDefault();
    if (pathname !== '/') navigate('/');
    onQuery?.(local.trim());
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
      <div className="wrap flex h-16 items-center gap-3">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          {store?.logoUrl ? (
            <img src={store.logoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--brand)' }}>
              <Flower2 className="h-5 w-5" style={{ color: 'var(--brand-ink)' }} />
            </span>
          )}
          <span className="hidden text-base font-bold tracking-tight text-slate-900 sm:block">
            {store?.name || 'Store'}
          </span>
        </Link>

        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Search flowers, plants, gifts…"
            aria-label="Search products"
            className="input rounded-full !py-2.5 pl-10 pr-9"
          />
          {local && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setLocal(''); onQuery?.(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        <nav className="flex shrink-0 items-center gap-1">
          <Link
            to="/orders"
            className="hidden h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 sm:flex"
            aria-label="My orders"
          >
            <Package className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={() => (isAuth ? window.location.assign('/orders') : openAuth())}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
            aria-label={isAuth ? 'Account' : 'Sign in'}
          >
            <User className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={openCart}
            className="relative flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <ShoppingBag className="h-4 w-4" />
            <span className={cn('tabular-nums', count === 0 && 'hidden sm:inline')}>{count || 'Cart'}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
