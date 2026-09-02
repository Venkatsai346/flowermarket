/**
 * TenantDomain — a hostname that resolves to a tenant (Phase 6.4).
 *
 * Two kinds:
 *   subdomain — `{slug}.{PLATFORM_ROOT_DOMAIN}`, created automatically when a
 *               store is published. Covered by the wildcard TLS certificate,
 *               so there is nothing to provision.
 *   custom    — the store's own domain. Requires DNS proof of ownership before
 *               it resolves to anything, because an unverified custom domain
 *               is a way to point someone else's traffic at your store — and,
 *               with on-demand TLS, a way to burn the platform's ACME quota.
 *
 * VERIFICATION IS THE SECURITY BOUNDARY. A row exists as soon as the owner
 * claims the domain, but `resolveByHost()` only ever returns rows where
 * `verification.status === 'verified'` AND `status === 'active'`.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { DOMAIN_KIND, DOMAIN_VERIFICATION_STATUS, TLS_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TenantDomainSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    hostname: { type: String, required: true, lowercase: true, trim: true, maxlength: 253 },
    kind: { type: String, enum: Object.values(DOMAIN_KIND), required: true },

    verification: {
      method: { type: String, enum: ['dns_txt'], default: 'dns_txt' },
      /** The value the owner must publish at `_fm-verify.{hostname}`. */
      token: { type: String, default: null, maxlength: 80 },
      status: {
        type: String,
        enum: Object.values(DOMAIN_VERIFICATION_STATUS),
        default: DOMAIN_VERIFICATION_STATUS.PENDING,
        index: true,
      },
      lastCheckedAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
      lastError: { type: String, default: null, maxlength: 300 },
      attempts: { type: Number, default: 0 },
    },

    tls: {
      status: { type: String, enum: Object.values(TLS_STATUS), default: TLS_STATUS.NONE },
      issuer: { type: String, default: null, maxlength: 80 },
      expiresAt: { type: Date, default: null },
      lastError: { type: String, default: null, maxlength: 300 },
    },

    /** The canonical hostname; others 301 to it. */
    isPrimary: { type: Boolean, default: false },
    redirectToPrimary: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },

    addedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'tenantdomains' }
);

// a hostname can only ever point at ONE tenant
TenantDomainSchema.index({ hostname: 1 }, { unique: true });
TenantDomainSchema.index(
  { tenantId: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } }
);

/** Only a verified, active domain may resolve. */
TenantDomainSchema.methods.isLive = function isLive() {
  return this.status === 'active'
    && this.verification?.status === DOMAIN_VERIFICATION_STATUS.VERIFIED;
};

TenantDomainSchema.plugin(auditPlugin);
TenantDomainSchema.plugin(softDeletePlugin);
TenantDomainSchema.plugin(toJSONPlugin);

export default mongoose.model('TenantDomain', TenantDomainSchema);
