import CatalogEvent from '../models/catalogEvent.model.js';
import { CATALOG_EVENT_TYPE, OUTBOX_STATUS } from '../constants/enums.js';
import config from '../config/index.js';

/**
 * CatalogEventService — outbox-based domain events.
 *
 * publish(): appends a durable outbox row (same request path, no I/O beyond
 *            one insert — writes stay fast).
 * drain():   publishes due rows to registered in-process handlers.
 *
 * CRASH-SAFETY & RETRY (worker-era semantics):
 *  - CONSUMPTION IS LEASED. A row moves pending→publishing via an ATOMIC
 *    findOneAndUpdate (status+availability guarded) and carries
 *    `claimedBy`/`leaseExpiresAt`. A worker that dies mid-handler leaves the
 *    row in `publishing` — but only until the lease expires, when
 *    reapExpired() returns it to `pending` for re-consumption. No event can
 *    be stuck in `publishing` forever, and N workers can drain concurrently
 *    without double-claiming the same row.
 *  - FAILURES BACK OFF. A handler failure re-queues the row as `pending`
 *    with `availableAt = now + backoff(attempts)` (30s, 2m, 10m, 30m).
 *    After `maxAttempts` the row lands in the terminal `failed` state
 *    (dead-letter): payload + lastError are retained, and it can be re-queued
 *    on purpose via retryFailed() (ops endpoint / UI).
 *  - HANDLERS MUST BE IDEMPOTENT (at-least-once delivery: a lease that
 *    expires while a handler is still running can be re-claimed).
 *
 * The row remains the durable record — a future Kafka/Redis publisher can
 * consume the same outbox without schema changes.
 */

const handlers = new Set();

/** Register an async handler: (eventDoc) => Promise<void> */
export function registerCatalogEventHandler(fn) {
  handlers.add(fn);
}

/** Exponential backoff: attempt 1→30s, 2→2m, 3→10m, 4→30m, then DLQ. */
export function backoffMs(attempts) {
  const ladder = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
  return ladder[Math.min(Math.max(attempts - 1, 0), ladder.length - 1)];
}

class CatalogEventService {
  async publish({ eventType, entityType, entityId, tenantId = null, payload = null, delayMs = 0 }) {
    if (!Object.values(CATALOG_EVENT_TYPE).includes(eventType)) {
      throw new Error(`Unknown catalog event type: ${eventType}`);
    }
    return CatalogEvent.create({
      eventType,
      entityType,
      entityId,
      tenantId: tenantId || null,
      payload,
      status: OUTBOX_STATUS.PENDING,
      availableAt: delayMs ? new Date(Date.now() + delayMs) : new Date(),
    });
  }

  /**
   * Consume up to `limit` due events.
   * @param {object} opts { limit, workerId, leaseMs }
   * @returns {Promise<{scanned:number, published:number, failed:number}>}
   */
  async drain({ limit = 50, workerId = 'manual', leaseMs = config.worker.leaseMs } = {}) {
    const now = new Date();
    // 0. reclaim rows whose worker died mid-handler (lease expired)
    await this.reapExpired();

    // 1. candidate ids (due + pending only)
    const candidates = await CatalogEvent.find({
      status: OUTBOX_STATUS.PENDING,
      availableAt: { $lte: now },
    })
      .sort({ availableAt: 1, createdAt: 1 })
      .limit(limit)
      .select('_id')
      .lean();

    let published = 0;
    let failed = 0;

    for (const c of candidates) {
      // 2. ATOMIC claim — exactly one of N concurrent workers wins the row
      const ev = await CatalogEvent.findOneAndUpdate(
        {
          _id: c._id,
          status: OUTBOX_STATUS.PENDING,
          availableAt: { $lte: new Date() },
        },
        {
          $set: {
            status: OUTBOX_STATUS.PUBLISHING,
            claimedBy: workerId,
            claimedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + leaseMs),
          },
        },
        { new: true },
      );
      if (!ev) continue; // lost the race or became unavailable — not ours

      try {
        for (const handler of handlers) {
          await handler(ev);
        }
      } catch (err) {
        failed += 1;
        await this._markFailed(ev, err, workerId);
        continue;
      }
      // 3. complete — only if we still hold the claim (a reaper could have
      //    recycled us for a very slow handler; then the re-claimer finishes)
      const done = await CatalogEvent.findOneAndUpdate(
        { _id: ev._id, status: OUTBOX_STATUS.PUBLISHING, claimedBy: workerId },
        {
          $set: { status: OUTBOX_STATUS.PUBLISHED, publishedAt: new Date() },
          $unset: { claimedBy: 1, claimedAt: 1, leaseExpiresAt: 1 },
        },
      );
      if (done) published += 1;
    }

