# Flower Market — Path to 100% World-Class

**Audience:** anyone finishing this platform for real customers, real rupees, and a brand people remember.  
**Surfaces in scope:** backend API · admin console (`apps/web`) · customer storefront (`apps/storefront`).  
**Out of scope for “100% of this product” but named:** Expo mobile (login-only scaffold), Phase-7 ideas.  
**As of:** 2026-09-08 · branch `arena/01a07c11-flowermarket` · Wave 1 live e2e **127/127** · Waves 2–5 shipped on this branch.

This document **does not** re-plan Phases 1–6. Those are shipped. It answers one question:

> What is still incomplete if the goal is a **complete, solid, robust, and stunning** end-to-end flower marketplace — not another feature dump?

---

## 0. Verdict

The backend is a **serious money system**. The admin console is a **complete ops surface**. The storefront is a **working customer loop**. Together they already beat most Indian D2C MVPs.

They are **not** yet a world-class florist platform you would put a real city on.

| Surface | Completeness (product) | Robustness | Beauty | What “100%” still means |
|---|---:|---:|---:|---|
| Backend | **88%** | **90%** | n/a | India-correct pricing, live providers, tenant lifecycle, PDF invoices, validation density, paise migration |
| Admin console | **92%** | **85%** | **70%** | Tenant suspend/activate, vendor product edit, chunk split, visual density, component tests |
| Storefront | **84%** | **82%** | **85%** | Wave 5: Checkout.js hardened (no script without keyId), profile, pin locality, sitemap/robots/JSON-LD |
| Mobile | **8%** | — | — | Not required for web 100%. A later product. |
| Platform overall | **~80%** | **~82%** | **~60%** | Waves 1–3 below. Wave 4 is the “stunning” leap. |

**The one-line strategy:** freeze the money core. Close the *customer-facing* holes that make a real shop fail. Then make it look like a florist, not a SaaS demo.

Do **not** rebuild search, ledger, payouts, GST engines, or the order saga. Those are already the best code in the repo.

---

## 1. What is already world-class (do not rebuild)

Treat these as load-bearing. New work must plug in, not rewrite.

**Money that cannot lie**
- Integer-paise engine, `allocatePaise`, `splitTaxPaise` (`CGST + SGST === tax` is structural).
- Double-entry ledger: balanced-or-nothing, idempotent journals, immutable corrections, recomputable balances.
- Payout batch machine whose **missing** `PROCESSING → QUEUED` edge is the double-pay defence.
- Wallet as a real ledger account (top-up, debit claim-token, refunds always return to wallet).
- GST reconstruction from *what was charged*, gapless FY numbering, IRN provider seam, GSTR working papers.
- Phases 10–20 integrity: audit hash-chain, fiscal period close, PSP settlement ingest, statutory deposits, bank statement, vendor/GST/bank reconcile + signed backfill. **e2e-live 121/121** on real mongod.

**Commerce that cannot oversell**
- Atomic slot lock (`$expr reservedCapacity < totalCapacity`).
- Cart snapshots + stale-price 409 until `confirmPriceChanges`.
- Order **orchestrator** (not choreography) with a compensating action on every failure.
- Two return flows (pickup+QC vs perishable instant claim).
- Host-first multi-tenancy: unknown store subdomain **404s**, never falls back to the default tenant.

**Discovery**
- Two-stage ranking, synonyms (`gulab`/`mogra`), typo correction, zero-result relaxation.
- CI gate: mean **NDCG@10 = 0.996** (fail below 0.85).

**Proof, not folklore** (this sandbox, 2026-09-07)

| Gate | Result |
|---|---|
| `npm run smoke:all` (27 suites, MMS → mongod 6.0.7) | **PASS** |
| smoke-worker / smoke-observability | 6/6 · 7/7 |
| refund-calc / slot-forecast | 6/6 · 4/4 |
| e2e-live against live API | **121/121** |
| async-payment-live | 14/14 |
| admin TAP + storefront unit | 50 + 7 |
| CI workflow | 4 jobs (hermetic / frontend / live-e2e 121 / Chromium UI) |

