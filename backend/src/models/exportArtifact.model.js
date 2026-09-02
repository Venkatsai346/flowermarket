/**
 * ExportArtifact — the rendered result of an ExportJob (Phase 4b).
 *
 * The CSV content (with UTF-8 BOM) is stored here — Mongo is the platform's
 * single store; object storage is a later swap, not a dependency. Row count +
 * size bytes let the admin UI show report health at a glance.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { EXPORT_JOB_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ExportArtifactSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    type: { type: String, enum: Object.values(EXPORT_JOB_TYPE), required: true, index: true },
    params: { type: Schema.Types.Mixed, default: {} },
    csv: { type: String, required: true }, // rendered RFC-4180 content (BOM prefixed)
    rowCount: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    requestedBy: { type: Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: Date.now },
  },
  { collection: 'exportartifacts' }
);

ExportArtifactSchema.plugin(auditPlugin);
ExportArtifactSchema.plugin(softDeletePlugin);
ExportArtifactSchema.plugin(toJSONPlugin);

export default mongoose.model('ExportArtifact', ExportArtifactSchema);
