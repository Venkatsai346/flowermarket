# Phase 6 — Frontend wave: Admin console (web) + mobile foundation

> Owner: Product frontend team. Status: **plan → iteration 1 SHIPPED** ✅
> (web console live on the :5173 preview against the Phase 5 API; mobile scaffold in
> `frontend/apps/mobile`; backend regression 9/9 green).
> Builds on Phase 5 (multi-tenant marketplace, live at `/api/v1`). Follows the same
> discipline as prior phases: blueprints first, shared core, provider-free pure client,
> role-aware surfaces, hand-verifiable acceptance criteria, full regression (9/9 backend
> suites must stay green — this phase touches zero backend logic).

## 1. Goal

Turn the Phase 5 API into a **world-class product surface**:

1. A **web admin console** (desktop-first) that lets three personas run their slice of the
   platform: **platform operator** (super_admin), **store owner** (tenant admin), and
   **vendor** (seller on the marketplace).
2. A **React Native app** (Expo) built on the **same shared core** (API client, auth
   session, utils) so the mobile experience is the next iteration, not a rewrite.
3. A **storefront** surface for customers later (slug-based public pages), reusing the
   same API client + design tokens.

## 2. Stack decision (what the user asked, clarified)

User's stack: **React Native + Vite, Tailwind CSS, Zustand (if required)**.

- **Vite** is the web bundler: `apps/web` = React 18 + Vite + Tailwind v4 + Zustand.
- **React Native** apps are built with **Expo/Metro**, not Vite — so the mobile app
  (`apps/mobile`) is an **Expo** project. Both apps import the **same
  `@flower-market/shared`** package (API client, auth store, money/date/status utils),
  which is plain ESM JS with no DOM deps — fully reusable by React Native.
- **Zustand** is used for exactly the two things that need global state: **auth session**
  (persisted) and **toasts**. All server data lives in per-page state via a tiny `useApi`
  hook — no server-state library needed at this scale, keeping the dependency surface
  small and consistent with the backend's provider-abstraction discipline.

## 3. Architecture

```
frontend/                        (npm workspaces monorepo)
├─ packages/
│  └─ shared/                    @flower-market/shared  (framework-agnostic)
│     ├─ api/client.js           fetch wrapper: envelope parsing, auth header,
│     │                          single-flight auto-refresh on 401, ApiError
│     ├─ api/endpoints.js        every API call as a typed function (1:1 with routes)
│     ├─ auth/store.js           zustand persisted session (user, tokens)
│     └─ utils/                  money (₹ en-IN), dates, status→tone maps
├─ apps/
│  ├─ web/                       @flower-market/web — Vite + React + Tailwind v4
│  │  └─ src/
│  │     ├─ api.js               client bound to /api/v1 (Vite proxy → :4000)
│  │     ├─ lib/useApi.js        data-fetch hook + action hook
│  │     ├─ components/ui/       Button, Card, Badge, Input, Modal, Table, …
│  │     ├─ components/layout/   AppShell, Sidebar, Topbar, Toaster
│  │     └─ features/            auth / dashboard / catalog / orders / vendors /
│  │                             billing / storefront / platform (pages)
│  └─ mobile/                    @flower-market/mobile — Expo scaffold on shared core
└─ uploads/admin_console.md      this plan
```

**Preview/proxy rule:** the browser never calls `localhost` — the Vite dev server proxies
`/api/*` → the API on `:4000` inside the sandbox, so the console works in the live
preview host with zero CORS friction.

## 4. Auth & multi-tenant model (the one thing everything hangs on)

- Access token is short-lived (15 min) and **carries the tenant claim**; `authenticate`
  rejects any request whose resolved tenant ≠ token tenant (`TENANT_MISMATCH`). The
  console therefore **never sends `x-tenant-id`** — the token *is* the tenant.
- `tokenTenant` middleware lets store-owner tokens hit `/marketplace/store/*` without a
  header. Platform `super_admin` tokens hit `/marketplace/admin/*`.
- **Session lifecycle:** login/register → `setSession({user, tokens})` (persisted) →
  the client attaches `Bearer`; on 401 it **single-flight refreshes** via
  `POST /auth/refresh` (rotating), retries the original request, and only clears the
  session if refresh fails (redirect to `/login`).
- **Role-based surfaces** (one console, three lenses):
  - `super_admin` → Platform console (cross-tenant: overview, stores, applications,
    vendors + product review, billing, plans) **and** their own store (seed admin owns
    the default tenant).
  - `admin` → Store console (dashboard, catalog, orders, vendors, billing, storefront).
  - `vendor` → Vendor console (profile, products).
  - `customer` → "no console access" notice (storefront comes later).

## 5. Design system

- Tailwind v4 CSS-first config (`@import "tailwindcss"`), default palettes:
  rose (brand/primary), emerald (money/success), amber (warnings), slate (neutrals).
- Reusable component classes in `@layer components`: `.card`, `.btn`, `.input`,
  `.label`, `.badge-*`, `.th/.td`, `.kpi`, `.modal-*`.
- Consistent states: loading skeletons, empty states with a CTA, inline form errors,
  destructive confirmations in modals, toast feedback for every mutation.
- ₹ formatting via `Intl.NumberFormat('en-IN', {currency:'INR'})`; compact ₹1.2L on KPIs.

## 6. Information architecture

| Surface | Nav |
| --- | --- |
| Platform | Overview · Stores · Vendor applications · Vendors · Billing · Plans |
| Store | Dashboard · Catalog · Orders · Vendors · Billing · Storefront |
| Vendor | Profile · Products |

