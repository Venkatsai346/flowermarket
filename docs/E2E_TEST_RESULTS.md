# Feature Test Results — backend + admin web + storefront

Live E2E + full test-matrix results from the "boot everything, exercise every
feature, classify pass/fail" deep-dive (2026-09-06).

## Stack that was tested (all live, on one machine)

| Service | Port | Notes |
|---|---|---|
| MongoDB 6.0.6 (replica set `rs0`) | 27017 | `flower_market` DB, seeded tenant `flower-market` |
| API backend | 4000 | ledger transactions **enabled**, OTP console provider, ops endpoints `/healthz` · `/readyz` · `/metrics` (Prometheus) |
| Async worker (`src/worker.js`) | — | outbox auto-drain (leased claims + backoff/DLQ) + scheduled nightly jobs + heartbeats — see `docs/WORKER_ARCHITECTURE.md` |
| Admin web | 5173 | Vite dev server |
| Storefront | 5174 | Vite dev server |

Seeded tenant: `6a9d8621360a608803fe1a62` (admin `admin@flowermarket.in` /
`Admin@12345`, demo rider `+91 9000000009`, 5 products / 3 categories).
(The original run used `6a9cdead4c488f8a24e1ff9a`; the sandbox was reset and
re-seeded on 2026-09-06, which mints a fresh tenant id — harnesses were
updated, and log/tenant discovery in the e2e scripts is now dynamic.)

## Result matrix — ALL GREEN after fixes

### A. Pure (no-DB) suites — `backend/scripts/*.test.js`
| Suite | Result |
|---|---|
| money | 60/60 |
| tax-calc (GST engine) | 78/78 |
| payout-calc | 47/47 |
| payout-provider | 52/52 |
| refund-calc | 6/6 |
| hostname resolution | 55/55 |
| search ranking | 79/79 |
| search-eval (NDCG@10) | 0.996 ≥ 0.85 gate |
| slot-forecasting | 4/4 |

### B. DB smoke suites (each on its own in-memory mongod)
| Suite | Result |
|---|---|
| smoke (auth/user 17 scenarios) | PASS |
| smoke-catalog | PASS |
| smoke-phase35 | PASS |
| smoke-admin | PASS |
| smoke-ops | 7/7 |
| smoke-ledger | 41/41 |
| smoke-domains | 32/32 |
| smoke-order (full lifecycle + wallet) | 27/27 |
| smoke-marketplace | 14/14 |
| smoke-media | 8/8 |
| smoke-gst | 58/58 |
| smoke-payouts | 143/143 (grew through Phases 11–17: bank settlement, statutory, statement, clawback, refund/carry integrity) |
| smoke-wallet (Phase 16) | 57/57 |
| smoke-vendors (Phase 17) | 90/90 |
| smoke-worker (leased claims, reaper, backoff/DLQ, single-flight) | 6/6 |
| smoke-observability (healthz/readyz/metrics, outbox lag, heartbeat, jobs) | 7/7 |
| smoke-payments (webhook idempotency, amount verify, reconciliation, metrics) | 13/13 |
| smoke-audit (trace propagation, exactly-once append, crash-window replay, orphan restore, refund/cancel chain) | 15/15 |

### C. Live E2E (`backend/scripts/e2e-live.mjs`, real HTTP against :4000)
**104/104 cases passed** (current — see the Phase re-verification sections below; the per-phase sections are the authoritative record). Snapshot text below:
**79/79 cases passed** (Phase 10 snapshot). Covers: ranked search + catalog + categories/brands/
product/stock + suggest + plans + default-tenant fallback; phone-OTP auth
(verify + wrong-OTP reject + 401); addresses + wallet; cart → slot →
server-quoted checkout (UPI mock, charged==quote, order-number format); admin
email/password login + RBAC (403/401); fulfillment pick→pack→dispatch→rider
machine (accept/arrive-hub/depart/arrive/complete OTP-POD)→delivered;
return pickup+QC→wallet refund; wallet checkout + debit + pre-pick cancel saga
→ wallet refund; admin catalog ops + outbox drain; both frontends serve HTML;
**money audit backbone (Phase 10 §11):** `x-trace-id` echo, order traceId
stamping, full trace chain (sale + refund + cancel on one trace, time-ordered),
platform integrity report `ok` with 100% event↔journal coverage, tenant-scoped
report, and SUPER_ADMIN-only RBAC on report/replay;
**tamper-evident chain + fiscal period close (Phase 11 §11.7–11.12):**
`replay-chain` backfilled the pre-chain history (idempotent), hash-chain
verifier green (0 breaks / 0 unanchored), SUPER_ADMIN close of the current
month, period report (closed state, balanced journals, from the journal),
reopen restoring posting, and the tenant-scoped period list.

