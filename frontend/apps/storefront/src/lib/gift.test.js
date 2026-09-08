import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyGift, fromCartGift, toGiftPayload, isGiftMeaningful, GIFT_OCCASIONS,
} from './gift.js';

test('empty form is not a gift', () => {
  assert.equal(isGiftMeaningful(emptyGift()), false);
});

test('fromCartGift hydrates a server snapshot into form fields', () => {
  const form = fromCartGift({
    isGift: true,
    occasion: 'birthday',
    message: 'Happy birthday',
    senderName: 'Arun',
    recipientName: 'Priya',
    recipientPhone: '9876543210',
    hidePrices: true,
    deliveryInstructions: 'Gate code 12',
  });
  assert.equal(form.isGift, true);
  assert.equal(form.occasion, 'birthday');
  assert.equal(form.message, 'Happy birthday');
  assert.equal(form.hidePrices, true);
});

test('toGiftPayload sends nulls not empty strings', () => {
  const body = toGiftPayload(emptyGift());
  assert.equal(body.isGift, false);
  assert.equal(body.message, null);
  assert.equal(body.hidePrices, false);
});

test('turning on a gift defaults hidePrices true in the payload', () => {
  const body = toGiftPayload({ ...emptyGift(), isGift: true, message: 'Hi' });
  assert.equal(body.hidePrices, true);
  assert.equal(body.message, 'Hi');
});

test('occasion list covers the florist set used on the PDP', () => {
  for (const o of ['birthday', 'anniversary', 'sorry', 'pooja', 'wedding', 'love', 'congratulations']) {
    assert.ok(GIFT_OCCASIONS.includes(o), o);
  }
});
