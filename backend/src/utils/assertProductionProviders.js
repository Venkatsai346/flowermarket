/**
 * Production provider guard (B10 / P0-4).
 *
 * `console` / `mock` / `memory` adapters exist so tests and laptops can
 * exercise the money path without credentials. They must NEVER be the
 * process that talks to real customers. A `NODE_ENV=production` boot with
 * mock payments, console payouts, or console OTP exits 1 BEFORE listen —
 * silent mock-in-prod is how a marketplace "launches" and never collects.
 *
 * ── WHAT IT COVERS ──────────────────────────────────────────────────────────
 * payments, payouts, OTP (BOTH the phone and the email slot), notifications
 * (push/email/sms), storage and search, plus the JWT secrets and the tenant
 * header override.
 *
 * Two failure modes are distinguished deliberately, because they have different
 * fixes:
 *   • a DEV DOUBLE (console/mock/memory/local) — works, but must never face a
 *     customer;
 *   • a DECLARED SEAM (ses, apns, atlas, opensearch) — a name that exists in
 *     config and docs but has NO implementation, so it throws on first use.
 *     These are the dangerous ones: they pass any check that looks at names and
 *     fail every call that looks at behaviour. `OTP_PROVIDER=ses` used to boot
 *     cleanly and then lock every user out of their account.
 *
 * The function is pure over a config object so unit tests can feed fixtures
 * without mutating process.env. The process wrapper calls `process.exit(1)`.
 */

import {
  CHANNEL,
  IMPLEMENTED,
  OTP_PROVIDER_CHANNELS,
  NOTIFICATION_PROVIDER_CHANNELS,
  REQUIRED_NOTIFICATION_CHANNELS,
  isDeclaredNotImplemented,
  isDevOnly,
  isImplemented,
  servesChannel,
} from './providerCapabilities.js';

const DEV_SECRET = /change-me|^dev-/i;
const LIVE_PAYMENTS = new Set(['razorpay']);
const LIVE_PAYOUTS = new Set(['razorpayx', 'cashfree']);

/**
 * Credentials each adapter needs to actually work.
 *
 * Listing them here — rather than discovering a missing key at 3am on the first
 * send — is the whole point of a boot guard.
 */
const REQUIRED_CREDENTIALS = {
  msg91: (cfg) => (!cfg.otp?.msg91AuthKey || !cfg.otp?.msg91TemplateId
    ? ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'] : []),
  twilio: (cfg) => (!cfg.otp?.twilioAccountSid || !cfg.otp?.twilioAuthToken || !cfg.otp?.twilioFrom
    ? ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] : []),
  smtp: (cfg) => {
    const missing = [];
    if (!cfg.smtp?.host) missing.push('SMTP_HOST');
    if (!cfg.smtp?.from && !cfg.notifications?.fromEmail) missing.push('SMTP_FROM');
    return missing;
  },
  fcm: (cfg) => {
    const f = cfg.fcm || {};
    const inline = f.projectId && f.clientEmail && f.privateKey;
    return inline || f.serviceAccountPath
      ? []
      : ['FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY (or FCM_SERVICE_ACCOUNT_PATH)'];
  },
};

/**
 * Verdict for one provider slot.
 *
 * Asks three separate questions, because they have three different fixes:
 *   1. is the name known at all?            → a typo
 *   2. is there an implementation?          → a declared seam that throws
 *   3. is it a dev double / right channel?  → unsuitable for real customers
 */
