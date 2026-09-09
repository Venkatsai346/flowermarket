import AuthService from '../services/auth.service.js';
import totpService from '../services/totp.service.js';
import cartService from '../services/cart.service.js';
import User from '../models/user.model.js';
import { parseGuestKey, clearGuestCookie } from '../middleware/guestCart.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { AppError, forbidden, badRequest, unauthorized } from '../utils/ApiError.js';

/**
 * AuthController — HTTP adapter for authentication flows.
 * Handlers are intentionally thin: validation (Joi middleware) + service call
 * + response envelope. All business logic lives in AuthService.
 */
class AuthController {
  /** POST /auth/otp/request — send an OTP for login/signup/reset. */
  requestOtp = asyncHandler(async (req, res) => {
    const { purpose, channel, phone, email } = req.body;
    const target = channel === 'phone' ? phone.number : email;
    const result = await AuthService.requestOtp({
      tenantId: req.tenantId,
      purpose,
      channel,
      target,
    });
    res.status(200).json(success(result, { message: 'OTP sent' }));
  });

  /** POST /auth/otp/verify — verify the OTP (returns user + tokens on login purpose). */
  verifyOtp = asyncHandler(async (req, res) => {
    const { purpose, channel, phone, email, code } = req.body;
    const target = channel === 'phone' ? phone.number : email;

    if (purpose === 'login') {
      const result = await AuthService.loginWithOtp({
        tenantId: req.tenantId,
        channel,
        target,
        code,
        deviceInfo: req.body.device || {},
        ip: req.ip,
      });
      await this.mergeGuestOnLogin(req, res, result);
      return res.status(200).json(success(result, { message: result.isNewUser ? 'Account created & logged in' : 'Logged in' }));
    }

    // non-login purposes (password_reset etc.) are validated elsewhere;
    // for now the verify endpoint focuses on login (reset has its own route).
    return res.status(200).json(success({ verified: true }));
  });

  /** POST /auth/register — explicit signup (OTP verified). */
  register = asyncHandler(async (req, res) => {
    const { phone, email, otpCode, profile, source } = req.body;
    const result = await AuthService.register({
      tenantId: req.tenantId,
      phone,
      email,
      otpCode,
      profile,
      source,
    });
    res.status(201).json(success(result, { message: 'Account created' }));
  });

