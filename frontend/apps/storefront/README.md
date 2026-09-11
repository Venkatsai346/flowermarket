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

* **there is no `x-tenant-id` header anywhere in this app — in production.**
  The console needs one because it can administer any tenant; a storefront is
  only ever one store. Nothing here knows a tenant id, so nothing here can
  address the wrong tenant. (DEV ONLY: `?asTenant=<id>` pins the tenant for
  local testing; the branch is `import.meta.env.DEV`-gated out of prod builds.)
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
checkout (address → held delivery slot → payment) · order list and tracking ·
**after-sales** — cancel an order, request a standard return or an instant
claim, and see returns, wallet balance, refunds and wallet activity
(`/returns`, `/wallet`, plus actions on `/orders/:id`). Wallet is also a
**payment method**: the checkout preflight (`POST /cart/quote`) returns the
exact server-authored total and "Pay with wallet" is exposed only when the
wallet balance covers that total.

Every one of these endpoints has existed since Phase 3 and had **no client at
all** until now. The after-sales endpoints had been shipped since Phase 3/3.5
and gained their customer UI here.

## Running it

```bash
npm run storefront          # :5174, proxies /api → :4000
npm run build:storefront
```

In development the API falls back to header/default tenant resolution because
bare `localhost` is classified as infrastructure — so the app works without
DNS. In production it is served for every `{slug}.{root}` hostname and for
verified custom domains.

## Testing multiple stores locally

One dev server acts as **every** store — no extra ports, no hosts-file edits,
no rebuilds. Browsers resolve `*.localhost` to loopback natively.

```bash
npm run storefront          # one server, :5174
```

Then open one tab per store (use each tenant's `slug` from the console or DB):

```
http://flower-market.localhost:5174     # store 1
http://rose-bazaar.localhost:5174       # store 2
http://lily-co.localhost:5174           # store 3
```

Each hostname gets its own sessions, carts and logins (storage is namespaced
by hostname), exactly like production subdomains. The backend resolves
`<slug>.localhost` only outside production (`ALLOW_LOCAL_SUBDOMAINS`, default
on in dev); an unknown slug fails closed with "No store at this address"
rather than silently showing the wrong store.

Two things that had to be true for this to work, and now are:

* the dev proxy preserves the `Host` header (`vite.config.js` deliberately
  omits `changeOrigin` — rewriting it would collapse every store to the
  fallback tenant);
* CORS already permits `*.localhost` origins in development.

Escape hatches: bare `http://localhost:5174` still shows the default/first
tenant (unchanged), and DEV-only `?asTenant=<tenantId>` pins any tab to any
tenant without touching the hostname (its storage is isolated per pin, but
changing the pin needs a reload for storage to follow — prefer hostnames).

## Deliberate omissions

Server-side rendering (the catalogue is behind a tenant lookup; SSG per store
comes with search in S1–S3), wishlists and reviews. Returns initiation is now
shipped; what remains deliberately out of scope is anything that needs a
customer profile beyond phone-OTP (e.g. profile editing, address management in
a dedicated settings surface) and the native rider/picker apps.
