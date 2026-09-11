/**
 * API response caching middleware — caches GET responses.
 *
 * Reduces database load for frequently-read endpoints:
 *   - Catalog listings
 *   - Product search results
 *   - Category/brand lists
 *   - Public store info
 *
 * Cache key: method + url + tenantId (so different stores never share cache).
 * TTL varies by route pattern (shorter for volatile data, longer for static).
 *
 * Uses BoundedCache (in-memory, LRU). For multi-instance deployments,
 * swap to Redis (the interface is identical: get/set with TTL).
 */

import { BoundedCache } from '../utils/BoundedCache.js';

const cache = new BoundedCache({
  maxEntries: 2000,
  ttlMs: 60_000, // default 1 minute
  name: 'response-cache',
});

// Per-route TTL overrides (regex → ms)
const TTL_OVERRIDES = [
  [/\/catalog\/categories/, 300_000],    // 5 min — categories rarely change
  [/\/catalog\/brands/, 300_000],         // 5 min
  [/\/search/, 30_000],                   // 30s — search results change often
  [/\/catalog$/, 60_000],                 // 1 min — product listings
  [/\/store\/info/, 600_000],             // 10 min — store info is very stable
  [/\/health/, 10_000],                   // 10s
];

function getTtl(path) {
  for (const [pattern, ttl] of TTL_OVERRIDES) {
    if (pattern.test(path)) return ttl;
  }
  return 60_000; // default 1 minute
}

/**
 * Response cache middleware for GET requests.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.excludePaths] — paths to never cache
 */
export function responseCache(opts = {}) {
  const exclude = (opts.excludePaths || []).map((p) => new RegExp(p));

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Skip excluded paths
    if (exclude.some((p) => p.test(req.path))) return next();

    // Never cache credentialed requests. This middleware runs BEFORE per-route
    // `authenticate`, so `req.user` is not set yet — detect credentials from
    // the headers directly. Authenticated reads are identity-scoped (my store,
    // my cart, tenant catalog) and the cache key carries no identity, so
    // caching them breaks write→read-your-write (a save followed by a refetch
    // returns the pre-save snapshot) and can leak one identity's payload to
    // another. Anonymous public reads (bootstrap, catalog, stores) carry no
    // credentials and stay cached; their freshness comes from bust-on-write.
    if (req.headers.authorization || req.headers.cookie) return next();

    // Skip authenticated admin routes (always fresh)
    if (req.path.includes('/admin/') && req.user) return next();

    // Build cache key
    const tenantId = req.tenantId || 'public';
    const key = `GET:${tenantId}:${req.originalUrl}`;

    // Check cache
    const cached = cache.get(key);
    if (cached) {
      res.set('X-Cache', 'HIT');
      res.set('X-Cache-Key', key.slice(0, 32));
      return res.status(cached.status).json(cached.body);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const ttl = getTtl(req.path);
        cache.set(key, { status: res.statusCode, body }, ttl);
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching a pattern.
 * Called when data changes (e.g., product update → invalidate catalog cache).
 */
export function invalidateCache(pattern) {
  let invalidated = 0;
  for (const [key] of cache.entries()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      invalidated += 1;
    }
  }
  return invalidated;
}

/**
 * Cache stats (for monitoring).
 */
export function cacheStats() {
  return cache.stats();
}
