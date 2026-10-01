import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;
const schema = new Schema({
  bundleMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
  componentMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
  componentVariantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null },
  quantity: { type: Number, required: true, min: Number.EPSILON, default: 1 },
  unitCode: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
  selectionGroup: { type: String, default: 'included', trim: true, lowercase: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
  required: { type: Boolean, default: true },
  defaultSelected: { type: Boolean, default: true },
  minSelections: { type: Number, min: 0, default: 1 },
  maxSelections: { type: Number, min: 1, default: 1 },
  priceAdjustment: { type: Number, default: 0 },
  sortOrder: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
}, { collection: 'productbundlecomponents' });
schema.pre('validate', function validateComponent(next) {
  if (String(this.bundleMasterId) === String(this.componentMasterId)) return next(new Error('A bundle cannot contain itself'));
  if (this.minSelections > this.maxSelections) return next(new Error('minSelections cannot exceed maxSelections'));
  return next();
});
schema.index(
  { bundleMasterId: 1, componentMasterId: 1, componentVariantId: 1, selectionGroup: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
schema.index({ componentMasterId: 1, status: 1 });
schema.plugin(auditPlugin); schema.plugin(softDeletePlugin); schema.plugin(toJSONPlugin);
export default mongoose.model('ProductBundleComponent', schema);