The money and the saga are done. The remaining work is **product completion, production wiring, and brand**.

---

## 2. Completeness map — current vs 100%

### 2.1 Customer loop (storefront)

| Step | Today | 100% |
|---|---|---|
| Land on a branded store from Host | ✅ bootstrap, theme CSS variables, WCAG ink, OG, LocalBusiness JSON-LD, sitemap.xml, robots.txt | floral photography already on kits |
| Know we deliver to *my* pin | ❌ hero always says “same-day slots”; no pin gate | Pin entry → serviceable / not, before browsing |
| Browse | ✅ grid, chips, sort, in-stock, autocomplete, `/search?q=` + facets | Wave 4: recently viewed, photography |
| Product | ✅ `/p/:slug` PDP (gallery, EAV care/vase-life, related, JSON-LD) | Wave 4: photography, occasion bundles |
| Cart | ✅ guest cookie/`x-guest-key`, merge on OTP | Guest cart (cookie/device) → merge on login |
| Coupon | ✅ API + cart apply | Surface on checkout (today easy to miss) |
| Address book | ✅ add / edit / default / delete + India PIN locality autofill + serviceability badge | no external postal API |
| Slot | ⚠️ fetched **without pincode**; hub falls back to first active | Slot list for the *address pin*; refuse unserviceable pins |
| Pay | ✅ Checkout.js on `payment_pending` (theme from `--brand`, UPI/card method filter, **no script without keyId**); webhook HMAC SoT; mock no-ops the widget | Live capture still needs Razorpay test keys |
| Track | ✅ 5-state rail + customer sentences per status + timeline | + live rider status, map optional, push/SMS |
| Invoice | ❌ `GET /tax/orders/:id/invoice` exists, UI never links it | Download GST invoice + credit note (PDF) |
| Notify | ✅ `shop.notifications` + storefront/console bell | — |
| Profile | ✅ `/account` — name, language (te/en), marketing consent via `PATCH /users/me` | — |

### 2.2 Store operator (admin console)

| Capability | Today | 100% |
|---|---|---|
| Catalog / listings / bulk / review | ✅ | polish optimistic-lock UX |
| Orders / fulfillment / returns / QC | ✅ | denser empty states, keyboard |
| Hubs, slots, forecast, inventory ledger | ✅ | |
| Policies, coupons, search tuning, GST | ✅ | |
| Users / staff / riders | ✅ | |
| Branding + custom domains | ✅ | live storefront preview on real Host |
| Billing (store) | ✅ | |
| Tenant suspend / force-plan / close | ❌ Lifecycle panel is **read-only** — no `POST /marketplace/admin/tenants/:id/status` | The single highest-leverage backend gap |
| Vendor product **edit** | ✅ pending-product edit modal | — |

### 2.3 Platform operator

| Capability | Today | 100% |
|---|---|---|
| Plans, applications, vendor review, KYC | ✅ | |
| Payouts, ledger explorer, trial balance, repair | ✅ | Turn **PSP settlement gate ON** in production |
| Nightly / exports / notifications admin | ✅ | |
| Live Razorpay / RazorpayX / GSP / FCM / S3 | seams only (`console`/`mock`) | Boot-time **refuse** mock in `NODE_ENV=production` |

### 2.4 Backend internals still open

