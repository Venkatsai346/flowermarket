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

const ProductRenditionSchema = new Schema({
  format: { type: String, enum: ['webp', 'avif'], required: true },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  sizeBytes: { type: Number, required: true, min: 1 },
  url: { type: String, required: true },
}, { _id: false });

const ProductImageSchema = new Schema(
  {
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    // Nullable scope: null = master gallery, set = this variant's gallery.
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null, index: true },
    url: { type: String, required: true, trim: true },
    mediaAssetId: { type: Types.ObjectId, ref: 'MediaAsset', default: null, index: true },
    checksumSha256: { type: String, default: null, maxlength: 64 },
    healthStatus: { type: String, enum: ['unknown', 'healthy', 'broken'], default: 'unknown' },
    renditions: { type: [ProductRenditionSchema], default: [], validate: (value) => value.length <= 12 },
    provenance: {
      sourceType: { type: String, enum: ['upload', 'official', 'wikimedia', 'licensed', 'legacy'], default: 'legacy' },
      sourceUrl: { type: String, default: null, maxlength: 2000 },
      creator: { type: String, default: null, maxlength: 300 },
      license: { type: String, default: null, maxlength: 200 },
      attribution: { type: String, default: null, maxlength: 1000 },
    },
    altText: { type: String, default: null, maxlength: 300 },
    mediaType: { type: String, enum: ['image', 'video', 'model_3d', 'document'], default: 'image' },
    role: { type: String, enum: ['gallery', 'thumbnail', 'swatch', 'lifestyle', 'size_chart', 'manual'], default: 'gallery' },
    mimeType: { type: String, default: null, maxlength: 100 },
    width: { type: Number, default: null, min: 1 },
    height: { type: Number, default: null, min: 1 },
    fileSize: { type: Number, default: null, min: 0 },
    focalPoint: {
      x: { type: Number, default: 0.5, min: 0, max: 1 },
      y: { type: Number, default: 0.5, min: 0, max: 1 },
    },
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
ProductImageSchema.index({ mediaAssetId: 1, status: 1, isDeleted: 1 }, { name: 'product_image_media_asset_idx' });
ProductImageSchema.index({ healthStatus: 1, status: 1, isDeleted: 1 }, { name: 'product_image_health_idx' });
// Variant-gallery reads: all active images of one variant, primary first.
ProductImageSchema.index({ productMasterId: 1, variantId: 1, status: 1, isPrimary: -1, sortOrder: 1 });
ProductImageSchema.index(
  { productMasterId: 1, status: 1, isDeleted: 1, mediaType: 1, variantId: 1, isPrimary: -1, sortOrder: 1 },
  { name: 'media_operations_gallery_idx' },
);
ProductImageSchema.index(
  { status: 1, isDeleted: 1, mediaType: 1, updatedAt: -1 },
  { name: 'media_operations_quality_scan_idx' },
);

ProductImageSchema.plugin(auditPlugin);
ProductImageSchema.plugin(softDeletePlugin);
ProductImageSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductImage', ProductImageSchema);
