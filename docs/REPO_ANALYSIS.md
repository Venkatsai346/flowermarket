# Flower Market — Deep Repository Analysis (Phase 6)

_Analysis date: 2026-09-03 · branch `arena/01a06577-flowermarket` · base commit `a3e65fc`
(`feat(phase6/S1-S3): search ranking — NDCG@10 0.569 -> 0.996`)_

This document **supersedes** the earlier Phase-5 analysis in this file. Everything below was
re-derived from the current tree and, where possible, actually executed in this sandbox
(dependency install, syntax sweep, module-graph import, DB-free test suites, frontend build).
The repo has grown past Phase 5 into a **completed Phase 6** (money core, GST invoicing,
vendor payouts, subdomain routing, storefront, search ranking).

---

## 0. TL;DR — what this codebase is now

1. **Backend is the product and it is unusually disciplined.** 79 Mongoose models, 59 services,
   23 controllers, 20 route modules, **293 endpoints** across 20 mounts, ~29k LOC of `src/`.
   Layering (routes → controllers → services → models) is consistently maintained; business
   logic lives in services and the largest file is a service (`payout.service.js`, 1170 LOC).
2. **Phase 6 is genuinely shipped, not just documented.** I ran the DB-free suites and every
   one is green: money 56/56, GST 78/78, payout 47/47, payout-provider 52/52, hostname 55/55,
   ranking 79/79, repo invariants 8/8, and `search-eval` reports **mean NDCG@10 = 0.996**
   against a 0.85 gate. Frontend builds clean (web 427 kB / 119 kB gzip, storefront 255 kB /
   79 kB gzip).
3. **The two biggest Phase-6 architectural wins are the double-entry ledger and an
   authority-by-Host model.** `ledger.service` enforces balance-or-nothing, idempotent,
   immutable journals with a recomputable materialized view; `tenantContext` resolves a store
   from the `Host` (fail-closed, negative-cache) so the new storefront bundle physically
   contains **no tenant id**.
4. **What remains "incomplete" is not broken money code — it is shipping seams and customer
   surfaces.** Real PSP / e-invoice / notification / search-provider credentials, PDF invoices,
   inclusive-pricing checkout, a real mobile app, and rider/picker tooling are the deliberate
   deferrals. The storefront **after-sales surface is now shipped** (cancel, returns, wallet,
   refunds). There is still no CI, no linter, no formatter.
5. **The earlier security findings are mostly fixed.** `/catalog/tenant/*` is now
   `authorize(ADMIN, SUPER_ADMIN, VENDOR)`, media writes are role-gated with a per-tenant byte
   quota, dev CORS is enumerated rather than universal, the client↔route contract drift is
   gone (invariants prove all 172 shared-client calls hit a route), and the dead
   `tenantContext` branch is removed.

---

## 1. Repository map

```
flowermarket/
├─ backend/                        Node 18+ ESM · Express 4 · Mongoose 8        ~29k LOC src
│  ├─ src/{config,constants,middleware,models,routes,controllers,services,utils}
│  ├─ scripts/                     seed, dev-server, nightly-job + 24 test files (~6.8k LOC)
│  ├─ docs/                        API.md · DATA_MODELS.md · ROADMAP.md · ARCHITECTURE.md
│  └─ storage/local/               ⚠ 11 runtime uploads still committed (~906 KB)
├─ frontend/                       npm-workspaces monorepo (~9.6k LOC app src)
│  ├─ packages/shared              @flower-market/shared — API client, endpoints, zustand auth
│  ├─ apps/web                     React 18 + Vite 6 + Tailwind 4 admin console (~7.0k LOC)
│  ├─ apps/storefront              React 18 + Vite 6 customer storefront (~1.85k LOC)   [NEW P2]
│  └─ apps/mobile                  Expo/RN scaffold — login screen only (~194 LOC)
├─ uploads/                        phase specification docs, incl. `phase6_…` (69 kB blueprint)
└─ package-lock.json               ⚠ stray root lockfile still named "bloomy"
```

### Current size vs the old Phase-5 snapshot

