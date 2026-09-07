/**
 * Console navigation + command palette + `g` then letter shortcuts.
 * One source so the sidebar and the palette cannot drift.
 */
import {
  Activity,
  Banknote,
  Bike,
  BookOpenCheck,
  ClipboardCheck,
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
  ShoppingCart,
  Store,
  Truck,
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
    ],
  },
  catalog: {
    label: 'Catalog',
    items: [
      { to: '/catalog/ops', label: 'Deep admin', icon: Zap, keys: [] },
      { to: '/catalog/masters', label: 'Masters', icon: Package, keys: [] },
      { to: '/catalog/categories', label: 'Categories', icon: FolderTree, keys: [] },
      { to: '/catalog/brands', label: 'Brands', icon: Truck, keys: [] },
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

export function commandsForRole(role) {
  return groupsForRole(role).flatMap((g) =>
    GROUPS[g].items.map((item) => ({ ...item, group: GROUPS[g].label }))
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
