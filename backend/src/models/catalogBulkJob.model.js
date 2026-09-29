import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const JobErrorSchema = new Schema({
  row: { type: Number, required: true, min: 1 },
  code: { type: String, default: null, maxlength: 80 },
  message: { type: String, required: true, maxlength: 500 },
  at: { type: Date, default: Date.now },
}, { _id: false });

const CatalogBulkJobSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  kind: { type: String, enum: ['price', 'stock'], required: true },
  dryRun: { type: Boolean, default: false },
  status: { type: String, enum: ['queued', 'running', 'cancel_requested', 'cancelled', 'completed', 'failed'], default: 'queued', index: true },
  totalRows: { type: Number, required: true, min: 1, max: 5000 },
  processed: { type: Number, default: 0, min: 0 },
  succeeded: { type: Number, default: 0, min: 0 },
  failed: { type: Number, default: 0, min: 0 },
  nextRow: { type: Number, default: 2, min: 2 },
  errorSummary: { type: [JobErrorSchema], default: [], validate: (value) => value.length <= 100 },
  requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
  claimedBy: { type: String, default: null, maxlength: 120 },
  leaseExpiresAt: { type: Date, default: null, index: true },
  attempts: { type: Number, default: 0, min: 0 },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { collection: 'catalogbulkjobs', timestamps: true });

CatalogBulkJobSchema.index({ tenantId: 1, createdAt: -1 }, { name: 'tenant_bulk_jobs_idx' });
CatalogBulkJobSchema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 }, { name: 'bulk_job_claim_idx' });
CatalogBulkJobSchema.index({ status: 1, lastHeartbeatAt: 1, createdAt: 1 }, { name: 'bulk_job_fair_queue_idx' });
CatalogBulkJobSchema.index({ expiresAt: 1 }, { name: 'bulk_jobs_ttl', expireAfterSeconds: 0 });
CatalogBulkJobSchema.plugin(toJSONPlugin);

export default mongoose.model('CatalogBulkJob', CatalogBulkJobSchema);
