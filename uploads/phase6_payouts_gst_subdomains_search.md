# Phase 6 — Money, Identity & Discovery

> **Scope:** vendor payouts (real disbursement) · GST invoicing · subdomain routing · search ranking
> **Status:** IN PROGRESS — **the whole money track is done: 6.0 ✅ · 6.1 ✅ · 6.2 ✅ · M3 ✅ · M4 ✅ · M5 ✅ · M6 ✅ · **P1 ✅ · P2 storefront ✅** · next: S1 search ranking · **Owner:** platform team
> **Builds on:** Phase 5 marketplace (`uploads/multi_tenant_marketplace.md`), Phase 3.5 pricing
> policies (`uploads/tenant_charges_rider_endpoints_slot_forecasting_refund_fees.md`),
> Phase 4b ops tooling (`uploads/ops_tooling_notifications_exports.md`)
> **Discipline (unchanged):** blueprint first · provider abstractions · data-not-constants ·
> idempotent everything · immutable financial history · hand-verifiable acceptance criteria ·
> full regression of all 10 backend suites before merge.

---

## 0. Executive summary

Phase 5 made the platform a marketplace on paper: vendors join, sell, and the platform
*accrues* a commission on an invoice. Phase 6 makes it a marketplace in law and in money:

| Workstream | One-line goal | Legal/financial risk if wrong |
|---|---|---|
| **6.2 GST invoicing** | Every sale produces a legally valid tax invoice with correct CGST/SGST/IGST split, HSN, and a credit note on every return. | Penalties, ITC denial for B2B buyers, blocked GSTR filings |
| **6.3 Vendor payouts** | Money actually leaves the platform bank account to the right vendor, once, on schedule, net of the right deductions. | Double payment, under/over payment, TDS/TCS non-deposit |
| **6.4 Subdomain routing** | `rosebazaar.flowermarket.in` (and custom domains) resolve to a tenant without a header. | Cross-tenant data leak via a spoofed `Host` header |
| **6.5 Search ranking** | Customers find the right stem in the first five results. | Revenue, not law |

**The non-negotiable ordering insight:** payouts are computed *from* tax-correct invoice
lines, and both are computed *from* money values that must never drift. So the phase runs
**pre-flight → money core → GST → payouts**, with **subdomains** and **search** as two
independent tracks that can run in parallel from day one.

```
6.0 pre-flight fixes ──► 6.1 money core (paise + double-entry ledger) ──► 6.2 GST ──► 6.3 payouts
                    └──► 6.4 subdomain routing  (independent)
                    └──► 6.5 search ranking     (independent, consumes existing outbox)
```

> ⚠️ **Tax disclaimer.** Every rate, threshold and due date in this document (GST slabs, TCS
> u/s 52, TDS u/s 194-O, e-invoicing turnover threshold) is modelled as **effective-dated
> data rows**, never as a code constant, precisely because they change by notification. The
> seed values below are starting points and **must be confirmed with a chartered accountant
> before go-live**. The engineering contract is: *the system can express any rate, on any
> date, for any HSN, and can prove which rate produced a historical number.*

---

## 0b. Execution log

| Milestone | Status | Notes |
| --- | --- | --- |
| **M0 pre-flight** | ✅ shipped | P1 fixed · **P2 was a false positive** (dynamic import) · P3/P4 closed · **new P7 found & fixed: 14 orphan audit actions silently voided the billing audit trail** · P6 (replica set) is infra, documented + probed at boot |
| **M1 money core** | ✅ shipped | paise helpers · `allocatePaise` · `splitTaxPaise` · 4 ledger models · `ledger.service` · `ledgerPosting.service` · saga + refund hooks · nightly backfill/verify · 56 unit + 6 invariant + 10 smoke scenarios |
| **M2 GST engine** | ✅ shipped | `utils/gst.js` (pure, 78 tests) · 4 new models + extended `TaxPolicy` · `tax.service` · `taxDocument.service` · `einvoiceProvider` · 15 routes · 10 smoke areas |
| **M3 GST exports** | ✅ shipped | 7 renderers on the existing `ExportJob` machinery (12 export types total). **PDF still deferred** — it needs a new dependency and is presentation, not correctness |
| **M4 payout accrual & cycles** | ✅ shipped | 6 models · pure `computeLineFinancials` (₹5279.10 asserted) · state machine · 2 eligibility gates · refund reversal · carry-forward · 22 routes · 47 tests |
| **M5 disbursement** | ✅ shipped | 4 provider adapters · **three-outcome contract** · HMAC webhook on the raw-body rail · reconcileInFlight · ingestPspSettlements · mirror-journal unwind · statements as ExportJob artifacts · 52 pure + 11 DB-backed areas |
| **M6 payout console** | ✅ shipped | platform approval queue + batch drawer + ledger explorer with trial-balance/drift; vendor payouts, statement download, bank + KYC readiness checklist; read-only `/ledger` API |
| **P1 domain routing** | ✅ shipped | Host→tenant with fail-closed unknown subdomains · pure hostname parser (fuzz found a real bug) · DNS-TXT verified custom domains gating TLS · negative-caching LRU · host-aware CORS · bootstrap endpoint · Domains console page |
| **P2 storefront app** | ✅ shipped | `apps/storefront` · zero tenant ids in the client · runtime theming with computed contrast · per-host sessions · catalog/cart/OTP/checkout/tracking · 253 kB |
| S1–S3 (search) | ⬜ | unchanged — independent of the money track |

**P1 decisions worth recording**

1. **The fallback was the vulnerability.** Resolving an unknown `*.root` subdomain to the
   default tenant is the kind of bug that never throws an error and quietly serves one
   store's catalogue on another's hostname. It now 404s.
2. **The fuzz test earned its keep on day one.** `store.flowermarket.in:80@evil.com` was
   resolving to `store`, because `lastIndexOf(':')` treated `:80@evil.com` as a port.
   Userinfo is now rejected outright and a port must be digits. Host is attacker input; it
   deserves adversarial tests, not examples.
3. **Negative results are cached.** Otherwise the cheapest possible attack — request a
   nonexistent subdomain in a loop — becomes an unbounded database load.
4. **Dev CORS is now enumerated, not universal.** `NODE_ENV` defaults to `development`, so
   "allow everything in dev" meant a deploy with an unset `NODE_ENV` shipped an open policy.

**P2 decisions worth recording**

1. **The absence is the architecture.** There is no tenant id anywhere in the storefront —
   not in a config, not in a header, not in a URL. A client that cannot name a tenant
   cannot name the wrong one. That is only possible because P1 made the Host authoritative.
2. **Contrast is computed, not assumed.** `readableInk()` derives WCAG luminance from the
   store's brand colour to choose black or white text on it. Letting a tenant pick a colour
   and then hardcoding white text is how you ship an unreadable button to a real customer.
3. **The cart lives on the server, always.** Price, stock and coupon validity are not things
   a browser may assert; the checkout saga re-validates all three anyway. The client keeps a
   snapshot purely so the badge and drawer render instantly.
4. **The customer sees 5 states, not 16.** `lib/status.js` translates the operational state
   machine into the handful of milestones a person tracks — `picking` and `packed` both read
   as "being prepared", because that distinction is ours to care about, not theirs.
5. **Sessions are namespaced per hostname.** Two stores open in two tabs sharing a cart would
   be both a bug and a privacy leak; the persist key is now `fm-shop:{host}`.

**M5 decisions worth recording**

1. **A payout call has three outcomes, not two.** success / clean-failure /
   **ambiguous**. The provider layer never throws on a transport error, because a thrown
   error in a `try/catch` is indistinguishable from a rejection and invites a retry.
   `{ ambiguous: true }` forces the caller to do the only safe thing: nothing.
2. **The ledger posts at submission, not at settlement.** The liability is discharged when
   the instruction is accepted; a rejection or reversal posts the exact mirror journal.
   This keeps `vendor_payable` honest at every instant rather than only at rest.
3. **`markReversed` returns the lines to the eligible pool, `markFailed` releases them
   too — but only a failure is retryable.** A reversal means the destination is bad, so the
   next cycle will re-attempt only after the vendor fixes their account (and the
   fingerprint change re-arms the 24h freeze).
4. **The mock provider is the test harness.** Outcomes keyed off the last two paise
   (…13 rejected, …17 reversed, …99 ambiguous) mean every unhappy path is reachable in CI
   with no credentials and no network.

**M6 decisions worth recording**

1. **The UI enforces the same rule as the state machine.** An in-flight batch shows
   *Reconcile* and nothing else — there is no retry control anywhere on the payout screen.
   A safety property that only exists in the API is one an operator will eventually route
   around; putting it in both places means the dangerous action is not even expressible.
