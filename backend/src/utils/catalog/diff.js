/** Diff helpers for ProductChangeRequest (before/after snapshots). */

/** Extract a subset of keys from an object. */
export function pick(obj = {}, keys = []) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Build a change-request diff: only the provided keys, only if actually changed.
 * @returns {{ changed: string[], before: object, after: object }}
 */
export function diffObjects(current = {}, proposed = {}, keys = []) {
  const before = {};
  const after = {};
  const changed = [];

  for (const k of keys) {
    if (!(k in proposed)) continue;
    const a = current[k];
    const b = proposed[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      before[k] = a ?? null;
      after[k] = b;
      changed.push(k);
    }
  }
  return { changed, before, after };
}
