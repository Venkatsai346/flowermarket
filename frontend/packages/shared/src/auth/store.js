/**
 * AuthStore — persisted zustand session (user + tokens).
 *
 * Both the storage adapter AND the persist key are injectable:
 *  - the web console uses localStorage under the default 'fm-auth';
 *  - the mobile app swaps in AsyncStorage;
 *  - the storefront namespaces the key BY HOSTNAME, so two stores open in two
 *    tabs can never share a session or a cart.
 *
 * Accepts either a storage adapter (legacy call style) or `{ name, storage }`.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const createAuthStore = (options) => {
  const isOptions = options && typeof options === 'object'
    && ('name' in options || 'storage' in options)
    && typeof options.getItem !== 'function';
  const name = isOptions ? (options.name || 'fm-auth') : 'fm-auth';
  const rawStorage = isOptions ? options.storage : options;
  const storage = rawStorage
    ? (typeof rawStorage.getItem === 'function' && typeof rawStorage.setItem === 'function' && !rawStorage.getState
      ? createJSONStorage(() => rawStorage)
      : rawStorage)
    : createJSONStorage(() => localStorage);

  return create(
    persist(
      (set, get) => ({
        user: null,
        accessToken: null,
        refreshToken: null,
        /** last tenant id seen — prefilled on the login form for store-owner re-login */
        lastTenantId: null,

        setSession: ({ user, tokens }) =>
          set({
            user: user || null,
            accessToken: tokens?.accessToken || null,
            refreshToken: tokens?.refreshToken || null,
            lastTenantId: user?.tenantId || get().lastTenantId,
          }),

        updateUser: (user) => set({ user }),

        /** store only the new tokens (from a refresh rotation) */
        setTokens: (tokens) =>
          set({
            accessToken: tokens?.accessToken ?? get().accessToken,
            refreshToken: tokens?.refreshToken ?? get().refreshToken,
          }),

        clear: () => set({ user: null, accessToken: null, refreshToken: null }),

        isAuthenticated: () => Boolean(get().accessToken),
        role: () => get().user?.role || null,
        tenantId: () => get().user?.tenantId || null,
      }),
      { name, storage }
    )
  );
};

/** Default instance for the web app. */
export const useAuthStore = createAuthStore();

export default useAuthStore;