2. **The vendor screen answers the support ticket before it is filed.** "Eligible / still
   in the return window / on hold" as three headline numbers, and a deduction waterfall
   that starts from gross sales, is the entire content of the most common vendor dispute.
3. **The ledger API is read-only by construction.** No endpoint posts a journal. Money
   moves only through the services that own the business event; an API that could write an
   arbitrary journal would defeat the point of having a ledger.
4. **The UI never does money arithmetic.** Every figure rendered is server-computed, so the
   console can disagree with the ledger only by being stale, never by being wrong.

**M4 decisions worth recording**

1. **The state machine's most important edge is the one that isn't there.**
   `PROCESSING → QUEUED` does not exist. A batch the provider has accepted may or may
   not have moved money; allowing a retry from that state is precisely how marketplaces
   pay twice. It can only be resolved by reconciliation (M5).
2. **The seller's GST is paid TO the seller.** The payout journal drains both
   `vendor_payable` and `gst_output_payable:{vendor}` because the seller is the person
   who deposits that GST. Only TCS is withheld by the platform. This is what makes the
   blueprint's ₹5279.10 reconcile against the ledger rather than merely against a
   spreadsheet.
3. **Accrual happens at CONFIRMED, eligibility at delivered + window.** Recording the
   entitlement early means a vendor can see money accruing in real time
   (`/payouts/me/upcoming`), while nothing becomes payable until the return risk has
   passed.
4. **PSP settlement gate ships OFF.** `requirePspSettlement` is implemented and wired to
   look for a `psp_settled` journal, but defaults to false until settlement-report
   ingestion lands in M5 — an unmet gate that silently blocks every payout would be worse
   than an honest default.

**M2 decisions worth recording**

1. **One `TaxDocument` collection, not two.** Invoices and credit notes share ~60
   fields, the numbering machinery and every GSTR query, and a credit note is legally a
   correction *to* an invoice. Discriminated by `docType`, with series still keyed on
   `docType` so numbering stays legally separate.
2. **Reconstruction over recomputation.** The invoice takes the tax the customer was
   *actually charged* (persisted on `orderitems`) and only splits it into heads. This
   makes the document correct today without touching checkout — and means a future slab
   change cannot re-price history.
3. **Inclusive-pricing checkout is deliberately NOT switched on.** `TAX_PRICES_INCLUSIVE`
   exists and the engine implements both modes, but flipping the *pricing pipeline* to
   inclusive changes what customers are charged. That is a separate, flagged migration
   (call it M2b) with its own comms, not a side effect of an invoicing milestone.
4. **PDF deferred to M3.** Rendering needs a new dependency and is presentation; the
   document data model, numbering and tax correctness are what everything downstream
   (payouts, GSTR filing) depends on.
5. **Rate policy is super_admin-only.** GST classification is a legal fact. A store
   choosing its own slab is a compliance incident waiting to happen, so `/tax/policies`
   and `/tax/statutory-rates` sit behind `authorize(SUPER_ADMIN)` while stores manage
   only their own registration and documents.

**Corrections to this plan discovered while executing it** (the plan is a
hypothesis; the code is the truth):

1. **P2 was wrong.** `catalog.tenant.controller.js` resolves `badRequest` through a
   dynamic `await import()`, which the review scanner's regex could not see. Not a bug.
   Tidied to a static import for consistency; the scanner now understands destructured
   dynamic imports.
2. **A worse defect existed in the same area.** `AuditLog.action` is enum-validated, and
   14 action strings used across billing, rider and maintenance were never added to
   `AUDIT_ACTION`. Because every `auditService.record()` call site ends in
   `.catch(() => {})`, those writes failed validation and vanished — including
   `invoice_generated`, `invoice_paid`, `invoice_void` and `plan_change`. A money phase
   cannot start on an audit trail that silently drops financial events. Fixed, and
   `scripts/invariants.test.js` now fails the build if any action string is not in the enum.
3. **The contract-drift check moved earlier.** §7.4 scheduled the `endpoints.js` ↔ route
   table diff for the frontend work; it was cheap to build now, so it ships with M1 — and
   it immediately failed on the known `adminInvoiceDetail` drift, which is now fixed
   (`GET /marketplace/admin/billing/invoices/:id` exists).

---

## 1. Pre-flight (6.0) — one day, blocks everything

These are found-in-review defects on the exact code paths Phase 6 extends. Fix and
regression-test them *before* writing new financial code.

| # | Defect | Evidence | Fix |
|---|---|---|---|
| P1 | `GET /wallet/transactions` throws `ReferenceError: serializeList is not defined` (500) | `services/wallet.service.js` calls `serializeList()` in `ledger()` but never imports it | add the import; add a smoke assertion |
| P2 | `catalog.tenant.controller.js` calls `badRequest()` without importing it | same class of bug, latent 500 | add the import |
| P3 | `/catalog/tenant/*` (20 routes incl. price/stock writes) is `authenticate`-only — a `customer` token can change prices | `routes/catalog.tenant.routes.js` `router.use(authenticate)` and nothing else | `authorize(ADMIN, SUPER_ADMIN, VENDOR)` |
| P4 | `/media/presign` open to any authenticated user, no quota | `routes/media.routes.js` | role gate + per-tenant byte quota |
| P5 | Money is float rupees everywhere | `utils/money.js` | superseded by 6.1 — see below |
| P6 | No MongoDB transactions available (standalone mongod) | `grep startSession` = 0 | run Mongo as a **single-node replica set** in dev/prod so `withTransaction` exists (see 6.1.3) |

**Exit criteria:** all 10 existing suites green + 2 new assertions covering P1/P2.

---

## 2. Workstream 6.1 — The money core

*Everything financial in Phase 6 stands on this. ~1.5 weeks.*

### 2.1 Problem

`utils/money.js` represents rupees as JS floats and rounds at every sum. That is survivable
for a cart total. It is **not** survivable for:

- commission = `GMV × bps / 10000` compounded over thousands of lines,
- a tax split that must satisfy `CGST + SGST == totalTax` **exactly**,
- a payout that must satisfy `Σ vendor payouts + Σ platform income + Σ tax payable == Σ collected` **exactly, to the paisa**.

A single lost paisa in a settlement report is a reconciliation ticket; a thousand of them is
an audit finding.

### 2.2 Decision: new financial documents are **paise-native**

Do **not** attempt a 76-model float→int migration. Instead:

- **New rule:** every document created by 6.1–6.3 stores integer **paise** in fields suffixed
  `Paise` (`grossPaise`, `taxPaise`, `commissionPaise`, `netPayablePaise`). These are the
  source of truth.
- **Legacy rule:** existing rupee fields (`Order.totalAmount`, `Invoice.total`, …) stay, and
  are written as `fromPaise(x)` derived views. Never the reverse.
- **Boundary helpers** in an extended `utils/money.js`:

```js
export const toPaise   = (rupees) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise)  => Math.round(paise) / 100;

/**
 * Largest-remainder allocation — splits `totalPaise` across `weights` so the
 * parts sum EXACTLY to the total. This is how tax, discount and commission are
 * distributed across order lines without losing or inventing a paisa.
 */
export function allocatePaise(totalPaise, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw   = weights.map((w) => (totalPaise * w) / sum);
  const floor = raw.map(Math.floor);
  let rem = totalPaise - floor.reduce((a, b) => a + b, 0);
  // hand the leftover paise to the largest fractional remainders, deterministically
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k += 1) floor[order[k % order.length].i] += 1;
  return floor;
}
```

This one function replaces `pricingPolicy.allocateDiscount()`'s "last line absorbs rounding"
hack, which is biased and can produce a negative allocation on a zero-priced line.

**Invariant test (must be in the suite):** for 10 000 random `(total, weights)` pairs,
`sum(allocatePaise(total, weights)) === total` and every part is `>= 0`.

### 2.3 Decision: a real double-entry ledger

Vendor payouts without a ledger become "sum some order items and hope". A ledger makes every
rupee traceable and makes reconciliation a query instead of an investigation.

**New models:**

```
LedgerAccount   (tenantId?, vendorId?, code, type: asset|liability|income|expense, currency)
LedgerEntry     (journalId, accountCode, debitPaise, creditPaise, refType, refId, occurredAt)
LedgerJournal   (tenantId, kind, idempotencyKey UNIQUE, entries[], postedAt, reversalOf)
AccountBalance  (accountKey UNIQUE, balancePaise, version, lastJournalId)   ← materialized view
```

**Chart of accounts (seeded, extensible):**

