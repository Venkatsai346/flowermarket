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
    meta: { type: Schema.Types.Mixed, default: {} }, // e.g. {width, height, duration}
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MediaAssetSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
MediaAssetSchema.plugin(toJSONPlugin);

export default mongoose.model('MediaAsset', MediaAssetSchema);
