import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The shared auth store persists under 'fm-auth'; give it an in-memory
// localStorage so the hook's real store wiring runs without browser APIs.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => { mem.clear(); },
  key: () => null,
  get length() { return mem.size; },
};

// Import AFTER the shim so the default auth store can persist in-memory.
const { useAuthStore } = await import('@flower-market/shared');
const { useApi } = await import('./useApi.js');

let latest;
function Probe({ fn, deps }) {
  latest = useApi(fn, deps, { toastOnError: false });
  return null;
}

const flush = () => act(async () => {});

// Faithful stand-in for an endpoint: returns the CURRENT session user's id,
// exactly like a real endpoint returns the caller's own data.
const fetchCurrentUser = () =>
  Promise.resolve({ data: useAuthStore.getState().user?.id ?? null, meta: null });

test('logout→login never leaves the previous user\'s data on screen', async () => {
  useAuthStore.getState().clear();

  let root;
  await act(async () => {
    root = create(React.createElement(Probe, { fn: fetchCurrentUser, deps: [] }));
  });
  await flush();
  assert.equal(latest.data, null, 'no data while logged out');

  // user A logs in
  await act(async () => {
    useAuthStore.getState().setSession({
      user: { id: 'user-a', role: 'admin', tenantId: 'tenant-a' },
      tokens: { accessToken: 'at-a', refreshToken: 'rt-a' },
    });
  });
  await flush();
  assert.equal(latest.data, 'user-a');
  assert.equal(latest.loading, false);

  // user A logs out
  await act(async () => {
    useAuthStore.getState().clear();
  });
  await flush();
  assert.equal(latest.data, null, 'logout drops user A\'s payload');

  // user B logs in — the hook must show B, never A
  await act(async () => {
    useAuthStore.getState().setSession({
      user: { id: 'user-b', role: 'admin', tenantId: 'tenant-b' },
      tokens: { accessToken: 'at-b', refreshToken: 'rt-b' },
    });
  });
  await flush();
  assert.equal(latest.data, 'user-b', 'user B sees their own data, with zero A remnants');

  root.unmount();
});

test('a direct account switch resets the old payload synchronously before refetching', async () => {
  useAuthStore.getState().clear();

  let root;
  await act(async () => {
    root = create(React.createElement(Probe, { fn: fetchCurrentUser, deps: [] }));
  });
  await act(async () => {
    useAuthStore.getState().setSession({
      user: { id: 'user-a', role: 'admin', tenantId: 'tenant-a' },
      tokens: { accessToken: 'at-a' },
    });
  });
  await flush();
  assert.equal(latest.data, 'user-a');

  // Switch straight to B without an intervening logout. The stale A payload
  // must be gone by the time the synchronous act returns — before B's fetch
  // has even resolved — so A's data can never flash for B.
  act(() => {
    useAuthStore.getState().setSession({
      user: { id: 'user-b', role: 'admin', tenantId: 'tenant-b' },
      tokens: { accessToken: 'at-b' },
    });
  });
  assert.equal(latest.data, null, 'user A\'s payload is dropped the moment the identity changes');
  assert.equal(latest.loading, true, 'refetch is in flight under the new identity');
  await flush();
  assert.equal(latest.data, 'user-b');

  root.unmount();
});

test('ordinary dependency refetches keep the previous payload visible (no spinner flash)', async () => {
  useAuthStore.getState().clear();

  let calls = 0;
  const fn = () => { calls += 1; return Promise.resolve({ data: calls, meta: null }); };

  let root;
  await act(async () => {
    root = create(React.createElement(Probe, { fn, deps: [1] }));
  });
  await flush();
  assert.equal(latest.data, 1);

  act(() => {
    root.update(React.createElement(Probe, { fn, deps: [2] }));
  });
  assert.equal(latest.loading, true);
  assert.equal(latest.data, 1, 'page change keeps current data while the new page loads');
  await flush();
  assert.equal(latest.data, 2);

  root.unmount();
});
