import test from 'node:test';
import assert from 'node:assert/strict';
import { createEndpoints } from './endpoints.js';

function routeMock() {
  const calls = [];
  const record = (method, path, opts = {}) => {
    calls.push({ method, path, opts });
    return { method, path, opts };
  };
  return {
    calls,
    get: (path, opts) => record('GET', path, opts),
    post: (path, body, opts) => record('POST', path, { ...opts, body }),
    patch: (path, body, opts) => record('PATCH', path, { ...opts, body }),
    put: (path, body, opts) => record('PUT', path, { ...opts, body }),
    del: (path, opts) => record('DELETE', path, opts),
    download: (path, opts) => record('DOWNLOAD', path, { ...opts, raw: true }),
  };
}

function check(api, calls, [method, path]) {
  const last = calls[calls.length - 1];
  assert.equal(last.method, method);
  assert.equal(last.path, path);
  return last;
}

test('admin download helpers map 1:1 to CSV routes', async () => {
  const client = routeMock();
  const api = createEndpoints(client);

  api.admin.exportProducts({ type: 'flower' });
  assert.equal(client.calls.at(-1).opts.raw, true);
  check(api, client.calls, ['DOWNLOAD', '/admin/products/export.csv']);

  api.admin.exportInventory({ q: 'rose' });
  check(api, client.calls, ['DOWNLOAD', '/admin/inventory/export.csv']);

  api.admin.exportOrders({ status: 'paid' });
  check(api, client.calls, ['DOWNLOAD', '/admin/orders/export.csv']);

  api.admin.exportUsers({ role: 'customer' });
  check(api, client.calls, ['DOWNLOAD', '/admin/users/export.csv']);

  api.admin.downloadExport('exp_123');
  check(api, client.calls, ['DOWNLOAD', '/admin/exports/exp_123/download']);
});

test('admin user, hub, slot, notification and export helpers map correctly', async () => {
  const client = routeMock();
  const api = createEndpoints(client);

  api.admin.users({ role: 'rider', page: 2 });
  check(api, client.calls, ['GET', '/admin/users']);

  api.admin.user('u_1');
  check(api, client.calls, ['GET', '/admin/users/u_1']);

  api.admin.createStaff({ role: 'picker' });
  check(api, client.calls, ['POST', '/admin/users/staff']);

  api.admin.setUserStatus('u_1', { status: 'blocked' });
  check(api, client.calls, ['PATCH', '/admin/users/u_1/status']);

  api.admin.setUserRole('u_1', { role: 'picker' });
  check(api, client.calls, ['PATCH', '/admin/users/u_1/role']);

  api.admin.riderStats({ from: '2026-09-01' });
  check(api, client.calls, ['GET', '/admin/users/riders/stats']);

  api.admin.createHub({ code: 'H1' });
  check(api, client.calls, ['POST', '/admin/hubs']);

  api.admin.overrideSlot('s_1', { manualCapacity: 12 });
  check(api, client.calls, ['POST', '/admin/slots/s_1/override']);

  api.admin.notifications({ status: 'pending' });
  check(api, client.calls, ['GET', '/admin/notifications']);

  api.admin.createExport({ kind: 'orders' });
  check(api, client.calls, ['POST', '/admin/exports']);
});

test('fulfillment, returns, rider and policies helpers map correctly', async () => {
  const client = routeMock();
  const api = createEndpoints(client);

  api.fulfillment.listAll({ status: 'paid' });
  check(api, client.calls, ['GET', '/fulfillment/orders']);

  api.fulfillment.startPicking('o_1');
  check(api, client.calls, ['POST', '/fulfillment/orders/o_1/pick']);

  api.fulfillment.dispatch('o_1');
  check(api, client.calls, ['POST', '/fulfillment/orders/o_1/dispatch']);

  api.fulfillment.deliver('o_1', { podType: 'otp', podValue: '1234' });
  check(api, client.calls, ['POST', '/fulfillment/orders/o_1/deliver']);

  api.fulfillment.reconcilePayments({ limit: 25 });
  const rec = check(api, client.calls, ['POST', '/fulfillment/reconcile/payments']);
  assert.deepEqual(rec.opts.query, { limit: 25 });

  api.returns.qcDecision('r_1', { decision: 'pass' });
  check(api, client.calls, ['POST', '/returns/r_1/qc']);

  api.rider.complete('d_1', { podType: 'signature', podValue: 'sig' });
  check(api, client.calls, ['POST', '/rider/deliveries/d_1/complete']);

  api.policies.previewCoupon({ code: 'WELCOME', cartSubtotal: 500 });
  const pv = check(api, client.calls, ['GET', '/policies/coupons/preview']);
  assert.deepEqual(pv.opts.query, { code: 'WELCOME', cartSubtotal: 500 });

  api.policies.createDeliveryFee({ baseFee: 30 });
  check(api, client.calls, ['POST', '/policies/delivery-fee']);
});

test('catalog tenant and catalog admin helpers map correctly', async () => {
  const client = routeMock();
  const api = createEndpoints(client);

  api.catalogTenant.listings({ status: 'active' });
  check(api, client.calls, ['GET', '/catalog/tenant/listings']);

  api.catalogTenant.bulkUpload('masters', { rows: [{}] });
  check(api, client.calls, ['POST', '/catalog/tenant/bulk/masters']);

  api.catalogTenant.bulkTemplate('inventory');
  check(api, client.calls, ['DOWNLOAD', '/catalog/tenant/bulk/template/inventory']);

  api.catalogAdmin.changeRequests({ status: 'pending' });
  check(api, client.calls, ['GET', '/catalog/admin/change-requests']);

  api.catalogAdmin.reviewChangeRequest('cr_1', { decision: 'approve' });
  check(api, client.calls, ['POST', '/catalog/admin/change-requests/cr_1/review']);

  api.catalogAdmin.eventStatus();
  check(api, client.calls, ['GET', '/catalog/admin/events/status']);
});
