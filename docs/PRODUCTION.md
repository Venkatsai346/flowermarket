# Production runbook

The API **will not listen** in `NODE_ENV=production` if payments, payouts or
OTP are still on a mock/console adapter, or if JWT secrets are the development
defaults. That is [B10 / P0-4](./WORLD_CLASS_COMPLETION.md). This page is the
env matrix and the compose path.

## Replica set

Mongo **must** be a replica set (`rs0`). Multi-document transactions (ledger,
gapless invoice numbers, payout journals) no-op on standalone mongod.

```bash
mongod --replSet rs0 --bind_ip_all
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Compose does this for you (`mongo` + `mongo-init`).

## `docker compose up` (laptop / staging)

```bash
docker compose up
```

- API `:4000`, worker, admin `:5173`, storefront `:5174`
- `NODE_ENV=development` so mock payments and console OTP are allowed
- Mongo 6 replica set, transactions on

## Production overlay

Copy `backend/.env.example` → `backend/.env.production` and fill live
values. Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up
```

Boot refuses to start unless every row below is live.

| Concern | Env | Production value | Notes |
|---|---|---|---|
| Payments | `PAYMENT_PROVIDER` | `razorpay` | Implied if `RAZORPAY_KEY_ID` is set |
| | `RAZORPAY_KEY_ID` / `_SECRET` | live keys | Test keys are fine on staging |
| | `RAZORPAY_WEBHOOK_SECRET` | required | HMAC over the **raw** body |
| Payouts | `PAYOUT_PROVIDER` | `razorpayx` or `cashfree` | `console`/`mock` → exit 1 |
| | `PAYOUT_WEBHOOK_SECRET` | required | Same HMAC scheme |
| | `RAZORPAYX_KEY_ID` / `_SECRET` / `_ACCOUNT_NUMBER` | required for razorpayx | |
| | `PAYOUT_TEST_MODE` | `true` on staging | Same adapter, test keys, no live rupees |
| | `PAYOUT_REQUIRE_PSP_SETTLEMENT` | **on** in production | Gate 2. A vendor is paid only after a `psp_settled` journal |
| OTP | `OTP_PROVIDER` | `msg91` or `twilio` | `console`/`memory` → exit 1 |
| | `MSG91_AUTH_KEY` + `MSG91_TEMPLATE_ID` | required for msg91 | Real HTTP, no echo of the code |
| JWT | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -hex 64` | `change-me` / `dev-` → exit 1 |
| Host | `ALLOW_TENANT_HEADER_OVERRIDE` | `false` | Host is the tenant |
| Storage | `STORAGE_PROVIDER` | `s3` recommended | `local` is allowed but not for a public CDN |
| Ledger | `LEDGER_STRICT` | default on in production | |

A misconfigured production process prints every violation and exits 1
**before** opening a port. There is no “start anyway” flag.

## Money dual-write (Wave 2 / B3)

Cart, quote, order detail and wallet balance now include `*Paise` siblings
next to the existing rupee fields (`grandTotal` **and** `grandTotalPaise`).
The rupee API is unchanged. Turn off with `MONEY_DUAL_WRITE_PAISE=false`
only if a client chokes on extra keys.

Identity: `toPaise(rupee) === paise` at every money moment. The ledger,
GST documents and payouts were already integer paise; this is the shop
catching up, not a second architecture.

## GST invoice PDF (B4)

`GET /tax/orders/:id/invoice` returns `html` (print-perfect) **and**
`pdfBase64` (application/pdf). Issuing the numbered TaxDocument never waits
on the renderer — a PDF crash is logged and the legal document still exists.
The storefront “Download GST invoice” button saves the PDF; HTML is the
fallback if the renderer is skipped.

## PSP settlement ingest

`POST /payouts/settlements` (existing) posts `psp_settled` journals.
With the production default gate, `markEligible` will not promote a line
until that journal exists for the order. Ingest Razorpay settlement reports
nightly; do not flip the gate off to “make payouts move”.

## What we will not fake

Live Razorpay captures, RazorpayX disbursements, MSG91 deliveries and S3
uploads require credentials. The adapters are real HTTP. A missing key is
an error, not a silent success.
