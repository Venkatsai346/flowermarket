# Architecture

## Layering (strict, one-directional)

```text
routes/  →  controllers/  →  services/  →  models/   (Mongoose)
              │                  │
              └─ middleware ─────┘        utils/ (errors, jwt, hash, validators)
```

- **Routes** declare paths + middleware (auth, RBAC, validation, rate limits).
- **Controllers** are thin: parse validated input, call one service, wrap in the
  response envelope. No business logic.
- **Services** hold all business rules (OTP lifecycle, token rotation, ownership,
  serviceability, exactly-one-default, tenant scoping). Testable without HTTP.
- **Models** define schema, indexes, virtuals, and document methods only.
- **Middleware** is cross-cutting: `tenantContext`, `authenticate`, `authorize`,
  `validate`, `rateLimiter`, `errorHandler`.

## Request lifecycle

```text
client → helmet → cors → json → compression → morgan
      → /api/v1 → tenantContext (resolve tenant + auth policy)
      → route → validate(schema) → authenticate (JWT → user)
      → authorize(roles) → controller → service → model
      → response envelope → errorHandler (on any throw)
```

## Auth flows

1. **OTP-first** (default, BigBasket-style): `POST /auth/otp/request` → code sent via
   provider abstraction (`console` in dev, MSG91/Twilio/SES later) → `verify` consumes
   the OTP atomically → account auto-created if first time → JWT + refresh issued.
2. **Password login**: available once a user sets a password (`/auth/password/change`,
   `/auth/password/reset`).
3. **Sessions**: short-lived JWT (15 min) + hashed rotating refresh (30 days) stored in
   `authtokens` with device context; logout/rotation/password-change revoke.

## Security checklist (implemented)

- bcrypt(12) password hashing; `passwordHash` `select:false` and stripped by `toJSON`.
- OTPs & refresh tokens stored as SHA-256; OTP compare via `timingSafeEqual`.
- Rate limiters: OTP send (5/10min), OTP verify (10/10min), login (10/10min) + standard.
- JWT signed with issuer + audience verification; tenant-scope guard on every request.
- helmet security headers, CORS allowlist, `x-powered-by` disabled, no stack traces in
  production responses (dev-only).
- Soft deletes everywhere; no destructive deletes in the codebase.
- Validation at the edge (Joi) and at the model (Mongoose validators) — defense in depth.

## Config & environment

All config is centralized in `src/config/index.js` (see `.env.example`):

```
NODE_ENV, PORT, MONGODB_URI
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_*_TTL_SECONDS, JWT_ISSUER, JWT_AUDIENCE
OTP_PROVIDER (console|memory|msg91|twilio|ses), OTP_*
DEFAULT_TENANT_ID, TENANT_HEADER
CORS_ORIGINS
RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET   (Phase 3)
```

## Scaling notes

- **Reads**: lean JSON via `toJSON` transforms; paginated lists with `meta` for infinite
  scroll; precomputed `searchText` + text index on products (Phase 2).
- **Writes**: TTL indexes self-clean OTPs/tokens; capacity updates on slots use
  optimistic locking (`version`).
- **Tenancy**: if a tenant grows huge, `{tenantId, …}` indexes keep tenant-scoped
  queries fast; collection sharding keys would follow `tenantId` later.
- **Going to production**: real OTP provider, Mongo Atlas + VPC, refresh-token cleanup
  job, `NODE_ENV=production`, secrets via secret manager (never `.env` committed).
