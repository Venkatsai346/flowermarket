import { useCallback, useEffect, useRef, useState } from 'react';
import { useShopAuth } from '../api.js';

/**
 * useApi — fetch-on-mount hook for a single endpoint call.
 *   const { data, meta, loading, error, refetch } = useApi(() => api.admin.orders({page}), [page]);
 *
 * Session-identity aware: subscribes to the shop auth store's `sessionId` and
 * discards any retained payload when the identity changes (customer logout →
 * login, or account switch), then refires under the new identity. Dependency
 * refetches keep the previous payload visible so pagination doesn't flash.
 */
export function useApi(fn, deps = []) {
  const sessionId = useShopAuth((s) => s.sessionId);
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const sessionRef = useRef(sessionId);

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fnRef.current();
      setState({ data: r.data, meta: r.meta, loading: false, error: null });
      return r;
    } catch (e) {
      setState((s) => ({ data: s.data, meta: s.meta, loading: false, error: e }));
      throw e;
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sessionChanged = sessionRef.current !== sessionId;
    sessionRef.current = sessionId;
    let alive = true;
    (async () => {
      setState((s) => (sessionChanged
        ? { data: null, meta: null, loading: true, error: null }
        : { ...s, loading: true, error: null }));
      try {
        const r = await fnRef.current();
        if (alive) setState({ data: r.data, meta: r.meta, loading: false, error: null });
      } catch (e) {
        if (alive) {
          setState((s) => (sessionChanged
            ? { data: null, meta: null, loading: false, error: e }
            : { data: s.data, meta: s.meta, loading: false, error: e }));
        }
      }
    })();
    return () => { alive = false; };
  }, [run, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, refetch: run };
}

/**
 * useAction — wraps a mutation; returns { busy, error, run(fn) }.
 * Call `run(() => api.x.y())` and handle the result/toast yourself.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}
