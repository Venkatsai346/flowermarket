/**
 * CatalogEvent — outbox for catalog domain events.
 *
 * WHY AN OUTBOX (matches the architecture doc's event-decoupling):
 *  - Writes stay fast: we append an event row in the SAME transaction/operation
 *    as the domain write; cache invalidation, search reindex and downstream
 *    sync happen LATER via drain() — never synchronously in the request path.
 *  - Drain publishes to registered in-process handlers today (cache invalidation,
 *    logging). The row is the durable record so a future Kafka/Redis/queue
 *    publisher can consume the same outbox without schema changes.
 *  - Failed events are retried by drain() (attempts + lastError), so no event
 *    is silently lost.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { CATALOG_EVENT_TYPE, OUTBOX_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const CatalogEventSchema = new Schema(
  {
    eventType: {
      type: String,
      enum: Object.values(CATALOG_EVENT_TYPE),
      required: true,
      index: true,
    },
    entityType: { type: String, required: true, maxlength: 60 },
    entityId: { type: Types.ObjectId, required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    payload: { type: Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: Object.values(OUTBOX_STATUS),
      default: OUTBOX_STATUS.PENDING,
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: null },
    availableAt: { type: Date, default: Date.now, index: true }, // supports delayed publish
    publishedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'catalogevents' }
);

// drain query index
CatalogEventSchema.index({ status: 1, availableAt: 1 });
// purge published events after 7 days
CatalogEventSchema.index(
  { publishedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60, partialFilterExpression: { publishedAt: { $type: 'date' } } }
);

CatalogEventSchema.plugin(auditPlugin);
CatalogEventSchema.plugin(softDeletePlugin);
CatalogEventSchema.plugin(toJSONPlugin);

export default mongoose.model('CatalogEvent', CatalogEventSchema);
