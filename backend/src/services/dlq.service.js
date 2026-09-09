/**
 * DlqService — Dead Letter Queue management for outbox events.
 *
 * The catalog event outbox (catalogEvent.service.js) has a DLQ for events
 * that fail after max retries. This service provides:
 *   1. List DLQ entries (with filtering)
 *   2. Inspect a single DLQ entry (full payload + error history)
 *   3. Requeue a DLQ entry (reset to pending, clear failure)
 *   4. Bulk requeue (retry all or filtered)
 *   5. Purge old DLQ entries (cleanup)
 *   6. DLQ stats (depth, age, error categories)
 *
 * The DLQ entries are CatalogEvent documents with status='failed'.
 */

import CatalogEvent from '../models/catalogEvent.model.js';
import catalogEventService from './catalogEvent.service.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest } from '../utils/ApiError.js';

class DlqService {
  /**
   * List DLQ entries (failed events).
   */
  async list({ tenantId = null, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { status: 'failed' };
    if (tenantId) q.tenantId = tenantId;
    if (query.eventType) q.eventType = query.eventType;
    if (query.entityType) q.entityType = query.entityType;
    if (query.from || query.to) {
      q.createdAt = {};
      if (query.from) q.createdAt.$gte = new Date(query.from);
      if (query.to) q.createdAt.$lte = new Date(query.to);
    }

    const [docs, total] = await Promise.all([
      CatalogEvent.find(q)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CatalogEvent.countDocuments(q),
    ]);

    return {
      items: serializeList(docs),
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: (page - 1) * limit + docs.length < total,
      },
    };
  }

  /**
   * Get a single DLQ entry with full details.
   */
  async get({ tenantId, eventId }) {
    const q = { _id: eventId, status: 'failed' };
    if (tenantId) q.tenantId = tenantId;
    const event = await CatalogEvent.findOne(q).lean();
    if (!event) throw notFound('DLQ entry not found', 'DLQ_ENTRY_NOT_FOUND');
    return event;
  }

  /**
   * Requeue a single DLQ entry (reset to pending for retry).
   */
  async requeue({ tenantId, eventId, actorId, req = null }) {
    const q = { _id: eventId, status: 'failed' };
    if (tenantId) q.tenantId = tenantId;
    const event = await CatalogEvent.findOne(q);
    if (!event) throw notFound('DLQ entry not found', 'DLQ_ENTRY_NOT_FOUND');

    event.status = 'pending';
    event.retryCount = 0;
    event.lastError = null;
    event.availableAt = new Date();
    await event.save();

    await auditService.record({
      action: 'dlq_requeue',
      entityType: 'catalog_event',
      entityId: event._id,
      tenantId: tenantId || event.tenantId,
      actorId,
      actorType: 'tenant',
      meta: { eventType: event.eventType },
      req,
    });

    return event;
  }

  /**
   * Bulk requeue DLQ entries (filtered or all).
   */
  async bulkRequeue({ tenantId, filters = {}, actorId, req = null }) {
    const q = { status: 'failed' };
    if (tenantId) q.tenantId = tenantId;
    if (filters.eventType) q.eventType = filters.eventType;
    if (filters.entityType) q.entityType = filters.entityType;
    if (filters.olderThan) q.updatedAt = { $lte: new Date(filters.olderThan) };

    const result = await CatalogEvent.updateMany(q, {
      $set: {
        status: 'pending',
        retryCount: 0,
        lastError: null,
        availableAt: new Date(),
      },
    });

    await auditService.record({
      action: 'dlq_bulk_requeue',
      entityType: 'catalog_event',
      entityId: null,
      tenantId: tenantId || 'platform',
      actorId,
      actorType: 'tenant',
      meta: { filters, modified: result.modifiedCount },
      req,
    });

    return { requeued: result.modifiedCount };
  }

  /**
   * Purge old DLQ entries (hard delete).
   */
  async purge({ tenantId, olderThanDays = 30, actorId, req = null }) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const q = { status: 'failed', updatedAt: { $lte: cutoff } };
    if (tenantId) q.tenantId = tenantId;

    const result = await CatalogEvent.deleteMany(q);

    await auditService.record({
      action: 'dlq_purge',
      entityType: 'catalog_event',
      entityId: null,
      tenantId: tenantId || 'platform',
      actorId,
      actorType: 'tenant',
      meta: { olderThanDays, deleted: result.deletedCount },
      req,
    });

    return { purged: result.deletedCount };
  }

  /**
   * DLQ stats — depth, age, error categories.
   */
  async stats({ tenantId = null }) {
    const match = { status: 'failed' };
    if (tenantId) match.tenantId = tenantId;

    const [depth, oldest, byEventType, byEntityType, errorCategories] = await Promise.all([
      CatalogEvent.countDocuments(match),
      CatalogEvent.findOne(match).sort({ createdAt: 1 }).select('createdAt').lean(),
      CatalogEvent.aggregate([
        { $match: match },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      CatalogEvent.aggregate([
        { $match: match },
        { $group: { _id: '$entityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      CatalogEvent.aggregate([
        { $match: { ...match, lastError: { $ne: null } } },
        { $group: { _id: { $substr: ['$lastError', 0, 80] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return {
      depth,
      oldestAgeMs: oldest ? Date.now() - new Date(oldest.createdAt).getTime() : 0,
      byEventType: Object.fromEntries(byEventType.map((e) => [e._id, e.count])),
      byEntityType: Object.fromEntries(byEntityType.map((e) => [e._id, e.count])),
      topErrors: errorCategories.map((e) => ({ message: e._id, count: e.count })),
    };
  }
}

export default new DlqService();
