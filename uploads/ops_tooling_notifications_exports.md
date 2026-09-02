# Phase 4b — Ops Tooling: Notifications (push · email · SMS) + Scheduled CSV/BI Exports

> Author: Arena.ai Agent Mode · Date: 2026-09-01 · Status: **design** → implementation
> Follows `admin_dashboard_api_analytics.md` (Phase 4). No external blueprint was provided —
> this document IS the plan, built on the system's standing constraints.

---

## 1. Root problem

Phase 4 gave the admin a full read/write surface, and Phase 3/3.5 publish domain events to a
durable outbox (`catalogEvents`) — but **nobody listens for the customer**. Order confirmed,
rider en route, delivered, refunded — these should reach the user on push, email and SMS.
Separately, the analytics rollup (`analyticsdailies`) exists but there is **no way to
schedule or ship reports** (CSV) without calling the API by hand at 2 AM.

Phase 4b adds two pipelines, both built on the same proven patterns already in the codebase:

1. **Notification pipeline**: template engine → devices → outbox → provider adapters,
   fed by the existing event outbox (a `registerCatalogEventHandler` consumer).
2. **Scheduled export pipeline**: idempotent export jobs → rendered artifacts, run by the
   same nightly pipeline that already builds forecasts and analytics.

## 2. Principles

1. **Provider abstraction, always** (same as `paymentProvider`/`SmsSender`): push/email/SMS
   adapters with a `console`/`mock` default. Code never depends on which provider is
   configured; real FCM/APNs/SMTP/Twilio slot in behind the same interface.
2. **Outbox everything**: notification sends and export jobs are durable rows with status +
   retry — never fire-and-forget in the request path. `drain()`-style processing with
   `attempts`/`lastError`.
3. **Idempotency**: notifications dedupe on `dedupeKey` (e.g. `order_confirmed:{orderId}`),
   export jobs on `jobKey` (e.g. `analytics_daily:2026-09-01`). Re-running is safe.
4. **Templates are data**: bodies live in `notificationtemplates` with `{{placeholders}}`,
   editable via admin API — no code deploys for copy changes. Per-channel variants
   (push/email/sms) with a platform default fallback (tenantId null).
5. **Multi-tenant + RBAC**: everything tenant-scoped; customer device/inbox endpoints
   require auth; admin template/export endpoints require ADMIN/SUPER_ADMIN.
6. **Scheduled = the nightly pipeline**: one orchestrator (forecast → analytics rebuild →
   due exports → drain events→notifications), callable as an admin endpoint AND a
   `scripts/nightly-job.mjs` for real cron.

## 3. Data models (all tenant-scoped, soft-delete, audit, toJSON plugins)

### 3.1 `devices` — push destinations
`tenantId`, `userId`, `provider` (`fcm` | `apns`), `platform` (`android` | `ios` | `web`),
`pushToken` (unique per user+provider), `status active|disabled`, `lastSeenAt`,
`metadata {appVersion, deviceModel, locale}`. Unique partial index on active
`(userId, provider, pushToken)`; user can hold multiple devices (phone + tablet).

### 3.2 `notificationtemplates` — the copy engine
`tenantId` (null = platform default), `code` (unique per tenant, e.g. `order_confirmed`),
`eventType` (nullable — auto-trigger), `channels` (`push|email|sms` allowed), per-channel:
- `subject` (push title / email subject)
- `body` with `{{placeholders}}` (e.g. `Order {{orderNumber}} confirmed — arriving {{slot}}`)
- `isActive`, `priority` (`low|normal|high`), `version`, `effectiveFrom/effectiveTo`.

### 3.3 `notifications` — outbox + inbox (one row per user-message)
`tenantId`, `userId`, `templateCode`, `templateVersion`, `channels[]`,
`dedupeKey` (unique), `payload` (resolved placeholder data snapshot), `title`/`body`/`subject`
(rendered at enqueue), `status pending|sending|sent|failed|read`, `attempts`, `lastError`,
`sentAt`, `readAt`, `channelStatus` (per-channel `{push: sent, email: failed, ...}`).
This row is BOTH the send queue and the app's notification inbox.

### 3.4 `exportjobs` + `exportartifacts` — scheduled reports
- `exportjobs`: `tenantId`, `jobKey` (unique — idempotency), `type`
  (`analytics_daily|orders|inventory|products|users`), `params` (date range/filters
  snapshot), `status pending|running|done|failed`, `attempts`, `lastError`, `artifactId`,
  `scheduledFor` (Date), `requestedBy`.
