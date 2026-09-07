/**
 * Production provider guard (B10 / P0-4).
 *
 * `console` / `mock` / `memory` adapters exist so tests and laptops can
 * exercise the money path without credentials. They must NEVER be the
 * process that talks to real customers. A `NODE_ENV=production` boot with
 * mock payments, console payouts, or console OTP exits 1 BEFORE listen —
 * silent mock-in-prod is how a marketplace "launches" and never collects.
 *
 * The function is pure over a config object so unit tests can feed fixtures
 * without mutating process.env. The process wrapper calls `process.exit(1)`.
 */

const DEV_SECRET = /change-me|^dev-/i;
const LIVE_PAYMENTS = new Set(['razorpay']);
const LIVE_PAYOUTS = new Set(['razorpayx', 'cashfree']);
const LIVE_OTP = new Set(['msg91', 'twilio', 'ses']);

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

  const otp = cfg.otp?.provider || 'console';
  if (!LIVE_OTP.has(otp)) {
    v.push(`OTP_PROVIDER=${otp} — production must use msg91, twilio, or ses`);
  } else if (otp === 'msg91' && (!cfg.otp?.msg91AuthKey || !cfg.otp?.msg91TemplateId)) {
    v.push('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required when OTP_PROVIDER=msg91');
  } else if (otp === 'twilio' && (!cfg.otp?.twilioAccountSid || !cfg.otp?.twilioAuthToken || !cfg.otp?.twilioFrom)) {
    v.push('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required when OTP_PROVIDER=twilio');
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
