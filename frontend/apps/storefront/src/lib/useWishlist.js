import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'bloomy-wishlist';

/**
 * Wishlist — localStorage-backed, server-synced when authenticated.
 *
 * Stores an array of { slug, title, imageUrl, price } objects.
 * The hook merges server wishlist on login and persists locally for guests.
 */
function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function writeLocal(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* quota exceeded — ignore */ }
}

/**
 * @returns {{ items: Array, toggle: (item) => void, isWishlisted: (slug) => boolean, clear: () => void }}
 */
export function useWishlist() {
  const [items, setItems] = useState(readLocal);

  // Persist on change
  useEffect(() => { writeLocal(items); }, [items]);

  const isWishlisted = useCallback(
    (slug) => items.some((w) => w.slug === slug),
    [items],
  );

  const toggle = useCallback((item) => {
    setItems((prev) => {
      const idx = prev.findIndex((w) => w.slug === item.slug);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      return [...prev, {
        slug: item.slug,
        title: item.title,
        imageUrl: item.imageUrl || item.images?.[0] || null,
        price: item.price || item.minPrice || null,
        addedAt: Date.now(),
      }];
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, toggle, isWishlisted, clear };
}

export default useWishlist;
