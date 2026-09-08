/**
 * Production provider guard — unit, no DB.
 *
 * A NODE_ENV=production boot with mock money MUST refuse to listen.
 *
 * The guard also has to catch the subtler failure: a provider name that is
 * DECLARED but not IMPLEMENTED, which boots cleanly and then throws on first
 * use. `OTP_PROVIDER=ses` did exactly that — and because signup sends an email
 * OTP while msg91/twilio are phone-only, `OTP_PROVIDER=msg91` alone did too.
 * Both are asserted below, because both were real.
 *
 * Run: node scripts/production-guard.test.js
 */
import assert from 'node:assert/strict';
import { collectProductionViolations, assertProductionProviders } from '../src/utils/assertProductionProviders.js';

let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

// A FULLY wired production config: every subsystem has a live adapter AND the
// credentials it needs. The OTP block has two slots, because a phone-only
// vendor cannot serve the email OTP that signup sends.
const live = {
  isProd: true,
  payments: { provider: 'razorpay' },
  razorpay: { keyId: 'rzp_live_xxx', keySecret: 'supersecretkeyvalue', webhookSecret: 'whsec_live' },
  payouts: {
    provider: 'razorpayx',
    webhookSecret: 'payout-whsec',
    razorpayx: { keyId: 'rzp_live_x', keySecret: 'xsecretkeyvalue', accountNumber: '232323000000' },
    cashfree: {},
  },
  otp: {
    provider: 'msg91',
    emailProvider: 'smtp',
    requiredChannels: ['phone', 'email'],
    msg91AuthKey: 'authkeyauthkey',
    msg91TemplateId: 'tmpl',
  },
  smtp: { host: 'smtp.postmark.test', from: 'Flower Market <no-reply@flowermarket.in>' },
  notifications: {
    provider: 'console',
    pushProvider: 'fcm',
    emailProvider: 'smtp',
    smsProvider: 'msg91',
  },
  fcm: { projectId: 'fm-prod', clientEmail: 'sa@fm-prod.iam', privateKey: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----' },
  storage: { provider: 's3', s3: { bucket: 'fm-media', region: 'ap-south-1', accessKeyId: 'AKIA', secretAccessKey: 'secret' } },
  search: { provider: 'mongo' },
  jwt: { accessSecret: 'a-production-access-secret-32b', refreshSecret: 'a-production-refresh-secret-32b' },
  domains: { allowHeaderOverride: false },
};

function main() {
  console.log('\nproduction-guard\n');

  assert.deepEqual(collectProductionViolations({ isProd: false, payments: { provider: 'mock' } }), []);
  ok('non-production never refuses');

  const mockPay = collectProductionViolations({ ...live, payments: { provider: 'mock' } });
  assert.ok(mockPay.some((m) => /PAYMENT_PROVIDER/.test(m)), mockPay.join('; '));
  ok('production + PAYMENT_PROVIDER=mock is a violation');

  const consolePayout = collectProductionViolations({ ...live, payouts: { ...live.payouts, provider: 'console' } });
  assert.ok(consolePayout.some((m) => /PAYOUT_PROVIDER/.test(m)), consolePayout.join('; '));
  ok('production + PAYOUT_PROVIDER=console is a violation');

  const consoleOtp = collectProductionViolations({ ...live, otp: { provider: 'console' } });
  assert.ok(consoleOtp.some((m) => /OTP_PROVIDER/.test(m)), consoleOtp.join('; '));
  ok('production + OTP_PROVIDER=console is a violation');

  const weakJwt = collectProductionViolations({ ...live, jwt: { accessSecret: 'dev-access-secret', refreshSecret: live.jwt.refreshSecret } });
  assert.ok(weakJwt.some((m) => /JWT_ACCESS_SECRET/.test(m)), weakJwt.join('; '));
  ok('production + default JWT secret is a violation');

  const header = collectProductionViolations({ ...live, domains: { allowHeaderOverride: true } });
  assert.ok(header.some((m) => /ALLOW_TENANT_HEADER_OVERRIDE/.test(m)), header.join('; '));
  ok('production + tenant-header override is a violation');

  // ---- declared seams: the failure mode that boots cleanly and then throws ----
  const sesOtp = collectProductionViolations({ ...live, otp: { ...live.otp, provider: 'ses', emailProvider: 'ses' } });
  assert.ok(sesOtp.some((m) => /OTP_PROVIDER=ses/.test(m) && /declared seam/.test(m)), sesOtp.join('; '));
  assert.ok(sesOtp.some((m) => /OTP_EMAIL_PROVIDER=ses/.test(m)), sesOtp.join('; '));
  assert.ok(sesOtp.some((m) => /msg91, twilio/.test(m)), 'the phone slot suggests phone-capable adapters: ' + sesOtp.join('; '));
  ok('OTP_PROVIDER=ses is refused as an unimplemented seam (it used to boot and lock everyone out)');

  // ---- channel coverage: msg91 alone cannot serve the signup email OTP ----
  const phoneOnly = collectProductionViolations({ ...live, otp: { provider: 'msg91', msg91AuthKey: 'a', msg91TemplateId: 't' } });
  assert.ok(
    phoneOnly.some((m) => /OTP_EMAIL_PROVIDER=msg91/.test(m) && /email/.test(m)),
    phoneOnly.join('; '),
  );
  ok('a phone-only OTP provider is refused because signup sends an email OTP');

  const smtpForPhone = collectProductionViolations({ ...live, otp: { ...live.otp, provider: 'smtp' } });
  assert.ok(smtpForPhone.some((m) => /OTP_PROVIDER=smtp cannot deliver on the "phone" channel/.test(m)), smtpForPhone.join('; '));
  ok('an email-only provider in the phone slot is refused, and says why');

  const missingSmtp = collectProductionViolations({ ...live, smtp: { host: '', from: '' } });
  assert.ok(missingSmtp.some((m) => /SMTP_HOST/.test(m)), missingSmtp.join('; '));
  ok('smtp without SMTP_HOST is refused rather than failing on first send');

  // ---- notifications ----
  const consoleNotif = collectProductionViolations({ ...live, notifications: { ...live.notifications, pushProvider: 'console' } });
  assert.ok(consoleNotif.some((m) => /NOTIFICATION_PUSH_PROVIDER=console/.test(m) && /development\/test double/.test(m)), consoleNotif.join('; '));
  ok('NOTIFICATION_PUSH_PROVIDER=console is refused in production');

  const apns = collectProductionViolations({ ...live, notifications: { ...live.notifications, pushProvider: 'apns' } });
  assert.ok(apns.some((m) => /NOTIFICATION_PUSH_PROVIDER=apns/.test(m) && /declared seam/.test(m)), apns.join('; '));
  ok('apns is refused as an unimplemented seam');

  const noFcm = collectProductionViolations({ ...live, fcm: {} });
  assert.ok(noFcm.some((m) => /FCM_PROJECT_ID/.test(m)), noFcm.join('; '));
  ok('fcm without a service account is refused');

  // ---- storage ----
  const localStorage = collectProductionViolations({ ...live, storage: { provider: 'local' } });
  assert.ok(localStorage.some((m) => /STORAGE_PROVIDER=local/.test(m) && /replica/.test(m)), localStorage.join('; '));
  ok('local storage is refused: one pod\'s disk is not shared and does not survive a redeploy');

  const noBucket = collectProductionViolations({ ...live, storage: { provider: 's3', s3: { bucket: '', region: '', accessKeyId: '', secretAccessKey: '' } } });
  assert.ok(noBucket.some((m) => /S3_BUCKET/.test(m)), noBucket.join('; '));
  ok('s3 without bucket/region/keys is refused');

  // ---- search ----
  const atlas = collectProductionViolations({ ...live, search: { provider: 'atlas' } });
  assert.ok(atlas.some((m) => /SEARCH_PROVIDER=atlas/.test(m) && /declared seam/.test(m)), atlas.join('; '));
  ok('SEARCH_PROVIDER=atlas is refused as an unimplemented seam');

  assert.deepEqual(collectProductionViolations({ ...live, search: { provider: 'mongo' } }).filter((m) => /SEARCH/.test(m)), []);
  ok('mongo search is accepted — it is the real ranked index, not a mock');

  assert.deepEqual(collectProductionViolations(live), []);
  ok('fully-wired production config is clean');

  let exited = null;
  const result = assertProductionProviders(
    { ...live, payments: { provider: 'mock' } },
    { exitFn: (code) => { exited = code; } },
  );
  assert.equal(result.ok, false);
  assert.equal(exited, 1);
  ok('assertProductionProviders exits 1 and does not throw');

  exited = null;
  const okResult = assertProductionProviders(live, { exitFn: (code) => { exited = code; } });
  assert.equal(okResult.ok, true);
  assert.equal(exited, null);
  ok('assertProductionProviders is a no-op when clean');

  console.log(`\n${passed} passed`);
}

main();
