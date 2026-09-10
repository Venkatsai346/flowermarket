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
        /**
         * Monotonic session-identity counter. Bumped by every setSession
         * (login/register) and every clear (logout / expired refresh), and
         * NOT by token rotation or profile hydration — those are the same
         * identity. Data-fetching hooks subscribe to this to invalidate any
         * payload cached under the previous identity, so a logout→login (or a
         * direct account switch) can never leave user A's data on screen.
         */
        sessionId: 0,

        setSession: ({ user, owner, tokens }) => {
          // Login returns {user, tokens}; store registration returns
          // {owner, tokens} — and the owner IS the logged-in user. A userless
          // session bricks every tenant header and role gate (the console
          // spins "loading" forever), so both auth shapes seat the session.
          const sessionUser = user || owner || null;
          return set({
            user: sessionUser,
            accessToken: tokens?.accessToken || null,
            refreshToken: tokens?.refreshToken || null,
            // A new login overwrites any previous tenant — never carry the
            // last user's tenant forward into a different account's session.
            lastTenantId: sessionUser?.tenantId || null,
            sessionId: get().sessionId + 1,
          });
        },

        updateUser: (user) => set({ user }),

        /** store only the new tokens (from a refresh rotation) */
        setTokens: (tokens) =>
          set({
            accessToken: tokens?.accessToken ?? get().accessToken,
            refreshToken: tokens?.refreshToken ?? get().refreshToken,
          }),

        clear: () => set({
          user: null,
          accessToken: null,
          refreshToken: null,
          // Nothing about the previous identity may survive a logout: the
          // tenant prefill, the user, and the tokens all go, and the session
          // counter advances so every mounted data hook invalidates at once.
          lastTenantId: null,
          sessionId: get().sessionId + 1,
        }),

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
