import { Router } from 'express';
import AuthController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import rateLimiter from '../middleware/rateLimiter.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../utils/validators/user.validators.js';

const router = Router();

/**
 * Public auth endpoints.
 * OTP endpoints are tightly rate-limited (brute-force protection).
 */

router.post('/otp/request', rateLimiter.otpSendLimiter, validate(otpRequestSchema), AuthController.requestOtp);
router.post('/otp/verify', rateLimiter.otpVerifyLimiter, validate(otpVerifySchema), AuthController.verifyOtp);

router.post('/register', rateLimiter.standard, validate(registerSchema), AuthController.register);
router.post('/login', rateLimiter.loginLimiter, validate(loginSchema), AuthController.login);
router.post('/refresh', rateLimiter.standard, validate(refreshTokenSchema), AuthController.refresh);
router.post('/logout', rateLimiter.standard, AuthController.logout);

// authenticated password endpoints
router.post('/password/change', authenticate, validate(changePasswordSchema), AuthController.changePassword);
router.post('/password/reset', rateLimiter.standard, AuthController.resetPassword);

export default router;
