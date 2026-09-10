import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthStore } from './store.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};

const tokens = (tag) => ({ accessToken: `at-${tag}`, refreshToken: `rt-${tag}` });

describe('auth store sessions', () => {
  test('login shape {user, tokens} seats the session', () => {
    const useStore = createAuthStore({ name: 't-login', storage: memoryStorage() });
    useStore.getState().setSession({
      user: { id: 'u1', role: 'admin', tenantId: 't1' },
      tokens: tokens('login'),
    });
    const s = useStore.getState();
    assert.equal(s.user?.id, 'u1');
    assert.equal(s.accessToken, 'at-login');
    assert.equal(s.lastTenantId, 't1');
    assert.equal(s.isAuthenticated(), true);
    assert.equal(s.role(), 'admin');
    assert.equal(s.tenantId(), 't1');
  });

  test('registration shape {owner, tokens} seats the session too', () => {
    // Register returns {tenant, owner, tokens} — no `user` key. Dropping the
    // owner left tokens set with user null: no tenant header, no role, and a
    // console stuck "loading" behind an infinite 401→refresh loop.
    const useStore = createAuthStore({ name: 't-register', storage: memoryStorage() });
    useStore.getState().setSession({
      owner: { id: 'o1', role: 'admin', tenantId: 't-new' },
      tokens: tokens('register'),
    });
    const s = useStore.getState();
    assert.equal(s.user?.id, 'o1');
    assert.equal(s.accessToken, 'at-register');
    assert.equal(s.lastTenantId, 't-new');
    assert.equal(s.isAuthenticated(), true);
    assert.equal(s.tenantId(), 't-new');
  });

  test('user wins when both shapes are present', () => {
    const useStore = createAuthStore({ name: 't-both', storage: memoryStorage() });
    useStore.getState().setSession({
      user: { id: 'u9', role: 'admin', tenantId: 't9' },
      owner: { id: 'o9', role: 'admin', tenantId: 't9' },
      tokens: tokens('both'),
    });
    assert.equal(useStore.getState().user?.id, 'u9');
  });

  test('clear() empties the session', () => {
    const useStore = createAuthStore({ name: 't-clear', storage: memoryStorage() });
    useStore.getState().setSession({
      user: { id: 'u1', role: 'admin', tenantId: 't1' },
      tokens: tokens('x'),
    });
    useStore.getState().clear();
    const s = useStore.getState();
    assert.equal(s.user, null);
    assert.equal(s.accessToken, null);
    assert.equal(s.isAuthenticated(), false);
  });

  test('clear() wipes every trace of the previous identity (logout leaves no stale tenant)', () => {
    // Regression: a logout used to keep `lastTenantId` around, so user B's
    // login screen (and anything reading the store) still saw user A's tenant.
    const useStore = createAuthStore({ name: 't-clear-identity', storage: memoryStorage() });
    useStore.getState().setSession({
      user: { id: 'a1', role: 'admin', tenantId: 't-aaa' },
      tokens: tokens('a'),
    });
    assert.equal(useStore.getState().lastTenantId, 't-aaa');

    useStore.getState().clear();
    const s = useStore.getState();
    assert.equal(s.lastTenantId, null);
    assert.equal(s.tenantId(), null);
    assert.equal(s.role(), null);
    assert.equal(s.refreshToken, null);
  });

  test('sessionId advances on every login and logout, but not on token rotation or hydration', () => {
    // Data hooks key off this counter to invalidate payloads from the previous
    // identity. Rotation (setTokens) and profile hydration (updateUser) are the
    // SAME identity and must not invalidate.
    const useStore = createAuthStore({ name: 't-session-id', storage: memoryStorage() });
    const g = () => useStore.getState();

    assert.equal(g().sessionId, 0);

    g().setSession({ user: { id: 'a1', role: 'admin', tenantId: 't-aaa' }, tokens: tokens('a') });
    const afterLoginA = g().sessionId;
    assert.equal(afterLoginA, 1);

    g().setTokens(tokens('a-rotated'));
    g().updateUser({ id: 'a1', role: 'admin', tenantId: 't-aaa' });
    assert.equal(g().sessionId, afterLoginA, 'rotation/hydration must not change the identity');

    g().clear();
    assert.equal(g().sessionId, afterLoginA + 1, 'logout advances the identity');

    g().setSession({ user: { id: 'b1', role: 'admin', tenantId: 't-bbb' }, tokens: tokens('b') });
    assert.equal(g().sessionId, afterLoginA + 2, 'user B login advances the identity again');
    assert.equal(g().lastTenantId, 't-bbb', 'B never inherits A tenant');
  });
});