| ID | Item | Why it still matters |
|---|---|---|
| B1 | Tenant lifecycle mutations | Cannot suspend a fraudulent/non-paying store |
| B2 | Checkout still **taxes on top** of price | Indian MRP is inclusive; customers are overcharged vs the shelf |
| B3 | Dual money: rupee-floats on orders/cart/wallet/analytics vs paise on ledger/GST/payouts | Ledger is exact; the shop is a half-paise away |
| B4 | PDF invoice/credit-note never rendered (`taxdocuments.pdf` is an empty slot) | Legal document customers actually need |
| B5 | Live providers unwired | Cannot take or send real money |
| B6 | `requirePspSettlement` defaults **false** | Can pay a vendor before PSP cash arrives |
| B7 | Joi `validate()` thin: fulfillment **3/22**, returns 2/5, orders 2/5, cart 6/12 | Ops surface is the worst |
| B8 | `smoke:all` omits worker, observability, refund-calc, slot-forecast (all green when run) | CI matrix incomplete |
| B9 | Runtime uploads tracked in git (`backend/storage/local`); root lockfile named `"bloomy"` | Hygiene |
| B10 | No production provider sanity check at boot | Silent mock in prod |
| B11 | Customer notification inbox orphaned | Backend complete, no client |
| B12 | Replica-set is now **solved in this sandbox**; still an infra runbook for deploy | Document + compose |
| B13 | No Docker/compose/k8s, no global API rate limit (auth only), no eslint/prettier | Production engineering |

---

## 3. The incomplete work, ranked

Severity: **P0** = cannot launch a real city · **P1** = customers/operators will feel it in week one · **P2** = world-class, not table-stakes · **P3** = later / explicit non-goal.

### 3.1 P0 — launch blockers (the shop would fail in the real world)

#### P0-1 · Real payments on the storefront
**Wave 5:** Checkout.js opens on `payment_pending` when `keyId` is present; mock mode never injects the script. Remaining: prove a live Razorpay test-mode capture on staging.

**Do:**
1. Return `{ keyId, gatewayOrderId, amountPaise, currency, customer }` from checkout when `paymentPending`.
2. Load Razorpay Checkout on the order page; on `handler`, rely on the webhook (already idempotent); poll `/orders/:id/payment` as today.
3. Hide Card/COD unless the method is actually enabled for the tenant/slot (`slot.codAllowed`).
4. Keep wallet as-is (already quote-gated).

**Done when:** a test card / UPI collect on staging captures, webhook confirms, inventory commits, and a duplicate webhook is a no-op. Browser suite `ui-async-payment.e2e.mjs` stays green.

#### P0-2 · Pincode is the front door
`resolveHub` falls back to the **first active hub** when the pin is missing or unserviceable. Checkout fetches `/cart/slots?date=` with **no pincode**. A Hyderabad pin (`500001`) can still get a Kakinada slot.

**Do:**
- Home: “Delivering to ______” chip (localStorage). Unserviceable → honest empty state, not a fake catalogue.
- Checkout: `GET /cart/slots?pincode={address.pincode}&date=…`.
- Checkout saga: reject if address pin is not serviceable (do not rely on hub fallback).
- Stop advertising “Same-day delivery slots available” as a hard-coded string.

**Done when:** pin `533001` checks out; pin `110001` cannot reserve a Kakinada slot.

#### P0-3 · Inclusive (MRP) pricing
`pricingPolicyService.computeOrderCharges` still does `lineTotal * gstSlabPct/100` **on top**. `TAX_PRICES_INCLUSIVE` and `utils/gst.js` already support inclusive mode; invoices reconstruct either way. The customer-facing number is wrong for India.

**Do:** flip the checkout path to inclusive, persist the same `OrderChargeBreakdown` shape, snapshot tax components, add a golden-file of 20 SKUs (rose bunch, bouquet 12%, plant 5%, nil-rated). Communicate: “shelf price is the price.”

**Done when:** a ₹299 rose (5% incl.) charges ₹299, not ₹314; invoice taxable + tax = 299; refunds reverse the same paise.

#### P0-4 · Production provider guard + runbook
A `NODE_ENV=production` boot with `PAYMENT_PROVIDER=mock` / `PAYOUT_PROVIDER=console` / `OTP_PROVIDER=console` must **exit 1**. Document the env matrix (Razorpay, RazorpayX or Cashfree, S3, SMTP/MSG91, optional GSP). Compose file: `mongod --replSet rs0` + API + worker + two Vite/nginx builds.