## 7. Screen inventory & API mapping (v1 — "full core")

| Screen | Reads | Writes |
| --- | --- | --- |
| Login | — | `POST /auth/login` |
| Register store | `GET /marketplace/plans` | `POST /marketplace/tenants/register` (auto-login) |
| Store dashboard | `GET /admin/analytics/dashboard`, `/admin/analytics/products` | — |
| Catalog | `GET /admin/products` (+search/health/page) | `POST /admin/inventory/:id/adjust` |
| Orders | `GET /admin/orders` (+filters) | — (detail modal; cancel next iteration) |
| Store vendors | `GET /marketplace/store/vendors` | `POST /marketplace/store/vendors/:id/sync` |
| Store billing | `GET /marketplace/store/subscription`, `/store/invoices` | `PATCH /marketplace/store/plan` |
| Storefront/branding | `GET /marketplace/store` | `PATCH /marketplace/store` (publish) |
| Platform overview | `GET /marketplace/admin/analytics/dashboard`, `top-tenants`, `top-vendors` | `POST /admin/analytics/rebuild` |
| Stores (platform) | `GET /marketplace/admin/tenants` | — |
| Vendor applications | `GET /marketplace/admin/vendor-applications` | `POST …/:id/review` (approve/reject) |
| Vendors (platform) | `GET /marketplace/admin/vendors`, `:id` | `PATCH …/admin/vendors/:id`, `POST …/vendor-products/:id/review` |
| Billing (platform) | `GET /marketplace/admin/billing/invoices` | `POST /admin/billing/cycle`, `…/:id/pay`, `…/:id/void`, `/overdue-sweep` |
| Plans (platform) | `GET /marketplace/admin/plans` | `POST/PATCH /marketplace/admin/plans` |
| Vendor profile | `GET /marketplace/vendor/me` | `PATCH /marketplace/vendor/me` |
| Vendor products | `GET /marketplace/vendor/products` | `POST/PATCH /marketplace/vendor/products` |

## 8. Data flow & state

- `packages/shared/api/client.js` — one fetch wrapper; parses `{success, data, meta,
  message, code}`; throws `ApiError` with `status/code/details`; auto-refresh on 401;
  returns `{data, meta}`.
- `packages/shared/api/endpoints.js` — every endpoint as a function (auth/marketplace/
  admin). The API surface is the contract; the web + mobile apps both call these.
- `apps/web/src/lib/useApi.js` — `useApi(fn, deps)` → `{data, meta, loading, error,
  refetch}`; `useAction()` → `{busy, error, run(fn)}` for mutations + toast on success.
- Zustand stores: `useAuthStore` (persisted), `useToastStore`. Everything else is local.

## 9. QA matrix (this iteration)

1. Login with seed admin → platform lens; register store → store lens (auto-login).
2. Register duplicate slug → inline 409 error; reserved slug blocked client-side too.
3. Store: dashboard KPIs + chart match `/admin/analytics/dashboard`; catalog search +
   health filter + inventory adjust (restock) reflects on refetch; orders list + detail.
4. Store vendors: sync → created/skipped toast; marketplace-off banner → billing CTA.
5. Billing: change plan → pro-rata notice; invoices list + line-item detail modal.
6. Storefront: branding save → publish → onboarding `active`; storefront link opens.
7. Platform: overview KPIs hand-match dashboard payload; approve a vendor application →
   role flips (vendor can log in); approve vendor product → marketplaceListed; run
   billing cycle → new invoice; pay → paid; plans CRUD.
8. Auth: expired token auto-refresh; logout clears session; deep-link redirects to
   /login and back (`from`).
9. Backend regression: all 9 suites stay green (this phase only adds frontend + demo
   seed tweaks in `dev-server.mjs`, which tests never load).

## 10. Acceptance criteria

- One web console, role-aware: platform operator, store owner, and vendor each land on
  their own surface after login; customer sees a clear "no access" state.
- Every screen in §7 works against the live Phase 5 API with loading/empty/error states,
  inline validation, and toast feedback on mutations.
- Store registration end-to-end: pick plan → create store → auto-logged-in as owner →
  dashboard shows the new tenant's (empty) analytics.
- The platform operator can run the entire marketplace lifecycle from the console:
  approve applications, review products, run billing, mark invoices paid, manage plans.
- The mobile app scaffold boots and shows a login screen wired to the same shared API
  client + auth store (proves the shared core).
- Backend regression stays 9/9 green.

## 11. Roadmap

- **Iteration 1 (this plan):** web admin console — full core (§7) + mobile scaffold.
- **Iteration 2:** mobile app (Expo) — dashboard, orders, vendor approvals on the go,
  push notifications (Phase 4b provider), reusing shared core.
- **Iteration 3:** customer storefronts (`/store/:slug`) — public pages, browse, cart,
  checkout against `/catalog`, `/cart`, `/orders` (customer flow), PWA.
- **Iteration 4:** polish — dark mode, i18n (en/te/hi), CSV exports UI, notifications
  center, per-role audit trail viewer.

## 12. Non-goals (this pass)

- No customer storefront app (iteration 3).
- No backend changes except demo-only seed enrichment in `dev-server.mjs`.
- No OTP login UI in the console v1 (email+password; OTP is the mobile/customer path).
- No live payment wiring (console marks invoices paid via the mock provider — Phase 5
  non-goal preserved).
