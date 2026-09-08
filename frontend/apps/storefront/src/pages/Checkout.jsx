import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeIndianRupee, Banknote, Calendar, Check, CreditCard, MapPin, Plus, ShieldCheck, Tag, Wallet,
} from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Money, Empty } from '../components/ui.jsx';
import { asList, cn, errMsg } from '../lib/utils.js';
import { kolkataDate } from '../lib/arrival.js';

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
  // Published by the tenant bootstrap: which payment methods this store may
  // actually offer, and the cash risk cap. Read from config server-side, so
  // switching cash off is an env flip, not a deploy.
  const payments = useShop((s) => s.payments);
  const navigate = useNavigate();
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  
  const [addressId, setAddressId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [reservation, setReservation] = useState(null);
  const [payment, setPayment] = useState('upi');
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);

  const { data: addresses, refetch: refetchAddresses } = useApi(() => api.shop.addresses(), []);
  const { data: wallet } = useApi(
    () => (isAuth ? api.shop.wallet() : Promise.resolve({ data: null })),
    [isAuth],
  );

  const addressesArray = useMemo(() => asList(addresses), [addresses]);

  const selectedAddress = addressesArray.find((a) => String(a.id) === String(addressId));
  const pin = selectedAddress?.pincode || '';

  const { data: slots, loading: slotsLoading } = useApi(async () => {
    if (!pin) return { data: [] };
    const dates = [0, 1, 2].map((i) => kolkataDate(i));
    const res = await Promise.all(dates.map((date) => api.shop.slots({ date, pincode: pin })));
    const first = res[0]?.data;
    if (first && first.serviceable === false) {
      return { data: { serviceable: false, pincode: pin, slots: [] } };
    }
    return { data: res.flatMap((r) => r.data?.slots || []) };
  }, [pin]);

  const slotsArray = useMemo(() => asList(slots), [slots]);
  const pinServiceable = !pin || slots?.serviceable !== false;

  const reservationId = reservation?.id || reservation?.reservationId || null;
  const couponCode = cart?.cart?.couponCode || cart?.couponCode || '';
  const quoteKey = isAuth && addressId && reservationId ? `${addressId}:${reservationId}:${couponCode}` : null;
  
  const { data: quote } = useApi(
    () => (quoteKey
      ? api.shop.checkoutQuote({ slotReservationId: reservationId, addressId, confirmPriceChanges: true })
      : Promise.resolve({ data: null })),
    [quoteKey],
  );

  const walletBalance = Number(wallet?.balance) || 0;
  const orderTotal = Number(quote?.grandTotal) || 0;
  const canWalletPay = Boolean(isAuth && wallet && quote && walletBalance >= orderTotal && quote.grandTotal != null);

  /**
   * Cash on delivery — three independent gates, and the UI must honour all of
   * them BEFORE offering the option. A radio button the server will refuse is a
   * broken promise: the customer picks cash, fills in the form, taps pay and
   * gets a 422. So availability is computed here and the option is hidden (with
   * a reason) instead.
   *
   *   1. platform  — cash switched off entirely (monsoon, fraud spike, a city
   *                  where riders are being robbed). From the bootstrap, so it
   *                  is an env flip, not a deploy.
   *   2. slot      — some slots do not allow cash (a hub with no float).
   *   3. cap       — cash is an unsecured credit line to a stranger; above the
   *                  risk cap the order must be prepaid.
   */
  const codCfg = payments?.cod || {};
  const codEnabled = codCfg.enabled !== false;
  const codCapPaise = Number(codCfg.maxAmountPaise) || 0;
  const codCap = Number(codCfg.maxAmount) || 0;
  const slotAllowsCod = Boolean(slotsArray.find((s) => String(s.id) === slotId)?.codAllowed);
  // Only judge the cap once a quote exists: before that the total is unknown,
  // and hiding cash on an empty number would flicker it out of the UI.
  const codOverCap = Boolean(quote && codCapPaise > 0 && Math.round(orderTotal * 100) > codCapPaise);
  const codAvailable = codEnabled && slotAllowsCod && !codOverCap;
  const codReason = !codEnabled
    ? 'Cash on delivery is not available right now'
    : !slotAllowsCod
      ? 'Cash on delivery is not available for this slot'
      : codOverCap
        ? `Cash on delivery is available up to ${codCap ? `₹${codCap.toLocaleString('en-IN')}` : 'the limit'} — this order is over it`
        : null;

  useEffect(() => {
    if (!addressId && addressesArray.length) {
      setAddressId(String(addressesArray.find((a) => a.isDefault)?.id || addressesArray[0].id));
    }
  }, [addressesArray, addressId]);

  useEffect(() => {
    if (!quote?.priceChanged) return undefined;
    let alive = true;
    api.shop.cart().then((r) => { if (alive) setCart(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, [quote?.priceChanged, setCart]);

  useEffect(() => {
    if (payment === 'wallet' && !canWalletPay) setPayment('upi');
  }, [payment, canWalletPay]);

  // Same rule for cash: if it stops being available (slot changed, total grew
  // past the cap, the platform switched cash off) fall back rather than submit
  // a method the backend will reject.
  useEffect(() => {
    if (payment === 'cod' && !codAvailable) setPayment('upi');
  }, [payment, codAvailable]);

  useEffect(() => {
    setSlotId('');
    setReservation(null);
  }, [pin]);

  /** Slots grouped by day, because "tomorrow 4–6pm" is how people think. */
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const s of slotsArray) {
      const key = s.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    return [...groups.entries()];
  }, [slotsArray]);

  const items = cart?.items || [];

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponBusy(true);
    try {
      const r = await api.shop.applyCoupon(coupon.trim());
      setCart(r.data);
      setCoupon('');
      toast('Coupon applied', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCouponBusy(false);
    }
  };

  const dropCoupon = async () => {
    try {
      const r = await api.shop.removeCoupon();
      setCart(r.data);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

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
      if (r.data?.paymentPending) {
        // async gateway (Razorpay): order exists but awaits capture — the
        // order page polls /orders/:id/payment until the webhook lands
        toast('Complete the payment to confirm your order');
        navigate(`/orders/${order.id}?pay=1`);
      } else {
        toast('Order placed', 'success');
        navigate(`/orders/${order.id}`);
      }
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
          action={<Button onClick={() => navigate('/')} >Browse the store</Button>}
        />
      </div>
    );
  }

  const canPlace = addressId && reservation && pinServiceable && !placing;

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
              {addressesArray.map((a) => (
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
          ) : !pin ? (
            <p className="text-sm text-slate-500">Pick an address so we can show slots for that pincode.</p>
          ) : !pinServiceable ? (
            <p className="text-sm text-rose-600">We don't deliver to {pin}. Choose another address or we cannot check out.</p>
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
                      const full = (s.remaining ?? s.availableCapacity ?? 1) <= 0;
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
            {PAYMENTS.filter(([id]) => id !== 'cod' || codAvailable).map(([id, label, Icon]) => (
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
            {/* An unavailable option is still INFORMATION: silently dropping
                "Cash on delivery" reads as a bug, and a customer who wanted
                cash has no way to know why it vanished. So when cash is off for
                a reason the customer can act on, say which reason. */}
            {codReason && slotId && (
              <p className="sm:col-span-2 lg:col-span-3 -mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                <Banknote className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>{codReason}</span>
              </p>
            )}
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
          {!couponCode ? (
            <div className="mb-3 flex gap-2">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="Coupon code"
                className="input flex-1 !py-2 text-sm"
              />
              <Button variant="outline" size="sm" loading={couponBusy} onClick={applyCoupon}>Apply</Button>
            </div>
          ) : (
            <div className="mb-3 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <span className="inline-flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" />{couponCode}</span>
              <button type="button" onClick={dropCoupon} className="underline">remove</button>
            </div>
          )}
          <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt><dd><Money value={cart?.cart?.subtotal ?? cart?.subtotal} /></dd>
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
                    <dt>{quote.pricesInclusive !== false ? 'GST (included)' : 'GST'}</dt>
                    <dd><Money value={quote.taxTotal} /></dd>
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
