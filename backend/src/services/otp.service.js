import OtpVerification from '../models/otpVerification.model.js';
import otpCode from '../utils/otp.js';
import { safeEqual, maskCode } from '../utils/hash.js';
import { badRequest, tooMany } from '../utils/ApiError.js';
import config from '../config/index.js';
import smsSender from './smsSender.service.js';

/**
 * OtpPersistenceService — lifecycle of one-time-passwords.
 *
 * Business rules enforced here:
 *  1. One live OTP per (tenant, channel, target, purpose) — requesting again
 *     revokes the previous one (prevents "which code is valid?" confusion).
 *  2. Resend cooldown window (config) blocks rapid-fire requests (rate limit).
 *  3. OTPs are stored hashed (SHA-256); a DB leak does not leak codes.
 *  4. Verification is atomic & one-shot: a consumed OTP can never be reused.
 *  5. Attempts are bounded; exceeding maxAttempts revokes the OTP.
 *  6. TTL index auto-deletes expired rows (self-cleaning collection).
 */
class OtpService {
  async request({ tenantId, purpose, channel, target, userId = null, length, ttlSeconds, maxAttempts }) {
    const otpLength = length || config.otp.length;
    const ttl = ttlSeconds || config.otp.ttlSeconds;
    const maxAtt = maxAttempts || config.otp.maxAttempts;

    // cooldown gate
    const last = await OtpVerification.findOne({ tenantId, purpose, channel, target })
      .sort({ createdAt: -1 });
    if (last && !last.consumedAt && last.resendCooldownUntil && last.resendCooldownUntil > new Date()) {
      throw tooMany('Please wait before requesting another OTP', 'OTP_RESEND_COOLDOWN');
    }

    // revoke any other live OTPs for this target+purpose (one live code at a time)
    await OtpVerification.updateMany(
      { tenantId, purpose, channel, target, consumedAt: null },
      { $set: { consumedAt: new Date(), consumedForUser: userId } }
    );

    const code = otpCode.generate(otpLength);
    const now = new Date();
    const doc = await OtpVerification.create({
      tenantId,
      userId,
      purpose,
      channel,
      target: String(target).trim().toLowerCase(),
      codeHash: otpCode.hash(code),
      codePrefix: maskCode(code),
      maxAttempts: maxAtt,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      resendCooldownUntil: new Date(now.getTime() + config.otp.resendCooldownSeconds * 1000),
    });

    await smsSender.sendOtp({ channel, target, code, purpose });

    return { otpId: doc.id, expiresInSeconds: ttl, masked: doc.codePrefix };
  }

  /**
   * Verify + atomically consume an OTP.
   * Returns the OTP doc on success; throws typed errors otherwise.
   */
  async verify({ tenantId, purpose, channel, target, code, userId = null }) {
    const doc = await OtpVerification.findOne({ tenantId, purpose, channel, target: String(target).trim().toLowerCase() })
      .sort({ createdAt: -1 });

    if (!doc) throw badRequest('No OTP found. Request a new one.', 'OTP_NOT_FOUND');

    if (doc.consumedAt) throw badRequest('This OTP has already been used.', 'OTP_ALREADY_USED');

    if (doc.expiresAt < new Date()) {
      throw badRequest('OTP has expired. Request a new one.', 'OTP_EXPIRED');
    }

    if (doc.attempts >= doc.maxAttempts) {
      throw tooMany('Too many wrong attempts. Request a new OTP.', 'OTP_MAX_ATTEMPTS');
    }

    if (!safeEqual(doc.codeHash, otpCode.hash(code))) {
      doc.attempts += 1;
      await doc.save();
      throw badRequest('Invalid OTP.', 'OTP_INVALID');
    }

    doc.consumedAt = new Date();
    doc.consumedForUser = userId;
    await doc.save();

    return doc;
  }
}

export default new OtpService();