function checkSlot({ kind, provider, channel = null, envName, table, cfg }) {
  const name = String(provider || '');
  const problems = [];

  if (!name) {
    problems.push(`${envName} is not set — production cannot use an unset ${kind} provider`);
    return problems;
  }
  if (!table[name]) {
    problems.push(`${envName}=${name} is not a known ${kind} provider (expected one of: ${Object.keys(table).join(', ')})`);
    return problems;
  }
  if (isDeclaredNotImplemented(kind, name)) {
    // Suggest only adapters that can actually serve THIS channel — telling
    // somebody to fix a phone slot with an email-only provider is not help.
    const alternatives = [...IMPLEMENTED[kind]]
      .filter((p) => !isDevOnly(kind, p))
      .filter((p) => !channel || servesChannel(p, channel, table));
    problems.push(
      `${envName}=${name} is a declared seam with no implementation — it would throw on every send. `
      + `Set ${envName} to a working${channel ? ` ${channel}-capable` : ''} adapter (${alternatives.join(', ') || 'none yet'})`,
    );
    return problems;
  }
  if (!isImplemented(kind, name)) {
    problems.push(`${envName}=${name} has no implementation`);
    return problems;
  }
  if (isDevOnly(kind, name)) {
    problems.push(`${envName}=${name} is a development/test double — production must use a live adapter`);
    return problems;
  }
  if (channel && !servesChannel(name, channel, table)) {
    problems.push(
      `${envName}=${name} cannot deliver on the "${channel}" channel (it serves: ${table[name].join(', ')}). `
      + `Set ${envName} to a provider that serves ${channel}`,
    );
    return problems;
  }
  const missing = (REQUIRED_CREDENTIALS[name] || (() => []))(cfg);
  if (missing.length) {
    problems.push(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when ${envName}=${name}`);
  }
  return problems;
}

function secretLooksLikeDev(value) {
  const s = String(value || '');
  return !s || s.length < 16 || DEV_SECRET.test(s);
}

/**
 * @param {object} cfg  the app config (or a test double with the same shape)
 * @returns {string[]}  human-readable violations; empty = safe to listen
 */
export function collectProductionViolations(cfg) {
  if (!cfg?.isProd) return [];
  const v = [];

  const payment = cfg.payments?.provider || (cfg.razorpay?.keyId ? 'razorpay' : 'mock');
  if (!LIVE_PAYMENTS.has(payment)) {
    v.push(`PAYMENT_PROVIDER=${payment || 'mock'} — production must use razorpay`);
  } else {
    if (!cfg.razorpay?.keyId || !cfg.razorpay?.keySecret) {
      v.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production');
    }
    if (!cfg.razorpay?.webhookSecret) {
      v.push('RAZORPAY_WEBHOOK_SECRET is required in production (unsigned webhooks are a capture vector)');
    }
  }

  const payout = cfg.payouts?.provider || 'console';
  if (!LIVE_PAYOUTS.has(payout)) {
    v.push(`PAYOUT_PROVIDER=${payout} — production must use razorpayx or cashfree`);
  } else if (!cfg.payouts?.webhookSecret) {
    v.push('PAYOUT_WEBHOOK_SECRET is required in production');
  }
  if (payout === 'razorpayx') {
    const x = cfg.payouts?.razorpayx || {};
    if (!x.keyId || !x.keySecret || !x.accountNumber) {
      v.push('RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET and RAZORPAYX_ACCOUNT_NUMBER are required');
    }
  }
  if (payout === 'cashfree') {
    const c = cfg.payouts?.cashfree || {};
    if (!c.clientId || !c.clientSecret) {
      v.push('CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are required');
    }
  }

  // ---- OTP: TWO slots, because one vendor cannot serve both channels ----
  // Signup sends an EMAIL OTP (auth.service) and login sends an SMS one. A
  // single OTP_PROVIDER therefore had to be good at both, and no adapter here
  // is: msg91/twilio are phone-only, smtp is email-only. The old guard checked
  // only the phone slot, so `OTP_PROVIDER=msg91` passed and then threw on every
  // signup; `OTP_PROVIDER=ses` passed and threw on every login.
  const otpPhone = cfg.otp?.provider || 'console';
  const otpEmail = cfg.otp?.emailProvider || otpPhone;
  const requiredChannels = cfg.otp?.requiredChannels?.length
    ? cfg.otp.requiredChannels
    : [CHANNEL.PHONE, CHANNEL.EMAIL];

  if (requiredChannels.includes(CHANNEL.PHONE)) {
    v.push(...checkSlot({
      kind: 'otp', provider: otpPhone, channel: CHANNEL.PHONE,
      envName: 'OTP_PROVIDER', table: OTP_PROVIDER_CHANNELS, cfg,
    }));
  }
  if (requiredChannels.includes(CHANNEL.EMAIL)) {
    v.push(...checkSlot({
      kind: 'otp', provider: otpEmail, channel: CHANNEL.EMAIL,
      envName: 'OTP_EMAIL_PROVIDER', table: OTP_PROVIDER_CHANNELS, cfg,
    }));
  }

  // ---- notifications: every channel the dispatcher can use ----
  const n = cfg.notifications || {};
  // slot name → the channel constant it must be able to serve
  const notifSlots = [
    ['push', CHANNEL.PUSH, n.pushProvider || n.provider, 'NOTIFICATION_PUSH_PROVIDER'],
    ['email', CHANNEL.EMAIL, n.emailProvider || n.provider, 'NOTIFICATION_EMAIL_PROVIDER'],
    ['sms', CHANNEL.PHONE, n.smsProvider || n.provider, 'NOTIFICATION_SMS_PROVIDER'],
  ];
  for (const [slot, channel, provider, envName] of notifSlots) {
    if (!REQUIRED_NOTIFICATION_CHANNELS.includes(slot)) continue;
    v.push(...checkSlot({
      kind: 'notification',
      provider: provider || 'console',
      channel,
      envName,
      table: NOTIFICATION_PROVIDER_CHANNELS,
      cfg,
    }));
  }

  // ---- storage: local disk cannot survive more than one replica ----
  const storage = String(cfg.storage?.provider || 'local');
  if (!IMPLEMENTED.storage.has(storage)) {
    v.push(`STORAGE_PROVIDER=${storage} has no implementation`);
  } else if (storage === 'local') {
    v.push(
      'STORAGE_PROVIDER=local writes media to one pod\'s filesystem — a second replica cannot see it '
      + 'and a redeploy loses it. Use s3 (or any S3-compatible store such as MinIO) in production',
    );
  } else {
    const s3 = cfg.storage?.s3 || {};
    const missing = ['bucket', 'region', 'accessKeyId', 'secretAccessKey']
      .filter((k) => !s3[k])
      .map((k) => `S3_${k === 'accessKeyId' ? 'ACCESS_KEY_ID' : k === 'secretAccessKey' ? 'SECRET_ACCESS_KEY' : k.toUpperCase()}`);
    if (missing.length) v.push(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when STORAGE_PROVIDER=s3`);
  }

  // ---- search: mongo is production-grade; atlas/opensearch are seams ----
  const search = String(cfg.search?.provider || 'mongo');
  if (isDeclaredNotImplemented('search', search)) {
    v.push(
      `SEARCH_PROVIDER=${search} is a declared seam with no implementation — every query would throw. `
      + 'Use mongo (the ranked Mongo index), which is production-grade',
    );
  } else if (!IMPLEMENTED.search.has(search)) {
    v.push(`SEARCH_PROVIDER=${search} has no implementation (known: mongo)`);
  }

  if (secretLooksLikeDev(cfg.jwt?.accessSecret)) {
    v.push('JWT_ACCESS_SECRET is missing or still a development default');
  }
  if (secretLooksLikeDev(cfg.jwt?.refreshSecret)) {
    v.push('JWT_REFRESH_SECRET is missing or still a development default');
  }

  if (cfg.domains?.allowHeaderOverride) {
    v.push('ALLOW_TENANT_HEADER_OVERRIDE must be false in production (Host is the tenant)');
  }

  return v;
}

/**
 * Fail the process when production is misconfigured.
 * @returns {{ok:boolean, violations:string[]}}
 */
export function assertProductionProviders(cfg, { exitFn = (code) => process.exit(code) } = {}) {
  const violations = collectProductionViolations(cfg);
  if (!violations.length) return { ok: true, violations };
  // eslint-disable-next-line no-console
  console.error('[boot] refusing to start — production providers are not live:');
  for (const msg of violations) {
    // eslint-disable-next-line no-console
    console.error(`  • ${msg}`);
  }
  exitFn(1);
  return { ok: false, violations };
}

export default assertProductionProviders;
