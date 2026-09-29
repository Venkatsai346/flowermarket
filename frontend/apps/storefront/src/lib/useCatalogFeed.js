import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useShopAuth } from '../api.js';

const FEED_CACHE = new Map();
const FEED_CACHE_TTL_MS = 60_000;
const FEED_CACHE_MAX = 20;

const rememberFeed = (key, state) => {
  FEED_CACHE.delete(key);
  FEED_CACHE.set(key, { ...state, savedAt: Date.now() });
  while (FEED_CACHE.size > FEED_CACHE_MAX) FEED_CACHE.delete(FEED_CACHE.keys().next().value);
};

/**
 * Cursor-driven catalogue feed.
 *
 * - resets atomically when filters/sort/session change
 * - appends pages without replacing products already on screen
 * - rejects late responses from an obsolete filter set
 * - de-duplicates by master id as a final consistency guard
 */
export function useCatalogFeed(params, { limit = 24 } = {}) {
  const sessionId = useShopAuth((state) => state.sessionId);
  const rawQueryKey = JSON.stringify(params || {});
  const stableParams = useMemo(() => {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== '' && value !== undefined && value !== null && value !== false) out[key] = value;
    }
    return out;
  // The serialized query is the intentional identity boundary for this hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawQueryKey]);
  const queryKey = useMemo(() => JSON.stringify(stableParams), [stableParams]);
  const cacheKey = `${sessionId || 'guest'}:${limit}:${queryKey}`;
  const generation = useRef(0);
  const loadingMoreRef = useRef(false);
  const [state, setState] = useState(() => {
    const cached = FEED_CACHE.get(cacheKey);
    return cached && Date.now() - cached.savedAt < FEED_CACHE_TTL_MS
      ? { data: cached.data, meta: cached.meta, loading: false, loadingMore: false, error: null }
      : { data: null, meta: null, loading: true, loadingMore: false, error: null };
  });

  const fetchPage = useCallback(async ({ cursor = null, append = false } = {}) => {
    const requestGeneration = generation.current;
    setState((current) => ({
      ...current,
      loading: append ? current.loading : true,
      loadingMore: append,
      error: null,
    }));
    try {
      const response = await api.shop.products({
        ...stableParams,
        groupBy: 'master',
        limit,
        cursor: cursor || undefined,
      });
      if (requestGeneration !== generation.current) return response;
      setState((current) => {
        const incoming = response.data || [];
        const combined = append ? [...(current.data || []), ...incoming] : incoming;
        const seen = new Set();
        const data = combined.filter((item) => {
          const id = String(item.masterId || item.listingId || '');
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        const next = { data, meta: response.meta || null, loading: false, loadingMore: false, error: null };
        rememberFeed(cacheKey, next);
        return next;
      });
      return response;
    } catch (error) {
      if (requestGeneration === generation.current) {
        setState((current) => ({ ...current, loading: false, loadingMore: false, error }));
      }
      throw error;
    }
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    generation.current += 1;
    loadingMoreRef.current = false;
    const cached = FEED_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < FEED_CACHE_TTL_MS) {
      setState({ data: cached.data, meta: cached.meta, loading: false, loadingMore: false, error: null });
      return;
    }
    setState({ data: null, meta: null, loading: true, loadingMore: false, error: null });
    fetchPage().catch(() => {});
  }, [cacheKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || state.loading || state.loadingMore || !state.meta?.hasMore || !state.meta?.nextCursor) {
      return Promise.resolve(null);
    }
    loadingMoreRef.current = true;
    return fetchPage({ cursor: state.meta.nextCursor, append: true })
      .catch(() => null)
      .finally(() => { loadingMoreRef.current = false; });
  }, [fetchPage, state.loading, state.loadingMore, state.meta]);

  const refetch = useCallback(() => {
    generation.current += 1;
    return fetchPage().catch(() => null);
  }, [fetchPage]);

  return { ...state, loadMore, refetch };
}
