/** Policy/coupon display + form metadata (matches backend enums). */

export const DISCOUNT_TYPE_META = {
  flat: { label: 'Flat ₹', tone: 'sky' },
  percent: { label: 'Percent %', tone: 'violet' },
};

export const COUPON_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  disabled: { label: 'Disabled', tone: 'slate' },
  expired: { label: 'Expired', tone: 'amber' },
};

export const REFUND_FEE_POLICY_META = {
  never: { label: 'Never refund fee', tone: 'slate' },
  full_order_return_only: { label: 'On full-order return only', tone: 'sky' },
  always: { label: 'Always refund fee', tone: 'emerald' },
};

export const COUPON_STATUS_OPTIONS = [
  ['active', 'Active'],
  ['disabled', 'Disabled'],
  ['expired', 'Expired'],
];

export const REFUND_FEE_OPTIONS = [
  ['never', 'Never'],
  ['full_order_return_only', 'Only on full-order return'],
  ['always', 'Always'],
];

export const DISCOUNT_TYPE_OPTIONS = [
  ['flat', 'Flat amount (₹)'],
  ['percent', 'Percentage (%)'],
];

export const POLICIES_TABS = [
  ['deliveryFee', 'Delivery fee'],
  ['tax', 'Tax rates'],
  ['coupons', 'Coupons'],
  ['refund', 'Refund policy'],
];

export const emptyCoupon = () => ({
  code: '',
  discountType: 'percent',
  value: '',
  minCartValue: '',
  maxDiscountCap: '',
  usageLimitPerCustomer: '',
  validFrom: '',
  validTo: '',
  isPlatformWide: false,
});

export const couponToForm = (c) => ({
  code: c.code || '',
  discountType: c.discountType || 'percent',
  value: c.value ?? '',
  minCartValue: c.minCartValue ?? '',
  maxDiscountCap: c.maxDiscountCap ?? '',
  usageLimitPerCustomer: c.usageLimitPerCustomer ?? '',
  validFrom: c.validFrom ? new Date(c.validFrom).toISOString().slice(0, 10) : '',
  validTo: c.validTo ? new Date(c.validTo).toISOString().slice(0, 10) : '',
  isPlatformWide: Boolean(c.tenantId === null),
});

export const couponPayload = (f) => ({
  code: f.code.trim().toUpperCase(),
  discountType: f.discountType,
  value: Number(f.value),
  minCartValue: f.minCartValue === '' ? null : Number(f.minCartValue),
  maxDiscountCap: f.maxDiscountCap === '' ? null : Number(f.maxDiscountCap),
  usageLimitPerCustomer: f.usageLimitPerCustomer === '' ? null : Number(f.usageLimitPerCustomer),
  validFrom: f.validFrom || null,
  validTo: f.validTo || null,
  isPlatformWide: Boolean(f.isPlatformWide),
});

export const emptyDeliveryFee = () => ({
  name: 'default',
  baseFee: '',
  freeDeliveryThreshold: '',
  expressSurgeMultiplier: '',
  distanceFeePerKm: '',
  effectiveFrom: '',
  effectiveTo: '',
});

export const deliveryFeeToForm = (p) => ({
  name: p.name || 'default',
  baseFee: p.baseFee ?? '',
  freeDeliveryThreshold: p.freeDeliveryThreshold ?? '',
  expressSurgeMultiplier: p.expressSurgeMultiplier ?? '',
  distanceFeePerKm: p.distanceFeePerKm ?? '',
  effectiveFrom: p.effectiveFrom ? new Date(p.effectiveFrom).toISOString().slice(0, 10) : '',
  effectiveTo: p.effectiveTo ? new Date(p.effectiveTo).toISOString().slice(0, 10) : '',
});

export const deliveryFeePayload = (f) => ({
  name: f.name.trim() || 'default',
  baseFee: Number(f.baseFee),
  freeDeliveryThreshold: f.freeDeliveryThreshold === '' ? null : Number(f.freeDeliveryThreshold),
  expressSurgeMultiplier: f.expressSurgeMultiplier === '' ? null : Number(f.expressSurgeMultiplier),
  distanceFeePerKm: f.distanceFeePerKm === '' ? null : Number(f.distanceFeePerKm),
  effectiveFrom: f.effectiveFrom || null,
  effectiveTo: f.effectiveTo || null,
});

export const emptyTax = () => ({
  categoryId: '',
  gstSlabPct: '',
  hsnCode: '',
  effectiveFrom: '',
  effectiveTo: '',
});

export const taxPayload = (f) => ({
  categoryId: f.categoryId,
  gstSlabPct: Number(f.gstSlabPct),
  hsnCode: f.hsnCode || null,
  effectiveFrom: f.effectiveFrom || null,
  effectiveTo: f.effectiveTo || null,
});
