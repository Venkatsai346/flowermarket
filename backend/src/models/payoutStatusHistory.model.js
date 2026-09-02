/**
 * PayoutStatusHistory — every state change of a payout batch (Phase 6.3).
 * Append-only, mirroring `orderstatushistories`: if money moved, there is a row
 * saying who moved it, when, and from what state.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PAYOUT_STATE, AUDIT_ACTOR_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PayoutStatusHistorySchema = new Schema(
  {
    payoutBatchId: { type: Types.ObjectId, ref: 'PayoutBatch', required: true, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', required: true },
    fromState: { type: String, enum: [...Object.values(PAYOUT_STATE), null], default: null },
    toState: { type: String, enum: Object.values(PAYOUT_STATE), required: true },
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    actorType: { type: String, enum: Object.values(AUDIT_ACTOR_TYPE), default: AUDIT_ACTOR_TYPE.SYSTEM },
    note: { type: String, default: null, maxlength: 400 },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'payoutstatushistories' }
);

PayoutStatusHistorySchema.index({ payoutBatchId: 1, createdAt: 1 });

PayoutStatusHistorySchema.plugin(auditPlugin);
PayoutStatusHistorySchema.plugin(softDeletePlugin);
PayoutStatusHistorySchema.plugin(toJSONPlugin);

export default mongoose.model('PayoutStatusHistory', PayoutStatusHistorySchema);
