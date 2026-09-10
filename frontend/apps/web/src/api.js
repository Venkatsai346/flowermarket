/**
 * Web app API binding — the shared client wired to this app's auth store,
 * hitting /api/v1 (proxied to the backend by Vite).
 */
import { createApiClient, createEndpoints, useAuthStore } from '@flower-market/shared';

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
    // Login sends no tenant header: emails are globally unique, so the server
    // resolves the account by email alone (a stale or missing id here used to
    // fail correct passwords with INVALID_CREDENTIALS).
    const tenantId = useAuthStore.getState().user?.tenantId;
    return tenantId ? { 'x-tenant-id': tenantId } : {};
  },
});

export const api = createEndpoints(client);
export default client;
