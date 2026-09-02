import TokenService from '../utils/jwt.js';
import { unauthorized } from '../utils/ApiError.js';
import User from '../models/user.model.js';
import { USER_STATUS } from '../constants/enums.js';

/**
 * authenticate — validates the Bearer access token and loads the user.
 *
 * Attaches:
 *   req.auth  -> { userId, tenantId, role, iat }
 *   req.user  -> hydrated User document (or null if skipFetch)
 *
 * The tenant-scope guard: if the token's tenant differs from the request
 * tenant (resolved by tenantContext), we reject — a token minted for tenant A
 * cannot access tenant B resources.
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw unauthorized('Authentication required', 'AUTH_REQUIRED');
    }

    const payload = TokenService.verifyAccessToken(token);
    if (!payload?.sub) throw unauthorized('Invalid token payload', 'INVALID_TOKEN');

    if (payload.tenant && req.tenantId && String(payload.tenant) !== String(req.tenantId)) {
      throw unauthorized('Token does not belong to this tenant', 'TENANT_MISMATCH');
    }

    const user = await User.findById(payload.sub).select('+isDeleted');
    if (!user) throw unauthorized('Account not found', 'USER_NOT_FOUND');
    if (user.status === USER_STATUS.BLOCKED) throw unauthorized('Account is blocked', 'ACCOUNT_BLOCKED');
    if (user.status === USER_STATUS.DELETED || user.isDeleted) throw unauthorized('Account no longer exists', 'ACCOUNT_DELETED');

    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenant || null,
      role: payload.role || null,
      iat: payload.iat || null,
    };
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
