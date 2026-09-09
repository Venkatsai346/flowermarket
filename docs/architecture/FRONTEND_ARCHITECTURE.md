# Frontend Architecture

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | React 18 | UI library |
| Build | Vite | Fast dev + production builds |
| Routing | React Router v6 | Client-side routing |
| State | Zustand | Lightweight global state |
| Data | React Query (TanStack) | Server state, caching, refetch |
| Styling | Tailwind CSS | Utility-first CSS |
| Forms | React Hook Form | Form validation |
| Validation | Joi (shared) | API contract validation |
| i18n | Custom (Telugu + English) | Internationalization |
| Icons | Lucide React | Icon library |

## Directory Structure

```
frontend/apps/web/src/
├── api.js                  # Axios instance with interceptors
├── App.jsx                 # Root router + role guards
├── components/
│   ├── layout/             # AppShell, Sidebar, Topbar, Footer
│   ├── ui/                 # Button, Badge, Toast, EmptyState, Skeleton
│   ├── charts/             # TrendChart (SVG sparklines)
│   ├── activity/           # ActivityFeed (live polling)
│   └── media/              # MediaUploader, MediaPickerModal
├── features/
│   ├── auth/               # Login, Register, NoAccess
│   ├── catalog/            # CatalogPage, Masters, Categories, Brands
│   ├── dashboard/          # StoreDashboard (KPIs, charts)
│   ├── orders/             # OrdersPage, OrderDetail
│   ├── ops/                # FulfillmentPage
│   ├── aftersales/         # Returns, Refunds
│   ├── inventory/          # InventoryPage
│   ├── hubs/               # HubsPage, DeliveryZonesPage
│   ├── users/              # UsersPage
│   ├── search/             # SearchAdminPage
│   ├── tax/                # TaxPage
│   ├── policies/           # PoliciesPage
│   ├── vendors/            # StoreVendorsPage
│   ├── billing/            # StoreBillingPage
│   ├── storefront/         # BrandingPage, DomainsPage, TenantSettings
│   ├── platform/           # PlatformOverview, Stores, Vendors, Billing,
│   │                       # Plans, Ledger, AuditLog, FiscalPeriods,
│   │                       # Settlements, Statutory, Exports, Reviews,
│   │                       # DemandForecast, Dlq, ConnectionPool
│   ├── payouts/            # Payouts, Settlement, Statutory
│   ├── vendor/             # VendorProfile, Products
│   └── rider/              # RiderDeliveryPage
├── hooks/                  # Custom hooks (useWishlist, etc.)
├── lib/
│   ├── api.js              # API client wrapper
│   ├── format.js           # fmtINR, fmtDate, etc.
│   ├── nav.js              # Navigation config + shortcuts
│   ├── utils.js            # cn(), helpers
│   ├── i18n.js             # Telugu + English translations
│   └── commands.js         # Command palette commands
├── styles/
│   └── animations.css      # Micro-interaction animations
└── rbac/
    └── routeMap.js         # Role → route access control
```

## Key Patterns

### Role-Based Routing

```jsx
// App.jsx — every route is wrapped with a role guard
const storeOnly = (el) => <RoleGuard roles={['admin', 'super_admin']}>{el}</RoleGuard>;
const platformOnly = (el) => <RoleGuard roles={['super_admin']}>{el}</RoleGuard>;

<Route path="orders" element={storeOnly(<OrdersPage />)} />
<Route path="platform" element={platformOnly(<PlatformOverview />)} />
```

### Data Fetching (React Query)

```jsx
const { data, isLoading, error } = useQuery({
  queryKey: ['orders', filters],
  queryFn: () => api.get('/orders', { params: filters }).then(r => r.data),
  keepPreviousData: true,
});
```

### Mutations

```jsx
const mutation = useMutation({
  mutationFn: (data) => api.post('/orders', data),
  onSuccess: () => {
    queryClient.invalidateQueries(['orders']);
    showToast('Order created', 'success');
  },
});
```

### Animations

```jsx
// CSS classes from styles/animations.css
<div className="animate-fade-in-up">Content</div>
<div className="stagger-children">{items.map(...)}</div>
<button className="btn-press">Click</button>
```

### Haptic Feedback

```jsx
import { haptic } from '../lib/haptics.js';
haptic('light');   // tap
haptic('medium');  // success
haptic('heavy');   // error
```

### Blur-up Image Loading

```jsx
import BlurImage from '../components/ui/BlurImage.jsx';
<BlurImage src="/product.jpg" alt="Rose bouquet" />
```

### WhatsApp Share

```jsx
import ShareToWhatsApp from '../components/ui/ShareToWhatsApp.jsx';
<ShareToWhatsApp orderId="ORD-123" total="₹590" />
```

## Performance Optimizations

1. **Lazy loading** — Admin pages loaded via `React.lazy()`
2. **Skeleton loading** — Every page has skeleton states
3. **Blur-up images** — `BlurImage` component with IntersectionObserver
4. **Stagger animations** — Lists animate in sequentially
5. **Reduced motion** — `prefers-reduced-motion` respected
6. **Code splitting** — Route-level chunks
7. **Tree shaking** — Lucide icons imported individually

## Accessibility

- Skip link (`<SkipLink />`) for keyboard navigation
- Focus management on route changes
- ARIA labels on interactive elements
- WCAG 2.1 AA color contrast
- `prefers-reduced-motion` support
