import Joi from 'joi';
import { USER_ROLES, LOGIN_METHOD } from '../../constants/enums.js';

/**
 * Centralized Joi validation schemas for the user domain.
 * Controllers run `validate(schema)` middleware; this keeps request shapes
 * documented in one place.
 */

const phoneSchema = Joi.object({
  countryCode: Joi.string().default('+91'),
  number: Joi.string()
    .pattern(/^[0-9]{6,15}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone number must be 6-15 digits',
      'any.required': 'Phone number is required',
    }),
});

const emailSchema = Joi.string().email().allow(null, '').lowercase();

export const otpRequestSchema = Joi.object({
  purpose: Joi.string()
    .valid('login', 'signup', 'password_reset', 'phone_change', 'email_verify', 'order_verify')
    .default('login'),
  channel: Joi.string().valid('phone', 'email').default('phone'),
  phone: Joi.when('channel', { is: 'phone', then: phoneSchema.required(), otherwise: Joi.forbidden() }),
  email: Joi.when('channel', { is: 'email', then: emailSchema.required(), otherwise: Joi.forbidden() }),
});

export const otpVerifySchema = Joi.object({
  purpose: Joi.string()
    .valid('login', 'signup', 'password_reset', 'phone_change', 'email_verify', 'order_verify')
    .default('login'),
  channel: Joi.string().valid('phone', 'email').default('phone'),
  phone: Joi.when('channel', { is: 'phone', then: phoneSchema.required(), otherwise: Joi.forbidden() }),
  email: Joi.when('channel', { is: 'email', then: emailSchema.required(), otherwise: Joi.forbidden() }),
  code: Joi.string().pattern(/^[0-9]{4,8}$/).required(),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const registerSchema = Joi.object({
  phone: phoneSchema,
  email: emailSchema,
  otpCode: Joi.string().pattern(/^[0-9]{4,8}$/).when('phone', {
    is: Joi.exist(),
    then: Joi.required().messages({ 'any.required': 'OTP code is required for phone signup' }),
  }),
  profile: Joi.object({
    firstName: Joi.string().max(60),
    lastName: Joi.string().max(60),
    dob: Joi.date().iso().max('now'),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say'),
  }).default({}),
  source: Joi.string().valid('app', 'web', 'admin', 'import').default('app'),
});

export const loginSchema = Joi.object({
  phone: phoneSchema,
  email: emailSchema,
  password: Joi.string().min(6).max(72),
  method: Joi.string().valid(...Object.values(LOGIN_METHOD)).default('phone_otp'),
}).xor('phone', 'email').with('password', 'email');

export const updateProfileSchema = Joi.object({
  profile: Joi.object({
    firstName: Joi.string().max(60),
    lastName: Joi.string().max(60),
    dob: Joi.date().iso().max('now').allow(null),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say'),
    avatarUrl: Joi.string().uri().allow(null, ''),
    bio: Joi.string().max(300).allow(null, ''),
  }),
  preferences: Joi.object({
    language: Joi.string().max(10),
    currency: Joi.string().max(8),
    theme: Joi.string().valid('light', 'dark', 'system'),
    notificationPrefs: Joi.object({
      push: Joi.boolean(),
      email: Joi.boolean(),
      sms: Joi.boolean(),
      whatsapp: Joi.boolean(),
    }),
  }),
  marketing: Joi.object({
    optedIn: Joi.boolean(),
  }),
  location: Joi.object({
    cityId: Joi.string(),
    stateId: Joi.string(),
    areaId: Joi.string(),
    pincode: Joi.string().max(12),
  }),
}).min(1);

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).max(72).required(),
});

export const setPasswordSchema = Joi.object({
  otpCode: Joi.string().pattern(/^[0-9]{4,8}$/).required(),
  newPassword: Joi.string().min(6).max(72).required(),
});

export const addressSchema = Joi.object({
  type: Joi.string().valid('home', 'work', 'other'),
  tag: Joi.string().valid('home', 'work', 'other'),
  name: Joi.string().max(80),
  phone: Joi.string().max(15),
  line1: Joi.string().max(160).required(),
  line2: Joi.string().max(160).allow(null, ''),
  landmark: Joi.string().max(120).allow(null, ''),
  city: Joi.string().max(80),
  state: Joi.string().max(80),
  pincode: Joi.string().pattern(/^[0-9]{4,12}$/).required(),
  coordinates: Joi.array().items(Joi.number()).length(2).allow(null),
  isDefault: Joi.boolean(),
});

export const updateAddressSchema = addressSchema.fork(
  ['line1', 'pincode'],
  (s) => s.optional()
);

export const roleUpdateSchema = Joi.object({
  role: Joi.string().valid(...Object.values(USER_ROLES)).required(),
});

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
});

export const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).allow('', null),
  status: Joi.string().valid('active', 'inactive', 'blocked', 'verification_pending', 'deleted'),
  sortBy: Joi.string().default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

// ---------------- Phase 4b: push devices ----------------
export const deviceRegisterSchema = Joi.object({
  provider: Joi.string().valid('fcm', 'apns').default('fcm'),
  platform: Joi.string().valid('android', 'ios', 'web').default('android'),
  pushToken: Joi.string().min(8).max(512).required(),
  metadata: Joi.object({
    appVersion: Joi.string().allow('', null).optional(),
    deviceModel: Joi.string().allow('', null).optional(),
    locale: Joi.string().allow('', null).optional(),
  }).optional(),
});

export const notificationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'sending', 'sent', 'failed', 'read').allow('').optional(),
});
