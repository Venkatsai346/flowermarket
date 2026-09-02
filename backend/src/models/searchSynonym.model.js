/**
 * SearchSynonym — vocabulary as data (Phase 6.5).
 *
 * Indian customers type `gulab`, `mogra`, `chameli` and `rajnigandha` as
 * readily as their English names, and transliterate inconsistently. Hardcoding
 * that list would mean a developer redeploys every time the zero-result log
 * shows a new spelling; as data, whoever reads that log can just fix it.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const SearchSynonymSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true }, // null = platform-wide
    terms: { type: [String], required: true },
    /**
     * equivalent — expands in every direction (gulab ⇄ rose)
     * oneway     — expands only from `from` (bouquet → bunch, but not back)
     */
    type: { type: String, enum: ['equivalent', 'oneway'], default: 'equivalent' },
    from: { type: String, default: null, lowercase: true, maxlength: 60 },
    note: { type: String, default: null, maxlength: 200 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { collection: 'searchsynonyms' }
);

SearchSynonymSchema.index({ tenantId: 1, isActive: 1 });

SearchSynonymSchema.plugin(auditPlugin);
SearchSynonymSchema.plugin(softDeletePlugin);
SearchSynonymSchema.plugin(toJSONPlugin);

export default mongoose.model('SearchSynonym', SearchSynonymSchema);
