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
 */
import { createApiClient, createEndpoints, createAuthStore } from '@flower-market/shared';

const storageKey = `fm-shop:${typeof window !== 'undefined' ? window.location.hostname : 'server'}`;

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
});

export const api = createEndpoints(client);
export default client;
