import { NavLink, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bike,
  BookOpenCheck,
  ClipboardCheck,
  Globe,
  Landmark,
  Flower2,
  FolderTree,
  Gem,
  LayoutDashboard,
  LogOut,
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
} from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { ROLE_META, initials, titleCase } from '@flower-market/shared';
import { cn } from '../../lib/utils.js';
import Badge from '../ui/Badge.jsx';

const GROUPS = {
  platform: {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/platform/stores', label: 'Stores', icon: Store },
      { to: '/platform/vendor-applications', label: 'Vendor applications', icon: ClipboardCheck },
      { to: '/platform/vendors', label: 'Vendors', icon: Truck },
      { to: '/platform/billing', label: 'Billing', icon: Receipt },
      { to: '/platform/payouts', label: 'Payouts', icon: Banknote },
      { to: '/platform/ledger', label: 'Ledger', icon: BookOpenCheck },
      { to: '/platform/plans', label: 'Plans', icon: Gem },
    ],
  },
  store: {
    label: 'My store',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/catalog', label: 'My catalog', icon: Package },
      { to: '/inventory', label: 'Inventory', icon: PackageSearch },
      { to: '/hubs', label: 'Hubs & slots', icon: MapPin },
      { to: '/orders', label: 'Orders', icon: ShoppingCart },
      { to: '/fulfillment', label: 'Fulfillment', icon: Truck },
      { to: '/returns', label: 'After-sales', icon: PackageCheck },
      { to: '/policies', label: 'Policies', icon: Percent },
      { to: '/search', label: 'Search', icon: Search },
      { to: '/tax', label: 'GST & tax', icon: Landmark },
      { to: '/users', label: 'Users', icon: User },
      { to: '/vendors', label: 'Vendors', icon: Truck },
      { to: '/billing', label: 'Billing', icon: Receipt },
      { to: '/storefront', label: 'Storefront', icon: Palette },
      { to: '/domains', label: 'Domains', icon: Globe },
    ],
  },
  catalog: {
    label: 'Catalog',
    items: [
      { to: '/catalog/masters', label: 'Masters', icon: Package },
      { to: '/catalog/categories', label: 'Categories', icon: FolderTree },
      { to: '/catalog/brands', label: 'Brands', icon: Truck },
    ],
  },
  vendor: {
    label: 'Vendor',
    items: [
      { to: '/vendor', label: 'Profile', icon: User, end: true },
      { to: '/vendor/products', label: 'Products', icon: Package },
      { to: '/vendor/payouts', label: 'Payouts', icon: Banknote },
      { to: '/vendor/payout-account', label: 'Payout account', icon: Landmark },
    ],
  },
  rider: {
    label: 'Rider',
    items: [
      { to: '/rider', label: 'Deliveries', icon: Bike, end: true },
    ],
  },
};

function SidebarNav() {
  const role = useAuthStore((s) => s.user?.role);
  const groups = [];
  if (role === 'super_admin') groups.push('platform', 'store', 'catalog');
  else if (role === 'admin') groups.push('store', 'catalog');
  else if (role === 'vendor') groups.push('vendor');
  else if (role === 'rider') groups.push('rider');

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {GROUPS[g].label}
          </p>
          <div className="space-y-0.5">
            {GROUPS[g].items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const roleMeta = ROLE_META[user?.role] || { label: 'User', tone: 'slate' };

  const logout = () => {
    clear();
    navigate('/login');
  };

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-600 text-white">
          <Flower2 className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-bold text-white">Flower Market</p>
          <p className="text-[11px] text-slate-400">Admin console</p>
        </div>
      </div>
      <SidebarNav />
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-xs font-bold text-white">
            {initials(user?.profile?.firstName || user?.email?.address || user?.phone?.number)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold text-white">
              {titleCase(user?.profile?.firstName || '')}{' '}
              {titleCase(user?.profile?.lastName || '')}
            </p>
            <Badge tone={roleMeta.tone} className="mt-0.5 px-1.5! py-0! text-[10px]!">
              {roleMeta.label}
            </Badge>
          </div>
          <button className="text-slate-400 transition hover:text-white" onClick={logout} title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