**Done when:** `docker compose up` on a blank VM serves storefront + admin against replica-set Mongo, and boot refuses mock money.

#### P0-5 · Tenant lifecycle API
`GET /marketplace/admin/tenants` is read-only. The Lifecycle panel correctly shows no buttons. A non-paying or abusive store cannot be suspended.

**Do:** `POST /marketplace/admin/tenants/:id/status` `{ status: 'active' | 'suspended', reason }` — Host resolution 404s for suspended, admin can still log in, in-flight orders complete, new checkout 403 `TENANT_SUSPENDED`. Then wire two buttons on `LifecyclePanel`.

**Done when:** suspend → storefront bootstrap 404; activate → store returns; action is audited.

---

### 3.2 P1 — complete the product (week-one gaps)

#### Storefront
| ID | Gap | Why | Shape of the fix |
|---|---|---|---|
| S-PDP | No `/p/:id` or `/p/:slug` | Unshareable, no SEO, sheet is not a product page | Route + gallery + care/vase-life from EAV + related + JSON-LD |
| S-INV | No invoice on order detail | `api.tax.orderInvoice` already exists | “Download GST invoice” after confirmed; PDF (B4) |
| S-GUEST | Cart requires Bearer | Bounce before OTP kills conversion | Anonymous cart id (httpOnly cookie) merge-on-login |
| S-BELL | No notification inbox | Routes exist | Shared `shop.notifications` + header bell |
| S-SEA | Search is a Home query string | No `/search?q=`, no facets | Dedicated page; backend facets already on the provider seam |
| S-I18N | `user.preferences.language` default `en`, unused | AP/Telugu market | `te`/`en` copy for chrome (catalogue stays merchant-authored) |
| S-AUTH | Add-to-cart 401 with a toast | Should open AuthSheet, then add | One `ensureAuth()` helper |

#### Admin
| ID | Gap | Shape |
|---|---|---|
| A-LIFE | Blocked on P0-5 | Suspend / activate / note |
| A-VEDIT | `updateVendorProduct` unused | Edit modal on vendor products |
| A-CHUNK | Vite >500 kB warning | `manualChunks` for lucide + charts |
| A-TEST | Pages have meta TAP only | Playwright already covers 44 admin checks; keep them as the contract |

#### Backend robustness
| ID | Gap | Shape |
|---|---|---|
| B7 | `/fulfillment` 3 validates / 22 routes | Joi every mutating body (POD type, reason, forecast flags) |
| B6 | Settlement gate off | Default `true` in production; ingest Razorpay settlements nightly |
| B8 | CI omissions | Add worker, observability, refund-calc, slot-forecast to `smoke:all` |
| B9 | Tracked `storage/local` + `"bloomy"` lock | `git rm --cached`, gitignore, delete root lock |
| RATE | Only auth is rate-limited | Global `standard` limiter on `/api/v1`; tighter on `/cart/checkout` |

#### Money correctness (not a rewrite)
| ID | Gap | Shape |
|---|---|---|
| B3 | Dual regimes | Migrate cart/order/wallet/analytics to paise **behind** `toPaise`; keep `rounding_difference` until drift is 0 for 30 days of prod traffic |
| B4 | Empty `taxdocuments.pdf` | Render with a small PDF lib (or HTML → headless) through the existing media pipeline; never block issue on PDF failure |

---

### 3.3 P2 — stunning (the florist, not the spreadsheet)

The storefront is a **competent grocery UI**: Inter, rose `#e11d48`, chips, sheets, steppers. Correct interaction design. It does not yet feel like **flowers**.

World-class here is taste, not more CRUD.

