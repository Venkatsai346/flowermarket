/** tiny classnames helper */
export const cn = (...xs) => xs.filter(Boolean).join(' ');

/**
 * Normalize row ids — list endpoints return lean `_id`, detail endpoints return
 * `id` (toJSON/serializeList). One helper everywhere.
 */
export const rid = (r) => r?.id ?? r?._id ?? null;

/** extract a human message from any thrown error (ApiError or otherwise) */

/** extract a human message from any thrown error (ApiError or otherwise) */
export const errMsg = (e) =>
  e?.message || (typeof e === 'string' ? e : 'Something went wrong');
