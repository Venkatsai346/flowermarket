/**
 * IP allowlisting middleware for sensitive routes.
 *
 * Two flavors:
 *   1. webhookIpAllowlist — protects payment/payout webhooks (optional)
 *   2. adminIpAllowlist   — protects admin/ledger/super_admin routes (optional)
 *
 * Both are OFF by default (empty allowlist = all IPs allowed).
 * Configure via WEBHOOK_IP_ALLOWLIST and ADMIN_IP_ALLOWLIST env vars
 * (comma-separated IPs/CIDRs).
 *
 * In development, all IPs are always allowed.
 *
 * Usage:
 *   app.post('/api/v1/payments/webhook/razorpay', webhookIpAllowlist(), handler);
 *   app.use('/api/v1/admin', adminIpAllowlist(), adminRoutes);
 */
import config from '../config/index.js';

/**
 * Parse a CIDR notation and check if an IP falls within it.
 * Supports exact IPs (no mask) and CIDR (e.g., '103.102.166.224/30').
 */
function ipInCidr(ip, cidr) {
  const parts = cidr.split('/');
  const target = parts[0];
  const prefixLen = parts.length > 1 ? parseInt(parts[1], 10) : 32;

  if (ip === target) return true;
  if (prefixLen === 0) return true;

  // Only support IPv4 for simplicity (Razorpay uses IPv4)
  const ipNum = ipv4ToNum(ip);
  const cidrNum = ipv4ToNum(target);
  if (ipNum === null || cidrNum === null) return false;

  const mask = (~0 << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

function ipv4ToNum(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isAllowed(ip, allowlist) {
  if (!allowlist.length) return true; // empty = all allowed
  return allowlist.some((cidr) => ipInCidr(ip, cidr));
}

function extractIp(req) {
  // Trust x-forwarded-for only behind a known proxy (trust proxy is set in app.js)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

/**
 * Create an IP allowlist middleware.
 *
 * @param {string[]} allowlist — array of IPs or CIDRs (empty = allow all)
 * @param {string} label — for error messages (e.g., 'webhook', 'admin')
 */
function createIpAllowlist(allowlist, label) {
  return function ipAllowlistMiddleware(req, res, next) {
    // In development, always allow
    if (config.isDev) return next();

    // Empty allowlist = no restriction
    if (!allowlist.length) return next();

    const ip = extractIp(req);
    if (isAllowed(ip, allowlist)) return next();

    console.warn(`[ip-allowlist] Blocked ${label} request from ${ip} (not in allowlist)`);
    return res.status(403).json({
      success: false,
      message: `Access denied: your IP is not authorized for ${label} access`,
      code: 'IP_NOT_ALLOWED',
    });
  };
}

/**
 * Protect payment/payout webhook routes.
 * Configure with WEBHOOK_IP_ALLOWLIST (comma-separated IPs/CIDRs).
 * Razorpay IPs: 103.102.166.224/30, 103.67.196.0/24
 */
export function webhookIpAllowlist() {
  const list = (process.env.WEBHOOK_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return createIpAllowlist(list, 'webhook');
}

/**
 * Protect admin/ledger/super_admin routes.
 * Configure with ADMIN_IP_ALLOWLIST (comma-separated IPs/CIDRs).
 */
export function adminIpAllowlist() {
  const list = (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return createIpAllowlist(list, 'admin');
}

export default { webhookIpAllowlist, adminIpAllowlist };
