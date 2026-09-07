# Payment Layer — architecture (Phase 7)

The money path of the platform: gateway abstraction, the async
capture-then-notify flow, webhook trust, idempotency, amount verification,
audit, and reconciliation — with the gateway as the **source of truth**.

Implemented + verified live on 2026-09-06.

## The shape of the problem

A real gateway (Razorpay) moves money **client-side**:

```
checkout → create gateway order → customer pays ON THE GATEWAY'S PAGE
         → gateway captures → gateway NOTIFIES us via webhook
```

Between "money moved" and "we know about it" there is a network hop that can
lose, duplicate, or delay the notification. A payment system must therefore
answer three questions with discipline:

1. **Is this notification genuine?** — cryptographic signature over the RAW
   body (HMAC-SHA256, constant-time compare).
2. **Have we seen this event before?** — gateways retry for days. The same
   `eventId` may arrive N times.
3. **What if the notification never arrives?** — poll the gateway (source of
   truth) before failing anything; recover what the gateway attests it
   captured; fail only what the gateway attests it did not.

Everything below is built around those three questions.

## Provider abstraction

`src/services/paymentProvider.service.js` — the rest of the codebase calls
`charge()` / `refund()` / `fetchPaymentStatus()` / `fetchRefundStatus()` /
`verifyWebhook()` and never learns which provider is configured.