- `exportartifacts`: `tenantId`, `type`, `params`, `csv` (rendered content, BOM),
  `rowCount`, `sizeBytes`, `requestedBy`, `completedAt`. Content is stored in Mongo (the
  platform's single store) — object storage is a later swap, not a dependency.

## 4. API surface

### Customer (`/me` — authenticated)
| endpoint | purpose |
| --- | --- |
| `GET /me/devices` · `POST /me/devices {provider, platform, pushToken}` · `DELETE /me/devices/:id` | register / list / remove push destinations |
| `GET /me/notifications?status=&page=` | notification inbox (history) |
| `POST /me/notifications/:id/read` | mark read |

### Admin (`/admin` — ADMIN/SUPER_ADMIN)
| endpoint | purpose |
| --- | --- |
| `GET/POST /admin/notifications/templates` · `GET/PATCH/DELETE /admin/notifications/templates/:id` | template CRUD (copy + channels + event trigger) |
| `GET /admin/notifications?status=&userId=&from=&to=` | notification log (all users) |
| `POST /admin/notifications/send {templateCode, userId?, data, channels?}` | manual send (test) |
| `POST /admin/notifications/process {limit?}` | drain event outbox → notifications (the worker hook) |
| `GET /admin/exports?status=&type=` · `POST /admin/exports {type, params, scheduledFor?}` | list / create export job (idempotent on jobKey) |
| `GET /admin/exports/:id` · `GET /admin/exports/:id/download` | job detail / download rendered CSV |
| `POST /admin/exports/run {limit?}` | run due export jobs |
| `POST /admin/maintenance/nightly {from?, to?}` | full nightly pipeline (forecast → analytics → exports → notifications) |

## 5. Business rules

- **Template resolution**: `notificationtemplates.findOne({tenantId, code, isActive})`
  falling back to `{tenantId: null, code, isActive}` (platform default). Missing template →
  message logged, NOT an error that fails the outbox drain.
- **Rendering**: `{{key}}` replaced from `payload`; unknown keys → empty string; result
  truncated to template `maxLength` (email 10k, sms 1600, push 500) with `…`.
- **Dispatch**: one `notifications` row per (user × template × dedupeKey); `channels`
  intersected with the template's channels and the user's reachable channels
  (push only if the user has an active device; sms/email only if the user has verified
  phone/email). Enqueue is synchronous & fast (one insert); SENDING happens in the worker.
- **Worker** (`processPending`): picks `pending` rows (limit), marks `sending`, calls each
  channel adapter, records per-channel status; all channels sent → `sent`; any failure →
  `failed` with `attempts`/`lastError` (retryable by re-running the worker).
- **Event mapping** (registered catalogEvent handler):
  `order_confirmed → order_confirmed`, `order_out_for_delivery → order_out_for_delivery`,
  `order_delivered → order_delivered`, `order_cancelled → order_cancelled`,
  `payment_failed → payment_failed`, `refund_initiated → refund_processed`,
  `rider_arrived → rider_arrived`. Payload enriches from the order doc (orderNumber,
  slot label, total) so templates have real data. Handler failures must NOT poison the
  drain — caught + recorded.
- **Export jobs**: `jobKey = {type}:{from}:{to}` (+hubId when present); creating an
  existing pending/done job returns it (idempotent); `runJob` renders via the Phase-4
  admin csv() functions, stores artifact, marks done; failures retry with attempts.
- **Nightly pipeline** (idempotent, each step isolated):
  1. `slotForecastingService.forecastUpcoming(days=7, dryRun=false)` (persists capacities)
  2. `analyticsService.rebuildDailyStats(from=today-30, to=today)` (upsert rollups)
  3. create `analytics_daily` export jobs for the last 30 days (jobKey idempotent)
  4. `exportService.runDueJobs()`
  5. `catalogEventService.drain(limit)` → notification consumer fires
  6. `notificationService.processPending(limit)`

## 6. Testing (`scripts/smoke-ops.test.js`)

1. Register a device (customer) → appears in `GET /me/devices`; duplicate token → dedupe.
2. Admin creates a template (`order_confirmed`, channels push+email+sms with placeholders).
3. Full checkout → delivered on the API → drain events → `notifications` rows exist for
   the customer with rendered title/body; template placeholders resolved from order data.
4. `POST /admin/notifications/send` (manual) → row created; `processPending` → sent with
   per-channel status; `GET /me/notifications` shows it; mark read flips status.
5. Export: create `orders` job → run → artifact has BOM + rows; duplicate create returns
   same job (idempotent); `download` returns text/csv; `analytics_daily` jobKey idempotent.
6. Nightly pipeline: `POST /admin/maintenance/nightly` runs without error; analyticsdailies
   exist; export jobs created; events drained.
7. Regression: all 7 prior suites still pass.

## 7. Acceptance criteria

- [ ] All 8 suites pass (7 existing + `smoke-ops.test.js`).
- [ ] Server boots with `/me/devices`, `/me/notifications`, `/admin/notifications/*`,
      `/admin/exports/*`, `/admin/maintenance/nightly`; live-verifiable.
- [ ] Notifications idempotent (dedupeKey) and provider-agnostic (console default).
- [ ] Export jobs idempotent (jobKey), artifacts downloadable.
- [ ] README / docs/API / docs/DATA_MODELS / docs/ROADMAP updated.
- [ ] Blueprint this file remains the source of truth.

## 8. Non-goals

- No real FCM/APNs/SMTP/Twilio SDK wiring in this pass (adapters + config hooks yes, live
  credentials no — same as razorpay: adapter now, keys later).
- No WebSocket/SSE realtime channel (inbox poll + push later).
- No attachment/binary exports (plain CSV; object storage later).
- No notification preferences matrix (per-channel toggles are a template concern, not a
  user-pref model, in this pass).