### D. Frontend unit suites
| App | Result |
|---|---|
| apps/web (admin) | pass, 0 fail |
| packages/shared | pass, 0 fail |
| apps/storefront | 7/7 |

### E. Browser-UI E2E (headless Chromium 149 via puppeteer-core, real renders + real requests)
Phase 2 of the deep-dive: drove the **actual browser UIs** of both apps — every
feature exercised through the frontend, real HTTP through the Vite proxies to
:4000, state asserted via API round-trips (not just DOM text).

**Storefront (customer) — 29/29** (`frontend/e2e/ui-storefront.e2e.mjs`)
| Area | Cases |
|---|---|
| Home: hero + store identity | S01 |
| Home: 5 seeded products in grid | S02 |
| Home: category chip filters grid (5→1→5) | S03 |
| Home: search box filters on Enter | S04 |
| Home: sort control + in-stock chip | S05 |
| PDP sheet: open product, price, Add to basket | S06 |
| Auth: sign-in sheet → phone step | S07 |
| Auth: OTP request + verify (dev code) | S08 |
| Auth: account menu appears in header | S09 |
| Cart: add from PDP → header badge | S10 |
| Cart: sheet shows line with price | S11 |
| Cart: quantity stepper updates subtotal (₹199→₹398) | S12 |
| Checkout: reachable, address step first | S13 |
| Checkout: add new address via form | S14 |
| Checkout: pick delivery slot (10-min hold) | S15 |
| Checkout: payment method + confirmed total | S16 |
| Checkout: place order → success + order number | S17 |
| Orders: new order listed with status | S18 |
| Order detail: items, price, progress rail | S19 |
| Order detail: cancel flow with reason | S20 |
| Second order placed (reused saved address) | S21 |
| Order 2 delivered via full rider flow | S22 |
| Order 2 UI: delivered + return CTA | S23 |
| Return: request sheet → submit (qty + reason) | S24 |
| Returns page lists the return | S25 |
| Wallet page: balance + transactions | S26 |
| Address book: add → edit → delete round-trip | S28 |
| Wallet: top-up credits the balance (live, API-verified) | S29 |
| No page errors / failed API requests | S27 |

**Async payment (customer) — 7/7** (`frontend/e2e/ui-async-payment.e2e.mjs`)
| Area | Cases |
|---|---|
| Dev toggle: mock gateway → async (pending) mode | P01 |
| Sign in with phone OTP (new customer) | P02 |
| Add a product to the basket from the PDP | P03 |
| Checkout lands in the awaiting-payment state (no auto-confirm) | P04 |
| Signed gateway webhook captures the payment | P05 |
| Polling flips the page Awaiting payment → Confirmed (no refresh) | P06 |
| Dev toggle: back to sync mode | P07 |