| Provider | When | `charge()` | Webhook signature |
|---|---|---|---|
| `mock` (default) | no Razorpay keys in env | synchronous success; amounts ending in paise `13` decline (deterministic failure hook). With `MOCK_PAYMENT_PENDING=true` **or** the dev-only runtime toggle `POST /fulfillment/payments/mock/force-pending` (400 outside development) it returns `pending` + `gatewayOrderId` — the full async flow without real keys | `x-mock-signature`, HMAC-SHA256 of the raw body with `MOCK_PAYMENT_WEBHOOK_SECRET` — **identical algorithm** to Razorpay's |
| `razorpay` | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set | creates a gateway order (`payment_capture=1`), returns `pending` + client secret | `x-razorpay-signature`, HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET` |

Both webhook routes are mounted with `express.raw` **before** `express.json`
in `src/app.js` — the signature is computed over exact bytes, so the body must
never be re-serialized.

### Mock gateway semantics (important)

The mock keeps an in-process `Map` (`mockGateway`) as a stand-in for the
**gateway's** system of record, keyed by `gatewayOrderId`:
`{ captured, gatewayPaymentId, amountPaise }`. In async mode the map entry is
written when the mock gateway *notifies* (capture-on-notify model — the mock
has no separate "customer completes payment" actuator; the webhook is that
actuator). Consequences:

- **Hermetic tests** can simulate "gateway captured, webhook lost" directly
  via `paymentProvider.mockGatewaySet(...)` and watch reconciliation recover
  it. That is the only reachable way to model that state, and it is the
  design reason `mockGatewaySet` exists.
- **Cross-process** (separate worker) the worker's own mock map is empty — so
  a worker-side reconcile of a stale mock payment correctly sees
  "gateway has no capture" and fails + cancels. With the **real** provider
  the gateway is a real remote system and this limitation does not exist.

## The webhook pipeline (`paymentService.applyWebhookEvent`)

Single funnel for **both** providers (`POST /api/v1/payments/webhook/razorpay`
and `.../mock`). Steps, in order:

1. **Signature** (`paymentProvider.verifyWebhook`) — HMAC-SHA256 over the raw
   body, constant-time compare. Failure → `401 WEBHOOK_SIGNATURE_INVALID`,
   nothing else happens (no state change, no audit row, no metrics increment
   beyond the attempt).
2. **Event-level idempotency** — `PaymentWebhookEvent`
   (`paymentwebhookevents`) with a **unique `{provider, eventId}` index**.
   First arrival wins via `findOneAndUpdate` upsert (`$setOnInsert` →
   `status: 'received'`); any E11000 or pre-existing non-`received` row →
   result `duplicate`, state machine not re-entered.
3. **Resolve our Payment** — `gatewayPaymentId` first, then
   `gatewayOrderId`. Unknown → result `ignored` (razorpay path 200-acks per
   Razorpay's contract; mock path 400s so dev miswiring is loud).
4. **Amount + currency verification** — on capture events, if the webhook
   carries `amountPaise` it must equal `round(payment.amount * 100)`; mismatch
   → result `mismatch`: **payment left PENDING, untouched**, and the event row
   records the evidence (both amounts in the note) for operator review. A
   webhook without an amount skips the check (lenient, like the real
   provider's minimal payloads).
5. **State machine** — success: `confirmSuccess` (payment → `success`,
   `paidAt`, `gatewayPaymentId` stamped) → order saga finalises
   `PAYMENT_PENDING → CONFIRMED` (inventory commit, slot consume). Failure
   event: payment → `failed`, order cancelled with full compensation
   (slot released, inventory de-committed).
6. **Audit** — the event row is the "who moved the money and why" log:
   `status ∈ received|processed|duplicate|mismatch|ignored`, `note`,
   `raw` payload (TTL 30 days via `expiresAt`), `tenantId`, `paymentId`,
   `orderId`.

### Audit row: first-writer-wins disposition

The terminal status is written **only by the first delivery**, guarded on
`status: 'received'` so even a race can't clobber it. Replays are bookkept
separately (`deliveries` counter + `lastSeenAt`) so ops can see a gateway
retrying without the audit verdict changing. (Caught live: a replay was
overwriting `processed` with `duplicate` — bug #14, now regression-tested in
`smoke-payments` §4 and `live-payments-proof` §D.)

### Ack policy

The endpoint **always 200-acks** a verified event (even `mismatch`/
`ignored`) — the gateway must not retry-storm an event we deliberately did
not act on. Only 401 (bad signature) and 400 (mock path, unknown refs) go
non-2xx.

## Reconciliation — the gateway is the source of truth

`paymentService.reconcilePending({ olderThanMinutes, limit })` and
`refundService.reconcileRefunds(...)`:

- Select **stale** PENDING payments (older than `PAYMENT_PENDING_STALE_MINUTES`,
  default 15) / PENDING refunds.
- **Wallet payments first**: they never wait on a gateway — a stale pending
  wallet payment is a half-finished synchronous debit (crash mid-transaction).
  Re-run the idempotent-by-ref debit: if a `WalletTransaction` exists the
  payment heals to `success`; otherwise the debit is safely attempted (never
  twice); only failure → `failed`.
- **Gateway payments**: `fetchPaymentStatus` (the gateway's record).
  - `captured` → **webhook was lost — recover**: `confirmSuccess` with
    `raw.reconciled: true, source: 'gateway-poll'`.
  - `failed`/absent → payment `failed` + order cancelled (compensation).
  - transient gateway error → **leave pending** for the next sweep (never
    fail on a network blip).
- Refunds: `fetchRefundStatus` → `success`/`failed` finalisation; the
  wallet-refund path is already synchronous and idempotent.

Two execution contexts, same code:

| Path | Trigger | Notes |
|---|---|---|
| Manual ops | `POST /fulfillment/reconcile/payments` (admin) | immediate sweep, result `{failed[], cancelled[], ...}` in the response |
| Scheduled worker job | `payment-reconcile`, every `PAYMENT_RECONCILE_EVERY_MS` (5 min) | built-in job in `src/workers/scheduler.js` — single-flight across workers via atomic `nextRunAt` claim; `lastResult` (scanned/failed/cancelled/refunds) inspectable in `scheduledjobs` |

## Customer visibility

`GET /api/v1/orders/:id/payment` (owner or admin) — safe subset of the
payment (status, method, gateway refs, timestamps — **never** tokens or
raw gateway payloads) + the order's status. This is what the storefront
"payment pending" state polls.

## Metrics (Prometheus, `fm_*`)

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `fm_webhook_events_total` | counter | `provider`, `result` (processed/duplicate/mismatch/ignored) | every verified webhook event by disposition |
| `fm_payment_reconcile_runs_total` | counter | `result` (ok/error) | reconcile sweeps (manual + worker) |
| `fm_payment_pending_count` | gauge | `provider` | payments stuck PENDING right now |
| `fm_payment_pending_age_seconds` | gauge | `provider` | age of the oldest stuck payment — **this is the alert** |
| `fm_refund_pending_count` | gauge | — | refunds awaiting gateway confirmation |

Plus the existing worker/ops set (heartbeats, outbox lag, DLQ depth).

## Configuration

| Env | Default | Effect |
|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | empty | non-empty → real async Razorpay flow |
| `RAZORPAY_WEBHOOK_SECRET` | empty | verifies `x-razorpay-signature` (required in prod) |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | `mock-webhook-secret-dev` | mock webhook HMAC secret |
| `MOCK_PAYMENT_PENDING` | `false` | `true` → mock behaves like the async gateway (checkout returns pending; webhook/reconcile confirms) — dev/demo of the full async flow. The same mode can be flipped at runtime with the dev-only endpoint `POST /fulfillment/payments/mock/force-pending` (ADMIN, 400 outside development) — used by the e2e suites to drive the awaiting-payment UI |
| `PAYMENT_RECONCILE_EVERY_MS` | `300000` | worker reconcile cadence |
| `PAYMENT_PENDING_STALE_MINUTES` | `15` | staleness gate for reconciliation |

All of the above are documented in `backend/.env.example` (the invariants
suite enforces that no env var read in code is missing from it).

## State machine (summary)

```
                    charge pending (async)                webhook: captured
