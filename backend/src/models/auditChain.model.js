/**
 * AuditChain — the per-tenant tail anchor of the hash-chained audit log
 * (Phase 11).
 *
 * The domain event log is a HASH CHAIN per tenant: event N carries
 * `prevHash` = the hash of event N-1, and each `hash` covers the event's
 * canonical content + its `seq` + `prevHash`. This document is the TAIL
 * ANCHOR: `{seq, tailHash, tailSeq}` — the last seq reserved and the hash
 * that owns it. It lives in a separate collection on purpose:
 *
 *   - tampering a stored event is caught by re-hashing (hash_mismatch);
 *   - deleting an event is caught by the link it breaks (broken_link);
 *   - deleting the TAIL event is caught here: the stored chain ends at a
 *     different hash/seq than the anchor claims (tail_mismatch).
 *
 * Appends advance the anchor with a compare-and-set (read tail → propose
 * next → conditional update), so two processes (API + worker) can append to
 * the same tenant without forking the chain. See `domainEvent.service.js`.
 */

import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const AuditChainSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    // last seq reserved for this tenant's chain
    seq: { type: Number, default: 0, min: 0 },
    // hash of the event at `tailSeq` (GENESIS_HASH when the chain is empty)
    tailHash: { type: String, default: '0'.repeat(64), required: true },
    tailSeq: { type: Number, default: 0, min: 0 },
  },
  { collection: 'auditchains', timestamps: true }
);

toJSONPlugin(AuditChainSchema);

const AuditChain = mongoose.model('AuditChain', AuditChainSchema);
export default AuditChain;
