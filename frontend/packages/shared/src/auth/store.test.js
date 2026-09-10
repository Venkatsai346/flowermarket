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
});