checkout ────────────────────────────────► PAYMENT_PENDING ──────────────┐
                                   │                                     │
                                   │ webhook: failed  /  gateway says    │ gateway-poll:
                                   │ nothing captured (stale sweep)      │ captured (lost
                                   ▼                                     ▼
                              FAILED ──► order CANCELLED (compensated)  CONFIRMED (order CONFIRMED)

mismatch: webhook amount ≠ recorded amount → payment STAYS PENDING,
event row = audit evidence. Stale sweep later resolves it against the
gateway's attestation, exactly like any other pending payment.
```

## Verification matrix (2026-09-06)

| Layer | Evidence |
|---|---|
| Hermetic (in-memory mongod + in-process app) | `scripts/smoke-payments.test.js` — **13/13**: sync regression; async checkout → `payment_pending`; customer endpoint (owner sees pending, stranger 404); bad signature 401 with zero side effects; amount mismatch → untouched + audit; signed webhook → processed → confirmed; **duplicate replay → single row, disposition preserved**; unknown refs (razorpay 200-ack / mock 400); **webhook lost → gateway-poll recovery**; gateway silent → failed + cancelled; Razorpay HMAC unit vectors (valid/tampered/missing, constant-time); **refund reconciliation**; `/metrics` assertions |
| Live stack (real mongod + API + worker + browser) | `scripts/live-payments-proof.mjs` — **28/28** against the running services with `MOCK_PAYMENT_PENDING=true`: async checkout, signature enforcement, **worker-safe reconcile (gateway silent → never confirmed without attestation)**, signed pipeline + dedupe + mismatch, metrics, worker job registration |
| Live stack (API-level async proof) | `scripts/async-payment-live.test.mjs` — **14/14**: dev toggle on → pending checkout (`paymentPending` + `gatewayOrderId`) → `GET /orders/:id/payment` polls pending → signed webhook (tampered sig rejected) → order confirmed + `paidAt` → toggle off |
| Browser UI (async customer journey) | `frontend/e2e/ui-async-payment.e2e.mjs` — **7/7**: pending state renders "Complete your payment" + "Awaiting payment"; signed webhook capture; the page's 5s poll flips it to Confirmed with no manual refresh |
| Browser UI (admin ops view) | `ui-admin.e2e.mjs` A37 — live async payment seeded via API+webhook appears in the Payments table (searchable by order id), the Webhook audit shows `payment.captured` / Processed, the payment drawer shows gateway refs + webhook events, reconcile sweep runs clean |
| Scheduled job live | `scheduledjobs.payment-reconcile` — `lastStatus: ok`, `lastResult {paymentsScanned:4, paymentsFailed:4, paymentsCancelled:4}` after the async demo run's stale pendings went past the 15-min window |
| Full regression | `npm run smoke:all` (16 suites, includes payments) + `e2e-live` 67/67 + `async-payment-live` 14/14 + storefront UI 29/29 + async-payment UI 7/7 + admin UI 37/37 — all green |

## Known boundaries (deliberate)

- **Mock gateway is per-process.** Cross-process recovery of the
  "captured-but-webhook-lost" state is hermetic-only (by design of the mock;
  see above). The real provider has no such boundary.
- **Payouts** (`payouts` + their webhook) are a separate but parallel layer
  (Phase 6.3) — same raw-body/HMAC discipline, own reconciliation.
- Amount verification trusts the gateway's `amountPaise` when present; a
  `mismatch` is an operator case by design, never an auto-reject of money.

## Files

| File | Role |
|---|---|
| `backend/src/services/paymentProvider.service.js` | provider abstraction (mock + razorpay), signature verify/sign, mock gateway map, gateway status polling |
| `backend/src/services/payment.service.js` | `applyWebhookEvent` (the pipeline), `reconcilePending`, confirm/fail state machine |
| `backend/src/services/refund.service.js` | `reconcileRefunds` + existing refund flow |
| `backend/src/controllers/payment.controller.js` | both webhook routes → pipeline; raw-body + signature contract |
| `backend/src/models/paymentWebhookEvent.model.js` | event idempotency + audit (unique `{provider,eventId}`, TTL) |
| `backend/src/workers/scheduler.js` | interval-job support (`everyMs`) + built-in `payment-reconcile` job |
| `backend/src/services/order.service.js` | `paymentStatus` (customer endpoint, getOrder-scoped, safe fields) |
| `backend/src/observability/registry.js` | payment metrics + dynamic gauges |
| `backend/scripts/smoke-payments.test.js` | hermetic suite (13 sections) |
| `backend/scripts/live-payments-proof.mjs` | live-stack proof (28 checks) |
