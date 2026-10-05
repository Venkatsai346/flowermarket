import mongoose from 'mongoose';
import { auditPlugin, softDeletePlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const SearchMerchandisingRuleSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true, lowercase: true, trim: true, maxlength: 60 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: null, maxlength: 500 },
  type: { type: String, enum: ['pin', 'boost', 'bury', 'redirect', 'substitute', 'shelf'], required: true, index: true },
  status: { type: String, enum: ['draft', 'active', 'paused'], default: 'draft', index: true },
  priority: { type: Number, default: 0, min: -10000, max: 10000 },
  scope: {
    query: { type: String, default: null, lowercase: true, trim: true, maxlength: 200 },
    match: { type: String, enum: ['exact', 'prefix', 'contains', 'all'], default: 'exact' },
    categoryId: { type: Types.ObjectId, ref: 'Category', default: null },
  },
  target: {
    listingIds: { type: [Types.ObjectId], default: [], validate: (value) => value.length <= 100 },
    masterIds: { type: [Types.ObjectId], default: [], validate: (value) => value.length <= 100 },
    redirectPath: { type: String, default: null, maxlength: 500 },
    substituteListingIds: { type: [Types.ObjectId], default: [], validate: (value) => value.length <= 20 },
    shelfTitle: { type: String, default: null, maxlength: 120 },
  },
  boost: { type: Number, default: 0.5, min: 0, max: 10 },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  timezone: { type: String, default: 'Asia/Kolkata', maxlength: 60 },
  createdBy: { type: Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Types.ObjectId, ref: 'User', default: null },
  version: { type: Number, default: 1, min: 1 },
}, { collection: 'searchmerchandisingrules', timestamps: true });

SearchMerchandisingRuleSchema.index({ tenantId: 1, status: 1, startsAt: 1, endsAt: 1, priority: -1 }, { name: 'search_rule_active_window_idx' });
SearchMerchandisingRuleSchema.index(
  { tenantId: 1, type: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'search_rule_code_uq' },
);
SearchMerchandisingRuleSchema.pre('validate', function validateRule(next) {
  if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt) return next(new Error('endsAt must be after startsAt'));
  if (this.type === 'redirect' && (!this.target?.redirectPath?.startsWith('/') || this.target.redirectPath.startsWith('//'))) return next(new Error('redirectPath must be an application-relative path'));
  if (['pin', 'boost', 'bury'].includes(this.type) && !this.target?.listingIds?.length) return next(new Error(`${this.type} rules require at least one listing`));
  if (this.type === 'substitute' && (this.target?.listingIds?.length !== 1 || !this.target?.substituteListingIds?.length)) return next(new Error('substitute rules require one source and at least one replacement listing'));
  if (this.type === 'shelf' && !this.target?.listingIds?.length && !this.target?.masterIds?.length) return next(new Error('shelf rules require at least one product'));
  return next();
});

SearchMerchandisingRuleSchema.plugin(auditPlugin);
SearchMerchandisingRuleSchema.plugin(softDeletePlugin);
SearchMerchandisingRuleSchema.plugin(toJSONPlugin);

export default mongoose.models.SearchMerchandisingRule || mongoose.model('SearchMerchandisingRule', SearchMerchandisingRuleSchema);
