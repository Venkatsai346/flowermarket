/**
 * AuthToken — session management for JWT refresh tokens & device logins.
 *
 * DESIGN NOTES:
 *  - JWT access tokens are stateless (signed, short-lived) and need no storage.
 *  - Refresh tokens ARE stored (hashed) here so they can be:
 *      - rotated on every use (theft-mitigation)
 *      - revoked on logout / password change / admin block
 *      - audited (device, ip, user-agent per session)
 *  - Device-scoped: a user can be logged in on multiple devices; each device
 *    gets its own token family (fresh pair + rotation chain).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { HASH_ALGO } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AuthTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // hashed refresh token (never store raw tokens)
    tokenHash: { type: String, required: true, index: true },
    hashAlgo: { type: String, enum: Object.values(HASH_ALGO), default: HASH_ALGO.SHA256 },

    // session context
    deviceId: { type: String, default: null, index: true },
    deviceName: { type: String, default: null },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },

    // lifecycle
    isRevoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['logout', 'password_change', 'admin_block', 'token_rotation', 'expired'],
      default: null,
    },
  },
  { collection: 'authtokens' }
);

// TTL index — documents auto-expire server-side a few minutes after expiry
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

AuthTokenSchema.plugin(auditPlugin);
AuthTokenSchema.plugin(softDeletePlugin);
AuthTokenSchema.plugin(toJSONPlugin);

export default mongoose.model('AuthToken', AuthTokenSchema);
