import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;
const schema = new Schema({
  productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
  productVariantId: { type: Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
  attributeKey: { type: String, required: true, trim: true, match: /^[a-z0-9_]+$/ },
  value: { type: Schema.Types.Mixed, required: true },
  valueType: { type: String, enum: ['string', 'text', 'number', 'boolean', 'select', 'multi_select', 'date', 'json'], default: 'string' },
  textValue: { type: String, default: null, maxlength: 4000 },
  numberValue: { type: Number, default: null },
  booleanValue: { type: Boolean, default: null },
  dateValue: { type: Date, default: null },
  unit: { type: String, default: null, maxlength: 20 },
  sortOrder: { type: Number, default: 0 },
}, { collection: 'productvariantattributevalues' });

schema.pre('validate', function projectTypedValue(next) {
  this.textValue = null; this.numberValue = null; this.booleanValue = null; this.dateValue = null;
  if (typeof this.value === 'number') { this.valueType = 'number'; this.numberValue = this.value; }
  else if (typeof this.value === 'boolean') { this.valueType = 'boolean'; this.booleanValue = this.value; }
  else if (this.value instanceof Date) { this.valueType = 'date'; this.dateValue = this.value; }
  else if (Array.isArray(this.value)) { this.valueType = 'multi_select'; this.textValue = this.value.map(String).join(' '); }
  else if (this.value && typeof this.value === 'object') { this.valueType = 'json'; this.textValue = JSON.stringify(this.value).slice(0, 4000); }
  else this.textValue = String(this.value);
  next();
});
schema.index({ productVariantId: 1, attributeKey: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ productMasterId: 1, attributeKey: 1, textValue: 1 });
schema.index({ productMasterId: 1, attributeKey: 1, numberValue: 1 });
schema.plugin(auditPlugin); schema.plugin(softDeletePlugin); schema.plugin(toJSONPlugin);
export default mongoose.model('ProductVariantAttributeValue', schema);
