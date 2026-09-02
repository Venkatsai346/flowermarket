import { create } from 'zustand';

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
  setCart: (cart) => set({ cart }),
  itemCount: () => (get().cart?.items || []).reduce((a, i) => a + (i.qty || 0), 0),

  // ---- UI ----
  cartOpen: false,
  openCart: () => set({ cartOpen: true }),
  closeCart: () => set({ cartOpen: false }),
  authOpen: false,
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),

  toasts: [],
  toast: (message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

export default useShop;
