import mongoose from 'mongoose';
import { auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

/** Append-only, PII-free search funnel events with bounded retention. */
const SearchInteractionSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  eventId: { type: String, required: true, maxlength: 100 },
  queryId: { type: String, required: true, maxlength: 64, index: true },
  sessionHash: { type: String, default: null, maxlength: 32 },
  type: { type: String, enum: ['query', 'impression', 'click', 'add_to_cart', 'purchase'], required: true, index: true },
  listingId: { type: Types.ObjectId, ref: 'TenantProduct', default: null, index: true },
  masterId: { type: Types.ObjectId, ref: 'ProductMaster', default: null },
  position: { type: Number, default: null, min: 0, max: 5000 },
  quantity: { type: Number, default: null, min: 0 },
  revenuePaise: { type: Number, default: null, min: 0 },
  normalizedQuery: { type: String, default: '', maxlength: 200 },
  profileCode: { type: String, default: 'default', maxlength: 40 },
  experimentBucket: { type: String, default: 'control', maxlength: 20 },
  resultCount: { type: Number, default: null, min: 0 },
  zeroResult: { type: Boolean, default: false },
  latencyMs: { type: Number, default: null, min: 0 },
  candidateListingIds: { type: [String], default: [], validate: (value) => value.length <= 1000 },
  candidateMasterIds: { type: [String], default: [], validate: (value) => value.length <= 1000 },
  source: { type: String, enum: ['api', 'storefront', 'order'], default: 'storefront' },
  occurredAt: { type: Date, default: Date.now },
}, { collection: 'searchinteractions' });

SearchInteractionSchema.index({ tenantId: 1, eventId: 1 }, { unique: true, name: 'search_interaction_event_uq' });
SearchInteractionSchema.index({ tenantId: 1, occurredAt: -1, type: 1 }, { name: 'search_interaction_analytics_idx' });
SearchInteractionSchema.index({ tenantId: 1, listingId: 1, occurredAt: -1 }, { name: 'search_interaction_listing_window_idx' });
SearchInteractionSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600, name: 'search_interaction_retention_ttl' });

SearchInteractionSchema.plugin(auditPlugin);
SearchInteractionSchema.plugin(toJSONPlugin);

export default mongoose.models.SearchInteraction || mongoose.model('SearchInteraction', SearchInteractionSchema);
