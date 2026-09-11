/**
 * Storefront API binding.
 *
 * ── The point of Phase 6.4, in one absence ──────────────────────────────────
 * There is NO `x-tenant-id` header here. The console has to send one because
 * it can administer any tenant; a storefront is only ever one store, and the
 * API works that out from the `Host` the browser used. Nothing in this app
 * knows a tenant id, which means nothing in this app can address the wrong
 * tenant.
 *
 * Session storage is namespaced per hostname so two stores open in two tabs
 * never share a cart or a login.
 *
 * ── Local development with several tenants ───────────────────────────────────
 * On localhost the Host resolves to nothing, so the API serves DEFAULT_TENANT_ID
 * (or the first active tenant) — which may not be the store you just edited in
 * the console. In DEV ONLY, `?asTenant=<id>` sends `x-tenant-id` so you can pin
 * the storefront to the tenant under test. The backend ignores the header
 * whenever a real hostname resolved (unless the override flag is on), and the
 * branch is `import.meta.env.DEV`-gated so production builds cannot carry it.
 */
import { createApiClient, createEndpoints, createAuthStore } from '@flower-market/shared';

/** DEV-only: explicit tenant pin from `?asTenant=`. Null in prod, always. */
function readDevTenantPin() {
  try {
    if (!import.meta.env?.DEV) return null;
    if (typeof window === 'undefined') return null;
    const id = new URLSearchParams(window.location.search).get('asTenant');
    return id && /^[0-9a-fA-F]{24}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const host = typeof window !== 'undefined' ? window.location.hostname : 'server';
// DEV-only `?asTenant=` pins the tenant without changing the hostname, so the
// pin joins the storage namespace — three tabs pinned to three stores keep
// three isolated carts/sessions. In production the pin is always null and the
// keys are exactly `fm-shop:{host}` / `fm-guest:{host}` as before. (Captured
// at load: changing the pin needs a reload for storage to follow.)
const devPin = readDevTenantPin();
const storageKey = `fm-shop:${host}${devPin ? `:${devPin}` : ''}`;
const guestStorageKey = `fm-guest:${host}${devPin ? `:${devPin}` : ''}`;

export function readGuestKey() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(guestStorageKey);
}

export function persistGuestKey(key) {
  if (typeof window === 'undefined' || !key) return;
  window.sessionStorage.setItem(guestStorageKey, key);
}

export function clearGuestKey() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(guestStorageKey);
}

export const useShopAuth = createAuthStore({
  name: storageKey,
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
});

const client = createApiClient({
  baseURL: '/api/v1',
  getAccessToken: () => useShopAuth.getState().accessToken,
  getRefreshToken: () => useShopAuth.getState().refreshToken,
  saveTokens: (tokens) => useShopAuth.getState().setTokens(tokens),
  clearSession: () => useShopAuth.getState().clear(),
  extraHeaders: () => {
    const headers = {};
    const key = readGuestKey();
    if (key) headers['x-guest-key'] = key;
    const pin = readDevTenantPin();
    if (pin) headers['x-tenant-id'] = pin;
    return headers;
  },
});

export const api = createEndpoints(client);
export default client;
