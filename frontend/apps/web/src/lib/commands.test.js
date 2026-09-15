import test from 'node:test';
import assert from 'node:assert/strict';
import { GO_SHORTCUTS, commandsForRole, filterCommands, groupsForRole } from './nav.js';

test('g o goes to orders', () => {
  assert.equal(GO_SHORTCUTS.o, '/orders');
  assert.equal(GO_SHORTCUTS.d, '/');
  assert.equal(GO_SHORTCUTS.p, '/platform');
});

test('role gates command lists', () => {
  // Store owner (tenant) runs "My store" only — the platform "catalog"
  // management group (masters/categories/brands/deep admin) is super_admin-only.
  assert.deepEqual(groupsForRole('admin'), ['store']);
  assert.deepEqual(groupsForRole('super_admin'), ['platform', 'store', 'catalog']);
  const vendor = commandsForRole('vendor');
  assert.ok(vendor.every((c) => c.to.startsWith('/vendor')));
  const admin = commandsForRole('admin');
  assert.ok(admin.some((c) => c.to === '/orders'));
  assert.ok(!admin.some((c) => c.to === '/platform'));
  // A tenant keeps their own catalog (tenant listing ops) but NOT the
  // platform global-catalog management pages.
  assert.ok(admin.some((c) => c.to === '/catalog'), 'tenant keeps "My catalog"');
  assert.ok(!admin.some((c) => c.to === '/catalog/masters'), 'tenant has no master-mgmt page');
  assert.ok(!admin.some((c) => c.to === '/catalog/categories'), 'tenant has no category-mgmt page');
  assert.ok(!admin.some((c) => c.to === '/catalog/ops'), 'tenant has no deep-admin page');
});

test('palette filter matches label and keys', () => {
  const cmds = commandsForRole('admin');
  const hits = filterCommands(cmds, 'gstin');
  assert.ok(hits.some((c) => c.to === '/tax'));
  assert.equal(filterCommands(cmds, 'zzzz-nope').length, 0);
});