**Admin web — 40/40** (`frontend/e2e/ui-admin.e2e.mjs`)
| Area | Cases |
|---|---|
| Login page renders; admin email+password login → dashboard | A01–A02 |
| Dashboard KPIs render | A03 |
| My catalog: 5 listings, detail opens | A04 |
| Catalog masters list | A05 |
| Catalog categories list | A06 |
| Brands: create a brand via UI | A07 |
| Catalog ops: price change → outbox event → **UI "Drain pending"** | A08 |
| Inventory page: stock rows | A09 |
| Hubs & slots page | A10 |
| Orders board: test order listed, detail opens | A11 |
| Fulfillment: pick → pack → dispatch via UI | A12 |
| Fulfillment: delivery tab + POD capture (OTP) → delivered | A13 |
| After-sales: return pickup + QC pass via UI → wallet refund | A14 |
| Policies: stats + tabs render | A15 |
| Policies: create coupon via UI | A16 |
| Search admin: health + synonyms + reindex | A17 |
| Tax: registration + documents render | A18 |
| Users: list + create staff (picker) via UI | A19 |
| Users: create rider via UI | A20 |
| Store vendors page renders | A21 |
| Billing page: plan state renders | A22 |
| Storefront branding: save tagline → API-verified → restore | A23 |
| Domains page renders | A24 |
| Platform console: overview / stores / lifecycle / vendor applications / vendors / billing / plans / payouts / ledger | A25–A33 |
| Payments ops: live async payment → webhook audit → drawer → reconcile | A37 |
| System integrity: ledger page reports all subsystems + replay action + **audit chain (tamper-evidence) row** (live, green) | A38 |
| Follow the money: order drawer assembles the trace timeline (order → payment → journal → audit events) | A39 |
| Fiscal periods: close month via UI → report rendered from the journal (balanced) → reopen | A40 |
| RBAC: store admin blocked from vendor console | A34 |
| Rider session: login as UI-created rider → /rider renders | A35 |
| No page errors / failed API requests | A36 |

## Genuine application bugs found & fixed (app code)

These were real defects in `src/` that the test matrix exposed — not test bugs.

1. **Order numbers `FM-…-undefined` in the full app.** `src/utils/orderNumber.js`
   incremented a `seq` field while preferring the `Counter` model whose field is
   `value`. Mongoose strict casting silently stripped the unknown `$inc` path
   (no-op) → upsert doc had no sequence. Fixed to increment `Counter.value`
   (single source of truth). Verified `FM-260906-00001`.

2. **Ranked catalog served stale/empty results.** Products were invisible until
   the first outbox drain, and deactivated items lingered. `catalog.public.controller.js`
   now falls back to a legacy scan when the ranked index returns 0 but live rows
   exist (`meta.indexState: stale_fallback`).

3. **`deliveredAt` missing from the Order model.** Payout eligibility
   (`deliveredAt + return window`) read `order.deliveredAt`, which wasn't a
   schema path, so it was silently dropped and every payout line's `eligibleAt`
   drifted to `order.updatedAt`. Added top-level `deliveredAt` and stamped it
   once in `order.service.transition()` on DELIVERED.

4. **Payout approval double-approval guard was unreachable.** In single-approval
   flow the first approval already leaves `PENDING_APPROVAL`, so a state-first
   check made the "already approved by you" guard unreachable exactly when it
   mattered. Reordered the guard in `payout.service.approve()`.

5. **Credit notes applied an s.170 round-off they must not have.** A partial
   credit note is not a payable; a rupee round-off shifted the credited amount
   by up to 5 paise vs the refund it documents. `summariseInvoice(lines,
   {roundOff:false})` for the CN path.

6. **Tax document-number race under concurrency.** `findAndModify` upserts are
   not guaranteed to absorb the insert-vs-insert race; 25 concurrent
   reservations produced E11000. Added an E11000 retry in
   `taxDocument.reserveNumber()` (and the same hardening in `orderNumber`).

7. **`serializeList` clobbered `id` on transformed docs.** `toObject()` with the
   toJSON transform already maps `_id→id` and deletes `_id`; the helper then
   overwrote `id` with `undefined`, so responses built from
   `created.map(d=>d.toObject())` shipped documents with no id. Now preserves
   the existing `id`.

**Found while driving the real browser UIs (phase 2):**

8. **Auth payload contract mismatch (admin login broken).** The web app's
   `api.auth.login` posted the wrong field shape, so email/password sign-in 400'd.
   Aligned the payload with the backend contract.
