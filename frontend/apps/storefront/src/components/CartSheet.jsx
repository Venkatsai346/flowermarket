import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { Button, Money, Sheet, Stepper, Empty } from './ui.jsx';
import { errMsg } from '../lib/utils.js';

export default function CartSheet() {
  const open = useShop((s) => s.cartOpen);
  const close = useShop((s) => s.closeCart);
  const cart = useShop((s) => s.cart);
  const setCart = useShop((s) => s.setCart);
  const toast = useShop((s) => s.toast);
  const openAuth = useShop((s) => s.openAuth);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const navigate = useNavigate();

  const [busyId, setBusyId] = useState(null);
  const [coupon, setCoupon] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);

  const items = cart?.items || [];
  const totals = cart?.totals || cart || {};

  const setQty = async (item, qty) => {
    setBusyId(item.id);
    try {
      const r = qty <= 0
        ? await api.shop.removeItem(item.id)
        : await api.shop.updateItem(item.id, { qty });
      setCart(r.data);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponBusy(true);
    try {
      const r = await api.shop.applyCoupon(coupon.trim().toUpperCase());
      setCart(r.data);
      toast('Coupon applied', 'success');
      setCoupon('');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCouponBusy(false);
    }
  };

  const dropCoupon = async () => {
    setCouponBusy(true);
    try {
      const r = await api.shop.removeCoupon();
      setCart(r.data);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCouponBusy(false);
    }
  };

  const goCheckout = () => {
    close();
    if (!isAuth) { openAuth(); return; }
    navigate('/checkout');
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Your basket"
      subtitle={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'Nothing here yet'}
      footer={items.length ? (
        <div className="space-y-3">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt><dd><Money value={totals.subtotal ?? cart?.subtotal} /></dd>
            </div>
            {Boolean(cart?.couponCode) && (
              <div className="flex justify-between text-emerald-600">
                <dt className="flex items-center gap-1"><Tag className="h-3.5 w-3.5" />{cart.couponCode}</dt>
                <dd>
                  <button type="button" onClick={dropCoupon} className="text-xs underline">remove</button>
                </dd>
              </div>
            )}
            <p className="pt-1 text-[11px] text-slate-400">
              Delivery, taxes and any discount are confirmed at checkout.
            </p>
          </dl>
          <Button className="w-full" onClick={goCheckout}>
            Checkout · <Money value={totals.subtotal ?? cart?.subtotal} />
          </Button>
        </div>
      ) : null}
    >
      {!items.length ? (
        <Empty
          icon={ShoppingBag}
          title="Your basket is empty"
          message="Add a few stems and they will show up here."
          action={<Button variant="soft" onClick={close}>Keep browsing</Button>}
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.id} className="flex gap-3 py-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                {it.imageUrlSnapshot ? (
                  <img src={it.imageUrlSnapshot} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>🌸</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-slate-800">{it.titleSnapshot}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <Money value={it.priceSnapshot?.sellingPrice} /> each
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <Stepper value={it.qty} onChange={(q) => setQty(it, q)} busy={busyId === it.id} />
                  <Money value={it.lineTotal} className="text-sm font-semibold" />
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remove ${it.titleSnapshot}`}
                onClick={() => setQty(it, 0)}
                className="h-7 w-7 shrink-0 rounded-full text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
              >
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
            </li>
          ))}

          {!cart?.couponCode && (
            <li className="flex gap-2 pt-4">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="Coupon code"
                className="input flex-1 !py-2 text-sm"
              />
              <Button variant="outline" size="sm" loading={couponBusy} onClick={applyCoupon}>Apply</Button>
            </li>
          )}
        </ul>
      )}
    </Sheet>
  );
}
