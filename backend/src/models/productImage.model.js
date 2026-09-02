/**
 * ProductImage — images of a ProductMaster, own collection.
 * Tenant-uploaded image edits route through ProductChangeRequest (UPDATE_IMAGES).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ProductImageSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    url: { type: String, required: true, trim: true },
    altText: { type: String, default: null, maxlength: 200 },
    isPrimary: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    uploadedBy: { type: Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
      index: true,
    },
  },
  { collection: 'productimages' }
);

ProductImageSchema.index({ productMasterId: 1, isPrimary: 1, status: 1 });

ProductImageSchema.plugin(auditPlugin);
ProductImageSchema.plugin(softDeletePlugin);
ProductImageSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductImage', ProductImageSchema);