    return { scanned: candidates.length, published, failed };
  }

  /** Handler threw: back off & re-queue, or dead-letter after maxAttempts. */
  async _markFailed(ev, err, workerId) {
    const attempts = (ev.attempts || 0) + 1;
    const maxAttempts = config.worker.maxAttempts;
    if (attempts >= maxAttempts) {
      // terminal dead-letter — retained for inspection, re-queue via retryFailed()
      await CatalogEvent.findOneAndUpdate(
        { _id: ev._id, status: OUTBOX_STATUS.PUBLISHING, claimedBy: workerId },
        {
          $set: {
            status: OUTBOX_STATUS.FAILED,
            attempts,
            lastError: err?.message || String(err),
          },
          $unset: { claimedBy: 1, claimedAt: 1, leaseExpiresAt: 1 },
        },
      );
    } else {
      // retryable — back off, keep the claim cleared so any worker may pick it up
      await CatalogEvent.findOneAndUpdate(
        { _id: ev._id, status: OUTBOX_STATUS.PUBLISHING, claimedBy: workerId },
        {
          $set: {
            status: OUTBOX_STATUS.PENDING,
            attempts,
            lastError: err?.message || String(err),
            availableAt: new Date(Date.now() + backoffMs(attempts)),
          },
          $unset: { claimedBy: 1, claimedAt: 1, leaseExpiresAt: 1 },
        },
      );
    }
  }

  /**
   * Reclaim rows stuck in `publishing` past their lease (worker crash /
   * OOM-kill mid-handler). Returns them to `pending` immediately — the last
   * attempt already consumed its backoff slot.
   * @returns {Promise<number>} count reclaimed
   */
  async reapExpired() {
    const res = await CatalogEvent.updateMany(
      {
        status: OUTBOX_STATUS.PUBLISHING,
        leaseExpiresAt: { $lte: new Date() },
      },
      {
        $set: { status: OUTBOX_STATUS.PENDING, lastError: null },
        $unset: { claimedBy: 1, claimedAt: 1, leaseExpiresAt: 1 },
      },
    );
    return res.modifiedCount || 0;
  }

  /** Ops affordance: re-queue all dead-lettered (failed) events. */
  async retryFailed() {
    const res = await CatalogEvent.updateMany(
      { status: OUTBOX_STATUS.FAILED },
      {
        $set: { status: OUTBOX_STATUS.PENDING, attempts: 0, lastError: null, availableAt: new Date() },
        $unset: { claimedBy: 1, claimedAt: 1, leaseExpiresAt: 1, publishedAt: 1 },
      },
    );
    return { requeued: res.modifiedCount || 0 };
  }

  /** Counts by status — handy for an ops/debug endpoint. */
  async status() {
    const [pending, publishing, published, failed] = await Promise.all([
      CatalogEvent.countDocuments({ status: OUTBOX_STATUS.PENDING }),
      CatalogEvent.countDocuments({ status: OUTBOX_STATUS.PUBLISHING }),
      CatalogEvent.countDocuments({ status: OUTBOX_STATUS.PUBLISHED }),
      CatalogEvent.countDocuments({ status: OUTBOX_STATUS.FAILED }),
    ]);
    return { pending, publishing, published, failed };
  }
}

export default new CatalogEventService();
