/**
 * Storefront gift draft — mirrors backend/src/utils/gift.js field names.
 * The API is the sanitiser; this file only shapes the form and labels.
 */

export const GIFT_OCCASIONS = [
  'birthday',
  'anniversary',
  'sorry',
  'pooja',
  'wedding',
  'love',
  'congratulations',
  'get_well',
  'just_because',
];

export const OCCASION_LABELS = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  sorry: "I'm sorry",
  pooja: 'Pooja',
  wedding: 'Wedding',
  love: 'Love',
  congratulations: 'Congratulations',
  get_well: 'Get well',
  just_because: 'Just because',
};

export const GIFT_MESSAGE_MAX = 280;
export const GIFT_INSTRUCTIONS_MAX = 240;

export function emptyGift() {
  return {
    isGift: false,
    occasion: null,
    message: '',
    senderName: '',
    recipientName: '',
    recipientPhone: '',
    hidePrices: true,
    deliveryInstructions: '',
  };
}

export function fromCartGift(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  return {
    isGift: g.isGift === true,
    occasion: g.occasion || null,
    message: g.message || '',
    senderName: g.senderName || '',
    recipientName: g.recipientName || '',
    recipientPhone: g.recipientPhone || '',
    hidePrices: g.isGift === true ? g.hidePrices !== false : true,
    deliveryInstructions: g.deliveryInstructions || '',
  };
}

export function toGiftPayload(form) {
  return {
    isGift: Boolean(form.isGift),
    occasion: form.occasion || null,
    message: form.message || null,
    senderName: form.senderName || null,
    recipientName: form.recipientName || null,
    recipientPhone: form.recipientPhone || null,
    hidePrices: form.isGift ? form.hidePrices !== false : false,
    deliveryInstructions: form.deliveryInstructions || null,
  };
}

export function isGiftMeaningful(gift) {
  if (!gift) return false;
  if (gift.isGift === true) return true;
  return Boolean(String(gift.deliveryInstructions || '').trim());
}

export function occasionLabel(code) {
  return OCCASION_LABELS[code] || null;
}
