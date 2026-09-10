import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@flower-market/shared';
import { errMsg } from './utils.js';
import { toast } from './toasts.js';

/**
 * useApi — fetch-on-mount hook for a single endpoint call.
 *   const { data, meta, loading, error, refetch } = useApi(() => api.admin.orders({page}), [page]);
 *
 * Session-identity aware: the hook subscribes to the auth store's `sessionId`
 * (a monotonic counter advanced by every `setSession` and `clear`). When the
 * identity changes — logout then login, or a direct account switch — any
 * `data`/`meta` retained from the previous identity is discarded and the call
 * refires under the new identity's credentials. A page that survives a session
 * change therefore cannot keep rendering user A's payload to user B.
 *
 * Ordinary dependency refetches (pagination, filters) still keep the previous
 * payload visible while reloading, so those don't flash a spinner.
 *
 * Errors are surfaced via the standard toast system by default so no page can
 * silently swallow a failed load. Pass `{ toastOnError: false }` for silent
 * background polls that already communicate their own state.
 */
export function useApi(fn, deps = [], { toastOnError = true } = {}) {
  const sessionId = useAuthStore((s) => s.sessionId);
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const sessionRef = useRef(sessionId);

  const notifyError = (e) => {
    if (toastOnError) toast.error(errMsg(e));
  };

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fnRef.current();
      setState({ data: r.data, meta: r.meta, loading: false, error: null });
      return r;
    } catch (e) {
      setState((s) => ({ data: s.data, meta: s.meta, loading: false, error: e }));
      notifyError(e);
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    // A session change is the one refetch that must also drop the previous
    // user's data. Detect it by comparing against the id seen at last run;
    // the comparison happens before the async call so an in-flight response
    // from the old identity can't slip back in afterwards.
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
          notifyError(e);
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, sessionId]);

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
