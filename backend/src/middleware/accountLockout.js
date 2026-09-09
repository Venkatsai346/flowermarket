/**
 * Account-level lockout middleware.
 *
 * Locks an account after N consecutive failed login attempts for a configured
 * duration. This is defense-in-depth alongside the per-IP rate limiter:
 * rate limiting protects the endpoint; lockout protects the ACCOUNT.
 *
 * A distributed attack from 1000 IPs would bypass per-IP rate limiting but
 * each account still locks after the threshold.
 *
 * Implementation: uses an in-memory Map with TTL cleanup. For multi-instance
 * deployments, replace with Redis (the Map is per-process, so an attacker
 * could distribute across processes — but that's already beyond the per-IP
 * limiter's protection).
 *
 * Usage:
 *   // Track failed OTP verifications
 *   app.post('/auth/otp/verify', accountLockout('otp_verify'), handler);
 *   // Track failed password logins
 *   app.post('/auth/login', accountLockout('login'), handler);
 */

const DEFAULTS = {
  maxAttempts: 10,
  lockoutMinutes: 15,
};

/**
 * In-memory lockout store.
 * Key: `{purpose}:{tenantId}:{target}`
 * Value: { attempts, lockedUntil }
 */
const lockouts = new Map();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of lockouts) {
    if (entry.lockedUntil && entry.lockedUntil < now) lockouts.delete(key);
    if (!entry.lockedUntil && entry.lastAttemptAt < now - 30 * 60 * 1000) lockouts.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Record a failed attempt for the given key. Returns { locked, remaining, lockedUntil }.
 */
export function recordFailure(key, opts = {}) {
  const max = opts.maxAttempts || DEFAULTS.maxAttempts;
  const lockoutMs = (opts.lockoutMinutes || DEFAULTS.lockoutMinutes) * 60 * 1000;
  const now = Date.now();

  let entry = lockouts.get(key);
  if (!entry) {
    entry = { attempts: 0, lockedUntil: null, lastAttemptAt: now };
    lockouts.set(key, entry);
  }

  // If currently locked, extend the lock on each attempt (don't reset the clock)
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, remaining: 0, lockedUntil: entry.lockedUntil };
  }

  entry.attempts += 1;
  entry.lastAttemptAt = now;

  if (entry.attempts >= max) {
    entry.lockedUntil = now + lockoutMs;
    return { locked: true, remaining: 0, lockedUntil: entry.lockedUntil };
  }

  return { locked: false, remaining: max - entry.attempts, lockedUntil: null };
}

/**
 * Clear failed attempts for the given key (called on successful login).
 */
export function clearFailures(key) {
  lockouts.delete(key);
}

/**
 * Check if an account is currently locked.
 */
export function isLocked(key) {
  const entry = lockouts.get(key);
  if (!entry || !entry.lockedUntil) return false;
  if (entry.lockedUntil < Date.now()) {
    lockouts.delete(key);
    return false;
  }
  return true;
}

/**
 * Build the lockout key from the request context.
 * Extracts the identity target from the request body.
 */
function buildKey(purpose, req) {
  const tenantId = req.tenantId || 'default';
  const body = req.body || {};
  const target = body.phone?.number || body.email || body.target || req.ip || 'unknown';
  return `${purpose}:${tenantId}:${String(target).toLowerCase().trim()}`;
}

/**
 * Express middleware factory.
 * Checks lockout BEFORE the handler runs; records failure on 4xx responses.
 *
 * @param {string} purpose — namespace for the lockout (e.g., 'otp_verify', 'login')
 * @param {object} [opts] — { maxAttempts, lockoutMinutes }
 */
export function accountLockout(purpose, opts = {}) {
  const max = opts.maxAttempts || DEFAULTS.maxAttempts;
  const lockoutMs = (opts.lockoutMinutes || DEFAULTS.lockoutMinutes) * 60 * 1000;

  return function lockoutMiddleware(req, res, next) {
    const key = buildKey(purpose, req);

    // Check if currently locked
    if (isLocked(key)) {
      const entry = lockouts.get(key);
      const remainingSec = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Account locked for ${remainingSec} seconds.`,
        code: 'ACCOUNT_LOCKED',
        details: {
          lockedUntil: new Date(entry.lockedUntil).toISOString(),
          retryAfterSeconds: remainingSec,
          maxAttempts: max,
        },
      });
    }

    // Intercept the response to track failures
    const originalJson = res.json.bind(res);
    res.json = function trackedJson(body) {
      // If this is a failed auth attempt (4xx), record the failure
      if (res.statusCode >= 400 && res.statusCode < 500 && body?.success === false) {
        const result = recordFailure(key, { maxAttempts: max, lockoutMinutes: lockoutMs / 60000 });
        if (result.locked) {
          return originalJson({
            success: false,
            message: `Too many failed attempts. Account locked for ${Math.ceil(lockoutMs / 1000)} seconds.`,
            code: 'ACCOUNT_LOCKED',
            details: {
              lockedUntil: new Date(result.lockedUntil).toISOString(),
              retryAfterSeconds: Math.ceil(lockoutMs / 1000),
              maxAttempts: max,
            },
          });
        }
      }
      // If this is a successful auth, clear the failures
      if (res.statusCode >= 200 && res.statusCode < 300 && body?.success !== false) {
        clearFailures(key);
      }
      return originalJson(body);
    };

    next();
  };
}

export default accountLockout;
