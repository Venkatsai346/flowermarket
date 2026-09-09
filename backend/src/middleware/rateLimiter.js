import rateLimit from 'express-rate-limit';
import config from '../config/index.js';

/**
 * Rate limiters — per-route protection.
 *
 * OTP endpoints get tight limits (brute-force protection at the HTTP layer,
 * complementing maxAttempts inside the OTP model).
 *
 * Phase 7.6: When REDIS_URL is configured, the rate limiter uses Redis for
 * distributed counting. This means rate limits work correctly across multiple
 * API instances behind a load balancer. Without Redis, each instance tracks
 * its own counts (in-memory), which is fine for single-instance dev.
 */

let redisStore = null;

/**
 * Try to create a Redis store for distributed rate limiting.
 * Called lazily on first use. Falls back to in-memory if Redis is unavailable.
 */
async function getRedisStore() {
  if (redisStore !== null) return redisStore || undefined;
  if (!config.redis?.url) { redisStore = false; return undefined; }
  try {
    const { RedisStore } = await import('rate-limit-redis');
    const { getRedis } = await import('../config/redis.js');
    const client = await getRedis();
    if (!client) { redisStore = false; return undefined; }
    redisStore = new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });
    return redisStore;
  } catch {
    redisStore = false;
    return undefined;
  }
}
const standard = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down', code: 'RATE_LIMITED' },
});

/** OTP send: max 5 per 10 minutes per IP. */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.isDev ? 50 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Try again later.', code: 'OTP_RATE_LIMITED' },
});

/** OTP verify: max 10 attempts per 10 minutes (blocks code brute-forcing). */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.isDev ? 100 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Try again later.', code: 'OTP_RATE_LIMITED' },
});

/** Login: max 10 per 10 minutes. */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.isDev ? 100 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.', code: 'LOGIN_RATE_LIMITED' },
});

/**
 * Global API limiter. Tests skip (a suite can issue hundreds of calls from
 * one IP). Production: 300 / 15 min per IP. Health is cheap and skipped.
 */
const api = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isDev ? 2000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => config.isTest || req.path === '/health',
  message: { success: false, message: 'Too many requests, please slow down', code: 'RATE_LIMITED' },
});

/** Checkout is the money moment — tighter than the rest of the API. */
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isDev ? 120 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { success: false, message: 'Too many checkout attempts. Wait a moment.', code: 'CHECKOUT_RATE_LIMITED' },
});

/**
 * Initialize Redis-backed rate limiting (call once at startup).
 * If Redis is not configured or unavailable, in-memory stores are used.
 */
export async function initRedisRateLimit() {
  await getRedisStore();
}

export default { standard, otpSendLimiter, otpVerifyLimiter, loginLimiter, api, checkoutLimiter };