| Area | Phase-5 analysis | Now |
|---|---:|---:|
| Backend `src` LOC | 18,898 | **28,976** |
| Models | 76 | **79** |
| Services | 46 | **59** |
| Controllers | 18 | **23** |
| Route modules | 16 | **20** |
| Endpoints | 232 | **293** |
| Backend test files | 10 smoke | **24** (pure + smoke + invariants) |
| Web console LOC | 5,523 | **7,012** |
| Shared client calls | ~81 | **172** |
| Customer-facing apps | 0 | **1** (storefront) |

---

## 2. Backend architecture (unchanged discipline, larger surface)

### 2.1 Request lifecycle

```
helmet → webhook raw-body routes → CORS (host-aware) → json/urlencoded → compression →
morgan → /api/v1 → tenantContext → auth routes → validate(Joi) → authenticate → authorize →
controller → service → model → envelope → errorHandler
```

Two critical details survive and were hardened:

- **Raw-body webhooks before `express.json`.** Razorpay payment webhook, mock payment webhook,
  and now the **payout provider webhook** (`POST /api/v1/payouts/webhook`) are mounted before
  the JSON parser so HMAC-SHA256 is computed over the exact bytes.
- **`tenantContext` decides the tenant before auth, and the Host now wins.** Resolution order
  is Host (`{slug}.{root}` or verified custom domain) → header (only when the Host did not
  decide) → default → bootstrap fallback. An unknown `*.root` subdomain **404s** rather than
  falling back to the default tenant (that fallback was the Phase-6 pre-flight leak).

### 2.2 Route surface (293 endpoints, 20 mounts)

| Mount | Endpoints | Guard posture |
|---|---:|---|
| `/auth` | 8 | public + rate limiters |
| `/users` | 19 | `authenticate`; admin sub-routes `authorize` |
| `/catalog` (public) | 5 | public |
| `/catalog/tenant` | 20 | `authenticate` + `authorize(ADMIN,SUPER_ADMIN,VENDOR)` ✅ (was F1) |
| `/catalog/admin` | 25 | `authenticate` + `authorize` |
| `/cart` | 12 | `authenticate` |
| `/orders` | 4 | `authenticate` |
| `/returns` | 5 | `authenticate` (+2 ops guards) |
| `/wallet` | 3 | `authenticate` |
| `/fulfillment` | 20 | `authorize` all |
| `/rider` | 9 | `authorize(RIDER…)` |
| `/policies` | 10 | `authorize` ×9 |
| `/admin` | 48 | router-level `authorize(ADMIN,SUPER_ADMIN)` |
| `/marketplace` | 39 | segmented `/vendor`, `/store`, `/admin` |
| `/media` | 6 | reads `authenticate`; writes role-gated + quota ✅ (was F2) |
| `/tax` | 14 | rate policy `SUPER_ADMIN`; store-owned docs `authorize` |
| `/payouts` | 24 | platform vs vendor hard-separated |
| `/ledger` | 5 | read-only by construction |
| `/domains` | 8 | public bootstrap + verified-domain management |
| `/search` | 9 | public suggest/events; admin profiles/synonyms/reindex |

### 2.3 Domain model (79 collections)

The model barrel is now organized by phase. The **Phase 6 additions** are:

- **6.1 money core (4):** `LedgerAccount`, `LedgerJournal`, `LedgerEntry`, `AccountBalance`.
- **6.2 GST (4):** `TaxRegistration`, `StatutoryRate`, `TaxDocumentSeries`, `TaxDocument`.
- **6.3 payouts (6):** `PayoutPolicy`, `VendorPayoutAccount`, `PayoutLineItem`, `PayoutBatch`,
  `PayoutStatusHistory`, `PayoutAdjustment`.
- **6.4 domains (1):** `TenantDomain`.
- **6.5 search (4):** `SearchDocument`, `RankingProfile`, `SearchSynonym`, `SearchQueryLog`.

The three shared plugins (softDelete, audit, toJSON) are still applied everywhere. The
snapshot discipline is still respected: `orderitem` persists charged tax/discount, invoices
**reconstruct** rather than recompute, payout lines are snapshots against refunds, and the
ledger journal is immutable.

