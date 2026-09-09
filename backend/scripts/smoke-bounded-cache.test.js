import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoundedCache } from '../src/utils/BoundedCache.js';

/**
 * BoundedCache unit tests.
 * Tests LRU eviction, TTL expiry, stats, and edge cases.
 */
describe('BoundedCache', () => {
  let cache;

  beforeEach(() => {
    cache = new BoundedCache({ maxEntries: 3, ttlMs: 1000, name: 'test' });
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should overwrite existing keys', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
    });

    it('should delete keys', () => {
      cache.set('a', 1);
      cache.delete('a');
      expect(cache.get('a')).toBeUndefined();
    });

    it('should report has()', () => {
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict the oldest entry when at capacity', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // should evict 'a'
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('d')).toBe(4);
      expect(cache.size).toBe(3);
    });

    it('should refresh LRU order on get', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // refresh 'a' to most recent
      cache.set('d', 4); // should evict 'b' (oldest after refresh)
      expect(cache.get('a')).toBe(1); // still alive
      expect(cache.get('b')).toBeUndefined(); // evicted
    });

    it('should refresh LRU order on set (overwrite)', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 10); // overwrite 'a' → moves to end
      cache.set('d', 4); // should evict 'b'
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('TTL expiry', () => {
    it('should return undefined for expired entries', () => {
      cache.set('a', 1, 1); // 1ms TTL
      // wait a tick
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(cache.get('a')).toBeUndefined();
    });

    it('should report has() as false for expired entries', () => {
      cache.set('a', 1, 1);
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(cache.has('a')).toBe(false);
    });

    it('should support per-entry TTL override', () => {
      cache.set('short', 1, 1); // 1ms
      cache.set('long', 2, 60000); // 60s
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe(2);
    });
  });

  describe('stats', () => {
    it('should track hits, misses, sets, evictions', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // hit
      cache.get('missing'); // miss
      cache.set('d', 4); // evicts 'a' (or 'b' depending on LRU)

      const s = cache.stats();
      expect(s.hits).toBe(1);
      expect(s.misses).toBe(1);
      expect(s.sets).toBe(4);
      expect(s.evictions).toBe(1);
      expect(s.size).toBe(3);
      expect(s.max).toBe(3);
    });
  });

  describe('iteration', () => {
    it('should iterate valid entries via entries()', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      const entries = [...cache.entries()];
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
    });

    it('should iterate valid values via values()', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      const values = [...cache.values()];
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('should skip expired entries in iteration', () => {
      cache.set('a', 1, 1); // 1ms TTL
      cache.set('b', 2, 60000); // 60s
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      const values = [...cache.values()];
      expect(values).toHaveLength(1);
      expect(values[0]).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined values', () => {
      cache.set('null', null);
      cache.set('undef', undefined);
      expect(cache.get('null')).toBeNull();
      expect(cache.get('undef')).toBeUndefined(); // undefined is indistinguishable from miss
    });

    it('should handle objects and arrays', () => {
      const obj = { a: 1 };
      const arr = [1, 2, 3];
      cache.set('obj', obj);
      cache.set('arr', arr);
      expect(cache.get('obj')).toBe(obj); // same reference
      expect(cache.get('arr')).toBe(arr);
    });

    it('should destroy cleanly', () => {
      cache.set('a', 1);
      cache.destroy();
      expect(cache.size).toBe(0);
    });
  });
});
