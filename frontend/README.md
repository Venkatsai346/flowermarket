# Flower Market — Frontend (admin console + mobile)

Monorepo (npm workspaces) for the Flower Market marketplace frontend, built on the
Phase 5 multi-tenant API (`/api/v1`).

```
frontend/
├─ packages/shared   @flower-market/shared  — framework-agnostic core:
│                     API client (envelope parsing + auto-refresh), typed endpoints,
│                     zustand auth session, money/date/status utils.
├─ apps/web          @flower-market/web     — React 18 + Vite + Tailwind v4 + Zustand
│                     admin console (platform / store / vendor surfaces).
└─ apps/mobile       @flower-market/mobile  — Expo (React Native) app scaffold on the
                      same shared core.
```

## Quick start

```bash
# 1. backend (from flower-market-backend/) — demo API on :4000
npm install && node scripts/dev-server.mjs

# 2. frontend (from frontend/)
npm install
npm run dev            # web console on :5173, proxies /api → :4000
npm run mobile         # Expo dev server
```

## Key design decisions

- **Token = tenant.** The API scopes every request to the JWT's tenant claim
  (TENANT_MISMATCH guard). The client never sends `x-tenant-id`; store-owner tokens
  resolve their own tenant via `tokenTenant`.
- **Shared core first.** `packages/shared` is plain ESM JS with no DOM deps — the exact
  same API client + auth store power the web console and the mobile app.
- **Role-based surfaces.** One console, three lenses: `super_admin` (platform),
  `admin` (store owner), `vendor`.
- **Auto-refresh.** 401 → single-flight `POST /auth/refresh` (rotating) → retry; only
  clear the session if refresh itself fails.
- **Zustand for two things only:** persisted auth session + toasts. Server data lives
  in per-page state via `useApi`.

Full plan: `uploads/admin_console.md`.