| Code | Type | Meaning |
|---|---|---|
| `gateway_clearing` | asset | money captured by the PSP, not yet settled to us |
| `bank` | asset | our settlement bank account |
| `vendor_payable:{vendorId}` | liability | what we owe a vendor |
| `platform_commission_income` | income | our cut |
| `gst_output_payable` | liability | GST collected on our own supplies (commission) |
| `tcs_payable` | liability | TCS collected u/s 52 on behalf of sellers |
| `tds_payable` | liability | TDS deducted u/s 194-O |
| `refund_clawback:{vendorId}` | asset | negative balance carried against a vendor |
| `customer_wallet_liability` | liability | mirrors the existing `wallets` collection |

**Posting rules (kind → journal):**

| Kind | Trigger | Debit | Credit |
|---|---|---|---|
| `sale_captured` | order → CONFIRMED | `gateway_clearing` | `vendor_payable`, `platform_commission_income`, `gst_output_payable`, `tcs_payable` |
| `psp_settled` | PSP settlement webhook | `bank` | `gateway_clearing` |
| `refund_issued` | RefundTransaction success | `vendor_payable` (clawback), `platform_commission_income` (reversal) | `gateway_clearing` / `customer_wallet_liability` |
| `payout_initiated` | payout batch sent | `vendor_payable` | `bank` |
| `payout_reversed` | payout failed/returned | `bank` | `vendor_payable` |
| `tds_deducted` | payout computation | `vendor_payable` | `tds_payable` |

**Hard invariant, asserted on every write:** `Σ debitPaise === Σ creditPaise` per journal.
A journal that doesn't balance throws `422 LEDGER_UNBALANCED` and posts nothing.

### 2.4 Consistency without wishful thinking

The repo has zero transactions today and heals with sweeps. For money that is not enough:
a crash between "post journal" and "increment balance" must not lose money.

- **Make the journal the source of truth**, the balance doc a *materialized view*. Balance is
  recomputable at any time: `AccountBalance = Σ entries`. A nightly `verifyBalances()` job
  recomputes and reports drift (must be 0).
- **Run Mongo as a single-node replica set** (`--replSet rs0`, one member) — zero operational
  cost, and it unlocks `session.withTransaction()`. Wrap *journal + balance* in a transaction.
  Everything else in the codebase keeps its current compensating-action style.
- **Fallback if a standalone mongod is unavoidable:** post the journal first (it is the truth),
  then update the balance with the existing versioned-optimistic-lock pattern; the
  `verifyBalances()` sweep repairs any gap. Document the window explicitly.
- **Idempotency:** `LedgerJournal.idempotencyKey` is unique, formatted
  `{kind}:{refType}:{refId}[:{attempt}]`, e.g. `sale_captured:order:66f…a1`. A duplicate post
  is a no-op returning the existing journal — same contract as `RefundTransaction`.

### 2.5 Deliverables

- `models/ledgerAccount|ledgerEntry|ledgerJournal|accountBalance.model.js`
- `services/ledger.service.js` — `post({kind, idempotencyKey, entries, refs})`, `balance(accountKey)`,
  `statement({accountKey, from, to})`, `verifyBalances()`
- `utils/money.js` extended with `toPaise/fromPaise/allocatePaise`
- Hook `sale_captured` into `order.service.finalizeOrderAfterPayment()` (the single place an
  order becomes real money) and `refund_issued` into `refund.service`
- `scripts/smoke-ledger.test.js` — 8 scenarios incl. the allocation invariant and a
  crash-injection replay proving idempotency

**Exit criteria:** for a seeded day of orders, `verifyBalances()` reports zero drift and
`Σ vendor_payable + Σ commission_income + Σ tax_payable == Σ gateway_clearing`, hand-checked
against the order list.

---

## 3. Workstream 6.2 — GST invoicing

*~2.5 weeks. Depends on 6.1.*

### 3.1 What's wrong today

`pricingPolicy.computeOrderCharges()` is a good policy engine but is **not** a tax engine:

| Gap | Today | Required |
|---|---|---|
| Inclusive vs exclusive | `grandTotal = subtotal + tax − discount + fee` → tax is **added on top** of the listed price | Indian retail prices are **MRP-inclusive**. Taxable value must be back-derived: `taxable = price × 100 / (100 + rate)` |
| Tax base vs discount | tax computed on **pre-discount** line total | GST is charged on the **transaction value** (post-discount, when the discount is known at supply time) |
| Rate split | one `taxAmount` | `CGST + SGST` (intra-state) **or** `IGST` (inter-state), each stored separately |
| Place of supply | absent | delivery-address state decides the split |
| Supplier identity | absent | tenant/vendor **GSTIN**, legal name, registered address per invoice |
| Numbering | none for tax invoices | unique, **consecutive, per financial year**, ≤16 chars, never reused |
| Returns | `RefundTransaction.refundTaxAmount` exists but no document | a **credit note** u/s 34 with its own series, linked to the original invoice |
| Nil-rated goods | `DEFAULT_GST_SLAB_PCT = 0` silently | must be an explicit **exempt/nil-rated** classification, reported separately |
| Marketplace duties | none | **TCS u/s 52** on seller supplies; **TDS u/s 194-O**; platform's **own tax invoice for commission** |
| E-invoice | none | IRN + signed QR above the turnover threshold |

**Domain nuance that makes this repo interesting:** a flower market sells a *mix* of
nil-rated and taxable goods — fresh cut flowers and live plants are typically nil/exempt,
while artificial flowers, pots, tools and gift packaging are taxable. So a single invoice
routinely spans multiple rates including 0%, which means rate-wise subtotals ("HSN summary")
are mandatory, not optional.

### 3.2 Model: tax classification is data, effective-dated

Extend the existing `TaxPolicy` (already correctly category-level and effective-dated) and add
the missing legal dimensions:

```js
// taxPolicy.model.js  (extended)
{
  categoryId, hsnCode,
  rateBps: 1800,                       // 18.00% in basis points — no floats
  natureOfSupply: 'taxable'|'nil_rated'|'exempt'|'zero_rated'|'non_gst',
  cessBps: 0,
  effectiveFrom, effectiveTo,          // already present — now actually queried by date
  isActive
}
```

**Resolution is by supply date, not "isActive":**
`resolveTaxPolicy({ categoryId, at })` → the row where `effectiveFrom <= at < effectiveTo`.
Historical invoices re-render identically forever. The current
`TaxPolicy.findOne({ categoryId, isActive: true })` is replaced everywhere.

**New: `TaxRegistration`** (one per tenant, and one per vendor):

```js
{ ownerType: 'tenant'|'vendor'|'platform', ownerId,
  legalName, tradeName, gstin, pan,
  stateCode: '37',                     // GST state code — drives intra/inter decision
  address: { line1, line2, city, state, pincode },
  registrationType: 'regular'|'composition'|'unregistered',
  turnoverBand: 'lt_5cr'|'gte_5cr',    // e-invoice applicability
  einvoiceEnabled: Boolean,
  verifiedAt, verificationRef }
```

**New: `TaxRateOverrideLog`** — every manual rate override, who and why. Immutable.

### 3.3 The tax engine

`services/tax.service.js` — pure, deterministic, unit-testable without a DB:

```js
computeLineTax({
  grossPaise,          // what the customer pays for the line, MRP-inclusive
  discountPaise,       // allocated with allocatePaise()
  rateBps, cessBps, natureOfSupply,
  supplierStateCode, placeOfSupplyStateCode, pricesAreInclusive = true
}) -> {
  taxableValuePaise, cgstPaise, sgstPaise, igstPaise, cessPaise, totalTaxPaise
}
```

**Algorithm (inclusive pricing, the default):**

```
net           = grossPaise − discountPaise                 // transaction value, tax-inclusive
taxable       = round(net × 10000 / (10000 + rateBps))     // back out the tax
totalTax      = net − taxable                              // exact by construction, no drift
intraState    = supplierStateCode === placeOfSupplyStateCode
cgst = sgst   = intraState ? split(totalTax) : 0           // split() = floor/ceil pair summing to totalTax
igst          = intraState ? 0 : totalTax
```

`split(totalTax)` returns `[floor(t/2), t − floor(t/2)]` so **CGST + SGST == totalTax always**,
even on odd paise. This is the single most common source of GSTR mismatches; solving it with
integers makes it structurally impossible.

**Place of supply:** goods → the delivery address state (already snapshotted on
`Order.addressSnapshot`). Because the snapshot is immutable, the split is reproducible forever.

**Invoice rounding:** sum all lines, then a single `round_off` line to the nearest rupee
(`roundOffPaise ∈ [−50, +50]`), so `grandTotal % 100 == 0`.

