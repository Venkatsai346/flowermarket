import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { errMsg } from './utils.js';
import { isAuthError, withAuthRetry } from './withAuth.js';

const eventId = () => globalThis.crypto?.randomUUID?.()
  || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`;

/**
 * Shared add-to-cart / qty mutations for Home, Search and the PDP.
 * The cart itself lives on the server (guest cookie or Bearer).
 */
export function useCartActions() {
  const cart = useShop((s) => s.cart);
  const pincode = useShop((s) => s.pincode);
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
      const r = await withAuthRetry(() => api.shop.addItem({
        tenantProductId: listing.listingId, qty: 1,
        searchQueryId: listing._search?.queryId || null,
        fulfillmentPincode: /^\d{6}$/.test(pincode || '') ? pincode : null,
      }));
      setCart(r.data);
      if (listing._search?.queryId) {
        api.shop.searchEvent({
          queryId: listing._search.queryId,
          eventId: eventId(),
          type: 'add_to_cart', listingId: listing.listingId, position: listing._search.position,
        }).catch(() => {});
      }
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
        : api.shop.updateItem(entry.itemId, {
          qty, fulfillmentPincode: /^\d{6}$/.test(pincode || '') ? pincode : null,
        })));
      setCart(r.data);
    } catch (e) {
      toast(isAuthError(e) ? 'Sign in to update your basket' : errMsg(e), isAuthError(e) ? 'info' : 'error');
    } finally {
      setBusyId(null);
    }
  };

  return { qtyByListing, busyId, add, changeQty };
}
