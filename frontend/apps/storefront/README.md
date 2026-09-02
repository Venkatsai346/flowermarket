# @flower-market/storefront

The customer-facing shop. One build serves **every** store on the platform.

## How it knows which store it is

It doesn't — the API does.

```
GET /api/v1/domains/bootstrap      (no parameters, no tenant id, no header)
```

The backend resolves the tenant from the `Host` the browser used
(`{slug}.{PLATFORM_ROOT_DOMAIN}` or a verified custom domain, Phase 6.4) and
returns branding, theme tokens and feature flags. Consequently:

* **there is no `x-tenant-id` header anywhere in this app.** The console needs
  one because it can administer any tenant; a storefront is only ever one
  store. Nothing here knows a tenant id, so nothing here can address the wrong
  tenant.
* **there is no per-store build.** Brand colours arrive as data and are written
  onto `:root` as CSS custom properties (`src/theme.js`). Text colour on the
  brand is chosen by **computing WCAG luminance**, so a store that picks pale
  yellow doesn't end up with white-on-yellow buttons.
* **the shell renders only after bootstrap resolves**, so a customer never sees
  a flash of the wrong brand.
* **sessions are namespaced by hostname** (`fm-shop:{host}`), so two stores open
  in two tabs can never share a cart or a login.

## What it covers

Catalog with search, category rail, sort and stock filter · product sheet ·
server-side cart with inline steppers and coupons · phone-OTP sign-in ·
checkout (address → held delivery slot → payment) · order list and tracking.

Every one of these endpoints has existed since Phase 3 and had **no client at
all** until now.

## Running it

```bash
npm run storefront          # :5174, proxies /api → :4000
npm run build:storefront
```

In development the API falls back to header/default tenant resolution because
`localhost` is classified as infrastructure — so the app works without DNS. In
production it is served for every `{slug}.{root}` hostname and for verified
custom domains.

## Deliberate omissions

Server-side rendering (the catalogue is behind a tenant lookup; SSG per store
comes with search in S1–S3), wishlists, reviews and returns initiation — the
returns API exists and the UI is a follow-up.
