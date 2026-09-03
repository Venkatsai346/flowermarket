import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from '@flower-market/shared';
import { api } from './api.js';
import AppShell from './components/layout/AppShell.jsx';
import { LoadingBlock } from './components/ui/Spinner.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import RegisterStorePage from './features/auth/RegisterStorePage.jsx';
import StoreDashboard from './features/dashboard/StoreDashboard.jsx';
import CatalogPage from './features/catalog/CatalogPage.jsx';
import MastersPage from './features/catalog/MastersPage.jsx';
import CategoriesPage from './features/catalog/CategoriesPage.jsx';
import BrandsPage from './features/catalog/BrandsPage.jsx';
import OrdersPage from './features/orders/OrdersPage.jsx';
import FulfillmentPage from './features/ops/FulfillmentPage.jsx';
import AftersalesPage from './features/aftersales/AftersalesPage.jsx';
import RiderDeliveryPage from './features/rider/RiderDeliveryPage.jsx';
import PoliciesPage from './features/policies/PoliciesPage.jsx';
import StoreVendorsPage from './features/vendors/StoreVendorsPage.jsx';
import StoreBillingPage from './features/billing/StoreBillingPage.jsx';
import BrandingPage from './features/storefront/BrandingPage.jsx';
import DomainsPage from './features/storefront/DomainsPage.jsx';
import PlatformOverview from './features/platform/PlatformOverview.jsx';
import PlatformStoresPage from './features/platform/PlatformStoresPage.jsx';
import VendorApplicationsPage from './features/platform/VendorApplicationsPage.jsx';
import PlatformVendorsPage from './features/platform/PlatformVendorsPage.jsx';
import PlatformBillingPage from './features/platform/PlatformBillingPage.jsx';
import PlansAdminPage from './features/platform/PlansAdminPage.jsx';
import VendorProfilePage from './features/vendor/VendorProfilePage.jsx';
import PlatformPayoutsPage from './features/payouts/PlatformPayoutsPage.jsx';
import LedgerPage from './features/platform/LedgerPage.jsx';
import VendorPayoutsPage from './features/payouts/VendorPayoutsPage.jsx';
import VendorPayoutAccountPage from './features/payouts/VendorPayoutAccountPage.jsx';
import VendorProductsPage from './features/vendor/VendorProductsPage.jsx';
import NoAccessPage from './features/auth/NoAccessPage.jsx';

const SearchAdminPage = lazy(() => import('./features/search/SearchAdminPage.jsx'));
const TaxPage = lazy(() => import('./features/tax/TaxPage.jsx'));
const UsersPage = lazy(() => import('./features/users/UsersPage.jsx'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage.jsx'));
const HubsPage = lazy(() => import('./features/hubs/HubsPage.jsx'));

/** gate: must be logged in; hydrates the user profile from /users/me */
function RequireAuth() {
  const location = useLocation();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuth = useAuthStore((s) => s.isAuthenticated());

  useEffect(() => {
    if (!accessToken) return undefined;
    let alive = true;
    api.auth
      .me()
      .then((r) => {
        if (alive) useAuthStore.getState().updateUser(r.data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [accessToken]);

  if (!isAuth) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

/** gate: role must be in the allow-list */
function RoleGuard({ roles, children }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role) return <LoadingBlock />;
  if (!roles.includes(role)) return <Navigate to="/no-access" replace />;
  return children;
}

/** role-aware landing page */
function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  if (!role) return <LoadingBlock />;
  const home = role === 'super_admin' ? '/platform'
    : role === 'admin' ? '/'
      : role === 'rider' ? '/rider'
        : role === 'vendor' ? '/vendor' : '/no-access';
  return <Navigate to={home} replace />;
}

const storeOnly = (el) => <RoleGuard roles={['admin', 'super_admin']}>{el}</RoleGuard>;
const platformOnly = (el) => <RoleGuard roles={['super_admin']}>{el}</RoleGuard>;
const vendorOnly = (el) => <RoleGuard roles={['vendor']}>{el}</RoleGuard>;
const riderAccess = (el) => <RoleGuard roles={['rider', 'admin', 'super_admin']}>{el}</RoleGuard>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterStorePage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="catalog" element={storeOnly(<CatalogPage />)} />
          <Route path="catalog/masters" element={storeOnly(<MastersPage />)} />
          <Route path="catalog/categories" element={storeOnly(<CategoriesPage />)} />
          <Route path="catalog/brands" element={storeOnly(<BrandsPage />)} />
          <Route path="orders" element={storeOnly(<OrdersPage />)} />
          <Route path="fulfillment" element={storeOnly(<FulfillmentPage />)} />
          <Route path="returns" element={storeOnly(<AftersalesPage />)} />
          <Route path="policies" element={storeOnly(<PoliciesPage />)} />
          <Route path="search" element={storeOnly(<Suspense fallback={<LoadingBlock />}><SearchAdminPage /></Suspense>)} />
          <Route path="tax" element={storeOnly(<Suspense fallback={<LoadingBlock />}><TaxPage /></Suspense>)} />
          <Route path="users" element={storeOnly(<Suspense fallback={<LoadingBlock />}><UsersPage /></Suspense>)} />
          <Route path="inventory" element={storeOnly(<Suspense fallback={<LoadingBlock />}><InventoryPage /></Suspense>)} />
          <Route path="hubs" element={storeOnly(<Suspense fallback={<LoadingBlock />}><HubsPage /></Suspense>)} />
          <Route path="rider" element={riderAccess(<RiderDeliveryPage />)} />
          <Route path="vendors" element={storeOnly(<StoreVendorsPage />)} />
          <Route path="billing" element={storeOnly(<StoreBillingPage />)} />
          <Route path="storefront" element={storeOnly(<BrandingPage />)} />
          <Route path="platform" element={platformOnly(<PlatformOverview />)} />
          <Route path="platform/stores" element={platformOnly(<PlatformStoresPage />)} />
          <Route path="platform/vendor-applications" element={platformOnly(<VendorApplicationsPage />)} />
          <Route path="platform/vendors" element={platformOnly(<PlatformVendorsPage />)} />
          <Route path="platform/billing" element={platformOnly(<PlatformBillingPage />)} />
          <Route path="platform/plans" element={platformOnly(<PlansAdminPage />)} />
          <Route path="domains" element={storeOnly(<DomainsPage />)} />
          <Route path="platform/payouts" element={platformOnly(<PlatformPayoutsPage />)} />
          <Route path="platform/ledger" element={platformOnly(<LedgerPage />)} />
          <Route path="vendor" element={vendorOnly(<VendorProfilePage />)} />
          <Route path="vendor/products" element={vendorOnly(<VendorProductsPage />)} />
          <Route path="vendor/payouts" element={vendorOnly(<VendorPayoutsPage />)} />
          <Route path="vendor/payout-account" element={vendorOnly(<VendorPayoutAccountPage />)} />
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
