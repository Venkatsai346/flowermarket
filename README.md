# 🌷 Flower Market

A production-grade, multi-tenant flower marketplace platform — BigBasket-style
slotted delivery, double-entry financial ledger, GST invoicing, vendor payouts,
and a full admin console + customer storefront + mobile app.

## Quick Start

### With Docker (recommended)

```bash
# Clone and start everything (MongoDB + API + Worker + Web + Storefront)
git clone https://github.com/Venkatsai346/flowermarket.git
cd flowermarket
docker compose up --build

# That's it. Open:
#   Admin Console:  http://localhost:5173
#   Storefront:     http://localhost:5174
#   API:            http://localhost:4000/api/v1/health
#   Swagger UI:     http://localhost:4000/api/v1/docs
```

### Without Docker

```bash
# Prerequisites: Node.js ≥ 18, MongoDB 6.x (replica set recommended)

# 1. Backend
cd backend
cp .env.example .env
npm ci
node scripts/seed-default-tenant.js   # creates a default tenant + admin user
npm run dev                            # starts API on :4000

# 2. Frontend (in a new terminal)
cd frontend
npm ci
npm run dev                            # Admin Console on :5173
npm run storefront                     # Storefront on :5174
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Storefront  │     │ Admin Console│     │ Mobile App  │
│  (React SPA) │     │  (React SPA) │     │  (Expo/RN)  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────▼───────┐
                    │   API Server  │
                    │   (Express)   │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────▼─────┐ ┌────▼────┐ ┌──────▼──────┐
        │  MongoDB   │ │  Worker │ │   Storage   │
        │  (rs0)     │ │ (events)│ │  (local/S3) │
        └────────────┘ └─────────┘ └─────────────┘
```

### Backend Layers

```
routes/  →  controllers/  →  services/  →  models/   (Mongoose)
              │                  │
              └─ middleware ─────┘        utils/ (money, gst, state machines)
```

- **Routes** — paths + middleware (auth, RBAC, validation, rate limits)
- **Controllers** — thin: parse input, call one service, wrap in response envelope
- **Services** — all business rules (testable without HTTP)
- **Models** — schema, indexes, virtuals, document methods only
- **Middleware** — cross-cutting: tenant context, auth, RBAC, validation, error handling

### Frontend Architecture

```
frontend/
├── packages/shared/     ← API client, auth store, money utils, brand kits
├── apps/web/            ← Admin console (React 18 + Vite + Tailwind v4 + Zustand)
├── apps/storefront/     ← Customer-facing SPA (host-aware, zero-config boot)
└── apps/mobile/         ← React Native / Expo (shared core)
```

## Testing

```bash
# Backend — all tests (pure + hermetic DB)
cd backend && npm run smoke:all

# Backend — pure tests only (no database needed)
cd backend && npm run test:unit

# Backend — money arithmetic (56 assertions, 10,000-case fuzz)
cd backend && npm run test:money

# Backend — GST calculations (78 assertions, 20,000-case fuzz)
cd backend && npm run test:tax

# Frontend — unit tests
cd frontend && npm test

# CI — full suite (backend + frontend + live E2E + browser UI)
# Runs automatically on push to main and on pull requests
```

## Key Business Domains

| Domain | Description |
|---|---|
| **Multi-tenant catalog** | Global product masters + per-tenant listings with field-ownership split |
| **Slotted delivery** | BigBasket-style time windows with atomic capacity locks |
| **Order saga** | Orchestrated checkout: charge → inventory → slot → fulfillment |
| **Double-entry ledger** | Every rupee tracked through journals, entries, and materialized balances |
| **GST invoicing** | CGST/SGST/IGST split, gapless per-FY numbering, e-invoice ready |
| **Vendor payouts** | Two-gate eligibility, three-outcome provider handling, negative carry-forward |
| **Search ranking** | Two-stage retrieval, 8-signal blend, NDCG@10 = 0.996 |
| **Cash on delivery** | Full ledger lifecycle: receivable → cash on hand → bank |

## Production Deployment

See `docs/PLATFORM_BUILD_PLAN.md` for the complete build plan.

```bash
# Production build
docker build -t flowermarket-api -f backend/Dockerfile backend/

# Production environment
cp backend/.env.production.example backend/.env.production
# Fill in real values (Razorpay keys, MongoDB URI, JWT secrets, etc.)

# Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**The API refuses to start** if mock/console/default providers are detected in
production. This is intentional — see `assertProductionProviders.js`.

## API Documentation

- **Swagger UI:** `http://localhost:4000/api/v1/docs` (interactive)
- **OpenAPI spec:** `http://localhost:4000/api/v1/openapi.json` (machine-readable)
- **API reference:** `backend/docs/API.md` (comprehensive markdown)

## Project Structure

```
flowermarket/
├── backend/
│   ├── src/
│   │   ├── config/          # Database, env, model registry
│   │   ├── constants/       # Enums, brand kits
│   │   ├── controllers/     # Thin HTTP handlers
│   │   ├── middleware/       # Auth, tenant, validation, rate limits, logging
│   │   ├── models/          # Mongoose schemas (75+ models)
│   │   ├── observability/   # Metrics, heartbeat
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Business logic (50+ services)
│   │   ├── utils/           # Money, GST, state machines, helpers
│   │   └── workers/         # Background scheduler
│   ├── scripts/             # Test suites, seed scripts, CI helpers
│   ├── docs/                # Architecture, API, data models, roadmap
│   └── Dockerfile           # Multi-stage production build
├── frontend/
│   ├── packages/shared/     # Shared API client, auth store, utils
│   ├── apps/web/            # Admin console
│   ├── apps/storefront/     # Customer storefront
│   ├── apps/mobile/         # React Native mobile app
│   └── e2e/                 # Browser-based E2E tests
├── scripts/ci/              # CI/CD helpers (MongoDB, live stack)
├── docs/                    # Platform build plan
├── docker-compose.yml       # Development stack
├── docker-compose.prod.yml  # Production overlay
└── README.md                # This file
```

## License

UNLICENSED — proprietary.
