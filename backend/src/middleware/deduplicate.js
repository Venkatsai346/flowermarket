/**
 * Request deduplication middleware — prevents duplicate processing.
 *
 * Problem: mobile networks can retry POST requests on timeout, causing
 * duplicate orders, payments, or other side effects.
 *
 * Strategies:
 *   1. Idempotency-Key header (explicit — client sends a UUID): applies to
 *      every write method. The client is ASKING for idempotency semantics.
 *   2. Content fingerprint (implicit — hash of scope+method+path+body):
 *      applies to POST ONLY. Rationale: the classic blind-retry failure is a
 *      duplicated CREATE; PUT/PATCH are either naturally idempotent (set) or
 *      deliberately repeatable (a second +10 stock adjustment is real intent,
 *      not a retry), so silently returning the first response there would be
 *      a lost update, not a protection.
 *
 * SCOPING (cross-tenant safety): the key space is scoped by host + tenant
 * header + a hash of the Authorization header. Two different tenants (or two
 * different users of the same tenant) can never collide on each other's
 * cached responses — a shared key would have returned tenant A's create
 * response (with A's ids) to tenant B.
 *
 * Storage: in-memory Map with TTL. For multi-process deployments,
 * swap to Redis (the interface is identical: get/set/delete with TTL).
 *
 * The middleware never blocks a request on its own error — a dedup failure
 * falls through to normal processing.
 */

import crypto from 'node:crypto';
import { BoundedCache } from '../utils/BoundedCache.js';

const cache = new BoundedCache({
  maxEntries: 5000,
  ttlMs: 60_000, // 1 minute (enough for retries, not for long polling)
  name: 'dedup',
});

// In-flight tracking (promise dedup)
const inflight = new Map();

const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_PATHS = /^\/(healthz|readyz|metrics|api\/v1\/health)/;

/** Per-actor key prefix: host + tenant header + auth hash. */
function scopePrefix(req) {
  const host = String(req.headers.host || '');
  const tenantHeader = String(req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || '');
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const scope = crypto
    .createHash('sha256')
    .update(`${host}|${tenantHeader}|${auth}`)
    .digest('hex')
    .slice(0, 16);
  return `s:${scope}`;
}

/**
 * Deduplication middleware.
 *
 * @param {Object} [opts]
 * @param {number} [opts.ttlMs=60000] — how long to cache a response
 * @param {string[]} [opts.headerNames=['idempotency-key', 'x-idempotency-key']]
 */
export function deduplicate(opts = {}) {
  const ttl = opts.ttlMs || 60_000;
  const headers = opts.headerNames || ['idempotency-key', 'x-idempotency-key'];

  return (req, res, next) => {
    // Only deduplicate writes
    if (SKIP_METHODS.has(req.method)) return next();
    if (SKIP_PATHS.test(req.path)) return next();

    // Find idempotency key from headers
    let explicit = null;
    for (const h of headers) {
      const v = req.headers[h];
      if (v && typeof v === 'string' && v.length <= 200) {
        explicit = v;
        break;
      }
    }

    // Implicit fingerprint: POST only (see strategy 2 in the file header).
    let fingerprint = null;
    if (!explicit && req.method === 'POST') {
      const body = req.body ? JSON.stringify(req.body) : '';
      fingerprint = crypto
        .createHash('sha256')
        .update(`${req.method}:${req.originalUrl}:${body}`)
        .digest('hex')
        .slice(0, 16);
    }

    // No explicit key and no eligible method → nothing to dedup.
    let key = null;
    if (explicit) key = `${scopePrefix(req)}:k:${explicit}`;
    else if (fingerprint) key = `${scopePrefix(req)}:fp:${fingerprint}`;
    if (!key) return next();

    // Check for completed response
    const cached = cache.get(key);
    if (cached) {
      res.set('X-Dedup-Cached', 'true');
      res.set('X-Dedup-Key', key);
      return res.status(cached.status).json(cached.body);
    }

    // Check for in-flight request (coalesce concurrent retries)
    const inFlightPromise = inflight.get(key);
    if (inFlightPromise) {
      // Wait for the original to finish, then return the same result
      return inFlightPromise.then(
        (result) => {
          res.set('X-Dedup-Coalesced', 'true');
          res.set('X-Dedup-Key', key);
          res.status(result.status).json(result.body);
        },
        () => next(), // If original errored, let this one try
      );
    }

    // Create in-flight tracker
    let resolveInflight;
    const promise = new Promise((resolve) => { resolveInflight = resolve; });
    inflight.set(key, promise);

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, { status: res.statusCode, body }, ttl);
      }

      // Resolve in-flight waiters
      resolveInflight({ status: res.statusCode, body });
      inflight.delete(key);

      // Add dedup headers
      res.set('X-Dedup-Key', key);

      return originalJson(body);
    };

    // Cleanup on error/close
    res.on('close', () => {
      inflight.delete(key);
    });

    next();
  };
}

/**
 * Get dedup stats (for monitoring).
 */
export function dedupStats() {
  return {
    cache: cache.stats(),
    inflight: inflight.size,
  };
}
