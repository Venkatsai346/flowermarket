import test from 'node:test';
import assert from 'node:assert/strict';
import { GO_SHORTCUTS, commandsForRole, filterCommands, groupsForRole } from './nav.js';

test('g o goes to orders', () => {
  assert.equal(GO_SHORTCUTS.o, '/orders');
  assert.equal(GO_SHORTCUTS.d, '/');
  assert.equal(GO_SHORTCUTS.p, '/platform');
});

test('role gates command lists', () => {
  assert.deepEqual(groupsForRole('admin'), ['store', 'catalog']);
  const vendor = commandsForRole('vendor');
  assert.ok(vendor.every((c) => c.to.startsWith('/vendor')));
  const admin = commandsForRole('admin');
  assert.ok(admin.some((c) => c.to === '/orders'));
  assert.ok(!admin.some((c) => c.to === '/platform'));
  // tenant admins keep Deep admin (role-gated tabs) but not global catalog ops
  assert.ok(admin.some((c) => c.to === '/catalog/ops'));
  assert.ok(!admin.some((c) => c.to === '/catalog/masters'));
  assert.ok(!admin.some((c) => c.to === '/catalog/categories'));
  assert.ok(!admin.some((c) => c.to === '/catalog/brands'));
  const platform = commandsForRole('super_admin');
  assert.ok(platform.some((c) => c.to === '/catalog/masters'));
  assert.ok(platform.some((c) => c.to === '/catalog/categories'));
  assert.ok(platform.some((c) => c.to === '/catalog/brands'));
});

test('palette filter matches label and keys', () => {
  const cmds = commandsForRole('admin');
  const hits = filterCommands(cmds, 'gstin');
  assert.ok(hits.some((c) => c.to === '/tax'));
  assert.equal(filterCommands(cmds, 'zzzz-nope').length, 0);
});
