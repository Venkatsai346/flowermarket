/**
 * SearchQueryLog — what people searched for and what they did next.
 *
 * This is the only way to know whether a ranking change helped. It is
 * deliberately PII-free (a hashed session, never a user id), sampled, and
 * TTL-expired after 90 days: enough to compute CTR and train a learning-to-
 * rank model later, not a permanent record of what a person shopped for.
 */

import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const SearchQueryLogSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** sha256(session)[0..16] — enough to group a session, useless to identify one. */
    sessionHash: { type: String, default: null, maxlength: 32 },
    queryId: { type: String, required: true, index: true },

    query: { type: String, default: '', maxlength: 200 },
    normalizedQuery: { type: String, default: '', index: true },
    corrections: { type: [Schema.Types.Mixed], default: [] },
    filters: { type: Schema.Types.Mixed, default: {} },

    profileCode: { type: String, default: 'default' },
    experimentBucket: { type: String, default: 'control' },

    resultCount: { type: Number, default: 0 },
    zeroResult: { type: Boolean, default: false, index: true },
    relaxedTo: { type: String, default: null },
    latencyMs: { type: Number, default: 0 },
    topListingIds: { type: [String], default: [] },

    // filled in later by the beacon endpoint
    clickedPositions: { type: [Number], default: [] },
    addedToCart: { type: [String], default: [] },
    orderedListingIds: { type: [String], default: [] },

    // NOTE: the index for this field is the TTL one declared below — declaring
    // `index: true` here as well creates a duplicate (Mongoose warns).
    at: { type: Date, default: Date.now },
  },
  { collection: 'searchquerylogs' }
);

// 90-day retention
SearchQueryLogSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
SearchQueryLogSchema.index({ tenantId: 1, normalizedQuery: 1, at: -1 });

SearchQueryLogSchema.plugin(auditPlugin);
SearchQueryLogSchema.plugin(toJSONPlugin);

export default mongoose.model('SearchQueryLog', SearchQueryLogSchema);
