import TokenService from '../utils/jwt.js';
import config from '../config/index.js';
import { TENANT_RESOLUTION_SOURCE } from '../constants/enums.js';

/**
 * tokenTenant — resolve req.tenantId from the access token when the client
 * sent no x-tenant-id header. Runs BEFORE authenticate.
 *
 * The token's `tenant` claim IS the caller's tenant: for subject-keyed routes
 * (my store, my profile) a headerless-but-authed request can only ever mean
 * "act as my own tenant", so default-resolving it (and 401ing on the mismatch)
 * strands exactly the clients that did nothing wrong — a fresh store owner
 * whose console has tokens but hasn't hydrated yet, any token-only API client.
 * Explicit headers still win for multi-tenant platform clients, and a present
 * header naming another tenant still 401s in authenticate. Invalid tokens are
 * left alone so authenticate produces the proper 401.
 */
export function tokenTenant(req, res, next) {
  const header = req.headers[config.tenant.tenantHeader?.toLowerCase()] || null;
  if (header) return next(); // explicit tenant wins
  const authz = req.headers.authorization || '';
  const [scheme, token] = authz.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = TokenService.verifyAccessToken(token);
      if (payload?.tenant) {
        req.tenantId = payload.tenant;
        req.tenantSource = TENANT_RESOLUTION_SOURCE.TOKEN;
      }
    } catch {
      // let authenticate produce the proper 401
    }
  }
  next();
}

export default tokenTenant;
