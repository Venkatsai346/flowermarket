import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Infinite scroll hook.
 *
 * Attaches to a sentinel element at the bottom of a list. When the sentinel
 * enters the viewport (via IntersectionObserver), it calls `loadMore`.
 *
 * Usage:
 *   const { items, loading, hasMore, sentinelRef } = useInfiniteScroll(
 *     (page) => api.shop.products({ page, limit: 24 }),
 *     { initialData: [] }
 *   );
 *
 *   return (
 *     <>
 *       {items.map(item => <ProductCard key={item.id} ... />)}
 *       {hasMore && <div ref={sentinelRef} />}
 *       {loading && <ProductSkeleton />}
 *     </>
 *   );
 */
export function useInfiniteScroll(fetchPage, { initialData = [], pageSize = 24, enabled = true } = {}) {
  const [items, setItems] = useState(initialData);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);

  // Reset when fetchPage changes (e.g. filter/sort change)
  useEffect(() => {
    if (!enabled) return;
    setItems(initialData);
    setPage(1);
    setHasMore(true);
  }, [fetchPage, enabled]);

  // Load a page
  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !enabled) return;
    setLoading(true);
    try {
      const result = await fetchPage(page);
      const newItems = Array.isArray(result) ? result : result?.items || result?.data || [];
      const meta = result?.meta || {};

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.listingId || i.id || i._id));
        const unique = newItems.filter((i) => !existingIds.has(i.listingId || i.id || i._id));
        return page === 1 ? newItems : [...prev, ...unique];
      });

      setHasMore(
        meta.hasMore !== undefined ? meta.hasMore
          : meta.totalPages !== undefined ? page < meta.totalPages
            : newItems.length >= pageSize
      );
      setPage((p) => p + 1);
    } catch {
      // silently fail — the user can retry by scrolling
    } finally {
      setLoading(false);
    }
  }, [page, loading, hasMore, enabled, fetchPage, pageSize]);

  // Initial load
  useEffect(() => {
    if (enabled && items.length === 0 && page === 1 && !loading) {
      loadMore();
    }
  }, [enabled]);

  // Observe the sentinel
  useEffect(() => {
    if (!enabled || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' } // trigger 200px before the sentinel is visible
    );

    observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, [enabled, hasMore, loadMore]);

  return { items, loading, hasMore, sentinelRef, loadMore };
}

export default useInfiniteScroll;
