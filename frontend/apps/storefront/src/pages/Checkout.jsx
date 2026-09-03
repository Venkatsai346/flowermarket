import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeIndianRupee, Banknote, Calendar, Check, CreditCard, MapPin, Plus, ShieldCheck, Wallet,
} from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Money, Empty } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const PAYMENTS = [
  ['upi', 'UPI', BadgeIndianRupee],
  ['card', 'Card', CreditCard],
  ['cod', 'Cash on delivery', Banknote],
];

function AddressForm({ onSaved, onCancel }) {
  const [f, setF] = useState({ name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' });
  const [busy, setBusy] = useState(false);
  const toast = useShop((s) => s.toast);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.shop.addAddress({ ...f, label: 'home' });
      onSaved?.(r.data);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="Full name" value={f.name} onChange={set('name')} />
        <input className="input" placeholder="Phone" inputMode="numeric" value={f.phone} onChange={set('phone')} />
      </div>
      <input className="input" placeholder="Flat / house / street" value={f.line1} onChange={set('line1')} />
      <input className="input" placeholder="Area, landmark (optional)" value={f.line2} onChange={set('line2')} />
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="City" value={f.city} onChange={set('city')} />
        <input className="input" placeholder="State" value={f.state} onChange={set('state')} />
        <input className="input" placeholder="Pincode" inputMode="numeric" value={f.pincode} onChange={set('pincode')} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" loading={busy} disabled={!f.line1 || !f.pincode} onClick={save}>Save address</Button>
      </div>
    </div>
  );
}

export default function Checkout() {
  const cart = useShop((s) => s.cart);
  const setCart = useShop((s) => s.setCart);
  const toast = useShop((s) => s.toast);
  const navigate = useNavigate();
  const isAuth = useShopAuth((s) => s.isAuthenticated());

  const [addressId, setAddressId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [reservation, setReservation] = useState(null);
  const [payment, setPayment] = useState('upi');
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState(false);

  const { data: addresses, refetch: refetchAddresses } = useApi(() => api.shop.addresses(), []);
  const { data: slots, loading: slotsLoading } = useApi(() => api.shop.slots({ days: 3 }), []);
  const { data: wallet } = useApi(
    () => (isAuth ? api.shop.wallet() : Promise.resolve({ data: null })),
    [isAuth],
  );

  const reservationId = reservation?.id || reservation?.reservationId || null;
  const quoteKey = isAuth && addressId && reservationId ? `${addressId}:${reservationId}` : null;
  const { data: quote } = useApi(
    () => (quoteKey
      ? api.shop.checkoutQuote({ slotReservationId: reservationId, addressId, confirmPriceChanges: true })
      : Promise.resolve({ data: null })),
    [quoteKey],
  );
  const walletBalance = Number(wallet?.balance) || 0;
  const orderTotal = Number(quote?.grandTotal) || 0;
  const canWalletPay = Boolean(isAuth && wallet && quote && walletBalance >= orderTotal && quote.grandTotal != null);

  useEffect(() => {
    if (!addressId && addresses?.length) {
      setAddressId(String(addresses.find((a) => a.isDefault)?.id || addresses[0].id));
    }
  }, [addresses, addressId]);

  // If the preflight had to snap the cart to live prices, re-read the cart so
  // the summary line items agree with the quoted totals.
  useEffect(() => {
    if (!quote?.priceChanged) return undefined;
    let alive = true;
    api.shop.cart().then((r) => { if (alive) setCart(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, [quote?.priceChanged, setCart]);

  // If a previously selected wallet option no longer covers the exact order
  // total (balance dropped / quote changed / cart changed), fall back to UPI
  // so the customer can never submit a wallet payment the server would reject.
  useEffect(() => {
    if (payment === 'wallet' && !canWalletPay) setPayment('upi');
  }, [payment, canWalletPay]);

  /** Slots grouped by day, because "tomorrow 4–6pm" is how people think. */
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const s of slots || []) {
      const key = s.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    return [...groups.entries()];
  }, [slots]);

  const items = cart?.items || [];

  const reserve = async (slot) => {
    setSlotId(String(slot.id));
    try {
      const r = await api.shop.reserveSlot(slot.id, {});
      setReservation(r.data);
      toast('Slot held for 10 minutes', 'success');
    } catch (e) {
      setSlotId('');
      toast(errMsg(e), 'error');
    }
  };

  const place = async () => {
    setPlacing(true);
    try {
      const r = await api.shop.checkout({
        addressId,
        slotReservationId: reservation?.id || reservation?.reservationId,
        paymentMethod: payment,
        confirmPriceChanges: true,
      });
      const order = r.data?.order || r.data;
      setCart(null);
      if (r.data?.pending) {
        toast('Complete the payment to confirm your order');
      } else {
        toast('Order placed', 'success');
      }
      navigate(`/orders/${order.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setPlacing(false);
    }
  };

  if (!items.length) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={MapPin}
          title="Your basket is empty"
          message="Add something before checking out."
          action={<Button onClick={() => navigate('/')}>Browse the store</Button>}
        />
      </div>
    );
  }

  const canPlace = addressId && reservation && !placing;

  return (
    <div className="wrap grid gap-6 py-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {/* 1. address */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>1</span>
            Delivery address
          </h2>
          {adding ? (
            <AddressForm
              onCancel={() => setAdding(false)}
              onSaved={(a) => { setAdding(false); setAddressId(String(a.id)); refetchAddresses(); }}
            />
          ) : (
            <div className="space-y-2">
              {(addresses || []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAddressId(String(a.id))}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition',
                    addressId === String(a.id) ? 'border-transparent ring-2' : 'border-slate-200 hover:bg-slate-50'
                  )}
                  style={addressId === String(a.id) ? { background: 'var(--brand-soft)', boxShadow: '0 0 0 2px var(--brand)' } : undefined}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-slate-800">{a.name || 'Address'}</span>
                    <span className="block truncate text-slate-500">
                      {[a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  {addressId === String(a.id) && <Check className="ml-auto h-4 w-4 shrink-0" style={{ color: 'var(--brand)' }} />}
                </button>
              ))}
              <Button variant="outline" size="sm" icon={Plus} onClick={() => setAdding(true)}>Add a new address</Button>
            </div>
          )}
        </section>

        {/* 2. slot */}
        <section className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>2</span>
            Delivery slot
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Choosing a slot holds it for 10 minutes so nobody else can take it while you pay.
          </p>

          {slotsLoading ? (
            <div className="flex gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 w-32" />)}</div>
          ) : !byDay.length ? (
            <p className="text-sm text-slate-500">No slots available right now — please try again shortly.</p>
          ) : (
            <div className="space-y-4">
              {byDay.map(([date, list]) => (
                <div key={date}>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Calendar className="h-3.5 w-3.5" />{date}
                  </p>
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                    {list.map((s) => {
                      const full = (s.availableCapacity ?? 1) <= 0;
                      const active = slotId === String(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={full}
                          onClick={() => reserve(s)}
                          className={cn(
                            'shrink-0 rounded-xl border px-4 py-2.5 text-left transition',
                            full && 'cursor-not-allowed opacity-40',
                            active ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50'
                          )}
                          style={active ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : undefined}
                        >
                          <span className="block text-sm font-semibold">{s.displayLabel || `${s.startTime}–${s.endTime}`}</span>
                          <span className={cn('block text-[11px]', active ? 'opacity-80' : 'text-slate-400')}>
                            {full ? 'Full' : s.windowType === 'express' ? 'Express' : 'Standard'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. payment */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>3</span>
            Payment
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PAYMENTS.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayment(id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition',
                  payment === id ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50'
                )}
                style={payment === id ? { background: 'var(--brand-soft)', boxShadow: '0 0 0 2px var(--brand)' } : undefined}
              >
                <Icon className="h-4 w-4 text-slate-500" />{label}
              </button>
            ))}
            {isAuth && (
              <button
                key="wallet"
                type="button"
                disabled={!canWalletPay}
                onClick={() => setPayment('wallet')}
                className={cn(
                  'flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-medium transition',
                  !canWalletPay && 'cursor-not-allowed opacity-50',
                  payment === 'wallet' && canWalletPay ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50'
                )}
                style={payment === 'wallet' && canWalletPay ? { background: 'var(--brand-soft)', boxShadow: '0 0 0 2px var(--brand)' } : undefined}
              >
                <Wallet className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="min-w-0">
                  <span className="block">Pay with wallet</span>
                  <span className="block text-[11px] normal-case text-slate-400">
                    {canWalletPay
                      ? `Balance ₹${walletBalance} covers this order`
                      : quote
                        ? `Need ₹${Math.max(0, orderTotal - walletBalance)} more`
                        : 'Balance check…'}
                  </span>
                </span>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-5">
          <h2 className="mb-3 text-base font-bold text-slate-900">Order summary</h2>
          <ul className="mb-4 max-h-52 space-y-2 overflow-y-auto text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-slate-600">{i.qty} × {i.titleSnapshot}</span>
                <Money value={i.lineTotal} className="shrink-0 text-slate-800" />
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt><dd><Money value={cart?.subtotal} /></dd>
            </div>
            {quote ? (
              <>
                {quote.deliveryFee > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <dt>Delivery</dt><dd><Money value={quote.deliveryFee} /></dd>
                  </div>
                )}
                {quote.taxTotal > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <dt>GST</dt><dd><Money value={quote.taxTotal} /></dd>
                  </div>
                )}
                {quote.discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <dt>Coupon</dt><dd>−<Money value={quote.discountTotal} /></dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold text-slate-900">
                  <dt>Total</dt><dd><Money value={orderTotal} /></dd>
                </div>
              </>
            ) : (
              <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
                Delivery fee, GST and any coupon are confirmed with your slot — pick an address and
                a delivery slot to see the exact total.
              </p>
            )}
          </dl>

          <Button className="mt-4 w-full" loading={placing} disabled={!canPlace} onClick={place}>
            {!addressId ? 'Choose an address' : !reservation ? 'Choose a slot' : 'Place order'}
          </Button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Stock and price are re-checked at the moment you order
          </p>
        </div>
      </aside>
    </div>
  );
}
