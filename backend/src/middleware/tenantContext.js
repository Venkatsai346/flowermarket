import TenantService from '../services/tenant.service.js';
import config from '../config/index.js';

/**
 * tenantContext — resolves the tenant for every request and attaches it to
 * req.tenant + req.tenantId.
 *
 * Resolution order:
 *  1. `x-tenant-id` header (explicit — used by multi-tenant clients)
 *  2. JWT payload tenant claim (authenticated requests)
 *  3. DEFAULT_TENANT_ID config
 *  4. first active tenant in DB (bootstrap)
 *
 * The resolved tenant is cached on the request so downstream services don't
 * re-query. (A shared in-memory cache per request cycle is fine here because
 * Express creates one request object per request.)
 */
export async function tenantContext(req, res, next) {
  try {
    const headerValue = req.headers[config.tenant.tenantHeader?.toLowerCase()] || null;

    let tenantId = headerValue;
    if (!tenantId && req.auth?.tenant) tenantId = req.auth.tenant;
    if (!tenantId && config.tenant.defaultTenantId) tenantId = config.tenant.defaultTenantId;

    if (tenantId) {
      const tenant = await TenantService.getById(tenantId);
      req.tenant = tenant;
      req.tenantId = tenant._id; // ObjectId — critical for aggregate $match (no auto-cast)
    } else {
      const tenant = await TenantService.resolveDefault();
      req.tenant = tenant;
      req.tenantId = tenant._id; // ObjectId
    }

    // tenant auth policy for this request (OTP length, session TTL, delivery rules)
    req.tenantAuth = await TenantService.getAuthConfig(req.tenantId);

    next();
  } catch (err) {
    next(err);
  }
}
