import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const MediaProcessingJobSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
  assetId: { type: Types.ObjectId, ref: 'MediaAsset', required: true },
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', required: true },
  attempts: { type: Number, default: 0, min: 0 },
  claimedBy: { type: String, default: null, maxlength: 120 },
  leaseExpiresAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  errorCode: { type: String, default: null, maxlength: 80 },
  errorMessage: { type: String, default: null, maxlength: 500 },
  expiresAt: { type: Date, default: null },
}, { collection: 'mediaprocessingjobs', timestamps: true });

MediaProcessingJobSchema.index({ assetId: 1 }, { unique: true, name: 'media_asset_processing_unique' });
MediaProcessingJobSchema.index({ status: 1, lastHeartbeatAt: 1, createdAt: 1 }, { name: 'media_processing_fair_claim_idx' });
MediaProcessingJobSchema.index({ tenantId: 1, createdAt: -1 }, { name: 'tenant_media_processing_history_idx' });
MediaProcessingJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'media_processing_jobs_ttl' });
MediaProcessingJobSchema.plugin(toJSONPlugin);

export default mongoose.model('MediaProcessingJob', MediaProcessingJobSchema);
