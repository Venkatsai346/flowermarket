import { forbidden } from '../utils/ApiError.js';

/**
 * Block customer commerce writes when the store is not `active`.
 *
 * Host resolution already 404s a suspended storefront. This guard covers the
 * header / token path (admin, tests, in-flight sessions): operators can still
 * log in and refund, but new carts and checkouts cannot take money.
 */
export function requireActiveTenant(req, res, next) {
  const status = req.tenant?.status;
  if (status && status !== 'active') {
    return next(forbidden(
      status === 'suspended'
        ? 'This store is temporarily unavailable'
        : 'This store is not accepting orders',
      'TENANT_SUSPENDED',
    ));
  }
  return next();
}

export default requireActiveTenant;
