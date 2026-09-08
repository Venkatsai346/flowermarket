/**
 * Gift identity — the florist equivalent of address/slot snapshots.
 *
 * Cart holds a mutable draft (`cart.gift`). Checkout freezes a copy onto
 * `order.giftSnapshot` so later address edits or cart reuse cannot rewrite
 * the card that was packed. Nothing here touches money, stock, or the saga.
 *
 * Sanitisation is the product: card text is handwritten-adjacent, never HTML,
 * never a control-character dump, never an unbounded string.
 */

export const GIFT_OCCASIONS = Object.freeze([
  'birthday',
  'anniversary',
  'sorry',
  'pooja',
  'wedding',
  'love',
  'congratulations',
  'get_well',
  'just_because',
]);

export const GIFT_MESSAGE_MAX = 280;
export const GIFT_INSTRUCTIONS_MAX = 240;
export const GIFT_NAME_MAX = 80;

export const OCCASION_LABELS = Object.freeze({
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  sorry: "I'm sorry",
  pooja: 'Pooja / temple',
  wedding: 'Wedding',
  love: 'Love',
  congratulations: 'Congratulations',
  get_well: 'Get well',
  just_because: 'Just because',
});

export class GiftValidationError extends Error {
  constructor(message, code = 'GIFT_INVALID') {
    super(message);
    this.name = 'GiftValidationError';
    this.code = code;
    this.status = 400;
  }
}

export function emptyGift() {
  return {
    isGift: false,
    occasion: null,
    message: null,
    senderName: null,
    recipientName: null,
    recipientPhone: null,
    hidePrices: false,
    deliveryInstructions: null,
  };
}

export function isGiftMeaningful(gift) {
  if (!gift || typeof gift !== 'object') return false;
  if (gift.isGift === true) return true;
  const note = typeof gift.deliveryInstructions === 'string'
    ? gift.deliveryInstructions.trim()
    : '';
  return note.length > 0;
}

/** Plain-text card copy. Tags, scripts and control chars never survive. */
export function sanitiseCardText(raw, max) {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

/**
 * Indian mobile: 10 digits, or +91 / 91 prefixed. Returns null when empty.
 * `strict` throws GiftValidationError on garbage so PATCH can 400 without
 * the checkout overlay refusing a last-second typo (checkout uses false).
 */
export function sanitiseGiftPhone(raw, { strict = false } = {}) {
  if (raw == null || raw === '') return null;
  const digits = String(raw).replace(/\D/g, '');
  let ten = digits;
  if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(ten)) return ten;
  if (!strict) return null;
  throw new GiftValidationError(
    'Recipient phone must be a 10-digit Indian mobile number',
    'GIFT_PHONE_INVALID',
  );
}

export function occasionLabel(code) {
  if (!code) return null;
  return OCCASION_LABELS[code] || null;
}

/**
 * Canonical gift document. Unknown occasions drop to null (old carts must
 * still check out). `isGift: false` keeps deliveryInstructions only.
 */
export function normalizeGift(input = {}, { strictPhone = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const isGift = src.isGift === true || src.isGift === 'true';
  const deliveryInstructions = sanitiseCardText(src.deliveryInstructions, GIFT_INSTRUCTIONS_MAX);

  if (!isGift) {
    return { ...emptyGift(), deliveryInstructions };
  }

  let occasion = src.occasion == null || src.occasion === ''
    ? null
    : String(src.occasion).toLowerCase().trim();
  if (occasion && !GIFT_OCCASIONS.includes(occasion)) occasion = null;

  const hidePrices = !(src.hidePrices === false || src.hidePrices === 'false');

  return {
    isGift: true,
    occasion,
    message: sanitiseCardText(src.message, GIFT_MESSAGE_MAX),
    senderName: sanitiseCardText(src.senderName, GIFT_NAME_MAX),
    recipientName: sanitiseCardText(src.recipientName, GIFT_NAME_MAX),
    recipientPhone: sanitiseGiftPhone(src.recipientPhone, { strict: strictPhone }),
    hidePrices,
    deliveryInstructions,
  };
}

/**
 * What the picker writes on the enclosure card and what the rider must not
 * say at the door. Prices never appear here — ops totals stay on the order.
 */
export function packingCard(gift) {
  if (!isGiftMeaningful(gift)) return null;
  return {
    isGift: gift.isGift === true,
    headline: gift.isGift ? (occasionLabel(gift.occasion) || 'Gift') : 'Delivery note',
    to: gift.recipientName || null,
    from: gift.senderName || null,
    message: gift.message || null,
    hidePrices: Boolean(gift.isGift && gift.hidePrices),
    deliveryInstructions: gift.deliveryInstructions || null,
    recipientPhone: gift.recipientPhone || null,
    occasion: gift.occasion || null,
  };
}
