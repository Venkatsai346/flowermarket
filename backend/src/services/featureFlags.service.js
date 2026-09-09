/**
 * FeatureFlagsService — safe rollout of new features.
 *
 * Flags are stored in MongoDB and cached in memory (BoundedCache).
 * Each flag can be:
 *   - Global on/off
 *   - Tenant-scoped (enable for specific stores)
 *   - Percentage rollout (enable for X% of users)
 *   - User-scoped (enable for specific users)
 *
 * Usage:
 *   const enabled = await featureFlags.isEnabled('voice-ordering', { tenantId, userId });
 *   if (enabled) { ... }
 */

import { BoundedCache } from '../utils/BoundedCache.js';

const cache = new BoundedCache({ maxEntries: 500, ttlMs: 60000, name: 'feature-flags' });

// In-memory flag store (replace with DB collection in production)
const flags = new Map();

const FLAG_SCHEMA = {
  key: '',           // unique flag key
  enabled: false,    // global on/off
  description: '',
  tenantOverrides: {},   // { tenantId: true/false }
  userOverrides: {},     // { userId: true/false }
  percentage: 0,         // 0-100, percentage of users who see the flag
  createdAt: null,
  updatedAt: null,
};

class FeatureFlagsService {
  /**
   * Check if a flag is enabled for a given context.
   */
  async isEnabled(flagKey, { tenantId, userId } = {}) {
    const cacheKey = `${flagKey}:${tenantId || ''}:${userId || ''}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const flag = flags.get(flagKey);
    if (!flag) return false;

    // User override (highest priority)
    if (userId && flag.userOverrides[String(userId)] !== undefined) {
      const result = flag.userOverrides[String(userId)];
      cache.set(cacheKey, result);
      return result;
    }

    // Tenant override
    if (tenantId && flag.tenantOverrides[String(tenantId)] !== undefined) {
      const result = flag.tenantOverrides[String(tenantId)];
      cache.set(cacheKey, result);
      return result;
    }

    // Percentage rollout
    if (flag.percentage > 0 && userId) {
      const hash = this._hash(flagKey + userId);
      const result = (hash % 100) < flag.percentage;
      cache.set(cacheKey, result);
      return result;
    }

    // Global flag
    cache.set(cacheKey, flag.enabled);
    return flag.enabled;
  }

  /**
   * Create or update a flag.
   */
  async set({ key, enabled, description, percentage, tenantOverrides, userOverrides }) {
    const existing = flags.get(key) || { ...FLAG_SCHEMA, key };
    if (enabled !== undefined) existing.enabled = enabled;
    if (description !== undefined) existing.description = description;
    if (percentage !== undefined) existing.percentage = percentage;
    if (tenantOverrides) Object.assign(existing.tenantOverrides, tenantOverrides);
    if (userOverrides) Object.assign(existing.userOverrides, userOverrides);
    existing.updatedAt = new Date();
    if (!existing.createdAt) existing.createdAt = new Date();
    flags.set(key, existing);
    cache.clear(); // Invalidate cache on change
    return existing;
  }

  /**
   * List all flags.
   */
  list() {
    return [...flags.values()];
  }

  /**
   * Get a specific flag.
   */
  get(key) {
    return flags.get(key) || null;
  }

  /**
   * Delete a flag.
   */
  delete(key) {
    cache.clear();
    return flags.delete(key);
  }

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}

export default new FeatureFlagsService();