### 2.4 Concurrency & consistency model

Still **no Mongo transactions** on a standalone mongod, but Phase 6 raised the bar:

- Atomic guarded `findOneAndUpdate` for inventory and slot capacity (unchanged).
- **Optimistic locks** on masters, listings, orders, inventory, wallet.
- **Idempotency keys** on charges, refunds, *and now every ledger journal
  (`{kind}:{refType}:{refId}`)* and every payout instruction.
- **New:** `ledgerService.withOptionalTransaction()` probes once whether the deployment is a
  replica set; when it is, journal + entries + balances commit in **one transaction**. When it
  isn't, the journal is still the truth and the nightly `verifyBalances({ repair: true })`
  sweep closes the crash window. The boot log states which mode is active.

The **order saga** and **payout state machine** are the two places where the "missing edge" is
itself the safety design (see §3.3 and §3.4).

---

## 3. Business logic — the six systems that matter

### 3.1 Money core (`utils/money.js` + `ledger.service.js` + `ledgerPosting.service.js`)

- **Integer paise** with `toPaise`/`fromPaise`/`sumPaise`/`applyBps`; `allocatePaise()`
  uses largest-remainder so rounding is never stolen from the last line;
  `splitTaxPaise()` makes `CGST + SGST === tax` structurally impossible to violate.
- **Double-entry with four enforced rules:** every journal balances (Σ debit = Σ credit) or
  nothing is written; every journal is idempotent; journals are immutable (correction = a
  reversing journal); `accountbalances` is a materialized view recomputable from entries.
- **Posting service maps business events:** `sale_captured` on CONFIRMED splits the customer's
  money into `vendor_payable`, `gst_output_payable:{vendor}`, platform commission income, etc.;
  `refund_issued` is a **proportional reversal of the original sale journal** — a refund can
  never touch an account the order didn't, nor exceed what was captured.
- `ensureChartOfAccounts()` runs at boot and is idempotent; scoped accounts
  (`vendor_payable:{id}`, `gst_output_payable:{owner}`, …) are created lazily.

### 3.2 GST engine (`utils/gst.js`, `tax.service.js`, `taxDocument.service.js`)

- **Effective-dating is the whole point.** Every rate resolver takes an `at` date; a two-year-old
  invoice re-renders with the rate in force then, not today's table.
- No policy is treated as `nil_rated` (a distinction that matters in GSTR-1), not as 0% taxable.
- **One `TaxDocument` collection, not two.** Invoices and credit notes share numbering and GSTR
  queries; `docType` discriminates and series are still per-`docType`.
- **One document per supplier.** A multi-vendor order yields one invoice per vendor plus one for
  the store's own lines.
- **Reconstruction over recomputation:** the invoice takes the tax the customer was *actually
  charged* (persisted on `orderitems`) and only splits it into CGST/SGST/IGST.
- **Numbering is gapless per financial year** using an atomic `$inc` inside the issuing
  transaction (when possible); documents that must not exist are **CANCELLED, never deleted**.
- **TCS u/s 52 and TDS u/s 194-O are effective-dated data**, never code constants; the seed
  values are explicitly flagged for CA verification before go-live.
- E-invoicing/IRN is behind `einvoiceProvider` (console/mock/gsp) with a nightly retry queue;
  **PDF rendering is the one deferred piece** (presentation, not correctness).

### 3.3 Vendor payouts (`payout.service.js`)

- **`computeLineFinancials()` is pure** and holds the worked example to the paisa:
  `₹5900 gross → −₹500 commission → −₹90 GST-on-commission → −₹25 TCS → −₹5.90 TDS → ₹5279.10`.
- **Two eligibility gates:** return risk (deliveredAt + returnWindowDays) and cash-in-hand
  (`psp_settled` ledger entry). The second gate ships **off by default** and is only manually
  enabled after settlement ingestion is fully deployed.
- **Accrual happens at CONFIRMED** (vendors see money "upcoming" in real time), but nothing is
  payable until the return window closes.
