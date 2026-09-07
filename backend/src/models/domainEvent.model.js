/**
 * DomainEvent — the append-only money audit backbone (Phase 10).
 *
 * WHY THIS IS SEPARATE FROM THE CATALOG EVENT OUTBOX:
 *   - `catalogevents` is a SIDE-EFFECT FAN-OUT: search reindex, cache
 *     invalidation. It is consumed, published, and TTL-purged after 7 days.
 *   - `domainevents` is an AUDIT RECORD: every money fact (a sale captured,
 *     a refund issued, a payout sent) exactly once, forever. It is the
 *     source the ledger can be rebuilt from, and the thing that answers
 *     "did every rupee that moved produce a journal?".
 *
 * INVARIANTS (enforced + verified — see integrity.service.js):
 *   1. EXACTLY-ONCE: `idempotencyKey` is unique. For journal-carrying kinds
 *      the key IS the ledger journal's idempotencyKey, so a saga retry or a
 *      webhook replay appends nothing new, and event→journal coverage is an
 *      exact join, not a fuzzy one.
 *   2. APPENDED AT THE FACT: the event is written where the business fact
 *      happens (order confirmed, refund completed, payout submitted) —
 *      BEFORE the journal post — so a crash between the two is VISIBLE
 *      (event present, journal missing) and replayable, never silent.
 *   3. VERSIONED: `schemaVersion` lets a future consumer reject (not
 *      mis-read) payloads it does not understand.
 *
 * NO TTL — audit rows are retained (see docs/AUDIT_ARCHITECTURE.md).
 */

import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';
import { DOMAIN_EVENT_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DomainEventSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    // end-to-end correlation: request → saga → journal → webhook → payout
    traceId: { type: String, default: null, index: true },

    kind: {
      type: String,
      enum: Object.values(DOMAIN_EVENT_TYPE),
      required: true,
      index: true,
    },
    schemaVersion: { type: Number, default: 1, min: 1 },

    // the aggregate this event is about (order / payment / refund / payout_batch)
    aggregateType: { type: String, required: true, maxlength: 40, index: true },
    aggregateId: { type: String, required: true, index: true },

    // secondary business reference (e.g. sale_captured also refs the order number)
    refType: { type: String, default: null, maxlength: 40 },
    refId: { type: String, default: null },

    // unique → exactly-once append (see header). Sparse so non-money events
    // without a key (none today) are still allowed.
    idempotencyKey: { type: String, default: null, unique: true, sparse: true },

    // Self-contained replay payload: for journal-carrying kinds this holds
    // the exact journal lines, so a missing journal can be re-posted byte
    // for byte without re-deriving business rules.
    payload: { type: Schema.Types.Mixed, default: null },

    // business time (paidAt / completedAt), not append time
    occurredAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'domainevents' }
);

// replay/coverage scans are kind-scoped and time-ordered
DomainEventSchema.index({ kind: 1, occurredAt: 1 });
DomainEventSchema.index({ aggregateType: 1, aggregateId: 1, occurredAt: 1 });
DomainEventSchema.index({ tenantId: 1, kind: 1, occurredAt: 1 });

toJSONPlugin(DomainEventSchema);

const DomainEvent = mongoose.model('DomainEvent', DomainEventSchema);
export default DomainEvent;
