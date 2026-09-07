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
