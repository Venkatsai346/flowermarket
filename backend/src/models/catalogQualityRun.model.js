import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const ErrorSchema = new Schema({
  code: { type: String, required: true, maxlength: 80 },
  message: { type: String, required: true, maxlength: 500 },
  at: { type: Date, required: true, default: Date.now },
}, { _id: false });

const CatalogQualityRunSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
  requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['queued', 'running', 'cancel_requested', 'cancelled', 'completed', 'failed'],
    default: 'queued',
    required: true,
  },
  active: { type: Boolean, default: true, required: true },
  sourceCutoff: { type: Date, required: true },
  lastMasterId: { type: Types.ObjectId, ref: 'ProductMaster', default: null },
  evaluated: { type: Number, default: 0, min: 0 },
  batches: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0, min: 0 },
  claimedBy: { type: String, default: null, maxlength: 120 },
  leaseExpiresAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  errorSummary: { type: [ErrorSchema], default: [], validate: (value) => value.length <= 25 },
}, { collection: 'catalogqualityruns', timestamps: true });

CatalogQualityRunSchema.index(
  { tenantId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'tenant_active_quality_run_unique' },
);
CatalogQualityRunSchema.index(
  { status: 1, lastHeartbeatAt: 1, createdAt: 1 },
  { name: 'quality_run_fair_claim_idx' },
);
CatalogQualityRunSchema.index(
  { tenantId: 1, createdAt: -1 },
  { name: 'tenant_quality_run_history_idx' },
);
CatalogQualityRunSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'quality_runs_ttl' },
);
CatalogQualityRunSchema.plugin(toJSONPlugin);

export default mongoose.model('CatalogQualityRun', CatalogQualityRunSchema);
