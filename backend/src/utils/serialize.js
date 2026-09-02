/**
 * serializeList — makes list responses consistent with detail responses.
 *
 * Detail endpoints return full Mongoose docs (toJSON plugin adds `id`).
 * List endpoints use `.lean()` for speed, which skips that transform, so
 * consumers would see `_id` instead of `id`. This helper maps lean rows to
 * the same public shape: `id` (string), no `_id`.
 */
export function serializeList(docs) {
  if (!Array.isArray(docs)) return docs;
  return docs.map((d) => {
    const { _id, ...rest } = d || {};
    return { ...rest, id: _id ? String(_id) : undefined };
  });
}

export default serializeList;
