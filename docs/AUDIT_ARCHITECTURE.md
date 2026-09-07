# Money Audit Backbone — architecture (Phase 10 "Follow the Money", Phase 11 "Tamper-evident, closeable ledger")

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

# Part 2 — Phase 11: hash-chained event log + fiscal period close

Phase 10 made money **auditable** (every journal has its event, every event has
its journal). Phase 11 makes the audit trail itself **trustworthy**: a
per-tenant hash chain over the domain event store (tamper-evidence for edits,
deletions and tail losses) and **fiscal period close** (a month's books can be
frozen, reported from the ledger, and deliberately reopened).

## The hash chain protocol

Every stored event carries `{ seq, prevHash, hash }`. The hash is

```
hash     = sha256(`${prevHash}|${content}`)
content  = tenantId|seq|kind|aggregateType|aggregateId|refType|refId
         | idempotencyKey|occurredAtISO|traceId|canonicalJson(payload)
```

with a genesis `prevHash` of `'0' × 64`. The chain's current tail lives in a
separate collection, `auditchains` (`{ tenantId unique, tailSeq, tailHash }`)
— the **anchor**. Appending is a compare-and-swap on the anchor:

1. read the anchor → `seq = tailSeq + 1`, compute the hash;
2. insert the event (unique sparse index on `{tenantId, seq}` guards against
   double-linking the same slot);
3. CAS the anchor to the new tail. On CAS loss, re-read and retry (5 tries).

Failure modes are deliberately non-fatal to the business:

- **duplicate append** (same idempotency key, same content) → the 11000 on
  the `{tenantId, seq}` index means "already linked" — the anchor CAS is
  rolled back and the original row wins. Idempotent, gap-free.
- **CAS exhausted / insert error** (two writers racing for the same slot and
  both losing) → the row is stored with `seq: null` — **unanchored**. The
  event is never lost and the caller never sees an error; the integrity
  report counts unanchored rows and the nightly pass re-anchors them.

## What the verifier detects — five break types

`verifyChains` walks the tenant's stored seqs in order, re-hashes every row
and cross-checks neighbours **and** the anchor (that is why the anchor lives
in a *different* collection: deleting the whole event collection leaves the
anchor pointing at a tail that no longer exists):

