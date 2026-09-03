import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Flower2, Package, Search, ShoppingBag, X } from 'lucide-react';
import { useShop } from '../store.js';
import { api } from '../api.js';
import AccountMenu from './AccountMenu.jsx';
import { cn } from '../lib/utils.js';

export default function Header({ query, onQuery }) {
  const store = useShop((s) => s.store);
  const count = useShop((s) => s.itemCount());
  const openCart = useShop((s) => s.openCart);
  const [local, setLocal] = useState(query || '');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const debounce = useRef(null);

  /**
   * Debounced autocomplete. 160 ms is short enough to feel instant and long
   * enough that a fast typist does not fire a request per keystroke.
   */
  useEffect(() => {
    if (local.trim().length < 2) { setSuggestions([]); return undefined; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api.shop.suggest(local.trim())
        .then((r) => setSuggestions(r.data || []))
        .catch(() => setSuggestions([]));
    }, 160);
    return () => clearTimeout(debounce.current);
  }, [local]);

  const submit = (e) => {
    e?.preventDefault();
    setShowSuggest(false);
    if (pathname !== '/') navigate('/');
    onQuery?.(local.trim());
  };

  const pick = (text) => {
    setLocal(text);
    setShowSuggest(false);
    if (pathname !== '/') navigate('/');
    onQuery?.(text);
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
            onChange={(e) => { setLocal(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            placeholder="Search flowers, plants, gifts…"
            aria-label="Search products"
            autoComplete="off"
            className="input rounded-full !py-2.5 pl-10 pr-9"
          />
          {showSuggest && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lift">
              {suggestions.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    onMouseDown={() => pick(s.text)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                    <span className="truncate">{s.text}</span>
                    {s.title !== s.text && <span className="ml-auto truncate text-xs text-slate-400">{s.title}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
          <AccountMenu />
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
