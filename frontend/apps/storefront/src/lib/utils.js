export const cn = (...xs) => xs.filter(Boolean).join(' ');

/** Unwrap the shapes list endpoints actually return. */
export function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.addresses)) return value.addresses;
  if (Array.isArray(value?.slots)) return value.slots;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

/** Human message from an ApiError, falling back sensibly. */
export const errMsg = (e) => e?.details?.[0]?.message || e?.message || 'Something went wrong';

/** Stable key for a listing row. */
export const listingKey = (p) => p.listingId || p.id || p.product?.id;
