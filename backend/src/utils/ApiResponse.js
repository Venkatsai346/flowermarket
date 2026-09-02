/**
 * ApiResponse — uniform response envelope.
 * Shape:
 *   { success, message?, data?, meta? }
 *
 * Pagination metadata goes in `meta` (page, limit, total, hasMore) so the React
 * Native app can render infinite lists without parsing headers.
 */
export function success(data = null, { message = 'Success', meta = null } = {}) {
  return { success: true, message, data, meta };
}

export function created(data = null, { message = 'Created' } = {}) {
  return { success: true, message, data };
}
