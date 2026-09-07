import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookieHeader, parseGuestKey, newGuestKey, GUEST_COOKIE, GUEST_HEADER,
} from './guestCart.js';

test('parseCookieHeader splits and decodes cookies', () => {
  const out = parseCookieHeader(`${GUEST_COOKIE}=abc_def; Path=/; other=1`);
  assert.equal(out[GUEST_COOKIE], 'abc_def');
  assert.equal(out.other, '1');
});

test('parseGuestKey prefers a valid x-guest-key header over the cookie', () => {
  const key = newGuestKey();
  const req = {
    headers: {
      [GUEST_HEADER]: key,
      cookie: `${GUEST_COOKIE}=aaaaaaaaaaaaaaaaaaaaaa`,
    },
  };
  assert.equal(parseGuestKey(req), key);
});

test('parseGuestKey rejects short or punctuation-laden keys', () => {
  assert.equal(parseGuestKey({ headers: { [GUEST_HEADER]: 'short' } }), null);
  assert.equal(parseGuestKey({ headers: { [GUEST_HEADER]: 'bad key with spaces!!!!' } }), null);
  assert.equal(parseGuestKey({ headers: { cookie: `${GUEST_COOKIE}=nope` } }), null);
});

test('newGuestKey is url-safe and long enough', () => {
  const k = newGuestKey();
  assert.match(k, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(k, newGuestKey());
});