### 3.4 Documents

**`TaxInvoice`** — immutable once `issued`.

```js
{
  tenantId, vendorId,                  // vendorId null = platform/store's own supply
  orderId, orderNumber,
  series: 'FM/24-25/A',                // per (supplier, FY, series)
  number: 'FM/24-25/A/000123',         // consecutive, gapless, ≤16 chars for the numeric part
  fyLabel: '2024-25',
  issuedAt, supplyDate,
  supplier: { snapshot of TaxRegistration },
  recipient: { name, gstin|null, address, stateCode },  // B2C if no GSTIN
  placeOfSupplyStateCode,
  lines: [{ orderItemId, description, hsnCode, qty, uom,
            grossPaise, discountPaise, taxableValuePaise,
            rateBps, cgstPaise, sgstPaise, igstPaise, cessPaise, natureOfSupply }],
  hsnSummary: [{ hsnCode, rateBps, taxableValuePaise, cgstPaise, sgstPaise, igstPaise }],
  totals: { taxableValuePaise, cgstPaise, sgstPaise, igstPaise, cessPaise,
            roundOffPaise, grandTotalPaise },
  status: 'draft'|'issued'|'cancelled',
  einvoice: { irn, ackNo, ackDate, signedQrPayload, status, lastError },
  pdf: { mediaAssetId, generatedAt },
  ledgerJournalId
}
```

**`CreditNote`** — same shape, `+ { originalInvoiceId, reason: 'return'|'cancellation'|'price_revision'|'deficiency', linkedRefundTransactionId }`, own series (`FM/24-25/CN`).

**`TaxDocumentSeries`** — the numbering authority:

```js
{ ownerType, ownerId, docType: 'invoice'|'credit_note', fyLabel, seriesCode,
  prefix, nextValue, width: 6 }
// unique (ownerType, ownerId, docType, fyLabel, seriesCode)
```

Numbers come from the existing atomic `Counter` pattern (`findOneAndUpdate($inc, upsert)`),
namespaced `taxdoc:{ownerId}:{docType}:{fy}:{series}`. **Gapless is a legal expectation**, so:
reserve the number *inside* the same transaction that issues the invoice; if issuance fails,
the transaction aborts and the number is not consumed. If a number *is* consumed and the
document must die, it is **cancelled, never deleted** (status `cancelled`, kept in the series).

### 3.5 Marketplace-specific duties

Three separate money flows that people routinely conflate:

1. **Seller → customer supply.** The *vendor* (or the store, for own inventory) is the
   supplier. The invoice is issued **on behalf of** the seller by the ECO. Seller's GSTIN on
   the invoice, not the platform's.
2. **Platform → seller service (commission).** The platform issues its **own tax invoice** to
   the vendor for the commission, with **GST on commission** (a taxable service). This is a
   *separate* document from the Phase-5 subscription `Invoice` — but the two should be merged
   into one monthly "platform tax invoice" with `subscription` + `commission` lines, since both
   are the platform's supply to the tenant. **The Phase-5 `Invoice` model becomes a
   `TaxInvoice` with `supplier = platform`.**
3. **Statutory collections.**
   - **TCS u/s 52** — the ECO collects a % of the net taxable value of supplies made through
     it and deposits it; reported in **GSTR-8**. Rate is effective-dated data (it has already
     been revised downward once by notification) — stored in a `StatutoryRate` collection,
     never a constant.
   - **TDS u/s 194-O** — income-tax deduction on the gross amount of sales to an e-commerce
     participant; also effective-dated data; reported in **26Q**.
   - Both are **deducted from the vendor payout** and posted to `tcs_payable` / `tds_payable`
     in the ledger — which is exactly why 6.1 comes first.

```js
// statutoryRate.model.js — data, not constants
{ kind: 'tcs_gst_52'|'tds_194o', rateBps, appliesTo: 'net_taxable'|'gross_sales',
  effectiveFrom, effectiveTo, notificationRef, note }
```

### 3.6 E-invoicing (IRP) — behind a provider, like everything else

`services/einvoiceProvider.service.js`, mirroring `paymentProvider`/`notificationProvider`:

- `console` (default) — logs the JSON payload, stamps a fake IRN. Dev/tests.
- `mock` — deterministic IRN + failure hook (a GSTIN ending in `13` fails, same joke as the
  payment mock) so retry paths are testable.
- `gsp` — real IRP via a GSP adapter (ClearTax / Masters India / NIC direct). Only activated
  when `einvoiceEnabled` and the supplier's turnover band requires it.

Rules: IRN is requested **at issuance**, asynchronously retried on failure (an invoice is not
blocked from being shown, but is flagged `einvoice.status = 'failed'` and surfaced in an ops
queue); IRN cancellation is time-boxed by the IRP (24h) — after that only a credit note works.
The signed QR payload is stored and rendered on the PDF.

### 3.7 Rendering

- **PDF** via a dependency-light renderer (`pdfkit`, ~1 dep) into the **existing media
  pipeline**: `storageProvider.writeBuffer(key, pdf)` → `MediaAsset {purpose: 'tax_invoice'}`
  → served through the existing `/media/local` or S3 path. No new storage concept.
- **Template is data** (`NotificationTemplate`-style `InvoiceTemplate` row per tenant: logo,
  footer, terms, signature image) so stores brand their own invoices.
- Customer access: `GET /orders/:id/invoice` (PDF) and `GET /orders/:id/invoice.json`.

### 3.8 Returns → credit notes

Wire into the existing returns flow (`returns.service` → `refund.service`), which already
splits refunds into `refundItemAmount / refundTaxAmount / refundFeeAmount` — that split was
built for exactly this:

```
return QC passed → refund.initiate()
   → creditNote.service.issueForRefund({ refundTransactionId })
       → lines = returned OrderItems, taxes recomputed from the ORIGINAL invoice line
         (never today's rate)
       → ledger journal `refund_issued` (reverses vendor_payable + commission_income + tax)
       → PDF + notification (`credit_note_issued` template)
```

**Never recompute tax from current policy on a refund.** The original `TaxInvoice.lines[]`
row is the authority — that is why it stores `rateBps` inline rather than a policy reference.

### 3.9 Filing exports

Reuse the Phase-4b `ExportJob` machinery (idempotent `jobKey`, artifact, download) with new
renderers:

| Export type | Contents |
|---|---|
| `gstr1_b2b` / `gstr1_b2cs` | outward supplies, invoice-wise (B2B) and rate-wise consolidated (B2C) |
| `gstr1_hsn` | HSN summary |
| `gstr1_cdnr` | credit/debit notes |
| `gstr8_tcs` | ECO TCS statement, per-seller GSTIN |
| `tds_194o_26q` | TDS deduction register |
| `sales_register` / `purchase_register` | accountant-friendly full dump |

All monthly, all idempotent on `jobKey = 'gstr1_b2b:{gstin}:{yyyymm}'`, all runnable from the
nightly pipeline and the admin console.

### 3.10 API surface (new)

| Method | Path | Role |
|---|---|---|
| `GET` | `/orders/:id/invoice` · `/invoice.json` | customer (own order) |
| `GET` | `/tax/invoices` (filters: series, from/to, gstin, status) | store admin |
| `GET` | `/tax/invoices/:id` · `/:id/pdf` | store admin |
| `POST` | `/tax/invoices/:id/cancel` | store admin (guarded, audited) |
| `POST` | `/tax/invoices/:id/einvoice/retry` | store admin |
| `GET` | `/tax/credit-notes` · `/:id` · `/:id/pdf` | store admin |
| `GET`/`PUT` | `/tax/registration` | store admin (own GSTIN) |
| `GET`/`POST`/`PATCH` | `/tax/policies` | **super_admin only** (rates are legal, not tenant choice) |
| `GET`/`POST` | `/tax/series` | store admin |
| `POST` | `/admin/exports` `{type:'gstr1_b2b', params}` | store admin (existing route, new types) |
| `GET`/`POST`/`PATCH` | `/marketplace/admin/statutory-rates` | super_admin |

### 3.11 Acceptance criteria (hand-verifiable)

1. **Inclusive maths.** Line: ₹590 MRP, 18% slab, no discount → `taxable = 500.00`,
   `CGST = 45.00`, `SGST = 45.00`, `total = 590.00`. Intra-state.
2. **Odd paise.** Line ₹100.01 @ 5% → `taxable = 95.25`, `tax = 4.76`, `CGST = 2.38`,
   `SGST = 2.38`. `CGST + SGST == tax` exactly.