**Brand system**
- Display type (a serif or a humanist, not Inter everywhere).
- Photography: full-bleed hero of actual bunches, not a coloured slab + tagline.
- Paper / petal textures used sparingly (one hero, one empty state), never as noise.
- Motion: 200–300 ms, `prefers-reduced-motion` already respected — keep that.
- Per-tenant theme already works (CSS variables). Give merchants **three** brand kits (classic rose, marigold temple, tropical green) instead of a raw hex picker only.

**PDP that sells**
- 3–6 image gallery, pinch on mobile.
- “Vase life 7 days”, stem count, colour, occasion chips (data already on `attributeSchema`).
- Care card. Occasion bundles (“Sorry”, “Birthday”, “Pooja”).
- Complementary add (`+ greeting card`, `+ vase`) as extra listings, not a new domain.

**Trust**
- Delivery promise tied to the **entered pin** and next open slot (“Arrives today 4–7 pm”).
- Live order tracking copy that matches the 5 customer states (already mapped).
- GSTIN in footer once `TaxRegistration` exists for the store.
- COD / UPI / wallet badges only for methods that will actually work.

**Admin “solid”**
- The console should stay dense (operators want density). Invest in: empty illustrations, command palette (`g o` → orders), sticky save bars, and a single **money health** strip (trial balance · unsettled PSP · KYC blocked) on `/platform`.
- Do not pretty-up ledger tables into charts that hide paise.

**Performance / polish**
- Image `srcset` + WebP via the media pipeline.
- Storefront route-level code split (Checkout/Orders lazy).
- Remove leftover `--- FIX:` comments in `Checkout.jsx` (the array-unwrap is a smell; type the API instead).

---

### 3.4 P3 — explicit later (do not start now)

| Item | Why wait |
|---|---|
| Expo shopping app | Mapping is in `backend/docs/ROADMAP.md`. Shared client is ready. Do it after P0 payments + pin. |
| Guest checkout without OTP | Cart can be guest; **checkout identity** should stay OTP (fraud + wallet). |
| Customer reviews / ratings | No model. Ranking “review score” is CTR. Add only with moderation. |
| Wishlist / subscriptions | Nice; not the loop. |
| Multi-currency, e-way, LTR, ITC portal | Phase 7 in `ROADMAP.md`. Query log is already LTR fuel. |
| Atlas / OpenSearch | Mongo provider + NDCG 0.996 is enough until catalogue > ~50k docs/tenant. |
| Live map / rider GPS | Rider state machine is enough for v1. |

---

## 4. Program of work

Four waves. Each wave ships behind the existing CI (hermetic + live-e2e + Chromium). No wave starts a second money architecture.

### Wave 0 — 2 days · hygiene that unblocks everything
1. Untrack `backend/storage/local`, gitignore `storage/`, delete root `"bloomy"` lockfile.
2. Add `refund-calc`, `slot-forecast`, `smoke-worker`, `smoke-observability` to `smoke:all`.
3. Boot-time provider guard (`B10`).
4. Joi on every **mutating** `/fulfillment` and `/returns` route (`B7` first slice).
5. Compose: `mongo:6` rs0 + api + worker + `web` + `storefront` nginx.

**Exit:** `docker compose up` + `npm run smoke:all` green on a clean machine.

### Wave 1 — 1.5–2 weeks · a real shop can sell flowers
P0-1 Razorpay widget · P0-2 pincode door · P0-3 inclusive pricing · P0-5 tenant suspend · S-AUTH (add-to-cart opens OTP) · S-INV (invoice link, PDF can be HTML-to-file v1) · slot pincode on checkout.

**Exit:**
- Staging: pay with Razorpay test UPI, get a GST invoice, cancel, refund to wallet.
- Unserviceable pin cannot check out.
- Suspended tenant’s Host 404s.
- e2e-live 121 + async-payment-live 14 + storefront UI 29 still green, plus new pin/payment cases.

