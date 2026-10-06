import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;
const schema = new Schema({
  productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
  variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null, index: true },
  code: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
  label: { type: String, required: true, trim: true, maxlength: 100 },
  level: { type: String, enum: ['each', 'inner', 'case', 'pallet', 'custom'], default: 'each' },
  containedPackageId: { type: Types.ObjectId, ref: 'ProductPackage', default: null },
  quantity: { type: Number, required: true, min: Number.EPSILON, default: 1 },
  unitCode: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
  identifiers: {
    sku: { type: String, default: null, trim: true, maxlength: 80 },
    barcode: { type: String, default: null, trim: true, maxlength: 60 },
    gtin: { type: String, default: null, trim: true, maxlength: 32 },
  },
  weight: { value: { type: Number, default: null, min: 0 }, unit: { type: String, enum: ['mg', 'g', 'kg', 'oz', 'lb'], default: 'g' } },
  dimensions: {
    length: { type: Number, default: null, min: 0 }, width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 }, unit: { type: String, enum: ['mm', 'cm', 'm', 'in', 'ft'], default: 'cm' },
  },
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true },
  sortOrder: { type: Number, default: 0 },
}, { collection: 'productpackages' });
schema.pre('validate', function validatePackage(next) {
  if (this.containedPackageId && String(this.containedPackageId) === String(this._id)) return next(new Error('A package cannot contain itself'));
  return next();
});
schema.index({ productMasterId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ 'identifiers.barcode': 1 }, { unique: true, partialFilterExpression: { $and: [{ 'identifiers.barcode': { $type: 'string' } }, { isDeleted: false }] } });
schema.index({ containedPackageId: 1 });
schema.plugin(auditPlugin); schema.plugin(softDeletePlugin); schema.plugin(toJSONPlugin);
export default mongoose.model('ProductPackage', schema);
