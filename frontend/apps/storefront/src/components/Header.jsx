import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Flower2, MapPin, Package, Search, ShoppingBag, X } from 'lucide-react';
import { useShop } from '../store.js';
import { api, useShopAuth } from '../api.js';
import { t } from '../i18n.js';
import AccountMenu from './AccountMenu.jsx';
import NotificationBell from './NotificationBell.jsx';
import { cn } from '../lib/utils.js';

export default function Header() {
  const store = useShop((s) => s.store);
  const count = useShop((s) => s.itemCount());
  const openCart = useShop((s) => s.openCart);
  const openPin = useShop((s) => s.openPin);
  const pincode = useShop((s) => s.pincode);
  const serviceability = useShop((s) => s.serviceability);
  const language = useShop((s) => s.language);
  const setLanguage = useShop((s) => s.setLanguage);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const [local, setLocal] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const debounce = useRef(null);

  useEffect(() => {
    if (pathname === '/search') {
      const q = new URLSearchParams(search).get('q') || '';
      setLocal(q);
    } else if (pathname === '/') {
      setLocal('');
    }
  }, [pathname, search]);

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

  const goSearch = (text) => {
    const q = (text || '').trim();
    setShowSuggest(false);
    if (!q) { navigate('/'); return; }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const submit = (e) => {
    e?.preventDefault();
    goSearch(local);
  };

  const pick = (text) => {
    setLocal(text);
    goSearch(text);
  };

  const switchLang = (lang) => {
    setLanguage(lang);
    if (isAuth) {
      api.shop.updateMe({ preferences: { language: lang } }).catch(() => {});
    }
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
            placeholder={t(language, 'searchPlaceholder')}
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
              onClick={() => { setLocal(''); navigate('/'); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        <nav className="flex shrink-0 items-center gap-1">
          <div className="hidden items-center rounded-full border border-slate-200 p-0.5 text-[11px] font-semibold sm:flex" role="group" aria-label="Language">
            <button
              type="button"
              onClick={() => switchLang('en')}
              className={cn('rounded-full px-2 py-1', language === 'en' ? 'bg-slate-900 text-white' : 'text-slate-500')}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => switchLang('te')}
              className={cn('rounded-full px-2 py-1', language === 'te' ? 'bg-slate-900 text-white' : 'text-slate-500')}
            >
              తె
            </button>
          </div>
          <button
            type="button"
            onClick={openPin}
            className="flex h-10 max-w-[7.5rem] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 sm:max-w-[9.5rem] sm:px-3"
            aria-label="Set delivery pincode"
          >
            <MapPin className={`h-4 w-4 shrink-0 ${serviceability && !serviceability.serviceable ? 'text-rose-500' : ''}`} />
            <span className="truncate tabular-nums">{pincode || t(language, 'setPin')}</span>
          </button>
          <Link
            to="/orders"
            className="hidden h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 sm:flex"
            aria-label="My orders"
          >
            <Package className="h-5 w-5" />
          </Link>
          <NotificationBell />
          <AccountMenu />
          <button
            type="button"
            onClick={openCart}
            className="relative flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <ShoppingBag className="h-4 w-4" />
            <span className={cn('tabular-nums', count === 0 && 'hidden sm:inline')}>{count || t(language, 'cart')}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
