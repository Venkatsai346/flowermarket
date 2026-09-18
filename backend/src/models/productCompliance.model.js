import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;
const documentSchema = new Schema({
  name: { type: String, required: true, maxlength: 160 },
  url: { type: String, required: true, maxlength: 2000 },
  mimeType: { type: String, default: null, maxlength: 100 },
  checksum: { type: String, default: null, maxlength: 128 },
}, { _id: false });
const schema = new Schema({
  productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
  variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null, index: true },
  type: { type: String, enum: ['certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental'], required: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  authority: { type: String, default: null, maxlength: 160 },
  jurisdiction: {
    country: { type: String, default: 'IN', maxlength: 2 }, state: { type: String, default: null, maxlength: 80 },
    regions: { type: [String], default: [], validate: (value) => value.length <= 100 },
  },
  status: { type: String, enum: ['draft', 'pending', 'verified', 'expired', 'rejected'], default: 'draft', index: true },
  validFrom: { type: Date, default: null },
  validUntil: { type: Date, default: null, index: true },
  issuerReference: { type: String, default: null, maxlength: 200 },
  documents: { type: [documentSchema], default: [], validate: (value) => value.length <= 20 },
  restrictions: { type: [String], default: [], validate: (value) => value.length <= 50 },
  metadata: { type: Schema.Types.Mixed, default: {} },
  verifiedBy: { type: Types.ObjectId, ref: 'User', default: null },
  verifiedAt: { type: Date, default: null },
}, { collection: 'productcompliances' });
schema.pre('validate', function validateCompliance(next) {
  if (this.validFrom && this.validUntil && this.validUntil <= this.validFrom) return next(new Error('validUntil must be after validFrom'));
  if (this.status === 'verified' && !this.documents?.length && !this.issuerReference) return next(new Error('Verified compliance requires evidence'));
  return next();
});
schema.index({ productMasterId: 1, variantId: 1, type: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ status: 1, validUntil: 1 });
schema.plugin(auditPlugin); schema.plugin(softDeletePlugin); schema.plugin(toJSONPlugin);
export default mongoose.model('ProductCompliance', schema);
