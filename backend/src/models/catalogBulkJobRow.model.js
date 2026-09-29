import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const CatalogBulkJobRowSchema = new Schema({
  jobId: { type: Types.ObjectId, ref: 'CatalogBulkJob', required: true },
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
  rowNumber: { type: Number, required: true, min: 2 },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'running', 'succeeded', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0, min: 0 },
  claimedBy: { type: String, default: null, maxlength: 120 },
  leaseExpiresAt: { type: Date, default: null },
  errorCode: { type: String, default: null, maxlength: 80 },
  errorMessage: { type: String, default: null, maxlength: 500 },
  finishedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { collection: 'catalogbulkjobrows', timestamps: true });

CatalogBulkJobRowSchema.index({ jobId: 1, rowNumber: 1 }, { unique: true, name: 'bulk_job_row_unique' });
CatalogBulkJobRowSchema.index({ jobId: 1, status: 1, rowNumber: 1 }, { name: 'bulk_job_pending_rows_idx' });
CatalogBulkJobRowSchema.index({ status: 1, leaseExpiresAt: 1 }, { name: 'bulk_row_lease_idx' });
CatalogBulkJobRowSchema.index({ tenantId: 1, createdAt: -1 }, { name: 'tenant_bulk_rows_retention_idx' });
CatalogBulkJobRowSchema.index({ expiresAt: 1 }, { name: 'bulk_job_rows_ttl', expireAfterSeconds: 0 });
CatalogBulkJobRowSchema.plugin(toJSONPlugin);

export default mongoose.model('CatalogBulkJobRow', CatalogBulkJobRowSchema);
