import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Durable, tenant-scoped journal for retry-safe catalog mutations. */
const catalogCommandSchema = new Schema({
  scopeId: { type: String, required: true, trim: true, maxlength: 128 },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 200 },
  operation: { type: String, required: true, trim: true, maxlength: 120 },
  requestFingerprint: { type: String, required: true, minlength: 64, maxlength: 64 },
  status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending', required: true },
  ownerToken: { type: String, required: true },
  leaseExpiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 1, min: 1 },
  response: { type: Schema.Types.Mixed, default: null },
  resource: {
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
  },
  completedAt: { type: Date, default: null },
  lastError: {
    code: { type: String, default: null },
    message: { type: String, default: null },
    at: { type: Date, default: null },
  },
}, { timestamps: true, minimize: false });

catalogCommandSchema.index({ scopeId: 1, idempotencyKey: 1 }, { unique: true, name: 'catalog_command_scope_key_uq' });
catalogCommandSchema.index({ status: 1, leaseExpiresAt: 1 }, { name: 'catalog_command_claim_idx' });
catalogCommandSchema.index({ completedAt: 1 }, {
  expireAfterSeconds: 60 * 60 * 24 * 90,
  partialFilterExpression: { completedAt: { $type: 'date' } },
  name: 'catalog_command_retention_ttl',
});

export default mongoose.models.CatalogCommand || mongoose.model('CatalogCommand', catalogCommandSchema);
