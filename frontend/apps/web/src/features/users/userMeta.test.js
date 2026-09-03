import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RIDER_AVAILABILITY_META, STAFF_ROLE_OPTIONS, USER_ROLE_META, USER_STATUS_META,
  emptyStaff, phoneDisplay, simpleName, staffPayload, statsDuration,
} from './userMeta.js';

test('user meta covers backend roles, statuses and rider availability', () => {
  for (const r of ['customer', 'vendor', 'admin', 'super_admin', 'picker', 'rider']) assert.ok(USER_ROLE_META[r]);
  for (const s of ['active', 'inactive', 'deleted', 'verification_pending', 'blocked']) assert.ok(USER_STATUS_META[s]);
  for (const a of ['available', 'busy', 'offline']) assert.ok(RIDER_AVAILABILITY_META[a]);
});

test('staff role options never include super_admin or customer', () => {
  const roles = STAFF_ROLE_OPTIONS.map(([v]) => v);
  assert.ok(roles.includes('admin'));
  assert.ok(roles.includes('picker'));
  assert.ok(roles.includes('rider'));
  assert.ok(!roles.includes('super_admin'));
  assert.ok(!roles.includes('customer'));
});

test('staff payload strips digits and only sends options that exist', () => {
  const payload = staffPayload({
    ...emptyStaff(),
    role: 'picker',
    firstName: '  Ravi  ',
    lastName: '',
    phoneNumber: ' 98765-43210 ',
    email: 'ravi@x.co',
    password: 'secret',
  });
  assert.equal(payload.firstName, 'Ravi');
  assert.equal(payload.phone.number, '9876543210');
  assert.equal(payload.email, 'ravi@x.co');
  assert.equal(payload.hubId, undefined);
});

test('staff payload includes hubId only for riders', () => {
  const p = staffPayload({ ...emptyStaff(), role: 'rider', phoneNumber: '9876543210', hubId: 'abc' });
  assert.equal(p.hubId, 'abc');
});

test('display helpers fall back cleanly', () => {
  assert.equal(simpleName({ profile: { firstName: 'A', lastName: 'B' } }), 'A B');
  assert.equal(simpleName({}), null);
  assert.equal(phoneDisplay({ phone: { countryCode: '+91', number: '9876543210' } }), '+919876543210');
  assert.equal(phoneDisplay({}), null);
});

test('statsDuration returns a valid date string', () => {
  assert.match(statsDuration(7), /^\d{4}-\d{2}-\d{2}$/);
});