3. **Inter-state.** Same order, delivery state ≠ supplier state → `IGST = 90.00`, CGST/SGST = 0.
4. **Mixed basket.** Fresh flowers (nil) + a ceramic pot (18%) → two HSN summary rows, nil-rated
   value reported separately, grand total unchanged from what the customer paid at checkout.
5. **Numbering.** 200 concurrent invoice issuances produce 200 consecutive numbers, no gaps,
   no duplicates (concurrency test).
6. **FY rollover.** An invoice issued 31-Mar and one on 1-Apr land in different series with the
   numeric part restarting at 1.
7. **Credit note.** Return one of two items → credit note reverses exactly that line's tax,
   references the original invoice number, and the ledger's `vendor_payable` drops by the
   net-of-commission amount.
8. **Immutability.** `PATCH` on an `issued` invoice → `409 INVOICE_IMMUTABLE`.
9. **Replay.** Re-running invoice generation for the same order → same invoice, no new number.

---

## 4. Workstream 6.3 — Vendor payouts (real disbursement)

*~2.5 weeks. Depends on 6.1 and 6.2.*

### 4.1 The settlement model

Money does not move when an order is placed. It moves when it is **safe**:

```
order CONFIRMED   → sale_captured journal; vendor_payable credited but NOT eligible
order DELIVERED   → eligibility clock starts
+ returnWindowDays (policy, default 7, perishables 1)
+ pspSettlementLag (money actually in our bank, from the PSP settlement report)
→ becomes ELIGIBLE
→ swept into the next PayoutCycle for that vendor
→ PayoutBatch → provider → webhook → SETTLED (or REVERSED)
```

Two independent gates — **return risk** and **cash-in-hand** — and a payout only happens when
both are open. Paying before the PSP settles is lending your own money; paying before the
return window closes is buying back your own goods.

### 4.2 Models

```js
// payoutPolicy.model.js  — per platform, overridable per vendor (DATA)
{ scope:'platform'|'vendor', vendorId,
  scheduleCron: 'weekly:wed', minPayoutPaise: 50000,   // ₹500 floor
  returnWindowDays: 7, perishableReturnWindowDays: 1,
  holdOnDispute: true, negativeBalanceCarryForward: true,
  deductions: { commission:true, gstOnCommission:true, tcs:true, tds:true, shippingShare:true } }

// vendorPayoutAccount.model.js  — bank details, never logged, never returned raw
{ vendorId, method:'bank'|'upi',
  accountHolderName, accountNumberEnc, ifsc, vpa,   // encrypted at rest, masked in API
  fingerprint,                                       // sha256(acct+ifsc) — dedupe & change detection
  verification: { status:'unverified'|'pending'|'verified'|'failed',
                  method:'penny_drop'|'vpa_validate', ref, verifiedAt, nameMatchScore },
  kyc: { pan, gstin, docs:[mediaAssetId], status, reviewedBy, reviewedAt },
  isDefault, status:'active'|'disabled' }

// payoutLineItem.model.js  — the eligibility ledger, one row per order item
{ vendorId, tenantId, orderId, orderItemId, invoiceId,
  grossPaise, taxPaise, commissionPaise, gstOnCommissionPaise,
  tcsPaise, tdsPaise, shippingSharePaise, netPayablePaise,
  eligibleAt, state:'accrued'|'eligible'|'held'|'batched'|'paid'|'reversed',
  holdReason, payoutBatchId, creditNoteId }

// payoutBatch.model.js
{ batchNumber:'PO-2609-0007', vendorId, cycle:{from,to},
  lineItemIds[], grossPaise, deductionsPaise, netPaise,
  openingBalancePaise, carryForwardPaise,
  state, providerRef, providerStatus, utr, failureReason,
  idempotencyKey UNIQUE, initiatedBy, initiatedAt, settledAt,
  ledgerJournalIds[], statementMediaAssetId }

// payoutAdjustment.model.js  — penalties, goodwill, manual corrections (audited, reason-coded)
{ vendorId, amountPaise (signed), reasonCode, note, createdBy, appliedInBatchId }
```

### 4.3 Payout state machine (explicit — nothing inferred)

```
DRAFT ──compute──► PENDING_APPROVAL ──approve──► QUEUED ──submit──► PROCESSING
                          │                         │                   │
                       reject                    cancel            provider webhook
                          ▼                         ▼               ┌───┴────┐
                       REJECTED                 CANCELLED           ▼        ▼
                                                                 PAID    FAILED ──retry──► QUEUED
                                                                            │
                                                                        REVERSED (bank return)
```

Guarded exactly like `orderStateMachine.js` — a frozen adjacency map, `assertTransition()`,
and a `PayoutStatusHistory` row on every hop. Approval is a **separate role action**
(`authorize(SUPER_ADMIN)` + optional maker-checker above a configurable amount) because this
is the one endpoint in the system that moves real money out.

### 4.4 The computation (worked example — this is the acceptance test)

Vendor sells 10 bouquets @ ₹590 (18% inclusive), commission 10%, in-state, TCS 0.5%,
TDS 0.1% (rates from `StatutoryRate` on the supply date):

```
gross (customer paid)              = 5 900.00
  taxable value                    = 5 000.00
  GST (CGST 450 + SGST 450)        =   900.00     → gst_output (seller's liability)

commission base = taxable value    = 5 000.00
commission @10%                    =  −500.00     → platform_commission_income
GST on commission @18%             =   −90.00     → gst_output_payable (platform's own supply)
TCS u/s 52 @0.5% of taxable        =   −25.00     → tcs_payable
TDS u/s 194-O @0.1% of gross       =    −5.90     → tds_payable
shipping share (policy)            =     0.00
─────────────────────────────────────────────
net payable to vendor              = 5 279.10
```

Every one of those seven numbers is a ledger entry, every rate is an effective-dated data row,
and the sum is asserted: `netPayable + commission + gstOnCommission + tcs + tds == gross − sellerGst`.
The smoke test asserts these literal rupee figures.

**Refund inside the window:** one bouquet returned → credit note → a **negative**
`PayoutLineItem` (`state: 'reversed'`, `netPayablePaise: −527.91`) enters the next cycle. If
the vendor's cycle total goes negative and `negativeBalanceCarryForward` is on, the batch is
skipped and `carryForwardPaise` rolls to the next cycle, posted to `refund_clawback:{vendorId}`.

### 4.5 Disbursement provider

`services/payoutProvider.service.js` — same shape as `paymentProvider`:

| Provider | Behaviour |
|---|---|
| `console` (default) | logs the instruction, marks PAID after a tick. Dev. |
| `mock` | deterministic: net amount in paise ending `13` → FAILED; ending `17` → REVERSED after PAID. Makes every unhappy path testable without keys. |
| `razorpayx` | real — `POST /payouts` with `X-Payout-Idempotency` header, fund account created from `VendorPayoutAccount`, mode auto-selected (`IMPS < ₹5L`, `NEFT`, `UPI`), webhook `payout.processed|failed|reversed` verified with the **same HMAC-SHA256 raw-body pattern already used for Razorpay payment webhooks**. |
| `cashfree` | second adapter to prove the abstraction isn't razorpay-shaped. Ship the interface, stub the calls. |

**Idempotency is doubled:** our `PayoutBatch.idempotencyKey` (unique index) *and* the
provider's idempotency header. On any ambiguous failure (timeout, 5xx) we **never re-submit
blindly** — we call `providerGetByIdempotencyKey()` and reconcile. This is the single most
dangerous code path in the platform and it is written defensively:

```
submit() →
  try  provider.payout(...)                    // idempotency key = batch.idempotencyKey
  catch(network/timeout) →
       mark batch PROCESSING with providerRef=null and `needsReconciliation=true`
       // NEVER retry here — the reconciliation sweep resolves it
```

### 4.6 Reconciliation (the part everyone skips)

Three nightly sweeps, all idempotent, all reporting to an ops queue rather than silently fixing:

1. **`reconcilePayouts()`** — for every batch in `PROCESSING` older than N minutes, fetch by
   idempotency key/provider ref → transition to PAID/FAILED/REVERSED, post the journal.
2. **`reconcilePspSettlements()`** — ingest the PSP settlement report (CSV/API), match to
   `gateway_clearing` entries, post `psp_settled`, and flag unmatched amounts both ways.
3. **`verifyBalances()`** (from 6.1) — recompute every `AccountBalance` from the journal; drift
   must be zero; non-zero pages the ops channel via the existing notification pipeline.

Plus a **payout statement** per batch — CSV + PDF, order-item level with every deduction shown,
stored as a `MediaAsset`, downloadable by the vendor. Vendors dispute payouts constantly;
a line-item statement is the difference between a support ticket and a self-serve answer.

