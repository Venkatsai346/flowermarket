# Money Audit Backbone — architecture (Phase 10, "Follow the Money")

The ledger (Phase 6.1) proves the numbers balance. It cannot answer the two
questions an auditor actually asks:

1. **What happened, in what order, for *this* rupee?** — a sale journal is a
   derived view; nothing tells you *which* order, payment, refund and payout
   produced it, or which HTTP request carried it.
2. **Is the system consistent *right now*?** — a crash between "the money fact
   happened" and "the journal was committed" would be *silently invisible* to
   the ledger alone: the trial balance still balances, because the missing
   posting was missing on both sides.

Phase 10 closes that gap with three pieces: an **append-only domain event
store** (the system of record for money facts), a **request trace id** that
stamps every money object, and a **system integrity report** with a
self-healing **replay**. All of it is additive — the green money path is
untouched, the audit layer never throws into it, and no env var was added.

Implemented + verified live on 2026-09-07.

## The shape of the problem

The order-confirm money path is a sequence of independent writes:

```
event append (Phase 10) → charge payment → post sale journal → (later) refund journals → payout journals
```

Each step already had idempotency (the journal's unique `idempotencyKey`,
the payment's provider key), but the *facts* only existed **inside the
derived artifacts**. Two consequences:

- **Crash window is undetectable.** Process dies after the charge, before the
  journal commit → the journal never exists. Nothing references the missing
  posting; the trial balance is trivially balanced (both sides missing).
- **No follow-the-money path.** To reconstruct one order's money life you had
  to join five collections on four different id shapes and guess the order.

The fix is to record the money facts **at the moment they happen**, in a
store whose whole contract is *append-only, idempotent, never throws* — and
to tag every artifact of one order with one shared `traceId`.

## The domain event store

`src/models/domainEvent.model.js` → collection `domainevents`.

| Field | Contract |
|---|---|
| `idempotencyKey` | **the same key as the journal it mirrors** (`sale_captured:order:{id}`, `refund_issued:refund:{id}`, `payout_initiated:payout_batch:{id}`, …). Unique **sparse** index — exactly-once, and the join key for coverage checks |
| `kind` | `sale_captured` · `refund_issued` · `payout_initiated` · `payout_reversed` · `payment_confirmed` · `payment_failed` · `order_cancelled` |
| `aggregateType/aggregateId/refType/refId` | what happened to what; `refId` links a refund to its **order** |
| `traceId` | the request trace (below) |
| `payload` | Mixed — the minimal facts (amounts in **paise**, destination, reason) |
| `occurredAt` | wall-clock of the fact, for time-ordered chains |

`src/services/domainEvent.service.js`:

- **`append()` is never-throwing.** The audit layer's cardinal rule: an audit
  failure must never take down a sale. Every call site goes through
  `safePost`-style `.catch()` — if the append fails, the money path completes
  and the integrity report later flags the orphan *journal* (the reverse
  direction), which the replay restores.
- **`replay()`** — the only write path. Two directions, both idempotent:
  1. **missing journal** (event without journal — the crash window): re-derive
     the posting from the event's facts via the existing
     `ledgerPosting.service` (which is itself idempotent on the unique
     `idempotencyKey`, so a partial re-run cannot double-post).
  2. **missing event** (journal without audit row — pre-Phase-10 data, or a
     posting that bypassed the backbone): re-fetch the **full** journal by
     `idempotencyKey` and restore the row from it, so the restored event is
     faithful, not inferred.
- **`findDrift()`** — the bidirectional coverage scan (events ↔ journals,
  joined on `idempotencyKey`), with bounded samples for the report.

### Why the event goes *before* the journal

Appending at the fact — before the journal commit — is the entire crash
safety design. If the journal went first, a crash between the two writes
would leave *no record at all* (the exact invisibility we are removing).
With the event first, every reachable crash state is **detectable**:

| Crash point | State | Detection |
|---|---|---|
| before event append | nothing | nothing to detect — the sale didn't happen |
| after event, before journal | event w/o journal | `findDrift` → `missingJournals` |
| after journal, before event (legacy/bypass) | journal w/o event | `findDrift` → `missingEvents` |
| after both | complete | — |

## The trace id

`src/middleware/traceId.js` runs **first** in `src/app.js`: it adopts a
validated inbound `x-trace-id` (regex-guarded; anything else is minted as
`tr_{16 hex}`) and echoes it in the response header. Morgan logs carry the
`:trace` token, so the access log and the money objects agree on one id.

Stamping follows the **money, not the request**:

- `Order` ← `req.traceId` at checkout (one checkout request = one order trace).
- `Payment` ← the order's trace (the charge is part of that order's life).
- `LedgerJournal` ← passed through `ledgerPosting.service` (sale/refund/payout postings).
- `RefundTransaction` ← the **order's** trace — a refund issued by a
  cancellation request keeps the order's trace, so the whole money life stays
  on one chain.
- `PayoutBatch` ← `req.traceId` at batch creation; its journals inherit it.
- Webhook audit rows ← the **payment's** trace (a webhook is evidence about
  an existing payment, not a new trace).

`GET /admin/traces/:traceId` (admin, tenant-scoped) assembles the chain:
order facts, status history, payments, webhook audit rows, journals, payout
state transitions and domain events — time-ordered, each row labelled by
source collection. 404 `TRACE_NOT_FOUND` when the id resolves to nothing.

## The integrity report

