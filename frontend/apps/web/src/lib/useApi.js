import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useApi — fetch-on-mount hook for a single endpoint call.
 *   const { data, meta, loading, error, refetch } = useApi(() => api.admin.orders({page}), [page]);
 */
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

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
    let alive = true;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const r = await fnRef.current();
        if (alive) setState({ data: r.data, meta: r.meta, loading: false, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ data: s.data, meta: s.meta, loading: false, error: e }));
      }
    })();
    return () => { alive = false; };
  }, [run]);

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
