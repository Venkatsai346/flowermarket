/**
 * ProductImage — images of a ProductMaster, own collection.
 * Tenant-uploaded image edits route through ProductChangeRequest (UPDATE_IMAGES).
 *
 * VARIANT SCOPING (world-class variant catalog):
 *  - `variantId = null`  -> a MASTER-level image (the product's default gallery).
 *  - `variantId = <id>`  -> an image of ONE variant (e.g. the red polo's photos).
 * One collection (not an embedded array on the variant) so uploads, ordering,
 * primary flags, soft-delete, audit and the catalog outbox all stay on the
 * single image pipeline. `isPrimary` is scoped per (master, variant): each
 * variant may have its own primary, and the master gallery has its own.
 * Reads resolve via `utils/catalog/variantImages.js`: variant images when any
 * exist, otherwise the master gallery as fallback.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ProductImageSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    // Nullable scope: null = master gallery, set = this variant's gallery.
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null, index: true },
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
// Variant-gallery reads: all active images of one variant, primary first.
ProductImageSchema.index({ productMasterId: 1, variantId: 1, status: 1, isPrimary: -1, sortOrder: 1 });

ProductImageSchema.plugin(auditPlugin);
ProductImageSchema.plugin(softDeletePlugin);
ProductImageSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductImage', ProductImageSchema);