- **The batch state machine's most important edge is the one that isn't there:**
  `PROCESSING → QUEUED` does not exist. An in-flight payout is resolved only by reconciliation,
  never by a retry — that is how marketplaces avoid paying twice.
- **Ledger posts at submission, not at settlement.** Rejection/reversal posts the exact mirror
  journal (`payout_reversed`) and returns lines to the eligible pool; a reversal is **not**
  retryable, a clean failure is.
- **Three-outcome provider contract:** success / clean-failure / **ambiguous**. Transport errors
  never throw (a throwing error is indistinguishable from a rejection and invites a retry);
  `{ ambiguous: true }` forces the caller to do nothing.
- Bank-detail fingerprint changes re-arm a **24 h freeze** and require penny-drop grade
  re-verification before release.

### 3.4 Subdomain routing (`tenantContext.js`, `tenantDomain.service.js`, `utils/hostname.js`)

- `Host` is **attacker input**. `utils/hostname.js` rejects userinfo, requires digits as ports,
  classifies infrastructure hosts, and is fuzzed (55 tests). The fuzz test literally caught a
  bug during development (`store.root:80@evil.com` was parsing the userinfo as a port).
- **Fail-closed:** unknown `*.root` subdomain → 404, never default tenant.
- Custom domains require a **DNS-TXT verification** that gates both resolution and TLS.
- TTL+LRU cache also caches **negatives** so a flood of unknown hosts is not an unbounded DB load.
- **Host-aware CORS:** configured allowlist + any subdomain of the root + verified custom domains
  + an enumerated dev set (localhost, 127.0.0.1, `.localhost`, `.e2b.app`). No "allow everything
  in dev" rule remains.

### 3.5 Search ranking (`search.service.js`, `searchProvider.service.js`, `utils/ranking.js`)

- **Two-stage retrieval:** bounded candidates from indexed `searchdocuments`, then a pure
  in-process scorer (2.4 ms per 1,000 candidates). This is deliberately *not* a Mongo
  aggregation — the scorer can be tested, explained, and retuned from data.
- The indexer rides the **existing CatalogEvent outbox** (no new event plumbing); upsert on a
  stable key makes at-least-once delivery harmless.
- **Out-of-stock is demoted, never filtered.** The floor is unbreakable: 300 randomised weight
  configurations cannot put a sold-out item above an in-stock one. A safety property depending
  on the operator choosing sensible weights is not a safety property.
- Ranking profiles and synonyms are **editable DATA** with deterministic A/B bucketing.
- **Inferred intent biases, explicit filters constrain.** `white flowers` returns white because
  the colour is a *reported* inference; only a client-supplied colour narrows.
- Typo correction is against the **store's own vocabulary**, not a dictionary, and short tokens
  may only be fixed by insertion/deletion (`rse → rose` works; `pot → hot` cannot).
- **The measurement gate is the deliverable:** `search-eval.mjs` means NDCG@10 = 0.996, gate
  0.85, so a future tuning change cannot silently undo this one.

### 3.6 Storefront (`frontend/apps/storefront`)

- **One parameterless call** (`GET /domains/bootstrap`) — no tenant id in config, URL, header,
  or build output. It is structurally incapable of addressing the wrong store.
- **Contrast is computed, not assumed** (WCAG luminance from the brand colour).
- **Cart lives on the server**; the client only keeps a snapshot so badge/drawer render instantly.
- **Sessions are namespaced per hostname** (`fm-shop:{host}`) so two stores in two tabs cannot
  share a cart.
- **Customers see 5 states, not 16** — a status translation map converts the operational state
  machine into the milestones a person tracks.

---

## 4. Verified in this sandbox

