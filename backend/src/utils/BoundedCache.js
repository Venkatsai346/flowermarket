/**
 * Bounded LRU cache with TTL expiry.
 *
 * Replaces unbounded `new Map()` caches that grow without limit and
 * eventually cause OOM in long-running processes.
 *
 * Features:
 *   - Max entries cap (evicts LRU when exceeded)
 *   - Per-entry TTL (stale entries cleaned on access or periodically)
 *   - O(1) get/set/delete via Map's insertion-order guarantee
 *   - Stats: hits, misses, evictions, size
 *
 * Usage:
 *   const cache = new BoundedCache({ maxEntries: 1000, ttlMs: 60_000 });
 *   cache.set('key', value);
 *   cache.get('key'); // → value or undefined
 */

export class BoundedCache {
  /**
   * @param {object} opts
   * @param {number} [opts.maxEntries=500] — hard cap on entries
   * @param {number} [opts.ttlMs=300000] — default TTL in ms (5 min)
   * @param {string} [opts.name='cache'] — for logging/debugging
   */
  constructor({ maxEntries = 500, ttlMs = 5 * 60 * 1000, name = 'cache' } = {}) {
    this.max = maxEntries;
    this.ttl = ttlMs;
    this.name = name;
    this._map = new Map(); // key → { value, expiresAt, lastAccessAt }
    this._stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };

    // Periodic cleanup every 60s (unref'd so it doesn't prevent process exit)
    this._timer = setInterval(() => this._cleanup(), 60_000);
    this._timer.unref();
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) {
      this._stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this._map.delete(key);
      this._stats.misses += 1;
      return undefined;
    }
    // Move to end (most recently used)
    this._map.delete(key);
    entry.lastAccessAt = Date.now();
    this._map.set(key, entry);
    this._stats.hits += 1;
    return entry.value;
  }

  set(key, value, ttlOverride) {
    const now = Date.now();
    const expiresAt = now + (ttlOverride ?? this.ttl);

    // If key exists, delete first to reset insertion order
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // Evict LRU if at capacity
    while (this._map.size >= this.max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
      this._stats.evictions += 1;
    }

    this._map.set(key, { value, expiresAt, lastAccessAt: now });
    this._stats.sets += 1;
  }

  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    return this._map.delete(key);
  }

  clear() {
    this._map.clear();
  }

  get size() {
    return this._map.size;
  }

  stats() {
    return { ...this._stats, size: this._map.size, max: this.max };
  }

  /** Iterate all valid entries as [key, value] pairs. */
  *entries() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (entry.expiresAt >= now) {
        yield [key, entry.value];
      }
    }
  }

  /** Iterate all valid values. */
  *values() {
    const now = Date.now();
    for (const entry of this._map.values()) {
      if (entry.expiresAt >= now) {
        yield entry.value;
      }
    }
  }

  /** Remove expired entries. */
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (entry.expiresAt < now) {
        this._map.delete(key);
      }
    }
  }

  /** Stop the cleanup timer (for graceful shutdown). */
  destroy() {
    clearInterval(this._timer);
    this._map.clear();
  }
}

export default BoundedCache;
