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
 *
 * RACE-SAFETY (the part a plain `doc.save()` cannot give us):
 *   The version check happens TWICE.
 *     1. Fast path (in-memory): the fetched doc's version vs expected —
 *        a stale client fails before any write round-trip.
 *     2. Slow path (atomic): the commit itself is a conditional
 *        `updateOne({ _id, version: expected }, { $set: …, version: n+1 })`.
 *        Two concurrent writers that both read version n: only ONE of their
 *        conditional updates can match (the DB row holds version n exactly
 *        once); the other gets matchedCount 0 → 409. Last-write-wins is
 *        impossible; the version counter can never be skipped or duplicated.
 *
 *   After a successful commit the in-memory doc is already at the new values
 *   (set + bump happened before the round-trip) and is marked clean, so a
 *   later `doc.save()` (e.g. the searchText recompute in updateGlobalFields)
 *   writes only its own new fields on top of the committed state.
 */
export async function updateWithVersion(doc, expectedVersion, patch, { bump = true } = {}) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw conflict('expectedVersion is required for updates', 'VERSION_REQUIRED');
  }
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) {
    throw conflict('expectedVersion must be a positive integer', 'VERSION_REQUIRED');
  }
  if (Number(doc.version) !== expected) {
    throw conflict('This item was modified by another request. Refresh and retry.', 'VERSION_CONFLICT');
  }

  // In-memory: apply patch + bump so the doc reflects the intended state.
  doc.set(patch);
  if (bump) doc.version = expected + 1;

  // Exact $set this commit should persist (patch + version bump; any
  // pre-existing in-memory changes the caller made — same as save() would).
  let set;
  if (typeof doc.getChanges === 'function') {
    set = doc.getChanges().$set;
  } else {
    // Mongoose < 5.10 fallback: the patch itself + the bump.
    set = { ...(patch || {}) };
    if (bump) set.version = expected + 1;
  }

  const Model = doc.constructor;
  const res = await Model.updateOne(
    { _id: doc._id, version: expected },
    { $set: set },
  );

  if (res.matchedCount !== 1) {
    // Lost the race: another writer committed between our findById and now.
    // Re-sync the in-memory doc with the database so anything downstream of
    // this error (loggers, callers re-using the doc) sees truth, then fail.
    try {
      const fresh = await Model.findById(doc._id);
      if (fresh) doc.init(fresh);
    } catch {
      /* best-effort re-sync; the 409 below is what matters */
    }
    throw conflict('This item was modified by another request. Refresh and retry.', 'VERSION_CONFLICT');
  }

  // Commit succeeded and the doc already holds the committed values — mark
  // clean so a subsequent save() only carries genuinely new changes.
  for (const p of doc.modifiedPaths()) doc.unmarkModified(p);
  return doc;
}

export default updateWithVersion;
