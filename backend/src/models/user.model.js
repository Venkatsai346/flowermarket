/**
 * User — customer-facing account model, designed BigBasket-style.
 *
 * DESIGN NOTES (dive-deep review):
 *  1. Normalized collections (no unbounded embedded arrays — avoids the 16MB
 *     document limit):
 *       - Address            -> separate collection, refs the user
 *       - AuthToken          -> separate collection (refresh tokens, device sessions)
 *       - OtpVerification    -> separate collection (phone/email OTP state)
 *  2. Identity strategy: phone is the primary login identity (Indian e-commerce
 *     standard); email is optional, unique-when-present. Passwords are optional
 *     (OTP login doesn't need one) but bcrypt-hashed when set.
 *  3. Multi-tenancy: every user record is scoped to a tenant. A person can hold
 *     multiple user records across tenants (different businesses) — that is the
 *     standard multi-tenant identity pattern; there is no fragile global unique
 *     phone constraint. Login goes through TenantAuthConfig + OtpVerification
 *     so OTPs, emails and secrets are always tenant-scoped.
 *  4. `profile` holds KYC-ish info (dob, gender). `preferences` holds app-level
 *     prefs. `marketing` controls consent (GDPR/DPDP-friendly).
 *  5. `lastLoginAt`, `loginCount` etc. feed analytics. `verification` drives the
 *     "verify your phone" flows.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  USER_ROLES,
  USER_STATUS,
  LOGIN_METHOD,
  GENDER,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ProfileSchema = new Schema(
  {
    firstName: { type: String, trim: true, maxlength: 60 },
    lastName: { type: String, trim: true, maxlength: 60 },
    dob: { type: Date, default: null },
    gender: {
      type: String,
      enum: Object.values(GENDER),
      default: GENDER.PREFER_NOT_TO_SAY,
    },
    avatarUrl: { type: String, trim: true, default: null },
    // A short "about / store notes" — useful when this user is a vendor later.
    bio: { type: String, trim: true, maxlength: 300, default: null },
  },
  { _id: false }
);

const PreferencesSchema = new Schema(
  {
    language: { type: String, default: 'en', maxlength: 10 },
    currency: { type: String, default: 'INR', maxlength: 8 },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    defaultAddressId: { type: Types.ObjectId, ref: 'Address', default: null },
    defaultPaymentMethodId: { type: Types.ObjectId, default: null }, // refs PaymentMethod later
    notificationPrefs: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
  },
  { _id: false }
);

const MarketingSchema = new Schema(
  {
    optedIn: { type: Boolean, default: false },
    consentVersion: { type: String, default: null },
    consentedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // ---- identity ----
    phone: {
      countryCode: { type: String, default: '+91', trim: true },
      number: { type: String, trim: true, match: /^[0-9]{6,15}$/ },
      verified: { type: Boolean, default: false },
      verifiedAt: { type: Date, default: null },
    },
    email: {
      address: { type: String, trim: true, lowercase: true, default: null },
      verified: { type: Boolean, default: false },
      verifiedAt: { type: Date, default: null },
    },

    // password is optional (OTP-first); bcrypt-hashed when set
    passwordHash: { type: String, select: false, default: null },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.CUSTOMER,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.VERIFICATION_PENDING,
      index: true,
    },

    profile: { type: ProfileSchema, default: () => ({}) },
    preferences: { type: PreferencesSchema, default: () => ({}) },
    marketing: { type: MarketingSchema, default: () => ({}) },

    // ---- login / account meta ----
    loginMethods: { type: [String], enum: Object.values(LOGIN_METHOD), default: [] },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    loginCount: { type: Number, default: 0, min: 0 },
    lastLoginDeviceId: { type: String, default: null },
    defaultTenantId: { type: Types.ObjectId, ref: 'Tenant', default: null }, // BigBasket-style "my default store"

    // location-specific data (BigBasket-style): which area/city does this user
    // operate in — drives slot availability & catalogue for that pincode.
    location: {
      cityId: { type: Types.ObjectId, ref: 'Location', default: null },
      stateId: { type: Types.ObjectId, ref: 'Location', default: null },
      areaId: { type: Types.ObjectId, ref: 'Location', default: null },
      pincode: { type: String, trim: true, maxlength: 12, default: null },
      lastKnownCoordinates: { type: [Number], default: null }, // [lng, lat]
      updatedAt: { type: Date, default: null },
    },

    // ---- rider operational state (Phase 3.5 rider app) ----
    rider: {
      availability: {
        type: String,
        enum: ['available', 'busy', 'offline'],
        default: 'offline',
        index: true,
      },
      zoneIds: { type: [Types.ObjectId], ref: 'DeliveryZone', default: [] }, // zones this rider covers
      currentHubId: { type: Types.ObjectId, ref: 'Hub', default: null },
      maxActiveDeliveries: { type: Number, default: 3, min: 1 },
      activeDeliveryCount: { type: Number, default: 0, min: 0 },
      lastSeenAt: { type: Date, default: null },
      rating: { type: Number, default: 5, min: 1, max: 5 },
    },

    referralCode: { type: String, trim: true, maxlength: 20, default: null },

    accountMeta: {
      source: { type: String, enum: ['app', 'web', 'admin', 'import'], default: 'app' },
      importedFrom: { type: String, default: null },
      notes: { type: String, default: null },
    },
  },
  { collection: 'users' }
);

// ---- indexes ----
UserSchema.index({ 'phone.countryCode': 1, 'phone.number': 1 });
// unique email only when actually set (partial index skips null/missing)
UserSchema.index({ 'email.address': 1 }, { unique: true, partialFilterExpression: { 'email.address': { $type: 'string' } } });
UserSchema.index({ tenantId: 1, status: 1 });
UserSchema.index({ role: 1, tenantId: 1 });
UserSchema.index({ createdAt: -1 });

// ---- virtuals ----
UserSchema.virtual('fullName').get(function () {
  const { firstName = '', lastName = '' } = this.profile ?? {};
  return [firstName, lastName].filter(Boolean).join(' ') || null;
});

UserSchema.virtual('phoneNumber').get(function () {
  if (!this.phone?.number) return null;
  return `${this.phone.countryCode || '+91'}${this.phone.number}`;
});

// ---- hooks ----
UserSchema.pre('save', async function (next) {
  // normalize phone number (strip spaces/dashes)
  if (this.isModified('phone.number')) {
    this.phone.number = String(this.phone.number || '').replace(/[\s-]/g, '');
  }
  // auto-promote from verification_pending once the primary identity is verified
  if (this.isModified('phone.verified') && this.phone.verified && this.status === USER_STATUS.VERIFICATION_PENDING) {
    this.status = USER_STATUS.ACTIVE;
  }
  next();
});

UserSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  if (update?.$set?.['phone.number']) {
    update.$set['phone.number'] = String(update.$set['phone.number']).replace(/[\s-]/g, '');
  }
  next();
});

// ---- methods ----
UserSchema.methods.setPassword = async function (rawPassword) {
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(rawPassword, salt);
  return this;
};

UserSchema.methods.isValidPassword = async function (rawPassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(rawPassword, this.passwordHash);
};

UserSchema.methods.touchLogin = function ({ ip = null, deviceId = null, method } = {}) {
  this.lastLoginAt = new Date();
  this.lastLoginIp = ip;
  this.lastLoginDeviceId = deviceId;
  this.loginCount = (this.loginCount || 0) + 1;
  if (method && !this.loginMethods.includes(method)) this.loginMethods.push(method);
  return this.save();
};

// ---- plugins ----
UserSchema.plugin(auditPlugin);
UserSchema.plugin(softDeletePlugin);
UserSchema.plugin(toJSONPlugin);

export default mongoose.model('User', UserSchema);
