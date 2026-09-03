/** Catalog governance + tenant listing metadata (matches backend enums). */
import {
  AUDIT_ACTION_META, BULK_JOB_STATUS_META, BULK_KIND_LABELS, CHANGE_REQUEST_STATUS_META,
  CHANGE_REQUEST_TYPE_META, ENTITY_TYPE_LABELS, EVENT_STATUS_META, LISTING_STATUS_META,
} from '@flower-market/shared';

export {
  AUDIT_ACTION_META, BULK_JOB_STATUS_META, BULK_KIND_LABELS, CHANGE_REQUEST_STATUS_META,
  CHANGE_REQUEST_TYPE_META, ENTITY_TYPE_LABELS, EVENT_STATUS_META, LISTING_STATUS_META,
};

export const LISTING_STATUS_OPTIONS = Object.entries(LISTING_STATUS_META);

export const fmtRows = (n) => `${Math.round(Number(n) || 0)}`;

/** Compact JSON for review diffs / audit payloads without losing nulls. */
export const fmtJson = (v) => {
  if (v == null) return '—';
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/** A conservative "changed keys" summary for an audit log before/after pair. */
export const changedKeys = (before = null, after = null) => {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) =>
    (a[k] == null && b[k] == null) ? false : String(a[k] ?? '') !== String(b[k] ?? '')
  );
};

export const entityLabel = (t) => ENTITY_TYPE_LABELS[t] || String(t || '').replaceAll('_', ' ');