| Check | Result |
|---|---|
| Backend `npm install` | ✅ 229 packages, clean |
| `node --check` on all src + scripts | ✅ 0 syntax errors |
| `import('./src/app.js')` + `import('./src/routes/index.js')` | ✅ full module graph resolves |
| `scripts/money.test.js` | ✅ **56/56** |
| `scripts/tax-calc.test.js` | ✅ **78/78** |
| `scripts/payout-calc.test.js` | ✅ **47/47** |
| `scripts/payout-provider.test.js` | ✅ **52/52** |
| `scripts/hostname.test.js` | ✅ **55/55** |
| `scripts/ranking.test.js` | ✅ **79/79** |
| `scripts/invariants.test.js` | ✅ **8/8** (audit enum, import resolution, client↔route 172/293, ledger types, env docs, role guards) |
| `scripts/search-eval.mjs` | ✅ **mean NDCG@10 0.996**, gate 0.85 |
| Frontend `npm install` + `npm run build` | ✅ web 427/119 kB gzip · storefront 280/85 kB gzip (after adding the after-sales surface) |
| DB-backed smoke suites | ⏭ **skip loudly** — `mongodb-memory-server` cannot reach `fastdl.mongodb.org` (ECONNRESET); no local `mongod` |

The DB-backed suites are the one thing not executable here. They are designed to skip
rather than fail when Mongo is unavailable, so this is an **environment** blocker, not a repo
defect. To run them in CI you either need a `mongo:7` service container or a cached mongod
binary.

---

## 5. Completed / incomplete phase matrix

### Completed and verified (backend + docs + UI)

| Phase | Status | Highlights |
|---|---|---|
| 1 — user domain | ✅ | OTP auth, JWT + rotating refresh, addresses, RBAC, tenant scaffolding |
| 2a — catalogue | ✅ | ProductMaster/TenantProduct split, approval, optimistic locks, inventory, outbox, bulk import |
| 2b+3 — order lifecycle | ✅ | cart revalidation, slotted delivery atomic locks, saga orchestrator, fulfillment/POD, returns/refunds |
| 3.5 — policies/rider/forecast | ✅ | policy engine, rider state machine, forecasting, Razorpay hardening |
| 4 — admin dashboard | ✅ | products/inventory/slots/orders/users/analytics + CSV exports |
| 4b — ops tooling | ✅ | notifications outbox, templates-as-data, scheduled exports, nightly pipeline |
| 5 — marketplace | ✅ | tenant self-service, vendor onboarding, billing/invoices, platform analytics, storefront branding |
| 6.0 — pre-flight | ✅ | RBAC on catalog tenant + media, media quota, audit-enum gate, CORS fail-closed |
| 6.1 — money core | ✅ | paise arithmetic, double-entry ledger, posting service, nightly backfill/verify |
| 6.2 — GST invoicing | ✅ | effective-dated rates, one-doc-per-supplier, gapless FY numbering, IRN provider, TCS/TDS |
| M3 — GST exports | ✅ | 7 new renderers (GSTR-1 b2b/b2cs/hsn/cdnr, GSTR-8, TDS-194O, sales register) |
| M4 — payout accrual | ✅ | pure financials, state machine, two gates, refund reversal, carry-forward, dual approval |
| M5 — disbursement | ✅ | 3-outcome provider contract, HMAC webhook, reconcile-in-flight, settlement ingest, statements |
| M6 — payout console | ✅ | platform approval queue, batch drawer, ledger explorer; vendor payouts/bank/KYC |
| P1 — domains | ✅ | Host-based resolution, fail-closed unknown host, DNS-TXT verified custom domains, negative cache, host-aware CORS |
| P2 — storefront | ✅ | customer app: bootstrap, catalog/search, cart, OTP, checkout, tracking |
| S1–S3 — search ranking | ✅ | indexed two-stage retrieval, pure scorer, A/B profiles, synonyms/typos, NDCG gate, autocomplete |

This matches the roadmap's `Phase 6 — IN PROGRESS … all ✅` line and the blueprint's execution log.

### Incomplete, deferred, or out-of-scope (and why)

