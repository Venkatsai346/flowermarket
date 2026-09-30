/**
 * MediaAsset — registry of uploaded objects (images & videos).
 *
 * Every presigned upload creates a row here first (status `pending`); confirm
 * verifies the object in the store and flips it to `ready`. The row is the
 * single source of truth for what was uploaded, by whom, for what purpose —
 * auditable and reusable via the gallery picker.
 */
import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';
import { MEDIA_TYPE, MEDIA_STATUS, MEDIA_PURPOSE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const RenditionSchema = new Schema({
  format: { type: String, enum: ['webp', 'avif'], required: true },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  sizeBytes: { type: Number, required: true, min: 1 },
  key: { type: String, required: true },
  url: { type: String, required: true },
  checksumSha256: { type: String, required: true, maxlength: 64 },
}, { _id: false });

const MediaAssetSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    uploadedBy: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: Object.values(MEDIA_PURPOSE), required: true, index: true },
    type: { type: String, enum: Object.values(MEDIA_TYPE), required: true },
    mimeType: { type: String, required: true },
    extension: { type: String, required: true, lowercase: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    key: { type: String, required: true, unique: true }, // {tenant}/{purpose}/{yyyymm}/{uuid}.ext
    bucket: { type: String, default: null }, // null for local provider
    url: { type: String, required: true }, // public URL (or origin-relative path for local)
    isPublic: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(MEDIA_STATUS), default: MEDIA_STATUS.PENDING, index: true },
    detectedMimeType: { type: String, default: null, maxlength: 120 },
    checksumSha256: { type: String, default: null, maxlength: 64 },
    width: { type: Number, default: null, min: 1 },
    height: { type: Number, default: null, min: 1 },
    aspectRatio: { type: Number, default: null, min: 0 },
    duplicateOf: { type: Types.ObjectId, ref: 'MediaAsset', default: null },
    renditions: { type: [RenditionSchema], default: [], validate: (value) => value.length <= 12 },
    provenance: {
      sourceType: { type: String, enum: ['upload', 'official', 'wikimedia', 'licensed', 'legacy'], default: 'upload' },
      sourceUrl: { type: String, default: null, maxlength: 2000 },
      creator: { type: String, default: null, maxlength: 300 },
      license: { type: String, default: null, maxlength: 200 },
      attribution: { type: String, default: null, maxlength: 1000 },
    },
    verifiedAt: { type: Date, default: null },
    health: {
      status: { type: String, enum: ['unknown', 'healthy', 'broken'], default: 'unknown' },
      checkedAt: { type: Date, default: null },
      consecutiveFailures: { type: Number, default: 0, min: 0 },
      error: { type: String, default: null, maxlength: 500 },
    },
    meta: { type: Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MediaAssetSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
MediaAssetSchema.index({ status: 1, 'health.checkedAt': 1 }, { name: 'media_health_probe_idx' });
MediaAssetSchema.index(
  { tenantId: 1, checksumSha256: 1, status: 1 },
  { name: 'tenant_media_checksum_idx', partialFilterExpression: { checksumSha256: { $type: 'string' } } },
);
MediaAssetSchema.plugin(toJSONPlugin);

export default mongoose.model('MediaAsset', MediaAssetSchema);