### 4.7 Safety rails

- **KYC gate:** no payout without `verification.status === 'verified'` **and** `kyc.status === 'approved'`.
- **Bank-change cooldown:** changing `VendorPayoutAccount` re-triggers penny-drop and freezes
  payouts for 24 h (`fingerprint` change detection). This is the standard defence against
  account-takeover payout redirection.
- **Amount ceilings:** per-batch and per-day platform caps in config; exceeding → manual approval.
- **Maker-checker:** batches above `PAYOUT_DUAL_APPROVAL_PAISE` need two distinct super_admins.
- **Everything audited:** `auditService.record()` on approve/submit/cancel/adjust with before/after.
- **Bank details never leave the server unmasked:** API returns `****1234` only; the encrypted
  column is `select: false` and in the `toJSONPlugin` secret denylist.

### 4.8 API surface (new)

| Method | Path | Role |
|---|---|---|
| `GET` | `/marketplace/vendor/payouts` · `/:id` · `/:id/statement.csv|pdf` | vendor (own) |
| `GET` | `/marketplace/vendor/payouts/upcoming` (eligible + held preview) | vendor |
| `GET`/`PUT` | `/marketplace/vendor/payout-account` (masked) | vendor |
| `POST` | `/marketplace/vendor/payout-account/verify` (penny drop) | vendor |
| `POST` | `/marketplace/vendor/kyc` | vendor |
| `GET` | `/marketplace/admin/payouts` (filters: state, vendor, cycle) | super_admin |
| `POST` | `/marketplace/admin/payouts/compute` `{cycle}` (idempotent) | super_admin |
| `POST` | `/marketplace/admin/payouts/:id/approve|reject|submit|cancel|retry` | super_admin |
| `POST` | `/marketplace/admin/payouts/:id/hold` `{reason}` | super_admin |
| `POST` | `/marketplace/admin/payout-adjustments` | super_admin |
| `POST` | `/marketplace/admin/payouts/reconcile` | super_admin / nightly |
| `GET` | `/marketplace/admin/ledger/accounts/:key/statement` | super_admin |
| `POST` | `/payouts/webhook/razorpayx` (raw body, HMAC verified) | public + signature |
| `POST` | `/marketplace/admin/kyc/:vendorId/review` | super_admin |

### 4.9 Acceptance criteria

1. The worked example in §4.4 reproduces to the paisa in a smoke test.
2. A delivered order is **not** eligible before `deliveredAt + returnWindowDays`.
3. A return during the window produces a negative line and the batch net drops accordingly.
4. `compute(cycle)` run twice creates **one** batch (idempotent on `{vendorId, cycle}`).
5. Mock provider FAILED → batch FAILED, `vendor_payable` restored, retry produces a **new**
   idempotency key and succeeds.
6. Provider timeout → batch stays PROCESSING, reconciliation resolves it, **no double payment**
   (asserted by ledger sum).
7. Payout blocked when KYC unverified → `403 PAYOUT_KYC_REQUIRED`.
8. Bank-account change freezes payouts for 24 h.
9. `verifyBalances()` drift = 0 after a full cycle of orders → refunds → payouts.
10. Vendor statement CSV line-item sum == batch net.

---

## 5. Workstream 6.4 — Subdomain & custom-domain routing

*~1 week. Independent — can start on day one.*

### 5.1 Goal

`rosebazaar.flowermarket.in` and `shop.rosebazaar.com` both resolve to tenant `rosebazaar`,
with **no `x-tenant-id` header**, without weakening the tenant-isolation guarantee that
`authenticate` currently enforces.

### 5.2 The security-critical part

`Host` is **attacker-controlled**. The current `tenantContext` trusts any `x-tenant-id`, and
`authenticate` then rejects a mismatch with the token (`TENANT_MISMATCH`) — that guard is what
actually keeps tenants apart, and it must survive unchanged:

```
resolution order (new):
  1. Host → subdomain slug        (public traffic; cached)
  2. Host → custom domain lookup  (verified domains only)
  3. x-tenant-id header           (ONLY for super_admin tokens, or when isDev)   ← tightened
  4. token tenant claim
  5. DEFAULT_TENANT_ID / first active tenant
INVARIANT (unchanged, re-asserted in tests):
  authenticated request ⇒ token.tenant === resolved tenant, else 401 TENANT_MISMATCH
```

Tightening rule 3 is the actual security win of this workstream: today *any* client can name
any tenant and only the token stops them. After 6.4, an unauthenticated request can only
address the tenant its hostname resolves to.

Also fix the dead branch found in review: `tenantContext` reads `req.auth?.tenant`, which is
never set (the key is `tenantId`, and `authenticate` runs later). Delete it.

### 5.3 Model + resolution cache

```js
// tenantDomain.model.js
{ tenantId, hostname: 'shop.rosebazaar.com',      // unique, lowercase
  kind: 'subdomain'|'custom',
  verification: { method:'dns_txt', token, status:'pending'|'verified'|'failed', verifiedAt },
  tls: { status:'none'|'provisioning'|'active'|'failed', issuer, expiresAt },
  isPrimary, redirectToPrimary, status:'active'|'disabled' }
```

Resolution is on the hot path of **every request**, so it gets a process-local LRU
(`hostname → {tenantId, at}`, 5-minute TTL, ~1k entries, invalidated on domain/tenant writes).
A cache miss is one indexed `findOne`. Measured target: **< 0.5 ms p99 added latency**.

### 5.4 Operational plan

