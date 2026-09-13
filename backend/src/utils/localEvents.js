/**
 * localEvents — a tiny in-process event bus for same-process coordination.
 *
 * Used for cache invalidation: catalog write services publish a durable
 * outbox row, then emit `catalog-write` here. The response-cache middleware
 * (same process, since HTTP writes and reads are served by the same API
 * instances) subscribes and clears its in-memory GET cache.
 *
 * SCOPE NOTE: this bus is per-process by design. In multi-instance
 * deployments the response cache must be swapped to a shared store (Redis)
 * and invalidation fanned out over pub/sub — same convention the rate
 * limiter and dedup middleware already document. A stale entry can then
 * only survive its short TTL (≤5 min), which is the same bound as before
 * this bus existed.
 */

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
// Invalidations are best-effort signal traffic; never let a missed listener
// crash a request path.
bus.setMaxListeners(100);

/** Emit a local, fire-and-forget event. */
export function localEmit(event, payload) {
  try {
    bus.emit(event, payload);
  } catch {
    /* best-effort by contract */
  }
}

/** Subscribe to a local event. Returns the unsubscribe function. */
export function localOn(event, listener) {
  bus.on(event, listener);
  return () => bus.off(event, listener);
}

export const LOCAL_EVENTS = Object.freeze({
  /** A catalog mutation was accepted (outbox row written). */
  CATALOG_WRITE: 'catalog-write',
});

export default bus;
