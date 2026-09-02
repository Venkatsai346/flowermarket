import User from '../models/user.model.js';
import AuthToken from '../models/authToken.model.js';
import OtpService from './otp.service.js';
import TenantService from './tenant.service.js';
import TokenService from '../utils/jwt.js';
import { generateOpaqueToken, sha256 } from '../utils/hash.js';
import { badRequest, unauthorized, notFound, conflict, forbidden } from '../utils/ApiError.js';
import config from '../config/index.js';
import { USER_ROLES, USER_STATUS, LOGIN_METHOD } from '../constants/enums.js';

/**
 * AuthService — orchestration of all authentication flows.
 *
 * Flows implemented:
 *   requestOtp  -> send OTP for login / signup / password_reset / phone_change
 *   loginWithOtp-> verify OTP, auto-create user if first time (OTP-first signup),
 *                  issue access + refresh tokens
 *   refresh     -> rotate refresh token family, issue new access token
 *   logout      -> revoke one device session (or all)
 *   register    -> explicit signup (OTP verified) with profile
 *   loginWithPassword -> email+password login (for users who set a password)
 *   changePassword / setPassword (OTP-based password reset)
 *
 * Multi-tenancy: every lookup is scoped by tenantId.
 * Session model: short-lived JWT access + stored, hashed, rotating refresh token.
 */
class AuthService {
  /** @param deviceInfo { deviceId?, deviceName?, platform?, userAgent? } */
  async requestOtp({ tenantId, purpose, channel, target }) {
    await TenantService.getById(tenantId);
    const authCfg = await TenantService.getAuthConfig(tenantId);

    return OtpService.request({
      tenantId,
      purpose,
      channel,
      target,
      length: authCfg.otpLength || config.otp.length,
      ttlSeconds: authCfg.otpTtlSeconds || config.otp.ttlSeconds,
      maxAttempts: authCfg.otpMaxAttempts || config.otp.maxAttempts,
    });
  }

  /** OTP login. Auto-creates the account on first login (OTP-first signup). */
  async loginWithOtp({ tenantId, channel, target, code, deviceInfo = {}, ip = null }) {
    const otpDoc = await OtpService.verify({
      tenantId,
      purpose: 'login',
      channel,
      target,
      code,
    });

    let user = await this.findUserByIdentity({ tenantId, channel, target });
    let isNewUser = false;

    if (!user) {
      user = await this.createOtpFirstUser({ tenantId, channel, target, otpDoc });
      isNewUser = true;
    }

    await this.ensureUserCanLogin(user);
    await user.touchLogin({ ip, deviceId: deviceInfo.deviceId, method: channel === 'phone' ? LOGIN_METHOD.PHONE_OTP : LOGIN_METHOD.EMAIL_PASSWORD });

    const tokens = await this.issueTokens(user, deviceInfo);
    return { user, tokens, isNewUser };
  }

  async refreshAccessToken({ refreshToken, deviceInfo = {}, ip = null }) {
    const tokenHash = sha256(refreshToken);
    const stored = await AuthToken.findOne({ tokenHash, isRevoked: false });

    if (!stored) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    if (stored.expiresAt < new Date()) throw unauthorized('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');

    const user = await User.findById(stored.userId);
    await this.ensureUserCanLogin(user);

    // ---- rotate: revoke old token, issue fresh pair ----
    stored.isRevoked = true;
    stored.revokedAt = new Date();
    stored.revokedReason = 'token_rotation';
    await stored.save();

    const tokens = await this.issueTokens(user, { ...deviceInfo, deviceId: stored.deviceId || deviceInfo.deviceId });
    return { user, tokens };
  }

