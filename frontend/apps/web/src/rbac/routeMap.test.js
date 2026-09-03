import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_ROLES, rolesForPath } from './routeMap.js';

describe('console RBAC route map', () => {
  test('every mapped route has at least one allowed role', () => {
    for (const [path, roles] of Object.entries(ROUTE_ROLES)) {
      assert.ok(Array.isArray(roles) && roles.length > 0, `${path} must allow at least one role`);
      assert.ok(roles.every((r) => typeof r === 'string'), `${path} roles must be strings`);
    }
  });

  test('platform routes are super_admin only', () => {
    for (const path of Object.keys(ROUTE_ROLES).filter((p) => p.startsWith('/platform'))) {
      assert.deepEqual(ROUTE_ROLES[path], ['super_admin'], `${path} must be super_admin only`);
    }
  });

  test('vendor, store and rider guards stay conservative', () => {
    for (const path of ['/vendor', '/vendor/products', '/vendor/payouts', '/vendor/payout-account']) {
      assert.deepEqual(ROUTE_ROLES[path], ['vendor'], `${path} must be vendor only`);
    }
    for (const path of ['/catalog', '/orders', '/inventory', '/billing', '/tax']) {
      assert.deepEqual(ROUTE_ROLES[path], ['admin', 'super_admin'], `${path} must be store owner + platform`);
    }
    assert.ok(ROUTE_ROLES['/rider'].includes('rider'));
  });

  test('unknown paths resolve to no roles (fail closed)', () => {
    assert.deepEqual(rolesForPath('/never-registered'), []);
  });
});
