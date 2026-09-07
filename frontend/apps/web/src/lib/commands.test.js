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
});

test('palette filter matches label and keys', () => {
  const cmds = commandsForRole('admin');
  const hits = filterCommands(cmds, 'gstin');
  assert.ok(hits.some((c) => c.to === '/tax'));
  assert.equal(filterCommands(cmds, 'zzzz-nope').length, 0);
});
