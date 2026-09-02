/**
 * AuditLog — immutable audit trail across catalog entities.
 * Feeds compliance & rollback tooling. Never updated/deleted after insert
 * (hard convention: no update methods are exposed by the service).
 *
 * Scoping: tenantId may be null for global entities (category, brand, master).
 * Tenants may only read their OWN tenantId rows; admins read everything.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AuditLogSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    entityType: { type: String, required: true, index: true, maxlength: 60 }, // e.g. 'product_master', 'tenant_product'
    entityId: { type: Types.ObjectId, required: true, index: true },
    action: { type: String, enum: Object.values(AUDIT_ACTION), required: true, index: true },
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    actorType: {
      type: String,
      enum: Object.values(AUDIT_ACTOR_TYPE),
      default: AUDIT_ACTOR_TYPE.SYSTEM,
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    ipAddress: { type: String, default: null },
    requestId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'auditlogs' }
);

AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });

AuditLogSchema.plugin(auditPlugin);
AuditLogSchema.plugin(softDeletePlugin);
AuditLogSchema.plugin(toJSONPlugin);

export default mongoose.model('AuditLog', AuditLogSchema);
