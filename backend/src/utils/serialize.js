/**
 * serializeDoc / serializeList — make lean responses consistent with detail
 * responses.
 *
 * Detail endpoints return full Mongoose docs (toJSON plugin adds `id`).
 * List endpoints use `.lean()` for speed, which skips that transform, so
 * consumers would see `_id` instead of `id` — and any client reading `.id`
 * (edit modals, verify buttons, delete confirms) would send `undefined`
 * back as the route param. Every entity object crossing the wire must carry
 * a string `id`: map lean rows through these helpers before responding.
 *
 * Handles BOTH input shapes:
 *  - lean rows:          { _id: ObjectId, ... }            → id from _id
 *  - transformed docs:   { id: 'hex', ... } (toObject() with the
 *    toJSON plugin's transform has already mapped _id → id and DELETED
 *    _id). Preserving the existing `id` is critical: previously this
 *    function overwrote it with `undefined`, so every response built from
 *    `created.map(d => d.toObject())` shipped documents with no id at all.
 */
export function serializeDoc(d) {
  if (!d || typeof d !== 'object') return d;
  const { _id, id, ...rest } = d;
  return { ...rest, id: _id ? String(_id) : id !== undefined && id !== null ? String(id) : undefined };
}

export function serializeList(docs) {
  if (!Array.isArray(docs)) return docs;
  return docs.map(serializeDoc);
}

export default serializeList;
