/**
 * Web app API binding — the shared client wired to this app's auth store,
 * hitting /api/v1 (proxied to the backend by Vite).
 */
import { createApiClient, createEndpoints, useAuthStore } from '@flower-market/shared';

/**
 * Login-only tenant scoping: store-owner accounts belong to their own tenant,
 * so the auth call needs `x-tenant-id` to find the user. The header is set
 * ONLY around the login call — tokens carry the tenant claim for everything
 * else (sending a mismatched header would 401 TENANT_MISMATCH).
 */
let loginTenantId = '';
export const setLoginTenantId = (v) => { loginTenantId = String(v || '').trim(); };

const client = createApiClient({
  baseURL: '/api/v1',
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  saveTokens: (tokens) => useAuthStore.getState().setTokens(tokens),
  clearSession: () => useAuthStore.getState().clear(),
  /**
   * tenantContext resolves the request tenant BEFORE authenticate runs, so it
   * never sees the JWT — non-default-tenant sessions MUST send x-tenant-id on
   * every request or they 401 TENANT_MISMATCH. The session user's tenantId is
   * the token's tenant, so sending it always is both safe and correct.
   */
  extraHeaders: () => {
    if (loginTenantId) return { 'x-tenant-id': loginTenantId }; // login-time scoping
    const tenantId = useAuthStore.getState().user?.tenantId;
    return tenantId ? { 'x-tenant-id': tenantId } : {};
  },
});

export const api = createEndpoints(client);
export default client;
