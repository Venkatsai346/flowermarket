# Catalog governance

How the shared flower catalog stays consistent while tenants operate on it.
Single policy core: `backend/src/utils/catalogGuards.js`
(enforced in `changeRequest.service.js`, `productMaster.service.js`,
`tenantProduct.service.js`; pure tests in `backend/scripts/catalog-guards.test.js`).

## Vocabulary: `admin` means store owner, not platform staff

The `ADMIN` role is the **tenant store owner** (assigned at store creation,
`store.service.js`). Platform operators are `SUPER_ADMIN`. Any endpoint or
screen that mutates shared (tenant-less) catalog data MUST require
`SUPER_ADMIN` — granting `ADMIN` hands every store owner the keys to the
global catalog.

## The three catalog planes

| Plane | Data | Scope | Writes |
|---|---|---|---|
| Global | masters, categories, brands, images | none (`tenantId` absent) | `SUPER_ADMIN` only (`/catalog/admin/*`) |
| Tenant | listings, proposals, change requests | `tenantId` | `admin` / `vendor` of that tenant (`/catalog/tenant/*`) |
| Public | active masters + listings | — | read-only (`/catalog/public/*`) |

Tenants never write the global plane directly. They **propose** masters and
**file change requests**; platform staff **review** them. Listings
(`tenantProduct`) are the tenant's own rows keyed by (tenant, master, variant).

## Paid-plan gating (creation only)

Filing change requests and proposing masters cost platform review time, so
creation is gated to paid plans (`CHANGE_REQUEST_PLANS = ['pro',
'business']`, single predicate `assertCatalogWritePlan`). Enforcement:

- `POST /catalog/tenant/change-requests` → 402 `PLAN_UPGRADE_REQUIRED`
- `POST /catalog/tenant/masters/propose` → 402 `PLAN_UPGRADE_REQUIRED`

The gate runs **first**, before any validation or DB read. Existing requests
are grandfathered: `revise` / `cancel` stay available on any plan so a
downgraded tenant can always withdraw or fix pending work, and already-filed
requests remain reviewable. Upgrades unlock creation immediately (checked live
per request, never cached).

## Atomic reviews (no double-apply, no stranding)

Every decision path claims its row with a guarded atomic update
(`findOneAndUpdate` with the expected status in the filter) and re-reads the
row on loss so the loser gets the precise terminal-state error:

- `review` / `reviewCreateMaster` — claim `PENDING_REVIEW`; loser gets
  `REQUEST_ALREADY_REVIEWED` / `NOT_PENDING_REVIEW`.
- `deprecate` — claims the master (`ALREADY_DEPRECATED` on loss); only the
  winner cascades listings and emits audit + event.
- `cancel` / `revise` — claim `pending` / `needs_changes`
  (`REQUEST_NOT_PENDING` / `REQUEST_NOT_REVISABLE` on loss).
- `revise` records a `change_request_revised` audit entry (it previously
  mutated silently).

Approvals apply **inside the winner**: the claim flips the request, the effect
runs, and — if the effect throws — the claim is **reverted to pending** with
`applyAttempts + 1` and `lastApplyError`, plus a
`change_request_apply_failed` audit entry, and the original error is rethrown.
A change request is therefore never stranded in `approved` without its effect;
the queue shows the failure and the request stays retryable. Vendors may
`revise` a reverted request; staff may re-`approve` after fixing the cause.

## Master lifecycle seal

- Submit validates its target: `create_master` skips the check (it creates the
  target); every other type requires the master to exist (`404
  MASTER_NOT_AVAILABLE`) and be `ACTIVE` (`400 MASTER_NOT_ACTIVE`), except
  `deactivate_master` which accepts `ACTIVE` only via `assertMasterListable`.
- Activation is re-checked: enabling a listing requires its master to be
  `ACTIVE` (`409 MASTER_NOT_AVAILABLE`), so a master deprecated between
  listing creation and activation can never surface a zombie listing.
- Storefront search and cart-add only ever see `ACTIVE` masters; deprecation
  cascades every tenant listing to `INACTIVE`.

## Console split (defense in depth)

The API is the enforcement point; the console mirrors it so tenant admins never
open dead pages: `routeMap.js` and `nav.js` restrict `/catalog/masters`,
`/catalog/categories`, `/catalog/brands` to `super_admin`, and
`CatalogOpsPage` shows only the tenant-scoped tabs (listings, bulk) to store
owners while platform staff also get review, audit, and events.
