/**
 * ExportJob — scheduled report request (Phase 4b).
 *
 * Idempotent on jobKey (e.g. analytics_daily:2026-09-01) so nightly creation
 * is a safe upsert. The worker (exportService.runDueJobs) renders the CSV via
 * the Phase-4 admin services, stores the artifact, and marks done.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { EXPORT_JOB_TYPE, EXPORT_JOB_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ExportJobSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    jobKey: { type: String, required: true, unique: true }, // {type}:{from}:{to}(:{hubId})
    type: { type: String, enum: Object.values(EXPORT_JOB_TYPE), required: true, index: true },
    params: { type: Schema.Types.Mixed, default: {} }, // from/to/hubId/filters snapshot

    status: {
      type: String,
      enum: Object.values(EXPORT_JOB_STATUS),
      default: EXPORT_JOB_STATUS.PENDING,
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    artifactId: { type: Types.ObjectId, ref: 'ExportArtifact', default: null },

    scheduledFor: { type: Date, default: null }, // null = run on next worker pass
    requestedBy: { type: Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
  },
  { collection: 'exportjobs' }
);

ExportJobSchema.index({ tenantId: 1, status: 1, scheduledFor: 1 });

ExportJobSchema.plugin(auditPlugin);
ExportJobSchema.plugin(softDeletePlugin);
ExportJobSchema.plugin(toJSONPlugin);

export default mongoose.model('ExportJob', ExportJobSchema);
