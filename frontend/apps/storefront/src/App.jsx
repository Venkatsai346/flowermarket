import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Flower2, ServerCrash } from 'lucide-react';
import { api, useShopAuth } from './api.js';
import { useShop } from './store.js';
import { applyTheme, applyDocumentMeta } from './theme.js';
import Header from './components/Header.jsx';
import CartSheet from './components/CartSheet.jsx';
import AuthSheet from './components/AuthSheet.jsx';
import { Toasts } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Checkout from './pages/Checkout.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Returns from './pages/Returns.jsx';
import Wallet from './pages/Wallet.jsx';

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

export default function App() {
  const { booted, bootError, setBoot, setBootError, store } = useShop();
  const setCart = useShop((s) => s.setCart);
  const toasts = useShop((s) => s.toasts);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const [query, setQuery] = useState('');

  // 1. who is this store?
  useEffect(() => {
    let alive = true;
    api.shop.bootstrap()
      .then((r) => {
        if (!alive) return;
        setBoot(r.data);
        applyTheme(r.data?.theme);
        applyDocumentMeta({
          name: r.data?.store?.name,
          tagline: r.data?.store?.tagline,
          description: r.data?.store?.description,
        });
      })
      .catch((e) => { if (alive) setBootError(e); });
    return () => { alive = false; };
  }, [setBoot, setBootError]);

  // 2. the cart follows the session (a guest cart is server-side too)
  useEffect(() => {
    if (!booted || bootError) return undefined;
    let alive = true;
    api.shop.cart()
      .then((r) => { if (alive) setCart(r.data); })
      .catch(() => { /* an anonymous visitor may simply have no cart yet */ });
    return () => { alive = false; };
  }, [booted, bootError, isAuth, setCart]);

  if (!booted || bootError) return <BootScreen error={bootError} />;

  return (
    <div className="flex min-h-screen flex-col">
      <Header query={query} onQuery={setQuery} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home query={query} />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="*" element={<Home query={query} />} />
        </Routes>
      </main>

      <footer className="mt-12 border-t border-slate-200/70 py-8">
        <div className="wrap flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-semibold text-slate-700">{store?.name}</p>
          {store?.tagline && <p className="text-xs text-slate-400">{store.tagline}</p>}
        </div>
      </footer>

      <CartSheet />
      <AuthSheet />
      <Toasts items={toasts} />
    </div>
  );
}