  async logout({ refreshToken, userId }) {
    if (refreshToken) {
      await AuthToken.updateOne(
        { tokenHash: sha256(refreshToken), isRevoked: false },
        { $set: { isRevoked: true, revokedAt: new Date(), revokedReason: 'logout' } }
      );
      return { revoked: 'current' };
    }
    // logout-all: revoke every session of the user (any device)
    await AuthToken.updateMany(
      { userId, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date(), revokedReason: 'logout' } }
    );
    return { revoked: 'all' };
  }

  /** Explicit signup — OTP must be verified; creates a verified account. */
  async register({ tenantId, phone = null, email = null, otpCode, profile = {}, source = 'app' }) {
    await TenantService.getById(tenantId);
    const authCfg = await TenantService.getAuthConfig(tenantId);

    if (!phone && !email) throw badRequest('Phone or email is required', 'IDENTITY_REQUIRED');

    if (phone) {
      await OtpService.verify({
        tenantId, purpose: 'signup', channel: 'phone', target: phone.number, code: otpCode,
      });
    }
    if (email) {
      await OtpService.verify({
        tenantId, purpose: 'signup', channel: 'email', target: email, code: otpCode,
      });
    }

    const existing = await this.findUserByIdentity({ tenantId, channel: phone ? 'phone' : 'email', target: phone ? phone.number : email });
    if (existing) throw conflict('An account with this identity already exists. Please login.', 'ACCOUNT_EXISTS');

    const user = await User.create({
      tenantId,
      phone: phone
        ? { countryCode: phone.countryCode || '+91', number: phone.number, verified: true, verifiedAt: new Date() }
        : { verified: false },
      email: email ? { address: email, verified: Boolean(email && !phone), verifiedAt: new Date() } : undefined,
      status: USER_STATUS.ACTIVE,
      profile,
      loginMethods: [phone ? LOGIN_METHOD.PHONE_OTP : LOGIN_METHOD.EMAIL_PASSWORD],
      accountMeta: { source },
      defaultTenantId: tenantId,
    });

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  /** Email + password login (available once a user sets a password). */
  async loginWithPassword({ tenantId, email, password, deviceInfo = {}, ip = null }) {
    if (!email || !password) throw badRequest('Email and password are required', 'CREDENTIALS_REQUIRED');
    const user = await User.findOne({ tenantId, 'email.address': email.toLowerCase() }).select('+passwordHash');
    if (!user) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    const ok = await user.isValidPassword(password);
    if (!ok) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

    await this.ensureUserCanLogin(user);
    await user.touchLogin({ ip, deviceId: deviceInfo.deviceId, method: LOGIN_METHOD.EMAIL_PASSWORD });
    const tokens = await this.issueTokens(user, deviceInfo);
    return { user, tokens };
  }

  async changePassword({ userId, currentPassword, newPassword }) {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    if (!(await user.isValidPassword(currentPassword))) {
      throw badRequest('Current password is incorrect', 'WRONG_PASSWORD');
    }
    await user.setPassword(newPassword);
    await user.save();
    await this.revokeAllSessions(userId, 'password_change');
    return { message: 'Password updated. All devices signed out.' };
  }

  /** Password reset via OTP (no login required). */
  async resetPasswordWithOtp({ tenantId, channel, target, otpCode, newPassword }) {
    await OtpService.verify({ tenantId, purpose: 'password_reset', channel, target, code: otpCode });
    const user = await this.findUserByIdentity({ tenantId, channel, target });
    if (!user) throw notFound('No account found for this identity', 'USER_NOT_FOUND');
    await user.setPassword(newPassword);
    await user.save();
    await this.revokeAllSessions(user.id, 'password_change');
    return { message: 'Password reset successful. Please login.' };
  }

  // ---------------- internals ----------------

  async findUserByIdentity({ tenantId, channel, target }) {
    const value = String(target).trim().toLowerCase();
    if (channel === 'phone') {
      return User.findOne({ tenantId, 'phone.number': value.replace(/[^\d]/g, '') }).select('+isDeleted');
    }
    return User.findOne({ tenantId, 'email.address': value }).select('+isDeleted');
  }

  async createOtpFirstUser({ tenantId, channel, target, otpDoc }) {
    const value = String(target).trim().toLowerCase();
    const user = await User.create({
      tenantId,
      phone: channel === 'phone'
        ? { countryCode: '+91', number: value.replace(/[^\d]/g, ''), verified: true, verifiedAt: new Date() }
        : { verified: false },
      email: channel === 'email'
        ? { address: value, verified: true, verifiedAt: new Date() }
        : undefined,
      status: USER_STATUS.ACTIVE,
      role: USER_ROLES.CUSTOMER,
      loginMethods: [channel === 'phone' ? LOGIN_METHOD.PHONE_OTP : LOGIN_METHOD.EMAIL_PASSWORD],
      defaultTenantId: tenantId,
      accountMeta: { source: 'app' },
    });
    otpDoc.consumedForUser = user.id;
    await otpDoc.save();
    return user;
  }

  async ensureUserCanLogin(user) {
    if (!user) throw unauthorized('Account not found', 'USER_NOT_FOUND');
    if (user.status === USER_STATUS.BLOCKED) throw forbidden('Your account has been blocked. Contact support.', 'ACCOUNT_BLOCKED');
    if (user.status === USER_STATUS.DELETED || user.isDeleted) throw unauthorized('Account no longer exists', 'ACCOUNT_DELETED');
  }

  /** Issue access token + persist hashed refresh token; returns both. */
  async issueTokens(user, deviceInfo = {}) {
    const { deviceId = null, deviceName = null, platform = 'unknown', userAgent = null } = deviceInfo;

    const accessToken = TokenService.signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    const refreshToken = generateOpaqueToken(32);
    await AuthToken.create({
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: sha256(refreshToken),
      deviceId,
      deviceName,
      platform,
      userAgent,
      ipAddress: null,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000),
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.jwt.accessTtlSeconds,
    };
  }

  async revokeAllSessions(userId, reason) {
    await AuthToken.updateMany(
      { userId, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date(), revokedReason: reason } }
    );
  }
}

export default new AuthService();
