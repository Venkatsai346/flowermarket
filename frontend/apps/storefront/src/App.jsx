import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Flower2, ServerCrash } from 'lucide-react';
import { api, useShopAuth } from './api.js';
import { useShop } from './store.js';
import { applyTheme, applyDocumentMeta, resolveBrandTheme } from './theme.js';
import { kolkataDate, pickNextSlot } from './lib/arrival.js';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import CartSheet from './components/CartSheet.jsx';
import AuthSheet from './components/AuthSheet.jsx';
import PincodeSheet from './components/PincodeSheet.jsx';
import { Toasts } from './components/ui.jsx';
import Home from './pages/Home.jsx';

const Product = lazy(() => import('./pages/Product.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.jsx'));
const Returns = lazy(() => import('./pages/Returns.jsx'));
const Addresses = lazy(() => import('./pages/Addresses.jsx'));
const Wallet = lazy(() => import('./pages/Wallet.jsx'));

/**
 * The storefront shell.
 *
 * ── Boot ────────────────────────────────────────────────────────────────────
 * One call, no parameters: `GET /domains/bootstrap`. The API works out which
 * store this is from the Host the browser used, and returns branding, theme
 * and feature flags. The app therefore contains no tenant id, no slug in a
 * config file, and no build-time per-store anything — the same bundle serves
 * every store on the platform.
 *
 * The shell renders only after bootstrap resolves, so a customer never sees a
 * flash of the wrong brand colour.
 */
function BootScreen({ error }) {
  if (error) {
    const notFound = error?.code === 'STORE_NOT_FOUND' || error?.status === 404;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <ServerCrash className="h-7 w-7 text-slate-400" />
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {notFound ? 'No store at this address' : 'This store is unavailable'}
          </h1>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            {notFound
              ? 'Check the web address — the shop you are looking for may have moved or closed.'
              : 'We could not reach the store just now. Please try again in a moment.'}
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl bg-slate-100">
        <Flower2 className="h-6 w-6 text-slate-300" />
      </span>
    </main>
  );
}

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-2xl" style={{ background: 'var(--brand-soft)' }}>
        <Flower2 className="h-5 w-5" style={{ color: 'var(--brand)' }} />
      </span>
    </div>
  );
}

export default function App() {
  const { booted, bootError, setBoot, setBootError, store, theme, routing } = useShop();
  const setCart = useShop((s) => s.setCart);
  const toasts = useShop((s) => s.toasts);
  const pincode = useShop((s) => s.pincode);
  const setServiceability = useShop((s) => s.setServiceability);
  const setNextSlot = useShop((s) => s.setNextSlot);
  const language = useShop((s) => s.language);
  const setLanguage = useShop((s) => s.setLanguage);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const location = useLocation();

  // 1. who is this store?
  useEffect(() => {
    let alive = true;
    api.shop.bootstrap()
      .then((r) => {
        if (!alive) return;
        setBoot(r.data);
        applyTheme(r.data?.theme);
      })
      .catch((e) => { if (alive) setBootError(e); });
    return () => { alive = false; };
  }, [setBoot, setBootError]);

  // 1b. remembered pin → serviceability (honest, not a fake catalogue)
  useEffect(() => {
    if (!booted || bootError || !pincode) return undefined;
    let alive = true;
    api.shop.serviceability(pincode)
      .then((r) => { if (alive) setServiceability(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [booted, bootError, pincode, setServiceability]);

  // 1c. next open slot for the pin → "Arrives today 4–7 pm"
  const serviceable = useShop((s) => s.serviceability);
  useEffect(() => {
    if (!booted || bootError || !pincode) { setNextSlot(null); return undefined; }
    if (serviceable && serviceable.serviceable === false) { setNextSlot(null); return undefined; }
    let alive = true;
    const load = async () => {
      for (const offset of [0, 1, 2]) {
        const r = await api.shop.slots({ date: kolkataDate(offset), pincode });
        if (!alive) return;
        if (r.data?.serviceable === false) { setNextSlot(null); return; }
        const next = pickNextSlot(r.data?.slots);
        if (next) { setNextSlot(next); return; }
      }
      if (alive) setNextSlot(null);
    };
    load().catch(() => { if (alive) setNextSlot(null); });
    return () => { alive = false; };
  }, [booted, bootError, pincode, serviceable, setNextSlot]);

  // 2. the cart follows the session (a guest cart is server-side too)
  useEffect(() => {
    if (!booted || bootError) return undefined;
    let alive = true;
    api.shop.cart()
      .then((r) => { if (alive) setCart(r.data); })
      .catch(() => { /* an anonymous visitor may simply have no cart yet */ });
    return () => { alive = false; };
  }, [booted, bootError, isAuth, setCart]);

  // 2b. signed-in language preference wins over localStorage
  useEffect(() => {
    if (!booted || !isAuth) return undefined;
    let alive = true;
    api.shop.me()
      .then((r) => {
        if (!alive) return;
        const lang = r.data?.preferences?.language;
        if (lang === 'te' || lang === 'en') setLanguage(lang);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [booted, isAuth, setLanguage]);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language === 'te' ? 'te' : 'en';
  }, [language]);

  // OG + canonical follow the route so a shared PDP is the PDP, not Home.
  useEffect(() => {
    if (!booted || bootError) return;
    const resolved = resolveBrandTheme(theme || {});
    applyDocumentMeta({
      name: store?.name,
      tagline: store?.tagline,
      description: store?.description,
      image: store?.bannerUrl || resolved.heroUrl,
      canonicalUrl: routing?.canonicalUrl,
      path: location.pathname + location.search,
    });
  }, [booted, bootError, store, theme, routing, location.pathname, location.search]);

  if (!booted || bootError) return <BootScreen error={bootError} />;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/p/:slug" element={<Product />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/addresses" element={<Addresses />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </main>

      <Footer />

      <CartSheet />
      <AuthSheet />
      <PincodeSheet />
      <Toasts items={toasts} />
    </div>
  );
}
