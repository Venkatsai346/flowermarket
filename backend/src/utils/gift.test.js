import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GIFT_OCCASIONS,
  GIFT_MESSAGE_MAX,
  emptyGift,
  isGiftMeaningful,
  sanitiseCardText,
  sanitiseGiftPhone,
  normalizeGift,
  packingCard,
  GiftValidationError,
} from './gift.js';

test('empty gift is not meaningful', () => {
  assert.equal(isGiftMeaningful(null), false);
  assert.equal(isGiftMeaningful(emptyGift()), false);
});

test('delivery instructions alone are meaningful (gate codes, not a card)', () => {
  assert.equal(isGiftMeaningful({ isGift: false, deliveryInstructions: 'Leave at the gate' }), true);
});

test('sanitiseCardText strips HTML and control chars, keeps a short note', () => {
  assert.equal(sanitiseCardText('<b>Happy</b> birthday\x00!', 280), 'Happy birthday!');
  assert.equal(sanitiseCardText('   ', 280), null);
  assert.equal(sanitiseCardText('x'.repeat(GIFT_MESSAGE_MAX + 40), GIFT_MESSAGE_MAX).length, GIFT_MESSAGE_MAX);
});

test('sanitiseCardText preserves a single paragraph break', () => {
  assert.equal(sanitiseCardText('line one\n\nline two', 280), 'line one\n\nline two');
});

test('phone accepts 10-digit Indian mobiles and +91', () => {
  assert.equal(sanitiseGiftPhone('9876543210'), '9876543210');
  assert.equal(sanitiseGiftPhone('+91 98765 43210'), '9876543210');
  assert.equal(sanitiseGiftPhone('09876543210'), '9876543210');
  assert.equal(sanitiseGiftPhone(''), null);
  assert.equal(sanitiseGiftPhone('12345'), null);
});

test('strict phone throws on garbage so PATCH can 400', () => {
  assert.throws(
    () => sanitiseGiftPhone('not-a-phone', { strict: true }),
    (err) => err instanceof GiftValidationError && err.code === 'GIFT_PHONE_INVALID',
  );
});

test('normalizeGift defaults hidePrices true when sending as a gift', () => {
  const g = normalizeGift({ isGift: true, message: 'For you', senderName: 'Arun' });
  assert.equal(g.isGift, true);
  assert.equal(g.hidePrices, true);
  assert.equal(g.message, 'For you');
  assert.equal(g.senderName, 'Arun');
});

test('normalizeGift honours hidePrices false', () => {
  const g = normalizeGift({ isGift: true, hidePrices: false });
  assert.equal(g.hidePrices, false);
});

test('normalizeGift drops unknown occasions instead of rejecting checkout', () => {
  const g = normalizeGift({ isGift: true, occasion: 'secret-admirer' });
  assert.equal(g.occasion, null);
});

test('normalizeGift accepts every published occasion', () => {
  for (const o of GIFT_OCCASIONS) {
    assert.equal(normalizeGift({ isGift: true, occasion: o }).occasion, o);
  }
});

test('turning isGift off keeps delivery instructions only', () => {
  const g = normalizeGift({
    isGift: false,
    message: 'should vanish',
    senderName: 'Arun',
    deliveryInstructions: 'Call before you arrive',
  });
  assert.deepEqual(g, {
    ...emptyGift(),
    deliveryInstructions: 'Call before you arrive',
  });
});

test('packingCard never includes a rupee figure', () => {
  const card = packingCard(normalizeGift({
    isGift: true,
    occasion: 'birthday',
    message: 'Happy birthday Priya',
    senderName: 'Arun',
    recipientName: 'Priya',
    hidePrices: true,
    deliveryInstructions: 'Do not ring the bell',
  }));
  assert.equal(card.headline, 'Birthday');
  assert.equal(card.to, 'Priya');
  assert.equal(card.from, 'Arun');
  assert.equal(card.hidePrices, true);
  assert.equal(JSON.stringify(card).includes('₹'), false);
  assert.equal(JSON.stringify(card).toLowerCase().includes('total'), false);
});

test('packingCard is null when there is nothing to pack', () => {
  assert.equal(packingCard(emptyGift()), null);
});
