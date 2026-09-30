import { useEffect, useMemo, useRef, useState } from 'react';

const PREFIX = 'flower-market:catalog-draft:v1:';

function read(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.data && parsed?.savedAt ? parsed : null;
  } catch { return null; }
}

/**
 * Durable, account-scoped form recovery. It never silently replaces server
 * data: callers show the recovery notice and the operator explicitly restores.
 */
export function useRecoverableDraft({ key, value, initialValue, enabled = true, delay = 500 }) {
  const storageKey = useMemo(() => String(key || 'unknown'), [key]);
  const baseline = useRef(JSON.stringify(initialValue));
  const [saved, setSaved] = useState(() => enabled ? read(storageKey) : null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    baseline.current = JSON.stringify(initialValue);
    setSaved(enabled ? read(storageKey) : null);
    setDirty(false);
  }, [storageKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    const serialized = JSON.stringify(value);
    const changed = serialized !== baseline.current;
    setDirty(changed);
    if (!changed) return undefined;
    const timer = window.setTimeout(() => {
      try {
        const record = { savedAt: new Date().toISOString(), data: value };
        window.localStorage.setItem(PREFIX + storageKey, JSON.stringify(record));
      } catch { /* private mode/quota: form remains usable */ }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, enabled, delay, storageKey]);

  useEffect(() => {
    if (!enabled || !dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, enabled]);

  const clear = () => {
    try { window.localStorage.removeItem(PREFIX + storageKey); } catch { /* noop */ }
    setSaved(null); setDirty(false);
    baseline.current = JSON.stringify(value);
  };

  return {
    dirty,
    recovered: saved,
    recover: () => { const data = saved?.data || null; setSaved(null); return data; },
    discard: clear,
    clear,
  };
}

export default useRecoverableDraft;
