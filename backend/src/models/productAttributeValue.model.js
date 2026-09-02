/**
 * ProductAttributeValue — EAV-style attributes for ProductMaster (own collection).
 *
 * Why EAV (per the architecture doc):
 *  - Category-specific attributes ("shelf life", "FSSAI code", "vase life days")
 *    vary across categories; a fixed schema would force migrations.
 *  - One row per (master, attributeKey). No unbounded arrays.
 *  - Validation against the category's `attributeSchema` happens at write time.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const ProductAttributeValueSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    attributeKey: { type: String, required: true, trim: true, match: /^[a-z0-9_]+$/ },
    value: { type: String, required: true, trim: true, maxlength: 200 },
    unit: { type: String, default: null, maxlength: 20 },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: 'productattributevalues' }
);

ProductAttributeValueSchema.index({ productMasterId: 1, attributeKey: 1 }, { unique: true });

ProductAttributeValueSchema.plugin(auditPlugin);
ProductAttributeValueSchema.plugin(softDeletePlugin);
ProductAttributeValueSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductAttributeValue', ProductAttributeValueSchema);