- **DNS/TLS:** wildcard `*.flowermarket.in` (single ACM/Let's Encrypt cert) covers all
  subdomains with zero per-tenant work. Custom domains use on-demand TLS
  (Caddy `on_demand_tls` with an `ask` endpoint hitting `GET /internal/domains/allowed?host=`,
  or ALB+ACM with automation). The `ask` endpoint is the security boundary: only verified,
  active domains get a certificate — otherwise a stranger can DoS your ACME quota.
- **Verification:** owner adds `_fm-verify.<domain> TXT <token>` → `POST /marketplace/store/domains/:id/verify`
  → resolver check → `verified` → TLS provisioning → live.
- **CORS:** replace the static allowlist with a regex for `^https://[a-z0-9-]+\.flowermarket\.in$`
  plus the verified custom-domain set (cached), and **fail closed in dev too** (F3 from the
  review) with the sandbox preview host added explicitly.
- **Reserved slugs:** already in `config.marketplace.reservedSlugs` — extend with `mail`, `ftp`,
  `cdn`, `static`, `assets`, `status`, `help`, `support`, `blog`, `pay`, `checkout`.
- **Canonicalisation:** non-primary hostnames `301` to the primary; emit `<link rel=canonical>`;
  robots/sitemap per tenant.
- **Sandbox/live-preview compatibility (important for this repo's workflow):** the preview host
  is `https://{port}-{sandbox}.e2b.app`, which has no tenant subdomain. Keep the header path
  working when `isDev`, and add a `?__tenant=slug` dev-only override so the existing Vite proxy
  setup keeps working unchanged.

### 5.5 Frontend: a real storefront app

Subdomains without a storefront is plumbing with nothing on the other end. Add
`frontend/apps/storefront` (Vite + React, same `@flower-market/shared` core):

- boots from `GET /storefront/bootstrap` (tenant resolved by Host) → branding, theme tokens,
  nav, feature flags;
- reuses the **existing untouched customer APIs**: `/catalog`, `/cart`, `/cart/slots`,
  `/cart/checkout`, `/orders/:id/timeline`, `/returns`, `/wallet` — i.e. this workstream also
  closes the "82 endpoints with no UI" gap from the repo review;
- theme from `Tenant.theme.primaryColor/accentColor` as CSS custom properties, so one build
  serves every store;
- SEO: pre-render product/category routes (Vite SSG) before considering SSR.

### 5.6 API surface (new)

| Method | Path | Role |
|---|---|---|
| `GET` | `/storefront/bootstrap` (Host-resolved) | public |
| `GET`/`POST`/`DELETE` | `/marketplace/store/domains` | store admin |
| `POST` | `/marketplace/store/domains/:id/verify` | store admin |
| `POST` | `/marketplace/store/domains/:id/primary` | store admin |
| `GET` | `/internal/domains/allowed?host=` | TLS `ask` hook (IP-allowlisted) |
| `GET` | `/marketplace/admin/domains` | super_admin |

### 5.7 Acceptance criteria

1. `curl -H 'Host: rosebazaar.flowermarket.in' /api/v1/catalog` returns rosebazaar's catalog
   with **no** `x-tenant-id`.
2. Same request with a *different* tenant's token → `401 TENANT_MISMATCH`.
3. `x-tenant-id` from a non-super_admin token pointing at another tenant → rejected (new).
4. Unverified custom domain → `ask` endpoint returns 404 → no certificate issued.
5. Unknown host → `404 STORE_NOT_FOUND`, never a fallback to the default tenant (that would be
   a silent cross-tenant leak).
6. Cached resolution adds < 0.5 ms p99; cache invalidates within 5 s of a domain change.
7. Existing header-based clients (admin console, mobile) keep working unchanged.

---

## 6. Workstream 6.5 — Search ranking

*~2 weeks. Independent.*

### 6.1 What exists

`catalogSearch.service.search()` builds a `$regex` `$or` across four fields inside an
aggregation. That means: a **collection scan per query**, no relevance (the `relevance` sort key
literally sorts by `searchText` alphabetically — a bug hiding in plain sight), no typo
tolerance, no synonyms, no facet counts, no ranking signals. There *is* a `text` index on
`ProductMaster` that nothing uses.

### 6.2 Strategy: provider abstraction + staged rollout

Follow the repo's own playbook — abstract the provider, ship the simple one, keep the door open:

```js
// services/searchProvider.service.js
interface SearchProvider {
  index(docs) · delete(ids) · search(query, opts) · suggest(prefix) · health()
}
```

| Provider | When |
|---|---|
| `mongo` (default) | Stage 1 — `$text` + weighted scoring pipeline. Zero new infrastructure. |
| `atlas` | Stage 2 — Atlas Search: fuzzy, synonyms, autocomplete, facets natively. One config change if already on Atlas. |
| `opensearch` | Stage 2 alt — self-hosted, full control, BM25 + function scoring. |

**Indexing feeds off the outbox that already exists.** `CatalogEvent` already emits
`product_created/updated`, `price_changed`, `stock_changed`, `tenant_product_created/updated`.
The search indexer registers on the same drain as the notification consumer
(`notificationService.initConsumer()` pattern) — no new event plumbing, and index freshness
inherits the outbox's at-least-once guarantee.

### 6.3 The search document

One denormalized `SearchDocument` per **(tenant, listing)** — because the same global master has
a different price, stock and status per tenant:

```js
{ _id: `${tenantId}:${listingId}`,
  tenantId, listingId, masterId, vendorId,
  title, titleNgrams, brandName, categoryPath: ['Flowers','Roses'], tags[], attributes{},
  searchText, suggest[],                    // prefix tokens for autocomplete
  pricePaise, mrpPaise, discountPct,
  inStock, stockQty, availabilityScore,
  soldCount30d, viewCount30d, ctr30d, ratingAvg, ratingCount,
  isPerishable, freshnessHours, vendorRating, isPromoted, promotedUntil,
  listedAt, updatedAt, status }
```

### 6.4 Ranking — a scoring function, not a sort key

```
score = w_text   × textRelevance          // normalized $meta:'textScore' or BM25
      + w_pop    × log1p(soldCount30d)/log1p(maxSold)
      + w_ctr    × smoothedCtr            // (clicks+α)/(impressions+α+β), Bayesian-smoothed
      + w_stock  × availabilityScore      // 1 in stock · 0.3 low · 0 out (never hard-filter, always demote)
      + w_fresh  × freshnessDecay         // exp(−ageHours/τ) — matters for a flower market
      + w_margin × normalizedMargin       // business signal, small weight, always disclosed
      + w_vendor × vendorRating
      + boost(isPromoted) − penalty(recentlyReturned)
```

**Ranking profiles are DATA**, exactly like `Plan` and `NotificationTemplate`:

```js
// rankingProfile.model.js
{ code:'default'|'freshness_first'|'experiment_b',
  tenantId,                                  // null = platform default
  weights: { text:1.0, pop:0.6, ctr:0.5, stock:0.8, fresh:0.4, margin:0.1, vendor:0.2 },
  boosts:  [{ when:{categoryId}, factor:1.2 }],
  pins:    [{ query:'rose', listingIds:[…] }],   // editorial control
  buries:  [{ listingIds:[…] }],
  isActive, trafficPct }                          // A/B split
```

An ops user retunes ranking from the console without a deploy — and every change is audited,
so a revenue dip is traceable to a weight change.

### 6.5 Query understanding

- **Synonyms as data** (`SearchSynonym`: `{terms:['gulab','rose','roses'], type:'equivalent'}`) —
  essential for an Indian catalogue where users type *gulab*, *mogra*, *jasmine*, *chameli*
  interchangeably, plus Hinglish transliteration.
- **Typo tolerance:** Stage 1 — trigram/n-gram field + edit-distance rescoring on the top 200;
  Stage 2 — native fuzzy.
- **Intent detection:** query → category/brand/attribute hints ("red roses bouquet under 500"
  → category=bouquet, attribute.color=red, priceMax=500). A small deterministic parser, not an LLM.
- **Zero-result recovery:** relax the last filter → spell-correct → category fallback → never
  show an empty page.
- **Autocomplete:** `GET /catalog/suggest?q=` over the `suggest` field, ≤ 30 ms, with
  query-log-derived popular completions.

### 6.6 Measurement — otherwise it's vibes

```js
// searchQueryLog.model.js  (sampled, TTL 90d, PII-free)
{ tenantId, sessionHash, query, normalizedQuery, filters, profileCode, experimentBucket,
  resultCount, latencyMs, clickedPositions[], addedToCart[], orderedListingIds[], at }
```

- **Online:** CTR@5, add-to-cart rate, zero-result rate, p95 latency, per profile bucket.
- **Offline:** a **judgment set** — 200 curated `(query, listing, grade 0–3)` rows in
  `SearchJudgment`, and an `npm run search:eval` script printing **NDCG@10 / MRR / recall@50**
  per profile. **A ranking change may not ship if NDCG@10 regresses.** That single rule is what
  separates a search *feature* from a search *system*.

### 6.7 API surface

| Method | Path | Notes |
|---|---|---|
| `GET` | `/catalog` (existing) | now ranked + faceted; **response shape unchanged** (additive `facets`, `queryId`) |
| `GET` | `/catalog/suggest?q=` | autocomplete |
| `POST` | `/catalog/search/events` | click/add-to-cart beacons (`queryId` + position) |
| `GET`/`POST`/`PATCH` | `/admin/search/profiles` | ranking profiles CRUD |
| `GET`/`POST` | `/admin/search/synonyms` | synonyms CRUD |
| `POST` | `/admin/search/reindex` | full rebuild, idempotent, resumable |
| `GET` | `/admin/search/analytics` | top queries, zero-result queries, CTR by position |

### 6.8 Acceptance criteria

1. "gulab" returns roses (synonym), "rse" returns roses (typo), "red roses under 500" respects
   both filters (intent parsing).
2. Out-of-stock items are demoted, never hidden — and never appear above an in-stock equivalent.
3. p95 search latency < 120 ms at 10k listings/tenant with facets on.
4. Reindex of 50k docs is resumable and idempotent; a crash mid-way loses nothing.
5. NDCG@10 on the judgment set improves ≥ 15% vs the current regex baseline (measured, printed).
6. Ranking profile weight change takes effect within 60 s without a deploy.
7. `GET /catalog` remains backward-compatible for the existing mobile/web clients.

---

## 7. Cross-cutting work

### 7.1 New enums (`constants/enums.js`)

`LEDGER_ACCOUNT_TYPE`, `LEDGER_JOURNAL_KIND`, `TAX_NATURE_OF_SUPPLY`, `TAX_DOC_TYPE`,
`TAX_DOC_STATUS`, `EINVOICE_STATUS`, `PAYOUT_STATE`, `PAYOUT_METHOD`, `PAYOUT_HOLD_REASON`,
`KYC_STATUS`, `BANK_VERIFICATION_STATUS`, `STATUTORY_RATE_KIND`, `DOMAIN_KIND`,
`DOMAIN_VERIFICATION_STATUS`, `TLS_STATUS`, `SEARCH_PROVIDER`, `RANKING_SIGNAL`.
Plus new `AUDIT_ACTION` values: `payout_approve|payout_submit|payout_reverse|invoice_issue|invoice_cancel|credit_note_issue|rate_override|domain_verify|ranking_change`.

### 7.2 Nightly pipeline (extend `services/maintenance.service.js` + `scripts/nightly-job.mjs`)

```
existing: forecast → analytics rollups → export jobs → run exports → drain events → notify
new:      + accrue payout line items      (delivered orders past the return window)
          + reconcile PSP settlements
          + reconcile in-flight payouts
          + verify ledger balances        (drift must be 0 → else alert)
          + compute payout batches        (on cycle days)
          + retry failed e-invoices
          + monthly: GSTR-1/GSTR-8/TDS export jobs
          + search index freshness check + delta reindex
```

Every step isolated and idempotent — the existing contract.

### 7.3 Config additions (`.env.example`)

```
# ---- Ledger / money ----
LEDGER_STRICT_BALANCE=true
MONGODB_REPLICA_SET=rs0            # enables transactions for financial writes

# ---- GST ----
EINVOICE_PROVIDER=console          # console | mock | gsp
EINVOICE_GSP_BASE_URL= / _API_KEY=
TAX_DEFAULT_STATE_CODE=37
TAX_PRICES_INCLUSIVE=true

# ---- Payouts ----
PAYOUT_PROVIDER=console            # console | mock | razorpayx | cashfree
RAZORPAYX_KEY_ID= / _KEY_SECRET= / _ACCOUNT_NUMBER= / _WEBHOOK_SECRET=
PAYOUT_MIN_PAISE=50000
PAYOUT_DUAL_APPROVAL_PAISE=10000000
PAYOUT_DEFAULT_RETURN_WINDOW_DAYS=7
PAYOUT_SCHEDULE=weekly:wed

# ---- Domains ----
PLATFORM_ROOT_DOMAIN=flowermarket.in
DOMAIN_RESOLUTION_CACHE_TTL_MS=300000
ALLOW_TENANT_HEADER_OVERRIDE=false  # true only for super_admin / dev

# ---- Search ----
SEARCH_PROVIDER=mongo              # mongo | atlas | opensearch
SEARCH_DEFAULT_PROFILE=default
SEARCH_LOG_SAMPLE_PCT=100
```

### 7.4 Frontend surfaces

| App | New |
|---|---|
| `apps/web` — **vendor** | Payouts list + statement download, upcoming payout preview, payout account + KYC wizard with penny-drop status |
| `apps/web` — **store admin** | Tax registration & series settings, invoice/credit-note browser + PDF preview, GST export centre, custom-domain manager with DNS instructions, search ranking tuner + query analytics |
| `apps/web` — **platform** | Payout batch queue (approve/reject/retry, maker-checker UI), ledger account explorer, reconciliation dashboard with drift alarms, statutory-rate editor |
| `apps/storefront` — **new** | Host-resolved customer storefront (catalog → cart → slot → checkout → track → returns) |

All wired through `packages/shared/src/api/endpoints.js` — **and this is the moment to add the
contract test** that failed in review (`adminInvoiceDetail` pointing at a non-existent route):
a CI script that diffs `endpoints.js` against the Express route table and fails on drift.

### 7.5 Test plan

New suites, following the existing hand-rolled style:

| Suite | Scenarios |
|---|---|
| `smoke-ledger.test.js` | 8 — balance invariant, allocation invariant, idempotent replay, crash injection |
| `tax-calc.test.js` | 14 — pure unit tests of the inclusive/exclusive maths, odd-paise splits, nil-rated, inter-state |
| `smoke-gst.test.js` | 12 — issue, number sequence under concurrency, FY rollover, credit note, immutability, GSTR-1 export shape |
| `smoke-payouts.test.js` | 16 — the §4.4 worked example, eligibility gates, return reversal, negative carry-forward, provider fail/reverse/timeout+reconcile, KYC gate, double-payment assertion |
| `smoke-domains.test.js` | 8 — host resolution, spoofed host, unknown host, header-override tightening, cache invalidation |
| `smoke-search.test.js` | 10 — synonym, typo, facet counts, demotion, pin/bury, profile switch, reindex resume |
| `search-eval.mjs` | NDCG@10 / MRR report vs the judgment set (gate, not a test) |

**Merge gate:** all 10 existing + 6 new suites green, `verifyBalances()` drift = 0, `vite build`
clean, endpoint contract diff empty.

---

## 8. Sequencing & effort

| Milestone | Content | Duration | Depends on |
|---|---|---|---|
| **M0** | Pre-flight fixes (§1) | 1 d | — |
| **M1** | Money core: paise helpers, ledger, journals, balances, verify sweep | 1.5 w | M0 |
| **M2** | GST engine: rates-as-data, tax service, invoice + credit note + numbering, PDF | 2 w | M1 |
| **M3** | GST filing exports + e-invoice provider + console UI | 0.5 w | M2 |
| **M4** | Payout accrual, eligibility, cycles, batches, state machine | 1.5 w | M2 |
| **M5** | Disbursement providers, webhooks, reconciliation, statements, KYC gate | 1 w | M4 |
| **M6** | Payout console (vendor + platform) | 0.5 w | M5 |
| **P1** | Subdomain + custom domain routing, CORS/TLS, header tightening | 1 w | M0 *(parallel)* |
| **P2** | Storefront app on Host resolution | 1 w | P1 |
| **S1** | Search provider abstraction, indexer on the existing outbox, Mongo ranked search | 1 w | M0 *(parallel)* |
| **S2** | Synonyms, typos, facets, autocomplete, profiles + A/B, query log | 1 w | S1 |
| **S3** | Judgment set + NDCG evaluation harness + tuner UI | 0.5 w | S2 |

**Critical path:** M0 → M1 → M2 → M4 → M5 ≈ **7 weeks**; with the two parallel tracks staffed,
the whole phase lands in ≈ **8 weeks**. Sequential single-developer: ≈ 12 weeks.

**Suggested cut lines if time is short:**
- Ship M1–M2 + P1 first — legal correctness and hostname routing unblock real customers.
- Payouts can run **manually against a generated statement** for the first few cycles
  (`payoutProvider=console` + a human doing NEFT) — the ledger and statements are the hard
  part; automating the bank call is the easy part.
- Search S1 alone already beats the current regex scan measurably.

---

## 9. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **Double payout** | Money lost, unrecoverable | Dual idempotency (ours + provider), never blind-retry, reconcile-by-reference, ledger double-entry assertion, mock provider timeout tests |
| **Wrong GST split** | Penalties, ITC denial | Integer paise, `CGST+SGST==tax` by construction, effective-dated rates, CA review of the seed HSN table before go-live |
| **Gapless numbering violated** | Compliance finding | Number reserved inside the issuing transaction; cancel-never-delete; concurrency test at 200 parallel issues |
| **Host-header tenant spoof** | Cross-tenant data leak | Token-tenant guard retained, header override restricted to super_admin, unknown host → 404 (never default) |
| **No Mongo transactions** | Torn financial writes | Single-node replica set; journal-is-truth + recomputable balances as the fallback; nightly drift alarm |
| **PSP settlement lag misread** | Paying out money we don't have | Payout gated on `psp_settled` ledger entries, not on order status |
| **Rate change mid-period** | Wrong historical numbers | Everything effective-dated and snapshotted onto the document; invoices re-render from their own stored `rateBps` |
| **Search regression** | Silent revenue loss | NDCG gate in CI, A/B by traffic %, one-click profile rollback |
| **Bank-detail takeover** | Fraudulent redirection | Penny-drop re-verification + 24 h freeze on fingerprint change + audit + notification to the vendor |
| **Scope creep** | Phase never ships | The four workstreams have independent exit criteria; ship M1–M2 alone if needed |

---

## 10. Explicit non-goals (Phase 7 candidates)

International/multi-currency, GST composition-scheme sellers, e-way bills, vendor advances and
credit lines, dynamic/personalized pricing, ML learning-to-rank (the profile weights are the
hand-tuned precursor — collect the query log now so LTR has training data later), buyer-side
GST ITC portal, subdomain-level custom themes beyond colour tokens, real-time settlement.

---

## 11. Definition of done

- [ ] All 10 existing backend suites green + 6 new suites green
- [ ] `verifyBalances()` reports **zero drift** across a seeded month of orders/refunds/payouts
- [ ] The §4.4 payout example and the §3.11 GST examples reproduce to the paisa in tests
- [ ] 200-concurrent invoice issuance → 200 consecutive numbers, zero gaps/duplicates
- [ ] A vendor completes: KYC → sale → invoice → return → credit note → payout → statement,
      end-to-end on the demo server, and every rupee is explainable from the ledger
- [ ] `curl -H 'Host: <slug>.<root>'` serves the right tenant with no header; spoofed host and
      unknown host both fail closed
- [ ] Search NDCG@10 ≥ +15% vs baseline, p95 < 120 ms
- [ ] `endpoints.js` ↔ route-table contract diff is empty in CI
- [ ] `docs/API.md`, `docs/DATA_MODELS.md`, `docs/ROADMAP.md` updated; this document marked SHIPPED
