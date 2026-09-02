import { forbidden } from '../utils/ApiError.js';
import { USER_ROLES } from '../constants/enums.js';

/**
 * authorize(...roles) — RBAC guard for protected routes.
 * Usage:
 *   router.get('/admin/users', authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), ctrl.list)
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    const role = req.auth?.role || req.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      return next(forbidden('You do not have permission to perform this action', 'FORBIDDEN'));
    }
    next();
  };
}
