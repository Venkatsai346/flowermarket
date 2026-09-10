import { Router } from 'express';
import AuthController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import rateLimiter from '../middleware/rateLimiter.js';
import { accountLockout } from '../middleware/accountLockout.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from '../utils/validators/user.validators.js';

const router = Router();

/**
 * Public auth endpoints.
 * OTP endpoints are tightly rate-limited (brute-force protection).
 * Account lockout provides defense-in-depth: even if an attacker bypasses
 * per-IP rate limiting (e.g. distributed botnet), accounts lock after 10
 * consecutive failures within 15 minutes.
 */

router.post('/otp/request', rateLimiter.otpSendLimiter, validate(otpRequestSchema), AuthController.requestOtp);
router.post('/otp/verify', rateLimiter.otpVerifyLimiter, accountLockout('otp_verify'), validate(otpVerifySchema), AuthController.verifyOtp);

router.post('/register', rateLimiter.standard, validate(registerSchema), AuthController.register);
router.post('/login', rateLimiter.loginLimiter, accountLockout('login'), validate(loginSchema), AuthController.login);
router.post('/refresh', rateLimiter.standard, validate(refreshTokenSchema), AuthController.refresh);
router.post('/logout', rateLimiter.standard, AuthController.logout);

// authenticated password endpoints
router.post('/password/change', authenticate, validate(changePasswordSchema), AuthController.changePassword);
router.post('/password/reset', rateLimiter.standard, validate(resetPasswordSchema), AuthController.resetPassword);

// ---- 2FA / TOTP (super_admin only) ----
router.post('/2fa/enroll', authenticate, rateLimiter.standard, AuthController.enroll2fa);
router.post('/2fa/verify', authenticate, rateLimiter.standard, AuthController.verify2faEnrollment);
router.post('/2fa/disable', authenticate, rateLimiter.standard, AuthController.disable2fa);
router.get('/2fa/status', authenticate, AuthController.status2fa);

export default router;
