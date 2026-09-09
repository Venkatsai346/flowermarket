# Contributing to Flower Market

## Getting Started

1. Clone the repository
2. Follow the [Quick Start](README.md#quick-start) in the README
3. Run the full test suite: `cd backend && npm run smoke:all`

## Branch Naming

- `feature/short-description` — new features
- `fix/short-description` — bug fixes
- `refactor/short-description` — code restructuring
- `docs/short-description` — documentation only
- `test/short-description` — test additions/fixes

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional body explaining WHY (not WHAT — the diff shows what).

Optional footer with issue references.
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

**Scopes:** `backend`, `frontend`, `shared`, `storefront`, `mobile`, `ci`, `docker`

**Examples:**
```
feat(backend): add product reviews API
fix(storefront): correct Razorpay Checkout.js async flow
refactor(backend): standardize error handling to use AppError
docs: add deployment guide for AWS
```

## Pull Request Process

1. **Create a branch** from `main` with the naming convention above
2. **Write tests** for any new functionality (backend scripts or frontend unit tests)
3. **Run the full suite** before opening the PR:
   ```bash
   # Backend
   cd backend && npm run smoke:all
   
   # Frontend
   cd frontend && npm test
   ```
4. **Open a PR** with:
   - Clear title matching the commit convention
   - Description of what changed and why
   - Screenshots for UI changes
   - Checklist (see below)
5. **Wait for CI** — all 4 jobs must pass (backend, frontend, live-e2e, browser-ui)
6. **Request review** from at least one code owner

## PR Checklist

- [ ] Tests pass (`npm run smoke:all` for backend, `npm test` for frontend)
- [ ] No new ESLint violations (`npm run lint` in backend)
- [ ] New API endpoints have Joi validation schemas
- [ ] New API endpoints are documented in `backend/docs/API.md`
- [ ] New models are added to `backend/src/config/models.js`
- [ ] New enums are added to `backend/src/constants/enums.js` (no magic strings)
- [ ] Money amounts use integer paise for financial operations (not rupee floats)
- [ ] New services use the response envelope (`{ success, data, meta }`)
- [ ] Tenant-scoped data includes `tenantId` in queries
- [ ] Soft deletes used instead of hard deletes
- [ ] No `process.env` outside `src/config/index.js`

## Code Style

### Backend (JavaScript/Node.js)

- **ES Modules** (`import`/`export`) — no CommonJS
- **No TypeScript** — plain JS with JSDoc for complex types
- **Async/await** — no raw `.then()` chains
- **Sequential awaits in loops** — use `for...of` with `// eslint-disable-next-line no-await-in-loop` annotation
- **Error handling** — throw `AppError` instances from `utils/ApiError.js`
- **No `process.env`** — use `config` from `src/config/index.js`
- **No embedded models** — every growing collection in its own model
- **Soft deletes** — use the `softDelete` plugin

### Frontend (React)

- **Functional components** — no class components
- **Zustand** for state management — no Redux, no Context API for global state
- **Tailwind CSS** — no CSS modules, no styled-components
- **Lucide React** for icons — no other icon libraries
- **Shared package** — use `@flower-market/shared` for API client, auth store, money utils

## Architecture Rules

1. **Routes → Controllers → Services → Models** — strict one-directional flow
2. **Controllers are thin** — parse input, call one service, wrap in envelope
3. **Services hold all business rules** — testable without HTTP
4. **Models define schema only** — no business logic in models
5. **Middleware is cross-cutting** — auth, RBAC, validation, tenant context

## Money Rules (Critical)

- **New financial documents** use integer paise (`*Paise` fields)
- **Legacy rupee floats** on cart/order/invoice totals — do not rewrite
- **`allocatePaise()`** for splitting amounts across lines (largest-remainder)
- **`splitTaxPaise()`** for CGST/SGST split (structurally exact)
- **Idempotency keys** on every charge, refund, and ledger journal
- **Journal-first, event-first** — domain events before ledger journals

## Testing Philosophy

- **Pure tests** (no database): money, tax, payout, ranking, hostname, invariants
- **Hermetic DB tests** (in-memory MongoDB): full service-level tests
- **Smoke tests** (real MongoDB): end-to-end scenario verification
- **Browser E2E** (Puppeteer): UI-level verification

**The rule:** If it touches money, it has a pure test that runs in < 1 second with no database.

## Questions?

Open a GitHub Discussion or reach out to the maintainers.
