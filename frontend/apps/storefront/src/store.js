import { create } from 'zustand';
import { persistGuestKey, clearGuestKey } from './api.js';

const pinKey = () => `fm-pin:${typeof window !== 'undefined' ? window.location.hostname : 'server'}`;
const langKey = () => `fm-lang:${typeof window !== 'undefined' ? window.location.hostname : 'server'}`;

function readPin() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(pinKey()) || '';
}

function readLang() {
  if (typeof window === 'undefined') return 'en';
  const v = window.localStorage.getItem(langKey());
  return v === 'te' ? 'te' : 'en';
}

/**
 * UI state only. The cart itself lives on the SERVER — price, stock and
 * coupon validity are all things a client must not be trusted with, and the
 * checkout saga re-validates them anyway. What we keep locally is the last
 * known snapshot (so the badge and drawer render instantly) plus the toast and
 * sheet flags.
 */
export const useShop = create((set, get) => ({
  // ---- tenant ----
  store: null,
  theme: {},
  features: {},
  routing: null,
  booted: false,
  bootError: null,
  setBoot: (payload) => set({ ...payload, booted: true, bootError: null }),
  setBootError: (bootError) => set({ bootError, booted: true }),

  // ---- cart snapshot ----
  cart: null,
  setCart: (cart) => {
    if (cart?.guestKey) persistGuestKey(cart.guestKey);
    if (cart && cart.guest === false) clearGuestKey();
    set({ cart });
  },
  itemCount: () => (get().cart?.items || []).reduce((a, i) => a + (i.qty || 0), 0),

  // ---- pincode (the front door) ----
  pincode: readPin(),
  serviceability: null,
  nextSlot: null,
  pinOpen: false,
  openPin: () => set({ pinOpen: true }),
  closePin: () => set({ pinOpen: false }),
  setPincode: (pincode) => {
    const pin = String(pincode || '').replace(/\D/g, '').slice(0, 6);
    if (typeof window !== 'undefined') {
      if (pin) window.localStorage.setItem(pinKey(), pin);
      else window.localStorage.removeItem(pinKey());
    }
    set({ pincode: pin, serviceability: pin ? get().serviceability : null, nextSlot: pin ? get().nextSlot : null });
  },
  setServiceability: (serviceability) => set({ serviceability }),
  setNextSlot: (nextSlot) => set({ nextSlot }),

  // ---- language (chrome only) ----
  language: readLang(),
  setLanguage: (language) => {
    const lang = language === 'te' ? 'te' : 'en';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(langKey(), lang);
      document.documentElement.lang = lang === 'te' ? 'te' : 'en';
    }
    set({ language: lang });
  },

  // ---- UI ----
  cartOpen: false,
  openCart: () => set({ cartOpen: true }),
  closeCart: () => set({ cartOpen: false }),
  authOpen: false,
  authPending: null,
  openAuth: (pending = null) => set({ authOpen: true, authPending: pending || null }),
  closeAuth: () => {
    const pending = get().authPending;
    pending?.onCancel?.();
    set({ authOpen: false, authPending: null });
  },

  toasts: [],
  toast: (message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

export default useShop;
