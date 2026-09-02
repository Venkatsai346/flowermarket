import TenantService from '../services/tenant.service.js';
import tenantDomainService from '../services/tenantDomain.service.js';
import config from '../config/index.js';
import { TENANT_RESOLUTION_SOURCE } from '../constants/enums.js';

/**
 * tenantContext — decides which tenant's data a request may touch (Phase 6.4).
 *
 * ── Resolution order ────────────────────────────────────────────────────────
 *   1. Host       — `{slug}.{PLATFORM_ROOT_DOMAIN}` or a VERIFIED custom domain
 *   2. Header     — `x-tenant-id`, only when the Host did not decide
 *   3. Default    — DEFAULT_TENANT_ID
 *   4. Fallback   — first active tenant (bootstrap only)
 *
 * ── Why Host wins, and why that is the security fix ─────────────────────────
 * Before this phase, ANY client could name ANY tenant with a header, and the
 * only thing standing between that and a cross-tenant read was `authenticate`
 * rejecting a token/tenant mismatch — which does nothing for the many public
 * endpoints. Now public traffic is bound to the hostname it arrived on, and
 * the header cannot override a Host that already resolved (unless
 * `ALLOW_TENANT_HEADER_OVERRIDE` is on, which is for local development).
 *
 * ── Why an unknown store subdomain 404s ─────────────────────────────────────
 * `resolveByHost()` throws `STORE_NOT_FOUND` for a well-formed subdomain with
 * no matching store, rather than falling through to the default tenant.
 * Silently serving the default store's catalogue at someone else's hostname is
 * a leak that looks like a feature.
 *
 * ── Why every existing client keeps working ─────────────────────────────────
 * `localhost`, IP literals and the sandbox preview host are classified as
 * infrastructure and never resolve a tenant, so the header path is untouched
 * for the admin console, the mobile app and every smoke test.
 *
 * Sets: req.tenant, req.tenantId (ObjectId — aggregates do not auto-cast),
 *       req.tenantAuth, req.tenantSource, req.tenantHost.
 */
export async function tenantContext(req, res, next) {
  try {
    const headerName = config.tenant.tenantHeader?.toLowerCase();
    const headerValue = headerName ? (req.headers[headerName] || null) : null;

    let tenantId = null;
    let source = null;
    let hostMatch = null;

    // ---- 1. the hostname the client actually addressed ----
    if (config.domains.enabled) {
      const rawHost = config.domains.trustForwardedHost
        ? (req.headers['x-forwarded-host'] || req.headers.host)
        : req.headers.host;
      // throws STORE_NOT_FOUND for an unknown *.root subdomain — deliberate
      hostMatch = await tenantDomainService.resolveByHost(rawHost);
      if (hostMatch) {
        tenantId = hostMatch.tenantId;
        source = hostMatch.source;
      }
    }

    // ---- 2. explicit header (only when the host did not decide) ----
    if (!tenantId && headerValue) {
      tenantId = headerValue;
      source = TENANT_RESOLUTION_SOURCE.HEADER;
    } else if (tenantId && headerValue && String(headerValue) !== String(tenantId)) {
      // The host already named a tenant and the header disagrees. In
      // production the host wins and the header is ignored; in development the
      // override is allowed so a single localhost can act as any tenant.
      if (config.domains.allowHeaderOverride) {
        tenantId = headerValue;
        source = TENANT_RESOLUTION_SOURCE.HEADER;
      }
    }

    // ---- 3/4. configured default, then bootstrap fallback ----
    if (!tenantId && config.tenant.defaultTenantId) {
      tenantId = config.tenant.defaultTenantId;
      source = TENANT_RESOLUTION_SOURCE.DEFAULT;
    }

    if (tenantId) {
      const tenant = await TenantService.getById(tenantId);
      req.tenant = tenant;
      req.tenantId = tenant._id;
    } else {
      const tenant = await TenantService.resolveDefault();
      req.tenant = tenant;
      req.tenantId = tenant._id;
      source = source || TENANT_RESOLUTION_SOURCE.FALLBACK;
    }

    req.tenantSource = source;
    req.tenantHost = hostMatch?.hostname || null;

    // tenant auth policy for this request (OTP length, session TTL, delivery rules)
    req.tenantAuth = await TenantService.getAuthConfig(req.tenantId);

    next();
  } catch (err) {
    next(err);
  }
}

export default tenantContext;
