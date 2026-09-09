/**
 * CSRF protection middleware.
 *
 * Uses the double-submit cookie pattern: the server sets a random token in a
 * cookie, and the client echoes it in the `X-CSRF-Token` header. State-changing
 * requests (POST/PUT/PATCH/DELETE) are rejected if the header doesn't match
 * the cookie.
 *
 * Why double-submit cookie instead of synchronizer token:
 *   - Stateless: no server-side session storage needed
 *   - Works with SPAs (React reads the cookie and sets the header)
 *   - Works with mobile apps (they don't send cookies, so CSRF doesn't apply)
 *
 * The cookie is:
 *   - HttpOnly: false (JS must read it)
 *   - Secure: true in production
 *   - SameSite: Strict (blocks cross-origin form submissions)
 *   - Path: /api (scoped to API routes)
 *
 * Safe methods (GET, HEAD, OPTIONS) are exempt.
 * Webhook endpoints are exempt (they use HMAC signatures).
 * API key-authenticated requests are exempt (no cookie auth).
 */

import crypto from 'crypto';
import config from '../config/index.js';

const CSRF_COOKIE = 'csrf-token';
const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EXEMPT_PATHS = [
  '/api/v1/payments/webhook',
  '/api/v1/payouts/webhook',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/otp',
  '/api/v1/auth/refresh',
  '/health',
];

/**
 * Generate a cryptographically random CSRF token.
 */
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Set the CSRF cookie on the response.
 */
export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // JS must read it
    secure: config.isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
}

/**
 * Middleware: set CSRF cookie if not present, then validate on state-changing requests.
 */
export function csrfProtection(req, res, next) {
  // Set the cookie if it doesn't exist yet
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = generateToken();
    setCsrfCookie(res, token);
  }

  // Safe methods don't need validation
  if (SAFE_METHODS.has(req.method)) return next();

  // Exempt webhook and auth endpoints
  const path = req.path || req.originalUrl || '';
  if (EXEMPT_PATHS.some((p) => path.startsWith(p))) return next();

  // API key auth is exempt (mobile/server clients don't have cookies)
  if (req.headers['x-api-key']) return next();

  // Validate: header must match cookie
  const headerToken = req.headers[CSRF_HEADER] || req.headers[CSRF_HEADER.replace(/-/g, '')];
  if (!headerToken || headerToken !== token) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token mismatch. Include the csrf-token cookie value in the X-CSRF-Token header.',
      code: 'CSRF_FAILED',
    });
  }

  next();
}

export default csrfProtection;
