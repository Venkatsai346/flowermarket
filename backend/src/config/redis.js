/**
 * Redis client — optional, graceful degradation.
 *
 * When REDIS_URL is set, the backend uses Redis for:
 *   - Rate limiting (distributed, works across multiple API instances)
 *   - Session cache (faster than MongoDB for hot reads)
 *   - Job queue (BullMQ for async tasks like notifications, exports)
 *
 * When REDIS_URL is NOT set, all Redis-dependent features fall back to
 * in-memory alternatives (Map-based rate limiting, in-process job registry).
 * This means the backend works without Redis in development, but production
 * should always have Redis for multi-instance deployments.
 *
 * The client connects lazily on first use and reconnects automatically on
 * transient failures (exponential backoff, max 3 retries before giving up).
 */

import config from './index.js';

let redisClient = null;
let redisAvailable = false;

/**
 * Get or create the Redis client. Returns null if REDIS_URL is not configured
 * or if the connection fails.
 */
export async function getRedis() {
  if (!config.redis?.url) return null;
  if (redisClient && redisAvailable) return redisClient;

  try {
    const { createClient } = await import('redis');
    redisClient = createClient({
      url: config.redis.url,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) return new Error('Redis: max retries exceeded');
          return Math.min(retries * 200, 2000); // exponential backoff, max 2s
        },
        connectTimeout: 5000,
      },
    });

    redisClient.on('error', (err) => {
      redisAvailable = false;
      console.warn('[redis] Connection error:', err.message);
    });

    redisClient.on('ready', () => {
      redisAvailable = true;
      console.log('[redis] Connected');
    });

    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch (err) {
    console.warn('[redis] Failed to connect:', err.message);
    redisAvailable = false;
    return null;
  }
}

/**
 * Check if Redis is available right now (doesn't try to connect).
 */
export function isRedisAvailable() {
  return redisAvailable;
}

/**
 * Graceful shutdown.
 */
export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.destroy();
    }
    redisClient = null;
    redisAvailable = false;
  }
}

export default { getRedis, isRedisAvailable, closeRedis };
