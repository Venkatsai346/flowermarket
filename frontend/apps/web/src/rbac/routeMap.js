/**
 * Dev-only route map: every console route and the roles allowed to open it.
 *
 * This is intentionally a tiny, auditable list rather than a runtime RBAC
 * engine. The route guards in `App.jsx` remain the enforcement point; this map
 * is the smoke test that keeps the route list and the role policy from
 * drifting silently.
 */
export const ROUTE_ROLES = {
  '/': ['admin', 'super_admin'],
  '/no-access': ['customer', 'vendor', 'admin', 'rider', 'super_admin'],
  '/catalog': ['admin', 'super_admin'],
  '/catalog/masters': ['admin', 'super_admin'],
  '/catalog/categories': ['admin', 'super_admin'],
  '/catalog/brands': ['admin', 'super_admin'],
  '/catalog/ops': ['admin', 'super_admin'],
  '/orders': ['admin', 'super_admin'],
  '/fulfillment': ['admin', 'super_admin'],
  '/returns': ['admin', 'super_admin'],
  '/policies': ['admin', 'super_admin'],
  '/search': ['admin', 'super_admin'],
  '/tax': ['admin', 'super_admin'],
  '/users': ['admin', 'super_admin'],
  '/inventory': ['admin', 'super_admin'],
  '/hubs': ['admin', 'super_admin'],
  '/vendors': ['admin', 'super_admin'],
  '/billing': ['admin', 'super_admin'],
  '/storefront': ['admin', 'super_admin'],
  '/domains': ['admin', 'super_admin'],
  '/rider': ['rider', 'admin', 'super_admin'],
  '/platform': ['super_admin'],
  '/platform/lifecycle': ['super_admin'],
  '/platform/stores': ['super_admin'],
  '/platform/vendor-applications': ['super_admin'],
  '/platform/vendors': ['super_admin'],
  '/platform/billing': ['super_admin'],
  '/platform/plans': ['super_admin'],
  '/platform/payouts': ['super_admin'],
  '/platform/ledger': ['super_admin'],
  '/vendor': ['vendor'],
  '/vendor/products': ['vendor'],
  '/vendor/payouts': ['vendor'],
  '/vendor/payout-account': ['vendor'],
};

export const rolesForPath = (path) => ROUTE_ROLES[String(path || '/')] || [];