| Item | Type | State / reason |
|---|---|---|
| **PDF invoice / credit-note rendering** | deferred in Phase 6 | needs a new dependency; presentation, not correctness (M3 note) |
| **Inclusive-pricing checkout (M2b)** | deliberately off | `TAX_PRICES_INCLUSIVE` exists and the engine handles both modes, but flipping the pricing pipeline changes what customers are charged; needs its own migration + comms |
| **PSP settlement gate** | default off | `requirePspSettlement` is implemented and `ingestPspSettlements()` exists, but defaults to `false` so an unmet gate can't silently block every payout |
| **Live external providers** | seams only | real RazorpayX/Cashfree credentials, e-invoice GSP credentials, FCM/APNs/SMTP/Twilio, SMS/msg91, Atlas/OpenSearch, S3, real billing gateway — interfaces are implemented, live wiring is not |
| **Legacy money decimalism** | partial | Phase 6 financial docs are **paise-native**, but the Phase 2–5 order/pricing/analytics path still uses rupee numbers with `roundMoney`; a full integer-paise migration of the old pipeline is not done |
| **Storefront after-sales UI** | ✅ closed | cancel order, standard return / instant claim request, returns list, wallet balance + transaction + refund views, account menu — all driven by the existing shared client and server-authoritative endpoints; shared client also gained `returnDetail` + `walletRefunds` |
| **Wallet-as-payment-method (R2b)** | ✅ closed | wallet checkout debits `customer_wallet_liability`, `Payment.provider=wallet`, insufficient balance runs the saga's normal `PAYMENT_FAILED` compensation, wallet-funded refunds are always routed to the wallet, concurrent/idempotent retries are locked by a `Payment.walletClaimToken` claim so a half-finished debit heals without double-charging, the reconciliation sweep cancels truly unrecoverable pending orders, and the checkout preflight (`POST /cart/quote`) returns the exact server-authored total the storefront gates on |
| **Mobile app** | scaffold | Expo login screen with hardcoded demo credentials and an in-memory storage shim; no catalog/cart/orders UI |
| **Rider / picker tooling** | absent | 9 `/rider` and 20 `/fulfillment` endpoints are fully implemented and smoke-tested, but there is no rider or picker app |
| **CI / linter / formatter / test runner** | absent | no `.github`, no ESLint, no Prettier, no test-runner config; smoke scripts are hand-rolled `node` files, only some wired into `package.json` |
| **Validation coverage** | uneven | `validate()` density: `/fulfillment` 3/20, `/returns` 2/5, `/cart` 6/12, `/orders` 2/4; params/bodies reach services unchecked in places |
| **Repo hygiene** | persists | 11 runtime uploads under `storage/local` are still tracked despite `.env.example` saying "keep OUT of git"; stray root `package-lock.json` named `"bloomy"` |

---

## 6. Findings (current)

### Security / correctness

- **R1 (closed): storefront after-sales UI.** A customer can now cancel an order, request a
  standard return or instant claim, and see returns, wallet balance, refunds and wallet activity.
  The UI stays server-authoritative: eligibility is checked on the server, amounts are rendered
  from the server, and every mutation refetches the order.
- **R2 (low): legacy money path is still float-based.** The new financial documents are
  paise-native, but order totals, refunds, taxes, and analytics still travel through rupee-number
  `roundMoney`. Paise stays consistent *within Phase 6* but the old pipeline and new money core
  are two different accounts of the same rupee until the migration completes.
- **R2b (closed): "pay with wallet" is now a real internal payment method.** `paymentMethod:
  'wallet'` debits `customer_wallet_liability` via `walletService.debit`, records
  `Payment.provider='wallet'` + a CHARGE transaction, keeps the sale journal source correct, and
  forces refunds back to the wallet. Insufficient balance surfaces as `PAYMENT_FAILED` through the
  saga's `compensateFailedCharge()`. A `walletClaimToken` optimistic claim makes concurrent
  retries run exactly one debiter; a crash between debit and Payment finalisation heals on retry
  (never double-debits). The reconciliation sweep also closes the saga loop by cancelling truly
  unrecoverable pending orders, and the storefront exposes wallet at checkout only when the exact
  server-authored `POST /cart/quote` grand total is covered.
- **R3 (low): validation density is uneven** (same gap as before) — `/fulfillment`, `/returns`,
  `/orders`, and parts of `/cart` rely on Mongoose casting as the only backstop.
