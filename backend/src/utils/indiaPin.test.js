import test from 'node:test';
import assert from 'node:assert/strict';
import { localityFromPincode, isIndiaPincode, normalizePincode } from './indiaPin.js';

test('normalizePincode strips non-digits and caps at 6', () => {
  assert.equal(normalizePincode('533-001'), '533001');
  assert.equal(normalizePincode(' 110001 '), '110001');
  assert.equal(isIndiaPincode('533001'), true);
  assert.equal(isIndiaPincode('53300'), false);
});

test('Kakinada 533001 is Andhra Pradesh', () => {
  const loc = localityFromPincode('533001');
  assert.equal(loc.city, 'Kakinada');
  assert.equal(loc.state, 'Andhra Pradesh');
  assert.equal(loc.region, 'Andhra Pradesh');
});

test('Hyderabad 500001 is Telangana', () => {
  const loc = localityFromPincode(500001);
  assert.equal(loc.city, 'Hyderabad');
  assert.equal(loc.state, 'Telangana');
});

test('Delhi 110001 and unknown-but-valid prefix', () => {
  const delhi = localityFromPincode('110001');
  assert.equal(delhi.city, 'New Delhi');
  assert.equal(delhi.state, 'Delhi');

  const otherAp = localityFromPincode('530123');
  assert.equal(otherAp.state, 'Andhra Pradesh');
  assert.equal(otherAp.city, null);
});

test('bad pins return empty locality', () => {
  assert.deepEqual(localityFromPincode(''), { city: null, state: null, region: null });
  assert.deepEqual(localityFromPincode('12'), { city: null, state: null, region: null });
});