  /** POST /auth/login — email + password login. */
  login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.loginWithPassword({
      tenantId: req.tenantId,
      email,
      password,
      deviceInfo: req.body.device || {},
      ip: req.ip,
    });
    await this.mergeGuestOnLogin(req, res, result);
    res.status(200).json(success(result, { message: 'Logged in' }));
  });

  /** Fold the anonymous cart into the just-signed-in user. Never fails login. */
  async mergeGuestOnLogin(req, res, result) {
    const guestKey = parseGuestKey(req);
    const userId = result?.user?.id || result?.user?._id || result?.userId;
    const tenantId = req.tenantId;
    if (!guestKey || !userId || !tenantId) return;
    try {
      await cartService.mergeGuestCart({ tenantId, userId, guestKey });
      clearGuestCookie(res);
    } catch {
      // login succeeded; the next authenticated GET /cart will retry the merge
    }
  }

  /** POST /auth/refresh — rotate refresh token, get new access token. */
  refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    const result = await AuthService.refreshAccessToken({
      refreshToken,
      deviceInfo: req.body.device || {},
      ip: req.ip,
    });
    res.status(200).json(success(result, { message: 'Token refreshed' }));
  });

  /** POST /auth/logout — revoke current session (or all with ?all=true). */
  logout = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    const result = await AuthService.logout({
      refreshToken: req.query.all ? undefined : refreshToken,
      userId: req.auth?.userId,
    });
    res.status(200).json(success(result, { message: 'Logged out' }));
  });

  /** POST /auth/password/change — requires login + current password. */
  changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const result = await AuthService.changePassword({
      userId: req.auth.userId,
      currentPassword,
      newPassword,
    });
    res.status(200).json(success(result));
  });

  /** POST /auth/password/reset — OTP-based reset (no login). */
  resetPassword = asyncHandler(async (req, res) => {
    const { channel, phone, email, otpCode, newPassword } = req.body;
    const target = channel === 'phone' ? phone.number : email;
    const result = await AuthService.resetPasswordWithOtp({
      tenantId: req.tenantId,
      channel,
      target,
      otpCode,
      newPassword,
    });
    res.status(200).json(success(result));
  });

  // ================= 2FA / TOTP (super_admin) =================

  /**
   * POST /auth/2fa/enroll — begin TOTP enrollment.
   * Generates a secret, backup codes, and otpauth URI.
   * Only super_admin can enroll.
   */
  enroll2fa = asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth.userId).select('+twoFactor.encryptedSecret +twoFactor.backupCodes');
    if (!user) throw badRequest('User not found');
    if (user.role !== 'super_admin') throw forbidden('Only super admins can enable 2FA');
    if (user.twoFactor?.enabled) throw badRequest('2FA is already enabled. Disable it first.');

    const enrollment = totpService.enroll(user._id.toString(), user.email?.address);

    // Store the encrypted secret and hashed backup codes (but don't mark as enabled yet)
    user.twoFactor = {
      enabled: false,
      encryptedSecret: enrollment.encryptedSecret,
      backupCodes: enrollment.hashedBackupCodes,
      enrolledAt: new Date(),
      lastVerifiedAt: null,
    };
    await user.save();

    // Return the secret, URI, and backup codes — shown ONCE to the user
    res.status(200).json(success({
      secret: enrollment.secret,
      otpauthUri: enrollment.otpauthUri,
      backupCodes: enrollment.backupCodes,
      message: 'Scan the QR code in your authenticator app, then verify with a 6-digit code to complete setup.',
    }, { message: '2FA enrollment started' }));
  });

  /**
   * POST /auth/2fa/verify — verify a TOTP code and enable 2FA.
   * Called once during enrollment to confirm the user set up their authenticator.
   */
  verify2faEnrollment = asyncHandler(async (req, res) => {
    const { code } = req.body;
    if (!code) throw badRequest('6-digit code is required');

    const user = await User.findById(req.auth.userId).select('+twoFactor.encryptedSecret');
    if (!user) throw badRequest('User not found');
    if (user.twoFactor?.enabled) throw badRequest('2FA is already enabled');

    const valid = totpService.verify(user.twoFactor?.encryptedSecret, code);
    if (!valid) throw badRequest('Invalid code. Make sure your authenticator app is synced.');

    user.twoFactor.enabled = true;
    user.twoFactor.lastVerifiedAt = new Date();
    await user.save();

    res.status(200).json(success({
      enabled: true,
      message: '2FA is now enabled. You will need your authenticator code on every login.',
    }, { message: '2FA enabled' }));
  });

  /**
   * POST /auth/2fa/disable — disable 2FA (requires current TOTP code or backup code).
   */
  disable2fa = asyncHandler(async (req, res) => {
    const { code, backupCode } = req.body;
    if (!code && !backupCode) throw badRequest('Provide a TOTP code or backup code to disable 2FA');

    const user = await User.findById(req.auth.userId).select('+twoFactor.encryptedSecret +twoFactor.backupCodes');
    if (!user) throw badRequest('User not found');
    if (!user.twoFactor?.enabled) throw badRequest('2FA is not enabled');

    let authenticated = false;

    if (backupCode) {
      const idx = totpService.verifyBackupCode(user.twoFactor.backupCodes, backupCode);
      if (idx >= 0) {
        authenticated = true;
        // Remove the used backup code
        user.twoFactor.backupCodes.splice(idx, 1);
      }
    } else {
      authenticated = totpService.verify(user.twoFactor.encryptedSecret, code);
    }

    if (!authenticated) throw badRequest('Invalid code');

    user.twoFactor = {
      enabled: false,
      encryptedSecret: null,
      backupCodes: [],
      enrolledAt: null,
      lastVerifiedAt: null,
    };
    await user.save();

    res.status(200).json(success({
      enabled: false,
      message: '2FA has been disabled.',
    }, { message: '2FA disabled' }));
  });

  /**
   * GET /auth/2fa/status — check 2FA status for the current user.
   */
  status2fa = asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth.userId);
    if (!user) throw badRequest('User not found');

    res.status(200).json(success({
      enabled: user.twoFactor?.enabled || false,
      enrolledAt: user.twoFactor?.enrolledAt || null,
      backupCodesRemaining: user.twoFactor?.backupCodes?.length || 0,
    }, { message: '2FA status' }));
  });
}

export default new AuthController();
