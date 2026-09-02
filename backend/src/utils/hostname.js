/**
 * hostname.js — PURE host parsing for tenant resolution (Phase 6.4).
 *
 * No database, no config reads, no I/O — so `scripts/hostname.test.js` can
 * exhaust the nasty cases (ports, IDN, IPv6, case, trailing dots, spoofing
 * attempts) in milliseconds. Host is attacker-controlled input, and this is
 * the code that decides which tenant's data a request may touch, so it is
 * deliberately small and deliberately paranoid.
 */

/** RFC-1123 label: letters, digits, hyphens; no leading/trailing hyphen. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalise a raw `Host` header into a comparable hostname.
 *
 * Handles: case, a trailing dot (`example.com.` is the same host), an explicit
 * port, IPv6 brackets, and surrounding whitespace. Returns null for anything
 * that is not a plausible hostname — the caller must then NOT resolve a tenant
 * from it.
 */
export function normalizeHost(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') return null;
  let host = rawHost.trim().toLowerCase();
  if (!host) return null;

  // A comma means multiple Host/X-Forwarded-Host values were joined by a proxy.
  // Take the first, which is the one the client actually addressed.
  if (host.includes(',')) host = host.split(',')[0].trim();

  // Userinfo has no place in a Host header, and allowing it is exploitable:
  // `store.flowermarket.in:80@evil.com` would otherwise have the ":80@evil.com"
  // treated as a port and stripped, leaving a perfectly valid store hostname.
  // (Found by the fuzz case in scripts/hostname.test.js.)
  if (host.includes('@')) return null;

  // IPv6 literal: [::1]:5173
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(0, end + 1) : null;
  }

  // Strip the port — but only if what follows the colon really IS a port.
  // Anything else means the value is malformed, and a malformed Host must be
  // rejected rather than salvaged.
  const colon = host.lastIndexOf(':');
  if (colon >= 0) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colon);
  }

  // strip a single trailing dot (fully-qualified form)
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (!host || host.length > 253) return null;
  // reject anything with characters that cannot appear in a hostname —
  // this is what stops header-injection style values reaching a DB query
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.includes('..')) return null;

  return host;
}

/** True for a bare IPv4/IPv6 literal — never a store hostname. */
export function isIpLiteral(host) {
  if (!host) return false;
  if (host.startsWith('[')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Extract the store slug from a subdomain of the platform root domain.
 *
 *   rosebazaar.flowermarket.in   + flowermarket.in  -> 'rosebazaar'
 *   flowermarket.in              + flowermarket.in  -> null (apex, not a store)
 *   a.b.flowermarket.in          + flowermarket.in  -> null (one level only)
 *   shop.rosebazaar.com          + flowermarket.in  -> null (custom domain)
 *
 * Returns null rather than guessing. A guess here is a cross-tenant leak.
 */
export function extractSubdomain(host, rootDomain) {
  if (!host || !rootDomain) return null;
  const root = String(rootDomain).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!root || host === root) return null;
  if (!host.endsWith(`.${root}`)) return null;

  const label = host.slice(0, -(root.length + 1));
  if (!label || label.includes('.')) return null; // exactly one level
  if (!LABEL_RE.test(label)) return null;
  return label;
}

/**
 * Slugs that must never resolve to a store, because they collide with
 * infrastructure hostnames. Checked case-insensitively.
 */
export function isReservedSlug(slug, reserved = []) {
  if (!slug) return true;
  return reserved.map((s) => String(s).toLowerCase()).includes(String(slug).toLowerCase());
}

/**
 * Classify a hostname for tenant resolution.
 *
 * @returns {{kind:'store_subdomain'|'reserved'|'apex'|'custom'|'infrastructure', host:string|null, slug:string|null}}
 *
 *   store_subdomain — a valid, non-reserved subdomain of the root domain
 *   reserved        — a subdomain of the root domain that is reserved (api, www…)
 *   apex            — the root domain itself
 *   custom          — some other public hostname; MAY be a verified custom domain
 *   infrastructure  — localhost, an IP, or an unparsable host: never a store
 */
export function classifyHost(rawHost, { rootDomain, reservedSlugs = [] } = {}) {
  const host = normalizeHost(rawHost);
  if (!host) return { kind: 'infrastructure', host: null, slug: null };
  if (isIpLiteral(host)) return { kind: 'infrastructure', host, slug: null };
  if (host === 'localhost' || host.endsWith('.localhost')) return { kind: 'infrastructure', host, slug: null };

  const root = rootDomain ? String(rootDomain).trim().toLowerCase() : null;
  if (root && host === root) return { kind: 'apex', host, slug: null };

  const slug = extractSubdomain(host, root);
  if (slug) {
    return isReservedSlug(slug, reservedSlugs)
      ? { kind: 'reserved', host, slug }
      : { kind: 'store_subdomain', host, slug };
  }

  // Not under our root domain: it can only be a custom domain, and only if a
  // verified TenantDomain row says so. The caller does that lookup.
  return { kind: 'custom', host, slug: null };
}

/** Is `host` this platform's own API/admin hostname (never a storefront)? */
export function isPlatformHost(rawHost, { rootDomain, platformHosts = [] } = {}) {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (platformHosts.map((h) => String(h).toLowerCase()).includes(host)) return true;
  const c = classifyHost(rawHost, { rootDomain, reservedSlugs: [] });
  return c.kind === 'apex';
}

/** Build the canonical storefront URL for a slug. */
export function storefrontUrl(slug, rootDomain, { protocol = 'https' } = {}) {
  if (!slug || !rootDomain) return null;
  return `${protocol}://${slug}.${String(rootDomain).toLowerCase()}`;
}

export default {
  normalizeHost,
  isIpLiteral,
  extractSubdomain,
  isReservedSlug,
  classifyHost,
  isPlatformHost,
  storefrontUrl,
};