9. **Slots payload shape mismatch (checkout slot step broken).** The checkout
   slot step sent the wrong shape; fixed to the per-day `{hub, slots}` the API
   expects.
10. **Cart endpoint returned a flat shape; frontend expected nested.** The cart
    API returns a flat object, but consumers read `cart?.cart?.subtotal` etc.
    Fixed the *backend* to keep the documented nested shape (do **not** "fix"
    `CartSheet` to the flat path).
11. **`useApi` contract: action fns must resolve to a `{data}`-shaped value.**
    A hook returned a bare payload, so `r.data` was `undefined` and save flows
    silently no-op'd. Fixed the helper to normalize to `{data}`.
12. **Address list missing `serializeList`.** The address list endpoint returned
    docs with no `id` (same class as #7); added the serializer.
13. **`createStaff` never persisted the password.** `UserSchema.methods.setPassword`
    only sets `passwordHash` and returns `this` — it does **not** `save()`. Every
    other caller `await`s an explicit save; `adminUsers.service.createStaff` was
    the only one that relied on the implicit save, so staff (picker/rider) were
    created with `passwordHash: null` and could never log in (surfaced by A19/A20
   staff creation + A35 rider login). Added `await user.save()` after
   `setPassword` in `createStaff`. **Rule: any `setPassword` caller must `save()`.**
14. **Webhook replays overwrote the audit verdict.** `applyWebhookEvent`'s
    `finish()` did an unconditional `updateOne({provider,eventId}, {$set:{status…}})`
    — so a *replayed* delivery (result `duplicate`) clobbered the first
    delivery's terminal `processed` status on the `PaymentWebhookEvent` audit
    row. An operator inspecting the event would see "duplicate" and lose the
    record that the money was in fact confirmed. Fixed first-writer-wins: the
    terminal status is written only while the row is still `received`
    (race-safe guard), and replays are bookkept separately
    (`deliveries` counter + `lastSeenAt`). Caught by `live-payments-proof`
    against the running stack; regression-tested in `smoke-payments` §4.
15. **Partial search index shadowed the live catalogue (items invisible).**
    The seed never built the ranked index, so the first outbox event made the
    index *partial* (fewer docs than live) and the ranked path — non-empty —
    never fell back to the legacy scan (the old guard only covered
    ranked-returns-0). A reseeded tenant could serve e.g. 2 of 5 products.
    Fixed in three places: `seed-default-tenant.js` now runs
    `searchIndexer.reindexAll()` after seeding; the nightly maintenance job
    backfills missing docs (`freshnessCheck.missing > 0 → reindexAll`); and
    `catalog.public.controller.js` probes the legacy scan *always* and serves
    it whenever `legacy.total > ranked.total` (`meta.indexState:
    stale_fallback`) — a partial index can no longer shadow live stock.
    Verified live: delete 3 index docs → `total=5, indexState=stale_fallback`;
    reindex → `ranked` again.
16. **Payments order-id search fired ~24 requests per search (400 storm).**
    `PaymentsPanel`'s "Payment by order id…" input refetched on every
    keystroke; typing a 24-char Mongo id char-by-char produced ~24
    `GET /fulfillment/payments` calls, each 400 until the id was whole
    (visible as a console-error storm in A36). Debounced the search value
    (300 ms, same pattern as `KycPanel`); A36 now reports `console-err=0`.

## Test defects (rot) found & fixed — app behavior was correct

- **Stale fixtures vs. evolved schemas:** `smoke-gst` used `type:'flower'`
  (now `fresh_flower`/`floral_accessory`) and Orders missing the now-required
  `addressSnapshot.addressId`; `smoke-payouts` Order fixture lacked `addressId`.
- **`smoke-ledger` drift sign:** asserted `-777` where the (self-consistent)
  service reports `+777` (view credit inflated ⇒ net debit 777 *below* entries).
- **`smoke-order` wallet flow** reused customer1's address with customer2's
  token (ownership-scoped checkout ⇒ ADDRESS_NOT_FOUND); gave customer2 its own
  address.
- **`smoke-payouts` section 2** created its "1-day-old" order on the *same*
  vendor, so its sale journal added ₹900 to that vendor's payable and skewed
  the exact-payable assertions; moved it to a second vendor. Its section 7
  ambiguous order was delivered 30 days ago (eligibleAt 23d ago, outside the
  ±2d cycle window); delivered 8 days ago instead.
- **`.env` leaking into DB suites.** The dev `MONGODB_URI`/`DEFAULT_TENANT_ID`
  were loaded via `src/config` (dotenv) *before* suite-local overrides could run,
  so suites silently ran against the live DB. Added `scripts/test-env-guard.js`
  as the FIRST import of every suite (honors only a CLI-provided
  `MONGODB_URI`, always clears `DEFAULT_TENANT_ID`), and a defense-in-depth
  guard in `smoke-domains` (which wipes the tenants collection) that refuses to
  run against a real database.
- **`smoke-phase35` used the pre-hardening mock-webhook contract.** When the
  mock webhook was hardened to require an HMAC signature (same scheme as
  Razorpay), the older suite's unsigned POST started 401ing. Updated the
  suite to sign the exact raw bytes with `paymentProvider.signMockWebhook` —
  the suite now exercises the *hardened* contract.
- **`e2e-live` §7 relied on catalog rank order for returnability.** The
  delivered-then-returned order was built from `catalog[0]`, whose ranking
  shifts with order history — a fresh DB ranks a perishable fresh flower
  first, and fresh flowers are correctly *non-returnable* for pickup-QC
  returns (business rule, not a bug). The test now picks the first
  non-perishable listing explicitly.
- **Admin UI A08 raced the background worker.** The test waited for the
  "Drain pending" button to be enabled, but the worker (5s outbox poll)
  typically dispatched the event first — the *healthy* state. The test now
  verifies the pipeline outcome (event created → published, bounded wait,
  whichever actor drained it) and asserts the button's disabled-state gating
  matches `pending=0`; the manual drain path is still exercised when the
  pending window is caught.

## Phase 7 re-verification — payment layer (2026-09-06)

The sandbox was fully reset (node_modules, mongod, browser libs, processes);
the whole stack was re-provisioned (mongod 6.0.6 rs0 + OpenSSL 1.1.1w,
`@sparticuz/chromium` 149 → `/tmp/chromium` + `/home/user/.browser-libs`),
the tenant re-seeded (new id above), and **every layer re-run green**:

| Layer | Result |
|---|---|
| `npm run smoke:all` (pure + 16 DB suites, now incl. **smoke-payments 13/13**) | ALL GREEN |
| `invariants` (env docs, money-invariants, RBAC guards, …) | 8/8 |
| `e2e-live.mjs` (live stack, full journey) | 67/67 |
| `live-payments-proof.mjs` (async checkout, HMAC enforcement, reconciliation, dedupe, mismatch, metrics, worker job) | 28/28 |
| `async-payment-live.test.mjs` (dev toggle → pending checkout → poll → signed webhook → confirmed, live stack) | 14/14 |
| Storefront browser UI | 29/29 |
| Async-payment browser UI (pending state → signed webhook → live poll flip) | 7/7 |
| Admin browser UI (incl. race-proofed A08 + payments-ops A37) | 37/37 |
| Worker `payment-reconcile` job, live | `lastStatus: ok` — swept 4 stale async-demo payments (gateway silent → failed + cancelled, never confirmed without attestation) |

The payment layer design + verification matrix:
`docs/PAYMENTS_ARCHITECTURE.md`.

## CI (2026-09-06)

The whole matrix is now a GitHub Actions pipeline
(`.github/workflows/ci.yml`) — runs on push to `main`, every PR, and
manually:

| Job | Runs |
|---|---|
| `backend` | `npm run smoke:all` — pure suites + 16 hermetic DB suites (in-memory mongod pinned to 6.0.6 via `MONGOMS_VERSION`) |
| `frontend` | unit tests (web, storefront, shared) + production builds |
| `live-e2e` | full live stack (mongo 6.0.6 rs0 service → `scripts/ci/boot-live-stack.sh` → API + worker + 2× Vite) → `e2e-live.mjs` 67 checks + `async-payment-live.test.mjs` 14 checks |
| `browser-ui` | same stack + real Chromium (`frontend/e2e/provision-chromium.mjs` extracts the `@sparticuz/chromium` binary + NSS/NSPR libs) → storefront 29 + async-payment 7 + admin 37 browser checks |

Local parity for the live jobs: `bash scripts/ci/boot-live-stack.sh`
(expects mongod on 127.0.0.1:27017), then `. /tmp/fm-ci/env.sh && node
scripts/e2e-live.mjs` — verified green in this sandbox (67/67 + 27/27).

## Environment notes
- MongoDB egress is blocked in this sandbox; mongod 6.0.6 + OpenSSL 1.1.1w were
  provisioned locally (`/home/user/.mongod`). DB suites run with
  `MONGOMS_SYSTEM_BINARY` + `LD_LIBRARY_PATH=/home/user/.mongod/ssl11/lib`.
- Live E2E reads OTPs from the backend console log
  (`[otp:console] … code=NNNNNN`).

## How to reproduce
Boot topology: `mongod` → `node src/server.js` (API :4000) →
`node src/worker.js` (async worker) → the two Vite dev servers (:5173/:5174).

```bash
# 1. pure + DB suites (hermetic in-memory mongod)
cd backend
export MONGOMS_SYSTEM_BINARY=/home/user/.mongod/mongodb-linux-x86_64-debian11-6.0.6/bin/mongod
export LD_LIBRARY_PATH=/home/user/.mongod/ssl11/lib
node scripts/<suite>.test.js        # e.g. smoke-gst, smoke-payouts
# 2. live E2E (needs the boot-stack running + seeded tenant)
node scripts/e2e-live.mjs
# 3. frontend unit
cd ../frontend/apps/web   && npm test
cd ../frontend/packages/shared && npm test
cd ../frontend/apps/storefront && npm test
# 4. browser-UI E2E (needs the boot-stack: mongod + :4000 + :5173 + :5174)
#    uses a headless Chromium already provisioned under /tmp/chromium + /home/user/.browser-libs
cd ../frontend/e2e
LD_LIBRARY_PATH=/home/user/.browser-libs node ui-storefront.e2e.mjs       # 29/29
LD_LIBRARY_PATH=/home/user/.browser-libs node ui-async-payment.e2e.mjs   # 7/7
LD_LIBRARY_PATH=/home/user/.browser-libs node ui-admin.e2e.mjs           # 37/37
```
## Phase 11 re-verification — tamper-evident chain + fiscal close (2026-09-07)

Full pyramid green after the hash chain + period close shipped:

| Layer | Result |
|---|---|
| `npm run smoke:all` (18 suites; `smoke-audit` now **25/25** incl. §10–11: crashed-append backfill, gapless duplicate, content tamper → `hash_mismatch`, tail delete → `tail_mismatch`, middle delete → `broken_link`, orphan-restore scar → manual `rebuildChain` → clean + `chain_rebuilt` fact, close → 409 `PERIOD_CLOSED` → balanced report → reopen) | ALL GREEN |
| `invariants` (8, incl. "no audit action the model would reject" — caught the new `period_close`/`period_reopen` actions on first run) | 8/8 |
| `e2e-live.mjs` | **79/79** (+§11.7–11.12: chain backfill, verifier green, close, balanced report, reopen, tenant period list) |
| `async-payment-live.test.mjs` | 14/14 |
| Storefront browser UI | 29/29 |
| Async-payment browser UI | 7/7 |
| Admin browser UI (incl. **A40** fiscal periods: close → report from journal → reopen; A38 now renders the audit-chain row) | **40/40** (console-err=0) |
| Live tamper proof (manual, real stack) | `replay-chain` anchored 79 rows → 0 breaks / 0 unanchored; edited one stored event's payload → verifier named `hash_mismatch` at the victim seq; restored → clean; close 2026-09 → report (68 journals, balanced) → reopened |

CI counts synced in `.github/workflows/ci.yml`: live 79 checks, admin browser 40.

## Phase 12 re-verification — the cash gate (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-payouts` | **73/73** (+§11: gate ON blocks unsettled order; settlement ingest unlocks it; `psp_settled` event chained, chain verifies; crash-window replay re-posts the settlement to the exact paise; event restore from journal; summary counts) |
| `smoke:all` (18 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **84/84** (+§12: summary shape, ingest posts exactly one, clearing reduced by the settled amount, summary reflects it, re-ingest idempotent) |
| Admin browser UI | **41/41** (A41: gate toggled via UI, settlement ingested from the card's own unsettled queue, gate restored; console-err=0) |
| Live proof (manual) | summary → ingest → clearing/bank move + chained event visible in the integrity report |

CI counts synced in `.github/workflows/ci.yml`: live 84 checks, admin browser 41.

## Phase 13 re-verification — statutory deposits (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-payouts` | **94/94** (+§13: exact carried liability; over-deposit refused; deposit clears payable + pays bank exactly; deposit event chained; revert restores zero-net with reason, double-revert refused; crash-window replay to the exact paise; event restore; trial balanced) |
| `smoke:all` (18 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **89/89** (+§13: summary shape, zero-liability invariant, over-deposit 409 with nothing posted, RBAC 403s) |
| Admin browser UI | **42/42** (A43: TCS + TDS cards render, impossible deposit refused through the UI quoting the real liability; console-err=1 = the intentional 409, A36's convention) |

CI counts synced in `.github/workflows/ci.yml`: live 89 checks, admin browser 42.

## Phase 14 re-verification — bank reconciliation, the egress truth (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-payouts` | **118/118** (+§15: debit+UTR confirms a PAID batch with no state change; credit+UTR → REVERSED with the vendor payable restored by the exact drained journal line, bank made whole, line back in the eligible pool, `payout_reversed` chained; unknown lines queued (never guessed); white-box PROCESSING batch settled on the bank's word; idempotent re-ingest (no dupes, no double-reversal); restore-scarred chain rebuilt clean; statement lines immutable) |
| `smoke:all` (22 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **93/93** (+§14: summary shape, unknown lines queued with nothing guessed, queue shows both, RBAC 403s) |
| Admin browser UI | **43/43** (A44: statement line with an unknown UTR lands in the persistent queue with its signed amount — nothing guessed; console-err=1 = the intentional A43 409, A36's convention) |

Also fixed this phase: `otpLogPath`/`resolveLogFile` (e2e-live + ui-harness) now
pick the **live API process's log by mtime** — a stale `/tmp/fm-ci/api.out.log`
left by a previous CI-style run was shadowing the serving process's log and
silently breaking OTP discovery after any API restart.

CI counts synced in `.github/workflows/ci.yml`: live 93 checks, admin browser 43.

## Phase 15 re-verification — clawback settlement (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-payouts` | **142/142** (+§16: paid order → full refund debits the vendor payable by the exact drained share; negative-only cycle nets zero with the debt as negative carry-forward; zero-net batch refused at submit (`PAYOUT_NOTHING_TO_PAY`); cancel of the carry batch CONSUMES its lines (no double-charge) and keeps the carry; the next cycle opens with the debt and pays exactly the reduced net — bank and vendor payable match hand-computed paise, each line settled once; carry-forward disabled → `PAYOUT_NEGATIVE_BALANCE`; unpaid-line refund just reverses; FAILED batch releases its lines (leak fixed); trial balanced throughout) |
| `smoke:all` (22 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **93/93** (fixed this phase: §4 product pick used a nonexistent `product.type` — now `isPerishable === false`; §14 statement ref/UTRs made run-unique so idempotent re-ingest can't false-fail on a ref collision) |
| Admin browser UI | **44/44** (A45: sweep → compute via the UI; a DRAFT batch — new or left by an interrupted run — is opened by row, cancelled with a reason, and its lines released; empty state is honestly reported when nothing is payable) |

Two real bugs found and fixed by the hermetic layer: a carried debt was
**never cleared from the old batch**, so the next cycle would absorb the same
debt twice; and `markFailed` never released its lines (they stayed pinned to
the failed batch, contradicting the docstring and the retry-by-next-cycle
design). `cancel`'s line release is now sign/carry-aware (see API.md Phase 15).

CI counts synced in `.github/workflows/ci.yml`: live 93 checks, admin browser 44.

## Phase 16 re-verification — wallet ledger integrity (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-wallet` (NEW) | **57/57** — invariant holds after each movement type (topup, second user, wallet sale, wallet refund, goodwill); goodwill DRs the new `wallet_goodwill_expense` account; white-box drift → exact paise detected → signed backfill → balanced → no-op second repair; journal deletion → `findDrift` → `replay` restores the exact paise from the `WalletTransaction`; backfill replay refused with `WALLET_BACKFILL_NOT_REPLAYABLE` (never guesses); trial balance + audit chain hold with wallet journals mixed in |
| `smoke:all` (23 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **99/99** (+§15: top-up ₹300 accepted; balance = before + 300; reconcile balanced with the journal posted; integrity `checks.wallet.ok`; 403s for customer on both admin endpoints; no-op repair posts nothing) |
| Admin browser UI | **44/44** (A38 now requires the **Wallet ledger** row: "all 8 subsystems reported") |

The live tenant carried **₹2,000** of pre-Phase-16 top-up drift into this
phase — the first reconcile measured it to the paise and the repair posted
one `wallet_backfill` journal (now visible in the journal list + audit
store), after which every layer agreed the books were balanced.

CI counts synced in `.github/workflows/ci.yml`: live 99 checks, admin browser 44.
## Phase 17 re-verification — vendor ledger integrity (2026-09-07)

| Layer | Result |
|---|---|
| `smoke-vendors` (NEW) | **90/90** — `vendor_payable:{vendor}` treated as a real ledger account: invariant `books == Σ line views + Σ adjustments + Σ carry + Σ openings` holds after every lifecycle step (accrue, refund-before-batch, clawback to the paise, cancel/fail/reverse of a carrying batch re-parks the debt, next cycle absorbs it and pays the reduced net); dual-face carry (cash face for the bank + book face for the journal) survives absorption without double-count; adjustments post at creation and drain at pay time; white-box drift → exact paise detected → signed non-replayable backfill (DR clearing / CR vendor payable when under-stated, reversed when over) → balanced → no-op second repair; deleting the backfill journal → `findDrift` flags it → replay refused with `VENDOR_BACKFILL_NOT_REPLAYABLE` (never guesses) → manual signed re-post restores balance; trial balance + audit chain hold with vendor journals mixed in |
| `smoke-payouts` | **143/143** (absorption fix re-verified: a carried batch's lines are CONSUMED at absorption, so the debt is counted exactly once — in the new batch's opening — and the books stay balanced) |
| `smoke:all` (24 suites, invariants 8/8) | ALL GREEN |
| `e2e-live.mjs` | **104/104** (+§16: platform vendor reconcile `ok` with per-vendor detail; integrity `checks.vendors.ok`; 403s for customer on both admin endpoints; no-op repair posts nothing; per-vendor scoped reconcile balanced) |
| Admin browser UI | **44/44** (A38 now requires the **Vendor payable** row: "all 9 subsystems reported") |

The live stack came in **clean**: 0 zero-face legacy carry batches (the one
from the Phase 15 run had already been absorbed), so the one-off
`scripts/seed-vendor-carry-views.mjs` migration (recovers `carryLedgerViewPaise`
from a carry batch's consumed lines for pre-Phase-17 data) found nothing to do
and the first live reconcile balanced to the paise with no repair.

CI counts synced in `.github/workflows/ci.yml`: live 104 checks, admin browser 44.
