export const cn = (...xs) => xs.filter(Boolean).join(' ');

/** Human message from an ApiError, falling back sensibly. */
export const errMsg = (e) => e?.details?.[0]?.message || e?.message || 'Something went wrong';

/** Stable key for a listing row. */
export const listingKey = (p) => p.listingId || p.id || p.product?.id;
