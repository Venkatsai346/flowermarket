import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = process.env.NODE_ENV || 'development';

/**
 * Centralized, validated app configuration.
 * Every module should import config from here instead of reading process.env.
 */
const config = {
  env,
  isDev: env === 'development',
  isProd: env === 'production',
  isTest: env === 'test',

  port: Number(process.env.PORT) || 4000,
  appName: process.env.APP_NAME || 'Flower Market API',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flower_market',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS) || 15 * 60,
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS) || 30 * 24 * 60 * 60,
    issuer: process.env.JWT_ISSUER || 'flower-market-api',
    audience: process.env.JWT_AUDIENCE || 'flower-market-app',
  },

  otp: {
    provider: process.env.OTP_PROVIDER || 'console', // console | memory | msg91 | twilio | ses
    length: Number(process.env.OTP_LENGTH) || 6,
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
  },

  tenant: {
    defaultTenantId: process.env.DEFAULT_TENANT_ID || '',
    tenantHeader: process.env.TENANT_HEADER || 'x-tenant-id',
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8081')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  limits: {
    jsonBody: process.env.JSON_BODY_LIMIT || '1mb',
    maxAddressesPerUser: Number(process.env.MAX_ADDRESSES_PER_USER) || 10,
  },

  // ---- Phase 4b: notifications (provider-agnostic; console/mock default) ----
  notifications: {
    provider: process.env.NOTIFICATION_PROVIDER || 'console', // console | mock | fcm | apns | smtp | twilio
    maxDevicesPerUser: Number(process.env.MAX_DEVICES_PER_USER) || 10,
    workerBatch: Number(process.env.NOTIFICATION_WORKER_BATCH) || 50,
  },

  // ---- Phase 4b: scheduled exports ----
  exports: {
    nightlyDays: Number(process.env.EXPORT_NIGHTLY_DAYS) || 30,
    defaultScheduledAtHour: Number(process.env.EXPORT_NIGHTLY_HOUR) || 2, // 2 AM cron
  },

  // ---- Phase 5: multi-tenant marketplace ----
  marketplace: {
    enabled: process.env.MARKETPLACE_ENABLED !== 'false', // platform-level switch
    billingProvider: process.env.BILLING_PROVIDER || 'console', // console | mock | razorpay
    defaultCommissionBps: Number(process.env.MARKETPLACE_DEFAULT_COMMISSION_BPS) || 100, // 1%
    defaultTrialDays: Number(process.env.MARKETPLACE_TRIAL_DAYS) || 14,
    invoiceGraceDays: Number(process.env.MARKETPLACE_INVOICE_GRACE_DAYS) || 7,
    reservedSlugs: (process.env.MARKETPLACE_RESERVED_SLUGS || 'admin,api,www,app,platform,marketplace,flower-market,market')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    nightlyDays: Number(process.env.MARKETPLACE_NIGHTLY_DAYS) || 30,
  },

  // ---- Media uploads (images & videos) ----
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local', // local | s3
    localDir: process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage', 'local'),
    localPublicPath: '/media/local',
    presignExpirySeconds: Number(process.env.MEDIA_PRESIGN_EXPIRY_SECONDS) || 15 * 60,
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'ap-south-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '', // defaults to bucket URL
    },
    limits: {
      maxImageBytes: Number(process.env.MEDIA_MAX_IMAGE_BYTES) || 10 * 1024 * 1024, // 10 MB
      maxVideoBytes: Number(process.env.MEDIA_MAX_VIDEO_BYTES) || 250 * 1024 * 1024, // 250 MB
      imageTypes: ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif'],
      videoTypes: ['mp4', 'webm', 'mov', 'quicktime'],
    },
  },
};

export default config;
