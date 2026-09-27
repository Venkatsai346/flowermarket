import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'bloomy-wishlist';
const listeners = new Set();
const EMPTY = [];
let snapshot;

function normalize(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter((item) => {
    const slug = String(item?.slug || '').trim();
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

function readLocal() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
  } catch {
    return [];
  }
}

function getSnapshot() {
  if (!snapshot) snapshot = readLocal();
  return snapshot;
}

function persist(next) {
  snapshot = normalize(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* private mode/quota: memory state remains usable */ }
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep separate tabs/windows and every mounted product card coherent.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = readLocal();
    for (const listener of listeners) listener();
  });
}

/**
 * Reactive local wishlist shared by every mounted hook instance.
 * Stores lightweight { slug, title, imageUrl, price, addedAt } snapshots.
 */
export function useWishlist() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const isWishlisted = useCallback(
    (slug) => items.some((item) => item.slug === String(slug || '')),
    [items],
  );

  const toggle = useCallback((item) => {
    const slug = String(item?.slug || '').trim();
    if (!slug) return;
    const current = getSnapshot();
    const exists = current.some((entry) => entry.slug === slug);
    if (exists) {
      persist(current.filter((entry) => entry.slug !== slug));
      return;
    }
    persist([...current, {
      slug,
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
