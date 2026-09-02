import CatalogEvent from '../models/catalogEvent.model.js';
import { CATALOG_EVENT_TYPE } from '../constants/enums.js';

/**
 * CatalogEventService — outbox-based domain events.
 *
 * publish(): appends a durable outbox row (same request path, no I/O beyond
 *            one insert — writes stay fast).
 * drain():   publishes pending rows to registered in-process handlers
 *            (cache invalidation, logging; later Kafka/Redis/queue).
 *            Failed rows are retried (attempts + lastError are recorded).
 */
const handlers = new Set();

/** Register an async handler: (eventDoc) => Promise<void> */
export function registerCatalogEventHandler(fn) {
  handlers.add(fn);
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
      status: 'pending',
      availableAt: delayMs ? new Date(Date.now() + delayMs) : new Date(),
    });
  }

  /** Publish pending events (optionally up to `limit`) to registered handlers. */
  async drain({ limit = 50 } = {}) {
    const events = await CatalogEvent.find({
      status: 'pending',
      availableAt: { $lte: new Date() },
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    let published = 0;
    let failed = 0;

    for (const ev of events) {
      ev.status = 'publishing';
      await ev.save();
      try {
        for (const handler of handlers) {
          await handler(ev);
        }
        ev.status = 'published';
        ev.publishedAt = new Date();
      } catch (err) {
        failed += 1;
        ev.status = 'failed';
        ev.attempts = (ev.attempts || 0) + 1;
        ev.lastError = err?.message || String(err);
      }
      await ev.save();
      published += 1;
    }

    return { scanned: events.length, published, failed };
  }

  /** Counts by status — handy for an ops/debug endpoint. */
  async status() {
    const [pending, publishing, published, failed] = await Promise.all([
      CatalogEvent.countDocuments({ status: 'pending' }),
      CatalogEvent.countDocuments({ status: 'publishing' }),
      CatalogEvent.countDocuments({ status: 'published' }),
      CatalogEvent.countDocuments({ status: 'failed' }),
    ]);
    return { pending, publishing, published, failed };
  }
}

export default new CatalogEventService();
