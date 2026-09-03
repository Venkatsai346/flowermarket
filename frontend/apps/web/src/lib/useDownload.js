import { useState } from 'react';
import { saveDownload } from './download.js';
import { errMsg } from './utils.js';
import { toast } from './toasts.js';

/**
 * Standard server-export download flow.
 *
 * `run` must be a thunk that returns the shared client's raw download result
 * (the Phase 0 `download`/`raw` path). The hook handles the "Preparing…"
 * label, blob save, success/failure toast and busy state.
 */
export function useDownload({ onDone } = {}) {
  const [busy, setBusy] = useState(false);

  const run = async (request, fallbackName) => {
    setBusy(true);
    try {
      const file = await saveDownload(await request(), fallbackName);
      toast.success(`${file.filename} downloaded`);
      onDone?.(file);
      return file;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}

export default useDownload;
