/**
 * serializeList — makes list responses consistent with detail responses.
 *
 * Detail endpoints return full Mongoose docs (toJSON plugin adds `id`).
 * List endpoints use `.lean()` for speed, which skips that transform, so
 * consumers would see `_id` instead of `id`. This helper maps rows to the
 * same public shape: `id` (string), no `_id`.
 *
 * Handles BOTH input shapes:
 *  - lean rows:          { _id: ObjectId, ... }            → id from _id
 *  - transformed docs:   { id: 'hex', ... } (toObject() with the
 *    toJSON plugin's transform has already mapped _id → id and DELETED
 *    _id). Preserving the existing `id` is critical: previously this
 *    function overwrote it with `undefined`, so every response built from
 *    `created.map(d => d.toObject())` shipped documents with no id at all.
 */
export function serializeList(docs) {
  if (!Array.isArray(docs)) return docs;
  return docs.map((d) => {
    if (!d) return d;
    const { _id, id, ...rest } = d;
    return { ...rest, id: _id ? String(_id) : id !== undefined ? String(id) : undefined };
  });
}

export default serializeList;
