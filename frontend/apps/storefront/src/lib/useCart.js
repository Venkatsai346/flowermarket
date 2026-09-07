import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { errMsg } from './utils.js';
import { isAuthError, withAuthRetry } from './withAuth.js';

/**
 * Shared add-to-cart / qty mutations for Home, Search and the PDP.
 * The cart itself lives on the server (guest cookie or Bearer).
 */
export function useCartActions() {
  const cart = useShop((s) => s.cart);
  const setCart = useShop((s) => s.setCart);
  const toast = useShop((s) => s.toast);
  const [busyId, setBusyId] = useState(null);

  const qtyByListing = useMemo(() => {
    const m = new Map();
    for (const it of cart?.items || []) m.set(String(it.tenantProductId), { qty: it.qty, itemId: it.id });
    return m;
  }, [cart]);

  const add = async (listing) => {
    setBusyId(listing.listingId);
    try {
      const r = await withAuthRetry(() => api.shop.addItem({ tenantProductId: listing.listingId, qty: 1 }));
      setCart(r.data);
      toast(`${listing.product?.title || 'Added'} added`, 'success');
    } catch (e) {
      toast(isAuthError(e) ? 'Sign in to add to your basket' : errMsg(e), isAuthError(e) ? 'info' : 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changeQty = async (listing, qty) => {
    const entry = qtyByListing.get(String(listing.listingId));
    if (!entry) return;
    setBusyId(listing.listingId);
    try {
      const r = await withAuthRetry(() => (qty <= 0
        ? api.shop.removeItem(entry.itemId)
        : api.shop.updateItem(entry.itemId, { qty })));
      setCart(r.data);
    } catch (e) {
      toast(isAuthError(e) ? 'Sign in to update your basket' : errMsg(e), isAuthError(e) ? 'info' : 'error');
    } finally {
      setBusyId(null);
    }
  };

  return { qtyByListing, busyId, add, changeQty };
}
