/**
 * API response caching middleware — caches GET responses.
 *
 * Reduces database load for frequently-read endpoints:
 *   - Catalog listings
 *   - Product search results
 *   - Category/brand lists
 *   - Public store info
 *
 * SECURITY (user scoping): the cache key includes a hash of the request's
 * Authorization header. This middleware runs BEFORE `authenticate`, so it
 * cannot read the verified identity — but a JWT is 1:1 with its user, so a
 * per-token hash gives per-user isolation without moving the middleware.
 * Requests without credentials share the anonymous key. (Two tokens of the
 * same user get separate entries — bounded, self-expiring, harmless.)
 *
 * STALENESS (invalidation): the catalog write path (catalogEventService.
 * publish) emits `catalog-write` on the in-process bus after every accepted
 * mutation; we clear the cache in response. Cross-instance staleness is
 * bounded by TTL (see localEvents.js scope note).
 *
 * Cache key: method + tenantId + authHash + url — different stores and
 * different users never share an entry.
 *
 * Uses BoundedCache (in-memory, LRU). For multi-instance deployments,
 * swap to Redis (the interface is identical: get/set/clear with TTL).
 */

import crypto from 'node:crypto';
import { BoundedCache } from '../utils/BoundedCache.js';
import { localOn, LOCAL_EVENTS } from '../utils/localEvents.js';

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
 * Stable identity tag for cache keys: a hash of the raw Authorization
 * header (or 'anon'). Hashed so keys stay short and tokens never live in
 * cache-key strings longer than necessary.
 */
function authTag(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return 'anon';
  return crypto.createHash('sha256').update(h).digest('hex').slice(0, 16);
}

/**
 * Default scope: PUBLIC storefront reads only.
 *
 * `/api/v1/catalog…` — except the `/admin` and `/tenant` sub-trees, plus
 * `/api/v1/store/info`. Anything else (authenticated user/admin/tenant
 * endpoints, orders, users, …) is NEVER cached. Rationale: a cache entry can
 * only be invalidated in-process; an admin whose role is demoted mid-TTL must
 * not keep reading cached admin responses. Public catalog reads are the
 * documented intent of this middleware (see file header) and the only ones
 * where a short staleness window (bounded by the write-invalidation bus + TTL)
 * is acceptable.
 */
const DEFAULT_ALLOW = /^\/api\/v1\/(?:catalog(?![^]*(?:\/admin|\/tenant))|store\/info)(?:\/|$)/;

/**
 * Response cache middleware for GET requests.
 *
 * @param {object} [opts]
 * @param {RegExp[]} [opts.allowPaths] override the default public allowlist
 * @param {string[]} [opts.excludePaths] extra paths to never cache
 */
export function responseCache(opts = {}) {
  const allow = (opts.allowPaths && opts.allowPaths.length) ? opts.allowPaths : [DEFAULT_ALLOW];
  const exclude = (opts.excludePaths || []).map((p) => new RegExp(p));

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Cache only public storefront reads (default allowlist)
    if (!allow.some((p) => p.test(req.path))) return next();

    // Skip excluded paths
    if (exclude.some((p) => p.test(req.path))) return next();

    // Build cache key: tenant + auth identity + full url (incl. query)
    const tenantId = req.tenantId || 'public';
    const key = `GET:${tenantId}:${authTag(req)}:${req.originalUrl}`;

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

/** Invalidate cache entries matching a pattern (substring on the key). */
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

/** Clear the whole GET cache (used on any catalog write — cheap, exact). */
export function invalidateAll() {
  const n = cache.size;
  cache.clear();
  return n;
}

// Every accepted catalog mutation clears this process's GET cache, so a
// price/status/taxonomy change is visible to the next customer request.
// (The outbox row is the durable record; this only governs read freshness.)
localOn(LOCAL_EVENTS.CATALOG_WRITE, () => {
  invalidateAll();
});

/** Cache stats (for monitoring). */
export function cacheStats() {
  return cache.stats();
}
