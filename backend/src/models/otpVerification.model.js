/**
 * OtpVerification — phone/email OTP state machine (BigBasket-style OTP login).
 *
 * DESIGN NOTES:
 *  - OTPs are stored in their own collection (not embedded in the user doc),
 *    with a TTL index so they self-clean. Old documents disappear automatically.
 *  - Every OTP row is tied to a purpose (login | signup | password_reset |
 *    phone_change | email_verify) and a verification channel.
 *  - Verifying is an atomic, one-shot operation: we find by (channel, target,
 *    code, purpose) and $set consumed in the same update — a used OTP can never
 *    be replayed. Brute-force is bounded by maxAttempts + a rate limiter at the
 *    HTTP layer (see middleware/rateLimiter.js).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const OtpVerificationSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', default: null, index: true }, // null pre-signup (login flow)

    purpose: {
      type: String,
      enum: ['login', 'signup', 'password_reset', 'phone_change', 'email_verify', 'order_verify'],
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['phone', 'email'],
      required: true,
      index: true,
    },
    target: { type: String, required: true, index: true }, // phone number or email address

    // OTP value — stored as SHA-256 (NOT plaintext). An attacker with DB read
    // access cannot harvest codes. Plaintext is only ever held in memory at send-time.
    codeHash: { type: String, required: true },
    codePrefix: { type: String, default: null }, // e.g. "12****" for masked UI display

    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5 },

    consumedAt: { type: Date, default: null },
    consumedForUser: { type: Types.ObjectId, ref: 'User', default: null },

    expiresAt: { type: Date, required: true },
    resendCooldownUntil: { type: Date, default: null },
  },
  { collection: 'otpverifications' }
);

// auto-expire OTP docs
OtpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });

OtpVerificationSchema.plugin(auditPlugin);
OtpVerificationSchema.plugin(softDeletePlugin);
OtpVerificationSchema.plugin(toJSONPlugin);

export default mongoose.model('OtpVerification', OtpVerificationSchema);
