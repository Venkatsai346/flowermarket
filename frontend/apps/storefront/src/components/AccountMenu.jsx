import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Package, RotateCcw, User, Wallet } from 'lucide-react';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { cn } from '../lib/utils.js';

const LINKS = [
  { to: '/orders', label: 'My orders', icon: Package },
  { to: '/returns', label: 'Returns & refunds', icon: RotateCcw },
  { to: '/wallet', label: 'My wallet', icon: Wallet },
];

/**
 * AccountMenu — the customer's signed-in navigation hub.
 *
 * When signed out it is a plain "Sign in" button; when signed in it opens the
 * after-sales destinations and a sign-out action. Everything else about the
 * session (refresh rotation, persistence, hostnamespacing) stays in the shared
 * auth store — this is purely a shell.
 */
export default function AccountMenu() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const user = useShopAuth((s) => s.user);
  const clear = useShopAuth((s) => s.clear);
  const openAuth = useShop((s) => s.openAuth);
  const toast = useShop((s) => s.toast);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const navigate = useNavigate();

  // Close on outside click / Escape — small but necessary on a header menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = () => {
    clear();
    setOpen(false);
    toast('Signed out');
    navigate('/');
  };

  if (!isAuth) {
    return (
      <button
        type="button"
        onClick={openAuth}
        className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        aria-label="Sign in"
      >
        <User className="h-5 w-5" />
      </button>
    );
  }

  const name = user?.profile?.firstName || user?.profile?.fullName || user?.name || user?.phone?.number || 'Account';

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-1.5 rounded-full pl-2 pr-3 text-slate-600 transition hover:bg-slate-100"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name}`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lift">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
            {user?.phone?.number && <p className="truncate text-xs text-slate-400">+{user.phone.countryCode || ''} {user.phone.number}</p>}
          </div>
          <nav role="menu">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <Icon className="h-4 w-4 text-slate-400" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-rose-600 transition hover:bg-rose-50"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