### Wave 2 — India-correct money in production · **SHIPPED**
B3 paise dual-write on cart/quote/order/wallet (`*Paise` siblings, rupee API unchanged, `MONEY_DUAL_WRITE_PAISE`) · B6 `requirePspSettlement` default **true in production** · B4 GST invoice **PDF 1.4** (never blocks issue) · B10 production provider guard (mock/console OTP/payments/payouts → exit 1) · MSG91 + Twilio OTP adapters (real HTTP) · RazorpayX payout-test mode documented · compose `mongo rs0 + api + worker + web + storefront` · `smoke:all` widened (guard, PDF, refund-calc, slot-forecast, worker, observability) · global API + checkout rate limits · fulfillment/returns/rider Joi on mutations · untracked `storage/local`, dropped `"bloomy"` lockfile.

**Exit still needing live keys:** one full day of staging traffic with `rounding_difference = 0`, settlement ingest matching Razorpay, a vendor payout batch that stops in PROCESSING on a timeout (no retry button — already true in UI). Live S3/MSG91/RazorpayX cannot be proven without credentials — seams refuse to mock-succeed.

### Wave 3 — 1 week · operator completeness · **SHIPPED**
A-LIFE buttons (Wave 1) · A-VEDIT (vendor pending-product edit modal) · A-CHUNK (`manualChunks` for lucide + charts) · notification bell (storefront + console inbox) · guest cart (httpOnly cookie / `x-guest-key`, merge-on-login) · `/p/:slug` PDP (gallery, care/vase-life from EAV, related, JSON-LD) · `/search?q=` with facets · global rate limit (Wave 2).

**Exit:** admin Chromium 44 still green; storefront UI e2e covers PDP `/p/:slug`, `/search?q=`, guest→login cart merge.

### Wave 4 — 2 weeks · stunning · **SHIPPED**
Brand kits (classic rose / marigold temple / tropical green) on `tenant.theme.kit` · floral hero photography · pin-aware “Arrives today 4–7 pm” from public slots · footer GSTIN from TaxRegistration · storefront `React.lazy` Checkout/Orders/PDP/Search · admin ⌘K + `g o` palette · i18n chrome `te`/`en` · platform money-health strip · Checkout `asList` (no `--- FIX:`) · OG/canonical. No sharp/WebP transcoder — merchants may upload WebP via the existing media pipeline.

**Exit:** a stranger on mobile, on a tenant Host, can: enter pin → browse a beautiful PDP → OTP → pay UPI → see “arrives today 4–7 pm” → download invoice. The page does not look like a Tailwind dashboard.

**Mobile (later):** implement the screen map in `ROADMAP.md` on the shared client. Do not start Expo to avoid finishing payments.

### Wave 5 — launch/trust · **SHIPPED**
Harden Razorpay Checkout.js (brand colour from `--brand`, UPI/card method filter, **never load checkout.razorpay.com without a keyId** — mock e2e safe) · `/account` profile (name, te/en, marketing) · India PIN locality on `GET /catalog/serviceability` (prefix table + hub city, no postal API) + shared AddressForm autofill · `GET /catalog/sitemap.xml` (host-tenant) + storefront `robots.txt` + Home LocalBusiness JSON-LD · order tracking copy · admin branding sticky save. Ledger / payouts / GST / ranking / saga untouched. Expo not started.

**Exit still needing live keys:** a test card / UPI collect on staging captures, webhook confirms, inventory commits. Unit tests cover no-script-without-keyId.

---

## 5. Architecture rules for the remaining work

These are how the existing system stayed coherent. Breaking them is how it stops being world-class.

