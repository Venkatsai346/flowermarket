import { conflict } from '../ApiError.js';

/**
 * Optimistic concurrency control — `version` field on mutable docs.
 *
 * Usage:
 *   const doc = await Model.findById(id);
 *   await updateWithVersion(doc, expectedVersion, { price: {...} });
 *
 * Throws 409 VERSION_CONFLICT when the caller's expectedVersion is stale,
 * forcing the client to refetch (the standard "refresh and retry" pattern).
 */
export async function updateWithVersion(doc, expectedVersion, patch, { bump = true } = {}) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw conflict('expectedVersion is required for updates', 'VERSION_REQUIRED');
  }
  if (Number(doc.version) !== Number(expectedVersion)) {
    throw conflict('This item was modified by another request. Refresh and retry.', 'VERSION_CONFLICT');
  }
  doc.set(patch);
  if (bump) doc.version = (Number(doc.version) || 1) + 1;
  return doc.save();
}

export default updateWithVersion;
