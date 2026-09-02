import AuthService from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';

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
    res.status(200).json(success(result, { message: 'Logged in' }));
  });

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
}

export default new AuthController();