- **R4 (info/environment): DB-backed smoke suites cannot run in this sandbox** because the mongod
  binary download is blocked; they skip loudly. Add a Mongo service container in CI.
- **R5 (info): external provider failures happen at runtime, not at boot.** `UnimplementedProvider`
  for Atlas/OpenSearch and the "not configured" checks for real providers fail loudly — good —
  but there is no boot-time check that flags a production deploy that accidentally points at
  `console`/`local`/`mock` providers. Worth a `--check-config` assertion.

### Repository hygiene

- **R6:** `backend/storage/local/**` (11 images, ~906 KB) still tracked; `backend/.gitignore`
  doesn't exclude `storage/` even though `.env.example` says keep it out of git.
- **R7:** root `package-lock.json` named `"bloomy"` with an empty `packages` map.
- **R8:** no CI, no lint/format config, and no unified test runner. Backend smoke/invariant suites
  run manually; the storefront now has a DB-free `npm test` (after-sales helpers), but nothing
  runs it automatically.

---

## 7. Recommended next moves

**Immediate (one work session)**
1. **Done — storefront after-sales surface.** Cancel, returns (standard + instant), wallet,
   refunds and wallet activity are now in the customer app; shared client gained
   `returnDetail` + `walletRefunds` so the client route table stays aligned.
2. **Done — wallet-as-payment-method.** Wallet checkout debits the ledger liability, refunds stay
   in the wallet, retries are idempotent, and the storefront gates wallet on the exact
   `POST /cart/quote` total; the DB-backed wallet scenario is added to `scripts/smoke-order.test.js`.
3. **Stop committing runtime uploads** — `git rm -r --cached backend/storage`, add
   `storage/` to `backend/.gitignore`, delete the stray root lockfile.
4. **Add CI** with a `mongo:7` service: `node --check` sweep, `vite build`, all pure suites, and
   all DB-backed smoke suites. That also makes the "can't run tests offline" problem disappear.

**Short (days)**
5. **Add a boot/config check** that aborts (or warns loudly) if a production
   `NODE_ENV=production` deploy uses `console`/`local`/`mock` payment/billing/notification/
   payout/search providers.
6. **Close the `validate()` gaps** on `/fulfillment`, `/returns`, `/orders`, `/cart`.
7. **Migrate the legacy order/pricing/analytics path to paise** now that Phase 6 gave you the
   helpers — otherwise the ledger can be exact while the rest of the product is a half-paise away.

**Strategic (weeks)**
8. **Build the real mobile shopping app** on the shared core (canonical roadmap mapping already
   documents every screen → endpoint).
9. **Build the rider app and picker view** on `/rider` + `/fulfillment` — both roles have
   complete backend state machines and zero tooling.
10. **Deploy the storefront to `{slug}.{root}` / custom domains** behind P1 resolution, then
    enable the PSP settlement gate and switch on inclusive-pricing checkout (M2b) only after the
    tax seeds are CA-verified.
11. **Add the Phase-7 candidates when ready** (multi-currency, e-way bills, vendor credit lines,
    learning-to-rank from the existing query log, buyer-side ITC, real-time settlement) — all are
    explicitly non-goals of Phase 6, not regressions.

---

## 8. Codebase statistics

| Area | Files | LOC |
|---|---:|---:|
| Backend `src/` | 226 | 28,976 |
| — services | 59 | ~12k (largest: `payout.service.js` 1170) |
| — models | 79 | |
| — controllers | 23 | |
| — routes | 20 | |
| Backend `scripts/` | 24 test/demo files | 6,845 |
| Frontend web `src/` | 40+ | 7,012 |
| Frontend storefront `src/` | 18 | 1,849 |
| Frontend shared `src/` | 8 | 731 |
| Mobile | 6 | 194 |
| Spec docs `uploads/` | 10 | ~3.6k lines |

Largest files (excluding `dist/`): `payout.service.js` (1170), `constants/enums.js` (1037),
`taxDocument.service.js` (765), `order.service.js` (723), `ledger.service.js` (588).