1. **No new money arithmetic.** If a number moves, it goes through `toPaise` / `allocatePaise` / `splitTaxPaise` or it does not ship.
2. **No raw `fetch` in pages.** Shared `api.*` only. Invariants suite fails the build on drift — keep it that way.
3. **Host is the tenant.** Storefront must never grow an `x-tenant-id`. Admin may, on localhost only.
4. **UI never invents a transition.** Disable the button from the previous server status (fulfillment, payouts, rider). The state machine is the product.
5. **Providers fail loud.** `console`/`mock` are for tests. Production boot is a hard fail (Wave 0).
6. **Idempotency keys on every charge, refund, payout, webhook.** Already true — do not add a “just retry” button. The payout console is the reference.
7. **PDP and search URLs are data, not state.** If it isn’t in the address bar, it isn’t shareable and isn’t SEO.
8. **Taste is a constraint.** One typeface pair, one brand kit per tenant, no extra chart library on the storefront.

---

## 6. Definition of “100% complete” (acceptance)

The platform is 100% for **backend + admin + storefront** when all of the following are true. Anything else is Polaroid, not the product.

### End-to-end customer (Chromium, real mongod, Razorpay test mode)
1. Open `{slug}.flowermarket.in` → branded, pin asked.
2. Unserviceable pin → no false slots.
3. Share `/p/red-roses-bunch-of-20` → same product, gallery, care, JSON-LD.
4. Guest add-to-cart → OTP → cart preserved.
5. Checkout quote matches the button; GST is **inside** MRP.
6. UPI widget captures → webhook → confirmed → inventory down → slot confirmed.
7. Track 5 states; rider POD completes; return QC credits wallet to the paise.
8. Download GST invoice PDF; numbers match the order snapshot.
9. Suspend store → Host 404; in-flight order still visible to the customer who has the URL? **No** — 404 is correct; admin can still refund.

### Operator
10. Lifecycle: suspend / activate with reason, audited.
11. Fulfillment + rider + QC + manual refund — already true; remain green.
12. Payout: settlement gate on; in-flight batch offers **Reconcile only**.
13. Ledger integrity overall `ok`; hash chain 0 breaks; `rounding_difference` = 0 for the day’s orders.

### Engineering
14. `docker compose up` is the happy path.
15. CI: `smoke:all` (including worker/obs/refund/forecast) + live-e2e 121 + async 14 + storefront UI + admin UI.
16. Production process **will not start** on mock payments/payouts/OTP.
17. No runtime uploads in git. No `"bloomy"` lockfile.

### Beauty (Wave 4)
18. A person who sells flowers would put this on their visiting card.
19. Lighthouse mobile ≥ 90 performance / ≥ 95 a11y on Home + PDP (pin cached).
20. `prefers-reduced-motion` still kills decoration.

Until 1–17 are true, do not call it launched. Until 18–20 are true, do not call it stunning.

---

## 7. Suggested sequence of commits (when we start building)

Wave 0
1. `chore: stop tracking runtime uploads; drop bloomy lockfile`
2. `chore: widen smoke:all; production provider guard`
3. `fix(api): Joi on fulfillment/returns mutations`
4. `chore: docker compose for rs0 + api + worker + web + storefront`

Wave 1
5. `feat(api): tenant status mutations (suspend/activate)`
6. `feat(web): lifecycle actions on PlatformLifecyclePage`
7. `feat(api,storefront): pincode-first slots and serviceability`
8. `feat(storefront): Razorpay Checkout.js on payment_pending orders`
9. `feat(api): MRP-inclusive checkout (golden SKUs)`
10. `feat(storefront): invoice download on order detail`

Wave 2–4 follow the tables in §4. Keep each PR behind the existing invariant + e2e gates.

---

## 8. What we will not do

- Rewrite the ledger, payout machine, GST engine, or ranking scorer.
- Add a second cart (client-only) that can disagree with the server.
- Show a Retry on an in-flight payout.
- Let `x-tenant-id` beat Host in production.
- Ship a “stunning” redesign that regresses the 121 live money checks.
- Start the Expo app to avoid finishing payments and pin.

The unfinished work is **narrow and high-leverage**. The platform is already a serious backend with a complete ops console and a working shop. World-class is: **India-correct prices, real UPI, honest delivery area, a shareable product, a legal invoice, a kill-switch for a store, and a storefront that looks like flowers.**
