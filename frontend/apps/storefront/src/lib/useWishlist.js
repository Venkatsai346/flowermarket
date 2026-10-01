import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'bloomy-wishlist';
const listeners = new Set();
const EMPTY = [];
let snapshot;

export function wishlistIdentity(item = {}) {
  if (item.key) return String(item.key);
  const slug = String(item.slug || '').trim();
  if (!slug) return '';
  if (item.variantId) return `${slug}::variant:${item.variantId}`;
  if (item.listingId) return `${slug}::listing:${item.listingId}`;
  return slug;
}

export function normalizeWishlist(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];
  for (const source of items) {
    const slug = String(source?.slug || '').trim();
    const key = wishlistIdentity({ ...source, slug });
    if (!slug || !key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...source, slug, key });
  }
  return normalized;
}

function readLocal() {
  try {
    return normalizeWishlist(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
  } catch {
    return [];
  }
}

function getSnapshot() {
  if (!snapshot) snapshot = readLocal();
  return snapshot;
}

function persist(next) {
  snapshot = normalizeWishlist(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* private mode/quota: memory state remains usable */ }
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = readLocal();
    for (const listener of listeners) listener();
  });
}

/** Reactive variant-aware local wishlist shared by every mounted component. */
export function useWishlist() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const isWishlisted = useCallback(
    (identity) => items.some((item) => item.key === (typeof identity === 'string' ? identity : wishlistIdentity(identity))),
    [items],
  );

  const toggle = useCallback((item) => {
    const slug = String(item?.slug || '').trim();
    const key = wishlistIdentity({ ...item, slug });
    if (!slug || !key) return;
    const current = getSnapshot();
    if (current.some((entry) => entry.key === key)) {
      persist(current.filter((entry) => entry.key !== key));
      return;
    }
    // Upgrade the old product-level wishlist row when the customer now picks
    // an exact sellable variant; do not leave an ambiguous duplicate behind.
    const base = item.variantId || item.listingId
      ? current.filter((entry) => !(entry.slug === slug && entry.key === slug))
      : current;
    persist([...base, {
      key,
      slug,
      variantId: item.variantId || null,
      listingId: item.listingId || null,
      variantLabel: item.variantLabel || null,
      sellerSku: item.sellerSku || null,
      title: item.title,
      imageUrl: item.imageUrl || item.images?.[0] || null,
      price: item.price ?? item.minPrice ?? null,
      addedAt: Date.now(),
    }]);
  }, []);

  const clear = useCallback(() => persist([]), []);

  return { items, toggle, isWishlisted, clear };
}

export default useWishlist;