| Break type | What it catches |
|---|---|
| `hash_mismatch` | **content edited in place** (payload, kind, aggregate id, timestamps…) |
| `broken_front` | the first stored row is not a genesis successor of what came before it (prefix erased) |
| `broken_link` | a middle row was **deleted** (its successor's `prevHash` no longer links) |
| `tail_missing` | the anchored tail row is gone (whole chain or tail lost) |
| `tail_mismatch` | the chain's real tail ≠ the anchor (tail rows deleted, or a concurrent unanchored race) |

The integrity report carries `checks.auditChain: { eventsVerified, unanchored,
breaks[], ok }`, and the admin console's integrity card renders the breaks by
name. The nightly pass also counts `chainBreaks`/`chainUnanchored` into its
summary.

## Repair policy — the deliberate heart of the phase

**A break is never auto-healed.** This is the security boundary:

- **Replay restores content, not the chain.** When `replay()` restores an
  orphan (an event whose row was deleted), it appends a *new* event — which
  takes a *new* chain slot. The old, deleted slot stays a visible
  `broken_link`. That scar is correct: the row-set changed, and the chain is
  now *showing* it. Auto-healing it would make tampering invisible.
- **The nightly anchors unanchored rows only** (crashed-append backfill) and
  never rebuilds.
- **The only re-link is a deliberate, manual, audited act**: `rebuildChain`
  (SUPER_ADMIN, `POST /ledger/integrity/rebuild-chain`) re-hashes the whole
  chain in seq order (seqs preserved), resets the anchor, and **appends a
  `chain_rebuilt` fact event** recording the re-link and the new tail. A
  rebuilt chain is therefore distinguishable from a tampered chain by
  construction — every heal leaves its own receipt *on* the chain.

The operational story for a real incident: verifier names the seq and the
kind of break → an operator restores the correct rows from the source system
→ if the row-set changed, they run `rebuild-chain` on purpose → the
`chain_rebuilt` event marks the moment and the operator who did it.

## Fiscal period close

`fiscalperiods` — `{ tenantId + periodKey ('YYYY-MM') unique, start, end,
state open|closed, closedAt/By, reopenedAt/By }`, UTC month bounds.

- **Close** (SUPER_ADMIN `POST /ledger/periods/:periodKey/close`) is allowed
  mid-month: it is an operator freeze. The `post()` guard then rejects any
  **new** journal whose `occurredAt` falls inside a closed period with
  **409 `PERIOD_CLOSED`** — but idempotent re-posts (replay of an event that
  was already journaled) pass, so the nightly/replay self-healing keeps
  working across a closed boundary.
- **Reopen** (SUPER_ADMIN `…/reopen`) is the only way back; it unblocks
  posting. Close and reopen each append their own **chained** domain event
  (`period_closed` / `period_reopened`), so the freeze itself is
  tamper-evident — deleting a close leaves the chain broken.
- **Period report** (`GET /ledger/periods/:periodKey`) is derived *from the
  journal*: journals with `occurredAt` in the month window → gross captured,
  refunds, net, payouts out, per-kind rollup and `periodBalanced` (the
  period's own trial balance). The report reads the ledger — it cannot be
  made to disagree with it.
- **Mid-month trade-off (documented, deliberate):** sales that *happen*
  while the month is closed cannot be posted until reopen; when they are,
  their `occurredAt` is the reopen-side moment, so the amount lands in that
  month's report window. Live sales against a closed period are drift until
  the books reopen — exactly the pressure the integrity report exists to
  make visible.

## Verification matrix (2026-09-07, Phase 11)

| Layer | Suite | Proof |
|---|---|---|
| Hermetic | `scripts/smoke-audit.test.js` §10–11 (25 total) | crashed-append backfill (exactly 1 anchored); duplicate append gapless; **content tamper → `hash_mismatch` at the victim seq**, cleared on restore; **tail deletion → `tail_mismatch`**, cleared; **middle deletion → `broken_link` at the successor**, cleared; orphan-restore scar → `rebuildChain` → clean + `chain_rebuilt` fact; integrity carries `auditChain`; close → new post 409 `PERIOD_CLOSED` → report (balanced) → chained close/reopen events → reopen unblocks → coverage still clean |
| Live API | `scripts/e2e-live.mjs` §11 (79 total) | `replay-chain` anchored the pre-chain history (79 rows), verifier green (0 breaks, 0 unanchored), close → closed+balanced report → reopen → tenant-scoped period list |
| Live browser | `frontend/e2e/ui-admin.e2e.mjs` A38/A40 (40 total) | integrity card with the **Audit chain (tamper-evidence)** row; **Fiscal periods** card: close month via UI → report rendered from the journal (balanced) → reopen |

Full pyramid at ship: smoke:all 18 suites green (audit 25/25, invariants
8/8) · e2e-live 79/79 · async-flow-live 14/14 · storefront UI 29/29 ·
async-pay UI 7/7 · admin UI 40/40 (console-err=0) · both Vite builds pass.

## Known boundaries (deliberate)

- A rare triple race (two writers competing for one seq and both CAS-losing
  in the same tick) can leave a `broken_link` even though no row was lost.
  It is *detectable* by the verifier and *resolvable* by a human via
  `rebuild-chain` — we chose a visible scar over a silent heal.
- `rebuildChain` preserves seqs but changes every hash from the re-link
  point; the `chain_rebuilt` fact is the receipt. Consumers that pinned an
  old tail hash must re-verify — that is the point.
- Period close is per-tenant and calendar-month only (no custom fiscal
  calendars); `periodKey` is strictly `YYYY-MM`.
- The chain is verified by full re-hash of stored rows — fine at the current
  volume (hundreds to thousands of events per tenant) and the nightly runs
  it anyway; a Merkle summary is the obvious scale-up if the store outgrows
  it.

## Verification matrix (2026-09-07, Phase 10)

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
| `backend/src/models/auditChain.model.js` | (P11) per-tenant chain tail anchor (`auditchains`) |
| `backend/src/models/fiscalPeriod.model.js` | (P11) `fiscalperiods` (open/closed per `YYYY-MM`) |
| `backend/src/models/domainEvent.model.js` | (P11) + `seq`/`prevHash`/`hash` + unique sparse `{tenantId, seq}` |
| `backend/src/services/domainEvent.service.js` | (P11) + chain protocol: `appendEvent` CAS, `verifyChains`, `repairChain`, `rebuildChain` |
| `backend/src/services/period.service.js` | (P11) close / reopen / list / `periodReport` (from the journal) |
| `backend/src/controllers/period.controller.js` | (P11) period endpoints |
| `backend/src/routes/ledger.routes.js` | (P11) + `replay-chain`, `rebuild-chain`, 4× `/periods` (SUPER_ADMIN) |
| `backend/src/routes/admin.routes.js` | (P11) + `GET /admin/periods[/:periodKey]` (ADMIN) |
| `backend/src/services/ledger.service.js` | (P11) `post()` `PERIOD_CLOSED` guard (new journals only) |
| `backend/src/services/maintenance.service.js` | (P11) + chain summary in nightly + step 11 (anchor unanchored only) |
| `frontend/apps/web/src/features/platform/LedgerPage.jsx` | (P11) audit-chain row + **Fiscal periods** card (close/report/reopen) |

# Part 3 — Phase 12: the cash gate (PSP settlement as a chained money event)

Phase 10/11 chained the events that *prove* money moved. Phase 12 chains the
last missing one: **PSP settlement** — the moment the gateway's clearing
balance actually reaches the platform's bank account. Until that event is in
the backbone, the ledger knows money was *captured* but not that it is
*ours*, and the payout "cash gate" (`policy.requirePspSettlement`) has
nothing to trust.

## What changed

- `ingestPspSettlements` is **event-first**: each settlement row appends a
  chained `psp_settled:order:{id}` domain event (payload carries
  `amountPaise`, `utr`, `reference`) *before* posting the
  `psp_settled` journal (DR `bank` / CR `gateway_clearing`). Rows for
  cancelled or unpaid orders are reported as `unmatched: {order, reason}`,
  never guessed.
- `psp_settled` is in `DOMAIN_EVENT_JOURNAL_KINDS` and in the
  `findDrift` money-kind list, so the coverage check is bidirectional for it:
  a deleted settlement **journal** is re-posted by `replay()` from the event
  (the exact paise come from the event payload); a deleted settlement
  **event** is restored from the journal. Settlement is now tamper-evident
  (it is on the chain) and replayable, exactly like a sale.
- `GET /payouts/admin/settlements` — the cash-gate summary:
  `gateway_clearing` and `bank` materialized balances, settled orders/paise,
  the paid-but-unsettled queue (count, paise, oldest samples) and the current
  `requirePspSettlement` policy.
- The admin console's **Platform → Payouts** page gains a **Settlement — the
  cash gate** card: the four numbers, the gate toggle, an ingest box
  (one order per line: `FM-YYMMDD-#####[, ₹amount][, UTR]`), the ingest
  result and the oldest-unsettled queue. The eligibility sweep toast now
  reports `blocked (cash not settled)` lines when the gate is on.

## Verification (2026-09-07)

- Hermetic `smoke-payouts` §11 (suite now 73/73): gate ON blocks an
  unsettled order, ingesting that order's settlement makes it eligible; the
  settlement event is chained and the chain verifies; crash window
  (journal+entries deleted, balance-repaired) → replay re-posts the
  settlement to the exact paise; deleted event → restored from the journal;
  summary counts correct.
- Live `e2e-live` §12 (84 total): summary shape, ingest posts exactly one,
  clearing reduced by the settled amount, summary reflects it, re-ingest
  idempotent.
- Browser `ui-admin` A41 (41 total): gate toggled through the UI, a
  settlement ingested from the card's own unsettled queue, gate restored.

## Boundary notes

- Settlement ingestion is operator-driven (the PSP pushes a report; we paste
  or post it). The amount defaults to the order total; an explicit amount in
  the row wins (that is how a partial/fee-adjusted settlement is recorded).
- The gate is per-order, not per-amount: a partially-settled order still
  unlocks the line. Over-settlement shows up as a smaller (or negative)
  `gateway_clearing` balance on the summary — visible, not silently netted.

# Part 4 — Phase 13: statutory deposits (the closing entry)

Payouts withhold TCS (GST s.52) and TDS (IT s.194-O) and credit
`tcs_payable` / `tds_payable` — money the platform holds **on behalf of the
government**. Phase 13 pays it out, closing the statutory loop:

```
payout_initiated:      DR vendor_payable / gst_output_payable
                          CR bank  +  CR tcs_payable  +  CR tds_payable
statutory_deposit:     DR tcs_payable / tds_payable
                          CR bank                     (money leaves for the govt)
statutory_deposit_reverted:  the mirror (operator correction — never deleted)
```

## Rules

- **Balance-guarded:** a deposit can never exceed the payable balance —
  `409 STATUTORY_OVER_DEPOSIT` quoting the actual amount withheld. You cannot
  pay the government money you did not withhold.
- **UTR mandatory:** the deposit-channel reference (CHAVS / 26Q ack) is
  required — a statutory payment without its reference is a compliance gap.
- **Event-first + chained:** `statutory_deposit:{id}` is appended to the
  tamper-evident chain before the journal; both deposit and revert are
  covered by the bidirectional drift check. A deleted deposit journal is
  re-posted by `replay()` from the `StatutoryDeposit` aggregate (the exact
  paise); a deleted event is restored from the journal.
- **Reverts, never deletes:** `revert` posts the mirror journal
  (`DR bank / CR {statute}_payable`), keeps the original, and stamps the
  reason on the record. The summary reports `deposited` (every posted
  deposit journal), `reverted`, `netDeposited` (cash the government kept) and
  `outstanding` (the payable balance — what is still owed).

## Verification (2026-09-07)

- Hermetic `smoke-payouts` §13 (suite 94/94): the exact carried liability
  (₹35 TCS / ₹7.90 TDS from the two paid batches, incl. the ambiguous one
  reconciliation resolved as PAID); over-deposit refused with nothing posted;
  deposit clears the payable and pays the bank out exactly; the deposit event
  is chained; revert restores the liability zero-net on the bank with its
  reason on the trail (double-revert refused); crash-window replay re-posts a
  deposit to the exact paise; deleted event restored; trial balanced.
- Live `e2e-live` §13 (89 total): summary shape, zero-liability invariant on
  a fresh book, over-deposit 409, nothing posted by a refused deposit, RBAC.
- Browser `ui-admin` A43 (42 total): the card renders both statutes; an
  impossible deposit through the UI is refused with the real liability.

## Boundary notes

- Deposits are operator-driven against whatever the payable balance is —
  partial deposits are legitimate (the balance simply stays until paid).
  Statute-specific filing rhythms (CHAVS monthly, 26Q quarterly) are a
  reporting concern outside this ledger's scope.
- A revert is an internal correction, not a government refund request — the
  audit trail (original + reversal + reason) is what a reviewer needs.

# Part 5 — Phase 14: bank reconciliation (the egress truth)

## The problem

Every edge of the money loop except one had an independent source of truth:
the customer's cash is proven by the PSP webhook (Phase 12's cash gate), the
settlement by the gateway's clearing file, the government's share by the
deposit UTR. The **egress** — money leaving the bank to vendors — was trusted
to the payout provider. But a provider can mark a payout PAID and the bank can
return it days later (NSF, closed account, recall) — and the provider will
never say so. The bank's own statement is the only record that knows.

## Design

- **`BankStatementLine`** — one ingested line: `{ statementRef, lineNo, utr,
  amountPaise (signed: <0 debit/out, >0 credit/in), description }` +
  `{ matchStatus: unmatched | confirmed_paid | returned, matchedBatchId,
  matchError, ingestedBy }`. Unique `{statementRef, lineNo}` → re-ingesting a
  statement is a no-op (never double-reverses, never double-counts).
- **Matching is UTR-exact and conservative** — a UTR is an identifier the
  bank, the provider and the ledger all hold; nothing else is used, and
  nothing is fuzzy:

  | bank line | batch with that UTR | result |
  |---|---|---|
  | debit (−) | PROCESSING | the money moved → `markPaid` (resolves an ambiguous submission from the bank side) |
  | debit (−) | PAID | `confirmed_paid` — audit only, no state change |
  | credit (+) | PAID | **bank return** → `markReversed` |
  | anything else | — | `unmatched` — queued, visible, **never guessed** |

- **The statement only decides; it never moves money.** Every state change
  goes through the existing `payoutService.markPaid` / `markReversed`, so the
  reversal journal (DR bank / CR vendor payable + GST/TCS/TDS mirrors), the
  line release back to `eligible`, the `payout_reversed` chained event and the
  audit action all happen exactly as with an operator-triggered reversal. A
  line whose match throws is kept `unmatched` with `matchError` and reported
  in `failed[]` — the other lines in the statement still process.
- **One chained fact per ingest**: `bank_statement_ingested:{statementRef}`
  (info event, not a journal kind — no money is posted by the ingest itself;
  the money facts are the matched batches' own journals). This answers "who
  fed us a statement, when, and what happened" on the tamper-evident chain.

## Verification (2026-09-07)

- Hermetic `smoke-payouts` §15 (suite 118/118): the paid batch's own UTR is
  confirmed by a debit (no state change); a credit with the same UTR reverses
  it — vendor payable restored by the **exact drained journal line** (not the
  net — the statutory/GST mirrors return too), bank made whole, line back in
  the eligible pool, `payout_reversed` chained; unknown lines queued; a
  white-box PROCESSING batch (fact + journal posted, provider silent) is
  settled **on the bank's word**; re-ingest is a no-op; the restore-scarred
  chain is rebuilt clean and the ingestion fact verified on it; statement
  lines immutable; trial balanced throughout.
- Live `e2e-live` §14 (93 total): summary shape, unknown lines queued with
  nothing guessed, queue visibility, RBAC.
- Browser `ui-admin` A44 (43 total): a line with an unknown UTR lands in the
  persistent queue with its signed amount.

## Boundary notes

- A UTR collision across batches (two batches claiming one UTR) would match
  the first found — the unique-UTR-per-batch invariant of the provider layer
  makes this a data-integrity bug to catch in the drift checks, not a
  matching hazard.
- Debits against REVERSED batches and credits against PROCESSING batches are
  intentionally unmatched (a re-send or a duplicate) — a human decides, with
  the batch's full history in hand.
- The queue is a worklist, not a state: lines are immutable once recorded;
  the batch's state (and its events) is the resolution.

# Part 6 — Phase 15: clawback settlement (the refund debt is money, too)

## The problem

The payout side knew how to *accrue* and *pay* — and Phase 12+ closed every
edge of the outflow loop. But the loop had a hole in the middle: a refund
after a payout. The refund journal (Phase 6) debits `vendor_payable` by the
vendor's share at refund time, and `reverseForRefund` creates a negative
line that offsets the vendor's next cycle. Neither half had ever been
proven end-to-end, and neither was safe on its own:

- the negative line and the carried debt are **two representations of the
  same obligation** — if both survive, the debt is collected twice;
- a cancelled/failed batch releases its lines back to the pool — for
  negative lines that means the offset (or the below-floor credit) is
  applied twice.

## Design

One rule decides line fate on `cancel`/`markFailed`:

| batch carries | lines are… | why |
|---|---|---|
| `carryForwardPaise !== 0` | **consumed (PAID, nothing moved)** | the batch's net was recorded as carry-forward — the lines are already counted; releasing them would charge/pay the same amounts again |
| `carryForwardPaise === 0` | released to `eligible` | nothing was carried; every line — negative offsets included — is still pending and re-enters exactly once |

The debt **moves**: when a batch is computed with a carried opening balance,
the old batch's `carryForwardPaise` is cleared at the same time the new batch
is pinned. The debt therefore exists in exactly one place at all times: the
latest batch that recorded it. (Crash between the two writes → the new batch
is DRAFT; cancelling it releases its lines and leaves the old carry intact —
the debt is counted exactly once on either side of the crash.)

Zero-net batches are refused at `submitForApproval`
(`PAYOUT_NOTHING_TO_PAY`) — a ₹0 instruction is never sent to the provider;
`negativeBalanceCarryForward: false` refuses the negative cycle at compute
time (`PAYOUT_NEGATIVE_BALANCE`) instead of silently zeroing it.

## The accounting, verified in paise

Paid order (drain D) → full refund → next cycle:

1. refund journal debits `vendor_payable` D (books: we are owed D);
2. negative-only cycle: net 0, carry −N (N = the line's net); cancel
   consumes the line, carry survives;
3. new sale (net N₂): cycle opens at −N, pays exactly N₂−N to the bank;
   the journal drains the payable by (new sale − debt);
4. books end at zero, cash matches the vendor's true entitlement, and the
   recovered debt is visible on the vendor's `refund_clawback` account as
   the journal's balancing residue.

## Verification (2026-09-07)

- Hermetic `smoke-payouts` §16 (suite 142/142): the full loop above with
  hand-computed paise at every step; debt-transfer no-double-charge; the
  `PAYOUT_NOTHING_TO_PAY` and `PAYOUT_NEGATIVE_BALANCE` guards; unpaid-line
  refund (no negative line); failed-batch line release; trial balanced.
- Live `e2e-live` (93): the sandbox even produced a real below-floor batch
  (net ₹0, carry ₹184.26) which A45 cancelled through the browser.
- Browser `ui-admin` A45 (44 total): sweep → compute → DRAFT batch cancelled
  with a reason, lines released; honest empty state when nothing is payable.

## Part 7 — Phase 16: wallet ledger integrity (the wallet IS a ledger account)

The customer wallet kept two parallel truths: `Wallet.balance` (the money the
customer can spend) and, for some movements only, the double-entry journal.
Top-ups and goodwill credits moved wallets **without** a journal, so a
platform whose wallet history pre-dates the ledger — or which lost a journal
in a crash window — silently owes customers more or less than its books say.
Phase 16 closes that gap and makes the wallet a first-class ledger account.

### The invariant

```
Σ Wallet.balance (tenant)  ===  customer_wallet_liability (tenant entry sum)
```

to the paise, at all times. Every wallet movement now has exactly one
journal owner, so neither side can move alone:

| Movement | Journal | Debit | Credit |
| --- | --- | --- | --- |
| top-up (real money in via gateway) | `wallet_topup` | `gateway_clearing` | `customer_wallet_liability` |
| goodwill credit (no gateway money) | `wallet_topup` (kind) | `wallet_goodwill_expense` | `customer_wallet_liability` |
| refund to wallet | `refund_issued` (unchanged, `postRefund`) | sale-side slice | `customer_wallet_liability` |
| wallet order payment | sale journal (unchanged) | `customer_wallet_liability` | vendor/TCS/TDS/GST split |

No movement owns two journals — a refund credit from the wallet service
posts **nothing** (the refund journal already raised the liability), and a
sale already debited it. The wallet service's rule: *journal exactly the
movements that no other service journals, and only those.*

### Event-first, replayable

A top-up appends the `wallet_topup` domain event **before** posting the
journal, sharing the journal's idempotency key
(`wallet_topup:wallet_txn:{txnId}`). A crash in between is the same drift
shape as every other money fact: `findDrift` flags the missing journal and
`replay` re-derives it from the `WalletTransaction` (paise-exact, goodwill
derived from the txn's `reason`). Verified hermetically by deleting the
journal and watching the replay restore it.

### Backfill — the honest repair for pre-ledger balances

If the wallets and the ledger disagree (a tenant that was live before the
ledger, a manual edit, a lost journal whose event is also gone), the report
says so with the exact difference, and the operator can post **one**
`wallet_backfill` journal for it:

- signed — wallet ahead: DR `gateway_clearing` / CR liability; behind: the
  reverse. The clearing side is swept to the bank by settlement ingest,
  exactly like a sale.
- audited — a `wallet_backfill` event carries the difference in its payload.
- **deliberately not replayable** — the backfill amount is not re-derivable
  from any aggregate (it is the *difference*, a measured fact). `replay`
  throws `WALLET_BACKFILL_NOT_REPLAYABLE` rather than guess, and the
  integrity report keeps flagging the missing journal until a human decides.
  A repair that re-guesses would manufacture the drift it exists to remove.

This phase's own proof: the shared live tenant carried **₹2,000** of
pre-Phase-16 top-up history. The first reconcile reported the difference to
the paise; the repair posted one backfill journal; every layer after —
reconcile, integrity, e2e — agreed the books were balanced.

### Where it shows up

- `GET /wallet/admin/reconcile` (SUPER_ADMIN) — read-only reconciliation.
- `POST /wallet/admin/reconcile/repair` (SUPER_ADMIN) — the one-journal repair.
- Integrity report `checks.wallet` → `ok` = balanced; the ledger page's
  "Wallet ledger" row plus a deliberate *Backfill* action when off the books.
- `smoke-wallet` (57 checks): the invariant after each of the five movement
  types, drift → detect → signed backfill → balanced, journal deletion →
  findDrift → replay restores exact paise, backfill replay refusal, trial
  balance + audit chain with wallet journals mixed in.
## Part 8 — Phase 17: vendor ledger integrity (`vendor_payable` is a real ledger account)

Phases 12–16 made the platform side honest: every paisa that enters (PSP
settlement), leaves (bank transfer, refunds, wallet credit), or is owed
(statutory, wallet liability) has exactly one journal owner. Phase 17 turns
the same lens on the **payables side** — the `vendor_payable:{vendor}`
accounts that sale/refund/clawback journals have been moving all along.
Before this phase nothing ever asked *do the books match what the payout
lines say we owe?* — a vendor's payable could drift from its own payout
history (a lost journal, a manual edit, a bug that double-posts or
forgets) and the only way to notice was a vendor complaining.

### The invariant

For every vendor, to the paise, at all times:

```
vendor_payable:{v}  =  Σ lineLedgerView (counted lines)
                    +  Σ adjustments      (counted)
                    +  Σ carryLedgerViewPaise   (carry-forward batches, carry ≠ 0)
                    +  Σ openingLedgerViewPaise (settled-out batches)
```

where `lineLedgerView` is the line's **book face** — gross − GST − commission,
signed by line type (sales positive, clawbacks negative) — and "counted"
means: any ACCRUED / ELIGIBLE / HELD line, plus a BATCHED line whose batch
journal is not live (not yet submitted/paid) and which carried nothing.

The subtlety this phase had to get right: **a line is counted exactly once,
in exactly one place.** When a cycle carries a debt forward, the old batch's
`carryForwardPaise` moves into the new batch's opening — and at absorption
the old batch's lines are **consumed** (PAID) and its carry zeroed. Zero the
carry but leave the lines BATCHED and the debt is counted twice (once "pinned
in a zero-carry batch", once in the new opening) — a permanent ghost drift of
exactly the debt. The hermetic §4 of `smoke-vendors` proves the full
cancel → fail → reverse → pay journey leaves **zero** residue.

Carry is therefore **dual-face**: the cash face (`carryForwardPaise`) is what
the next bank transfer nets; the book face (`carryLedgerViewPaise`) is what
the journals still owe. Every settle-out path (`cancel`, `markFailed`,
`markReversed`) re-parks **both** faces into the next cycle's opening;
absorption clears **both** on the source batch and consumes its lines.

### The ledger view is a cache — drift is injected at the right layer

`AccountBalance` rows are materialized (only `$inc`'d at post). Deleting a
journal **does not** roll the balance back — so a white-box "the journal was
lost" test must also roll the view, exactly as the crash-window that lost the
journal would have left it. The smoke suite's §6/§7 do precisely that and
watch detection, repair, and refusal behave at the paise.

### Backfill — signed, audited, never guessed

`reconcileVendor({repair: true})` on a drifted vendor posts **one**
`vendor_backfill` journal, signed by the direction of the difference
(under-stated: DR `gateway_clearing` / CR `vendor_payable`; over-stated: the
reverse), with a `vendor_backfill` domain event appended **first** carrying
the difference in its payload and **the journal's own idempotency key**
(`vendor_backfill:{vendorId}:{ts}`) — so the event↔journal chain and
`findDrift` see one fact, not two. Like the wallet backfill, the amount is
the *difference* — a measured fact, not re-derivable — so `replay` refuses it
with `VENDOR_BACKFILL_NOT_REPLAYABLE`. Repair is **per-vendor by design**:
the platform endpoint without an `id` reports drift but refuses to post
(`VENDOR_RECONCILE_NEEDS_ID`), because a blind platform-wide repair would
post an unknown number of journals at once.

### Where it shows up

- `GET /payouts/admin/vendor-reconcile` (SUPER_ADMIN) — platform reconcile
  (per-vendor detail) or `?id=` single-vendor report.
- `POST /payouts/admin/vendor-reconcile/repair` (SUPER_ADMIN) — the
  one-journal, per-vendor repair.
- Integrity report `checks.vendors` (platform-scoped — vendors are
  platform-global) → the ledger page's **Vendor payable** row (A38 now
  requires all 9 subsystems), with drift to the paise and a repair action.
- `smoke-vendors` (90 checks): the invariant after every lifecycle step,
  debt-loss regression (cancel/fail/reverse of a carrying batch re-parks,
  absorption consumes, zero residue), adjustments posted at creation and
  drained at pay, drift → signed backfill → balanced → no-op second repair,
  journal loss → findDrift → replay refused → manual signed re-post, trial
  balance + audit chain with vendor journals mixed in.
- `scripts/seed-vendor-carry-views.mjs` — one-off, idempotent recovery of
  `carryLedgerViewPaise` for pre-Phase-17 carry batches from their consumed
  lines (the live tenant needed no run: its one legacy carry had already
  been absorbed).
## Part 9 — Phase 18: statutory ledger integrity (TCS/TDS are real accounts)

Phase 13 made the platform pay its withholdings: TCS (GST s.52) and TDS
(IT s.194-O) are withheld from vendor payouts, credited to `tcs_payable` /
`tds_payable`, and discharged by UTR-tracked deposits to the government.
But like the wallet before Phase 16 and the vendor payables before Phase 17,
nothing ever asked *do those accounts match the facts that created them?*
A lost journal, a manual edit, or a payout posted without its withholdings
would leave the platform owing the government more or less than its books
say — a compliance gap discovered (if at all) by a tax officer, not by the
system.

### The invariant

For each statute, to the paise, at all times:

```
{statute}_payable  =  withheld − net deposits
```

- **withheld** — Σ `batch.{tcs,tds}Paise` over batches whose
  `PAYOUT_INITIATED` journal is live (state PROCESSING or PAID). The journal
  is posted at *submission* (the liability is booked the moment the
  instruction is accepted) and credits the payable for the batch's
  aggregated withholdings.
- **net deposits** — recorded deposits minus reverts. Both move the same
  account (DR on deposit, CR on revert), so the deposit's UTR trail and the
  ledger agree by construction.

The subtlety mirrors Phase 17's: a batch is "withheld" only while its credit
is live. A **REVERSED** batch (bank returned the money after a successful
transfer) and a **FAILED** batch (provider rejected) both posted the
`PAYOUT_INITIATED` credit AND the mirror unwind — they net to zero and are
excluded. Counting them would double-count the unwind as a second withholding.

### Where the money is, and the sign of the repair

The payable is funded by the payout itself: the `PAYOUT_INITIATED` journal
debits the bank (net) while crediting the payable the withheld slice. So the
backfill's counter is **bank**:

- under-stated (books owe the government less than the facts say) —
  **DR bank / CR {statute}_payable**: the liability is restored and the bank
  is corrected to what it actually retained;
- over-stated — the mirror.

Signed by the direction of the difference, posted as **one**
`statutory_backfill` journal with the `statutory_backfill` domain event
appended first under the **same idempotency key** — one fact, not two. The
amount is the measured difference, not re-derivable from any aggregate, so
`replay` refuses it with `STATUTORY_BACKFILL_NOT_REPLAYABLE`. Repair is
**per-statute by design** (`STATUTORY_RECONCILE_NEEDS_STATUTE` otherwise):
a blind platform-wide statutory repair would post an unknown number of
journals at once.

### Where it shows up

- `GET /payouts/admin/statutory-reconcile` (SUPER_ADMIN) — platform picture
  (per-statute detail) or `?statute=` single-statute report.
- `POST /payouts/admin/statutory-reconcile/repair` (SUPER_ADMIN) — the
  one-journal, per-statute repair.
- Integrity report `checks.statutory` (platform-scoped — the payable
  accounts carry no tenant) → the ledger page's **Statutory payable (TCS/TDS)**
  row (A38 now requires all 10 subsystems), with drift to the paise and a
  per-statute backfill action.
- `smoke-statutory` (49 checks): the withholdings booked at submission, a
  deposit and its revert, over-deposit refusal, bank-reversal and
  provider-failure unwinds, drift → signed backfill → balanced → zero-diff
  refused, backfill journal loss → findDrift → replay refused → re-post under
  the event's own key restores the pair with no residual drift, trial
  balance + audit chain with statutory journals mixed in.

## Part 10 — Phase 19: GST output payable integrity (seller + platform GST are real accounts)

Phase 6.1 booked the seller's GST at sale time: `buildSaleLines` credits
`gst_output_payable:{vendor}` the item's tax, and from Phase 13 the payout
journal drains the batch's aggregated `sellerGstPaise` when it posts — the
platform remits the seller's output GST on their behalf, so the obligation
leaves the books with the payout. The platform's own commission GST
(`gstOnCommissionPaise`) sits in `gst_output_payable:platform`. But like the
wallet before Phase 16, the vendor payables before Phase 17, and the
statutory payables before Phase 18, nothing ever asked *do those accounts
match the facts that created them?* A lost sale journal, a refund posted
with the wrong allocation, or a payout whose GST drain vanished would leave
the seller's GSTR-8 obligation overstated or understated — a compliance gap
discovered (if at all) by a tax officer, not by the system.

### The invariant

For every vendor and the platform, to the paise, at all times:

```
gst_output_payable:{owner}  =  sale credits − refund debits − live payout drains
```

- **sale credits** — Σ `item.taxAmount` (paise) over the owner's items on PAID
  orders. This is exactly what the sale journal credited, so a vendor whose
  items carry tax always shows a live obligation.
- **refund debits** — per SUCCESS refund, the owner's share of
  `allocatePaise(toPaise(refund.amount), creditLines)` where creditLines are
  the sale's non-zero-credit lines — the *same* allocation
  `reverseProportional` used when the refund journal posted, so books and
  facts move by the same paise.
- **live payout drains** — Σ `max(0, batch.sellerGstPaise)` over batches in
  PROCESSING / PAID. A REVERSED or FAILED batch posted its drain AND its
  unwind, so it nets to zero and is excluded — counting it would
  double-count the unwind.

The one honest caveat: `buildSaleLines` prices commission from the vendor's
*current* rate, so a post-facto rate change shifts the derived basis. The
drift flag is the alarm for exactly that; the repair moves the books to the
derived truth.

### Where the money is, and the sign of the repair

The GST liability is funded out of the customer's payment (the sale journal
debited `gateway_clearing` the total and split it), so the backfill's
counter is **gateway_clearing**:

- under-stated (books owe less GST than the facts say) —
  **DR gateway_clearing / CR gst_output_payable:{owner}**: the obligation is
  restored and the clearing account corrected to what it actually retained;
- over-stated — the mirror.

Signed by the direction of the difference, posted as **one** `gst_backfill`
journal with the `gst_backfill` domain event appended first under the **same
idempotency key** — one fact, not two. The amount is the measured difference,
not re-derivable from any aggregate, so `replay` refuses it with
`GST_BACKFILL_NOT_REPLAYABLE`. Repair is **per-owner by design**
(`GST_RECONCILE_NEEDS_OWNER` otherwise): a blind platform-wide GST repair
would post one journal per drifted owner.

### Where it shows up

- `GET /payouts/admin/gst-reconcile` (SUPER_ADMIN) — platform picture
  (per-vendor + platform detail) or `?vendor=` single-vendor report.
- `POST /payouts/admin/gst-reconcile/repair` (SUPER_ADMIN) — the
  one-journal, per-owner repair.
- Integrity report `checks.gst` → the ledger page's **GST output payable**
  row (A38 now requires all 11 subsystems), with drift to the paise and a
  per-owner backfill action.
- `smoke-gstpayable` (56 checks): a paid sale books the vendor's GST with the
  platform at zero; a PAID payout drains exactly the batch's seller GST to
  the platform account; full and 50% refunds debit back the proportional
  slice; a clawback (full refund of a paid order) pulls the books negative
  and a larger delivered order in the window absorbs it; a bank reversal of
  the batch restores the drain; white-box drift → exact paise detected →
  signed backfill (DR clearing / CR payable) with event key == journal key →
  balanced → zero-difference refused; backfill journal loss → findDrift →
  replay refused → re-post under the event's own key restores the pair with
  no residual drift; trial balance + audit chain hold with GST backfills
  mixed in.

## Part 11 — Phase 20: bank cash position integrity (the settlement bank is a real account)

Phases 12 through 19 made the ledger's *internal* accounts honest: every
payable and liability now reconciles to the domain facts that created it.
But every one of those accounts is a mirror of cash that is, in the end,
sitting in — or leaving — one physical place: the platform's settlement
bank. A settlement journal lost in a crash, a payout journal that landed
without its event, or a deposit the platform booked but never made, would
leave the books disagreeing with the money — and no internal account
reconcile can see it, because from the ledger's point of view everything
balances. Phase 20 asks the last cash question: **do the bank books equal
the cash facts, to the paise?**

### The invariant

To the paise, at all times:

```
books(bank)  =  Σ psp_settled  −  Σ live batch.netPaise  −  Σ net statutory deposits
```

- **settlements** — the `PSP_SETTLED` domain events, signed. Settlement is
  final once posted (the cash is in the account), and the PSP nets refunds
  in as *negative* settlement rows, so the event sum is the whole truth of
  the inflow side.
- **live payout outflows** — Σ `batch.netPaise` over batches in PROCESSING
  or PAID. The payout journal credits the bank the *net* (after
  commission, the platform's commission GST, and TCS/TDS), at submission —
  so the liability is booked the moment the instruction is accepted.
- **net statutory deposits** — recorded deposits minus reverts. Both move
  the same account, so the UTR trail and the ledger agree by construction.

Refunds never touch the bank: they go back out through the gateway
(`gateway_clearing`), which is exactly why the invariant excludes them —
a refund of an already-settled order leaves the bank books untouched and
balanced.

The REVERSED-batch subtlety repeats from Phases 17–19: the reversal posts
the mirror journal, so the pair nets to zero and the batch is excluded
from "live". Counting it would double-count the unwind.

### Where the money is, and the sign of the repair

The bank account is single (the platform's operating account) — there is
no per-owner split, so the repair posts **one** signed `bank_backfill`
journal:

- under-stated (the books show less cash than the facts say) —
  **DR bank / CR gateway_clearing**: the unexplained-cash bucket absorbs
  the correction, restoring the bank to what the facts say it holds;
- over-stated — the mirror.

The `bank_backfill` domain event is appended first under the **same
idempotency key** as the journal — one fact, not two. The amount is the
measured difference, not re-derivable from any aggregate, so `replay`
refuses it with `BANK_BACKFILL_NOT_REPLAYABLE`.

### The statement cross-check

The bank statement (Phase 14) is an *independent* source of truth for the
egress side: the bank's own record of money moving. A statement line whose
UTR matches no known batch is money that left (or arrived) with no
explanation in our systems — the closest thing to fraud the platform will
ever see. The Phase 20 check therefore reports `ok` only when the books
balance **and** the unmatched queue is empty. Unmatched lines are never
guessed at; they stay visible until an operator matches them (which, for a
batch, drives the payout state machine) or removes them through the new
operator-correction endpoint (`DELETE /payouts/admin/statement/lines/:ref/:lineNo` —
unmatched lines only; matched lines are immutable once they have driven a
money movement).

### Where it shows up

- `GET /payouts/admin/bank-reconcile` (SUPER_ADMIN) — the platform cash
  picture: settlements / live payouts / net deposits to the paise, plus the
  statement's unmatched count.
- `POST /payouts/admin/bank-reconcile/repair` (SUPER_ADMIN) — the
  one-journal repair.
- `DELETE /payouts/admin/statement/lines/:ref/:lineNo` (SUPER_ADMIN) —
  operator correction for a bad ingestion.
- Integrity report `checks.bank` → the ledger page's **Bank cash position**
  row (A38 now requires all 12 subsystems), with the single backfill
  action.
- `smoke-bank` (54 checks): settlement moves cash in; a live payout drains
  the net; a bank reversal unwinds it; a statutory deposit (and its
  revert) moves and restores; a refund of a settled order leaves the bank
  untouched; white-box drift → exact paise detected → signed backfill
  (DR bank / CR clearing) with event key == journal key → balanced →
  zero-difference refused; backfill journal loss → findDrift → replay
  refused → re-post under the event's own key restores the pair with no
  residual; an unmatched statement line keeps the check red until it is
  explained; trial balance + audit chain hold with bank journals mixed in.
