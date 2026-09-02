/**
 * AuthStore — persisted zustand session (user + tokens).
 *
 * The storage adapter is injectable so the web app uses localStorage and the
 * mobile app can swap in AsyncStorage without touching this code.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const createAuthStore = (storage = createJSONStorage(() => localStorage)) =>
  create(
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
      { name: 'fm-auth', storage }
    )
  );

/** Default instance for the web app. */
export const useAuthStore = createAuthStore();

export default useAuthStore;
