import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from './client.js';

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function setup({ fetchImpl, accessToken = 'access-1' } = {}) {
  const tokens = { access: accessToken, refresh: 'refresh-1' };
  const calls = [];
  const client = createApiClient({
    baseURL: '/api/v1',
    getAccessToken: () => tokens.access,
    getRefreshToken: () => tokens.refresh,
    saveTokens: (next) => { tokens.access = next.accessToken; tokens.refresh = next.refreshToken; },
    clearSession: () => {},
    onUnauthorized: () => {},
    extraHeaders: () => ({ 'x-tenant-id': 'tenant-42' }),
    fetchImpl: async (url, opts) => {
      const call = { url, opts: { ...opts, headers: { ...opts.headers } } };
      calls.push(call);
      return fetchImpl(url, opts, call);
    },
  });
  return { client, calls, tokens };
}

test('regular JSON requests keep the success envelope', async () => {
  const { client, calls } = setup({
    fetchImpl: async (url, opts) => {
      assert.equal(url, '/api/v1/items?page=2&limit=25');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers.authorization, 'Bearer access-1');
      assert.equal(opts.headers['x-tenant-id'], 'tenant-42');
      return jsonResponse({
        success: true,
        data: { items: [1, 2] },
        meta: { total: 2 },
        message: 'ok',
      });
    },
  });

  const result = await client.get('/items', { query: { page: 2, limit: 25 } });
  assert.deepEqual(result.data, { items: [1, 2] });
  assert.deepEqual(result.meta, { total: 2 });
  assert.equal(result.message, 'ok');
  assert.equal(calls.length, 1);
});

test('raw download returns the unconsumed Response plus headers', async () => {
  const { client, calls } = setup({
    fetchImpl: async () => new Response('id,sku\n1,ROSE', {
      status: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="products.csv"',
      },
    }),
  });

  const result = await client.download('/admin/products/export.csv', { query: { type: 'flower' } });
  assert.equal(result.raw, true);
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-disposition'], 'attachment; filename="products.csv"');
  assert.ok(result.data instanceof Response);
  assert.equal(await result.data.text(), 'id,sku\n1,ROSE');
  assert.equal(calls[0].url, '/api/v1/admin/products/export.csv?type=flower');
});

test('raw requests can also be made through the lower-level request option', async () => {
  const { client } = setup({
    fetchImpl: async () => new Response('template', { status: 200 }),
  });
  const result = await client.request('/catalog/tenant/bulk/template/masters', { raw: true });
  assert.equal(result.raw, true);
  assert.equal(await result.data.text(), 'template');
});

test('raw non-2xx responses throw structured ApiError when the body is JSON', async () => {
  const { client } = setup({
    fetchImpl: async () => jsonResponse({
      success: false,
      code: 'TENANT_MISMATCH',
      message: 'Wrong tenant header',
      details: { header: 'tenant-1' },
    }, { status: 403 }),
  });

  await assert.rejects(
    client.download('/admin/inventory/export.csv'),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'TENANT_MISMATCH');
      assert.equal(err.message, 'Wrong tenant header');
      assert.deepEqual(err.details, { header: 'tenant-1' });
      return true;
    },
  );
});

test('raw 401 refresh retries once and carries the rotated token', async () => {
  let first = true;
  const { client, calls, tokens } = setup({
    fetchImpl: async (url, opts, call) => {
      if (url === '/api/v1/auth/refresh') {
        assert.equal(opts.method, 'POST');
        return jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' },
          },
        });
      }
      if (call?.index === 0 || first) {
        first = false;
        assert.equal(opts.headers.authorization, 'Bearer access-1');
        return jsonResponse({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Token expired',
        }, { status: 401 });
      }
      assert.equal(opts.headers.authorization, 'Bearer access-2');
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    },
  });

  const result = await client.download('/admin/users/export.csv');
  assert.equal(tokens.access, 'access-2');
  assert.equal(tokens.refresh, 'refresh-2');
  assert.equal(result.raw, true);
  assert.equal(await result.data.text(), 'ok');

  const paths = calls.map((c) => c.url);
  assert.deepEqual(paths, [
    '/api/v1/admin/users/export.csv',
    '/api/v1/auth/refresh',
    '/api/v1/admin/users/export.csv',
  ]);
});

test('401 refresh failure clears the session and reports the refresh error', async () => {
  let cleared = null;
  let unauthorized = null;
  const tokens = { access: 'stale', refresh: 'refresh-1' };
  const offline = createApiClient({
    baseURL: '/api/v1',
    getAccessToken: () => tokens.access,
    getRefreshToken: () => tokens.refresh,
    saveTokens: () => {},
    clearSession: () => { cleared = true; },
    onUnauthorized: (err) => { unauthorized = err; },
    fetchImpl: async (url) => {
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({ success: false, code: 'REFRESH_FAILED', message: 'bad refresh' }, { status: 401 });
      }
      return jsonResponse({ success: false, code: 'UNAUTHORIZED', message: 'expired' }, { status: 401 });
    },
  });

  await assert.rejects(
    offline.download('/admin/orders/export.csv'),
    (err) => err.code === 'REFRESH_FAILED' && err.message === 'bad refresh',
  );
  assert.equal(cleared, true);
  assert.equal(unauthorized?.code, 'REFRESH_FAILED');
});