`src/services/integrity.service.js#report({ tenantId })` — **read-only**, one
structured answer across every subsystem that holds state:

| Check | Question | Drift signal |
|---|---|---|
| `ledger` | trial balances? materialized balances match entries? every audit event has its journal and vice-versa? | unbalanced trial, `verifyBalances` drift, `missingJournals`/`missingEvents` |
| `searchIndex` | is the ranked index complete? | `freshnessCheck` missing/orphans |
| `slots` | is any slot reserved beyond its effective capacity? | `reservedCapacity > (manualCapacity ∨ totalCapacity)` |
| `payments` | webhook audit trail sane? | **mismatch** events (the fraud signal; duplicates are expected) |
| `payouts` | every submitted/disbursed batch has its journal? | missing `payout_initiated`/`payout_reversed` journal |
| `events` | the store's own shape | informational (it is the reference — always `ok`) |
| `notifications` | is the outbox stuck? | `pending ≥ 1000` |

`overall` is `ok` iff no check is `false`. The report is served at:

- `GET /ledger/integrity` + `POST /ledger/integrity/replay` — **SUPER_ADMIN**
  (platform-wide or tenant-scoped via `?tenantId=`).
- `GET /admin/integrity` — ADMIN, always tenant-scoped.

The admin console's **Platform → Ledger** page renders all seven checks with
a **Replay** action that is enabled exactly when there is something to
replay, and the order drawer shows the **Follow the money** timeline for any
order that carries a trace.

## Self-healing: the nightly pass

`src/services/maintenance.service.js` step 10 (per tenant): run the report;
if `checks.ledger.ok === false` → `replay(limit 200)` +
`verifyBalances({ repair: true })`. A crash window opened on a Wednesday is
healed by Thursday 2 AM without a human, and the run log carries the
integrity summary. The manual endpoints are the same code path.

## Verification matrix (2026-09-07)

| Layer | Suite | Proof |
|---|---|---|
| Hermetic | `scripts/smoke-audit.test.js` (15 checks, in-memory mongod, real HTTP app) | trace echo + stamping; exactly-once append; **crash window**: journal deleted → drift flagged → replay re-posts the identical journal → trial + balances + coverage green; orphan journal → event restored; refund+cancel chain on one trace; time-ordered chain; RBAC |
| Invariants | `scripts/invariants.test.js` (8) | new routes + shared-client calls resolve; RBAC guards intact |
| Live API | `scripts/e2e-live.mjs` §11 (73 total) | `x-trace-id` echo, order traceId, full chain incl. refund+cancel, platform integrity `ok` with 100% coverage, tenant report, 403s for non-super-admin |
| Live browser | `frontend/e2e/ui-admin.e2e.mjs` A38/A39 (39 total) | integrity card green on the live stack; order drawer "Follow the money" timeline (order → payment → journal → audit events) |
| Live repair | manual, real stack | pre-Phase-10 history: **37 orphan journals** (24 sale + 13 refund) flagged by the report, restored by one `replay()` call → coverage 0/0, trial balanced, balances 4/4 |

Full pyramid at ship: smoke:all 18 suites green · e2e-live 73/73 ·
async-flow-live 14/14 · storefront UI 29/29 · async-pay UI 7/7 · admin UI
39/39 (console-err=0) · both Vite builds pass.

## Known boundaries (deliberate)

- The event store is the reference for *journal-mirroring* events; it does
  not attempt to record every business transition (status changes are still
  in `orderStatusHistory` — the trace view reads them from there).
- `replay()` is bounded (`limit`, default 200) and idempotent — a large
  backlog heals across nightly passes rather than in one spike.
- Trace ids are minted per request; a webhook that arrives *without* the
  original request context still lands on the payment's trace (the join is
  via `gatewayOrderId`), so webhooks never start a dangling trace.
- The slot check runs platform-wide (a slot is never tenant-crossing, but the
  report doesn't scope it) — fine for the current single-hub-per-tenant shape.

## Files

| File | Role |
|---|---|
| `backend/src/models/domainEvent.model.js` | the store (unique sparse `idempotencyKey`) |
| `backend/src/services/domainEvent.service.js` | append / forTrace / stats / findDrift / replay |
| `backend/src/middleware/traceId.js` | adopt-or-mint + response echo |
| `backend/src/services/integrity.service.js` | report (read-only) + replay |
| `backend/src/services/maintenance.service.js` | nightly step 10 (report → conditional replay + balance repair) |
| `backend/src/controllers/trace.controller.js` | chain assembler for the trace view |
| `backend/src/controllers/ledger.controller.js` | `integrity` + `replay` handlers |
| `backend/src/controllers/admin.controller.js` | tenant-scoped `integrity` |
| `backend/src/routes/ledger.routes.js` | `GET /ledger/integrity`, `POST /ledger/integrity/replay` (SUPER_ADMIN) |
| `backend/src/routes/admin.routes.js` | `GET /admin/integrity`, `GET /admin/traces/:traceId` (ADMIN) |
| `frontend/apps/web/src/features/platform/LedgerPage.jsx` | integrity card + replay action |
| `frontend/apps/web/src/features/orders/OrdersPage.jsx` | "Follow the money" timeline |
| `frontend/packages/shared/src/api/endpoints.js` | `ledger.integrity/replay`, `admin.integrity/trace` |
| `backend/scripts/smoke-audit.test.js` | the hermetic proof |
