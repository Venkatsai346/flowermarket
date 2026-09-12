/**
 * Console navigation + command palette + `g` then letter shortcuts.
 * One source so the sidebar and the palette cannot drift.
 */
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bike,
  BookOpenCheck,
  Calendar,
  ClipboardCheck,
  Database,
  Download,
  FileSpreadsheet,
  FolderTree,
  Gem,
  Globe,
  Landmark,
  LayoutDashboard,
  MapPin,
  Package,
  PackageCheck,
  PackageSearch,
  Palette,
  Percent,
  Receipt,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Store,
  TrendingUp,
  Truck,
  Upload,
  User,
  Zap,
} from 'lucide-react';

export const GROUPS = {
  platform: {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: LayoutDashboard, end: true, keys: ['overview', 'gmv'] },
      { to: '/platform/lifecycle', label: 'Lifecycle & ops', icon: Activity, keys: ['suspend', 'activate'] },
      { to: '/platform/stores', label: 'Stores', icon: Store, keys: ['tenants'] },
      { to: '/platform/vendor-applications', label: 'Vendor applications', icon: ClipboardCheck, keys: ['kyc', 'apply'] },
      { to: '/platform/vendors', label: 'Vendors', icon: Truck, keys: [] },
      { to: '/platform/billing', label: 'Billing', icon: Receipt, keys: ['invoice'] },
      { to: '/platform/payouts', label: 'Payouts', icon: Banknote, keys: [] },
      { to: '/platform/ledger', label: 'Ledger', icon: BookOpenCheck, keys: ['trial', 'journal'] },
      { to: '/platform/plans', label: 'Plans', icon: Gem, keys: [] },
      { to: '/platform/audit', label: 'Audit log', icon: Shield, keys: ['audit', 'log', 'activity'] },
      { to: '/platform/fiscal-periods', label: 'Fiscal periods', icon: Calendar, keys: ['period', 'fy'] },
      { to: '/platform/settlements', label: 'Settlements', icon: Upload, keys: ['bank', 'reconcile'] },
      { to: '/platform/statutory-deposits', label: 'Statutory deposits', icon: Landmark, keys: ['tds', 'tcs'] },
      { to: '/platform/exports', label: 'Exports', icon: Download, keys: ['csv', 'download'] },
      { to: '/platform/reviews', label: 'Reviews', icon: Star, keys: ['moderate', 'rating'] },
      { to: '/platform/demand', label: 'Demand forecast', icon: TrendingUp, keys: ['reorder', 'stock'] },
      { to: '/platform/dlq', label: 'Dead letter queue', icon: AlertTriangle, keys: ['failed', 'retry'] },
      { to: '/platform/pool', label: 'Connection pool', icon: Database, keys: ['mongo', 'dedup'] },
    ],
  },
  store: {
    label: 'My store',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, keys: ['home'] },
      { to: '/catalog', label: 'My catalog', icon: Package, keys: ['listings', 'sku'] },
      { to: '/inventory', label: 'Inventory', icon: PackageSearch, keys: ['stock'] },
      { to: '/hubs', label: 'Hubs & slots', icon: MapPin, keys: ['pincode'] },
      { to: '/orders', label: 'Orders', icon: ShoppingCart, keys: [] },
      { to: '/fulfillment', label: 'Fulfillment', icon: Truck, keys: ['pick', 'pack'] },
      { to: '/returns', label: 'After-sales', icon: PackageCheck, keys: ['refund', 'qc'] },
      { to: '/policies', label: 'Policies', icon: Percent, keys: ['coupon'] },
      { to: '/search', label: 'Search', icon: Search, keys: ['synonym'] },
      { to: '/tax', label: 'GST & tax', icon: Landmark, keys: ['gstin', 'invoice'] },
      { to: '/users', label: 'Users', icon: User, keys: ['staff', 'rider'] },
      { to: '/vendors', label: 'Vendors', icon: Truck, keys: [] },
      { to: '/billing', label: 'Billing', icon: Receipt, keys: [] },
      { to: '/storefront', label: 'Storefront', icon: Palette, keys: ['brand', 'kit', 'theme'] },
      { to: '/domains', label: 'Domains', icon: Globe, keys: ['host'] },
      { to: '/settings', label: 'Settings', icon: Settings, keys: ['config', 'preferences'] },
      { to: '/exports', label: 'Exports', icon: FileSpreadsheet, keys: ['csv', 'download'] },
      { to: '/delivery-zones', label: 'Delivery zones', icon: MapPin, keys: ['zone', 'area'] },
    ],
  },
  catalog: {
    label: 'Catalog',
    items: [
      // Deep admin mixes tenant tabs (listings, bulk) with platform tabs
      // (review, audit, events) — the page itself gates tabs by role.
      { to: '/catalog/ops', label: 'Deep admin', icon: Zap, keys: [] },
      // Global catalog ops: platform-only (the API enforces super_admin;
      // hiding the entries keeps tenant admins from opening dead pages).
      { to: '/catalog/masters', label: 'Masters', icon: Package, keys: [], roles: ['super_admin'] },
      { to: '/catalog/categories', label: 'Categories', icon: FolderTree, keys: [], roles: ['super_admin'] },
      { to: '/catalog/brands', label: 'Brands', icon: Truck, keys: [], roles: ['super_admin'] },
    ],
  },
  vendor: {
    label: 'Vendor',
    items: [
      { to: '/vendor', label: 'Profile', icon: User, end: true, keys: [] },
      { to: '/vendor/products', label: 'Products', icon: Package, keys: [] },
      { to: '/vendor/payouts', label: 'Payouts', icon: Banknote, keys: [] },
      { to: '/vendor/payout-account', label: 'Payout account', icon: Landmark, keys: ['kyc'] },
    ],
  },
  rider: {
    label: 'Rider',
    items: [
      { to: '/rider', label: 'Deliveries', icon: Bike, end: true, keys: ['pod'] },
    ],
  },
};

/** `g` then this letter within 800ms. */
export const GO_SHORTCUTS = Object.freeze({
  o: '/orders',
  d: '/',
  c: '/catalog',
  f: '/fulfillment',
  p: '/platform',
  s: '/search',
  t: '/tax',
  i: '/inventory',
  h: '/hubs',
  b: '/billing',
  v: '/vendors',
  l: '/platform/ledger',
  k: '/storefront',
  r: '/returns',
  u: '/users',
});

export function groupsForRole(role) {
  if (role === 'super_admin') return ['platform', 'store', 'catalog'];
  if (role === 'admin') return ['store', 'catalog'];
  if (role === 'vendor') return ['vendor'];
  if (role === 'rider') return ['rider'];
  return [];
}

/** Items of a nav group visible to a role (no `roles` = every group member). */
export function itemsForRole(role, group) {
  const items = GROUPS[group]?.items || [];
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

export function commandsForRole(role) {
  return groupsForRole(role).flatMap((g) =>
    itemsForRole(role, g).map((item) => ({ ...item, group: GROUPS[g].label }))
  );
}

export function filterCommands(commands, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((c) => {
    const hay = [c.label, c.to, c.group, ...(c.keys || [])].join(' ').toLowerCase();
    return hay.includes(needle);
  });
}
