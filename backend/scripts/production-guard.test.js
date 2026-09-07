/**
 * Production provider guard — unit, no DB.
 *
 * A NODE_ENV=production boot with mock money MUST refuse to listen.
 * Run: node scripts/production-guard.test.js
 */
import assert from 'node:assert/strict';
import { collectProductionViolations, assertProductionProviders } from '../src/utils/assertProductionProviders.js';

let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

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
  otp: { provider: 'msg91', msg91AuthKey: 'authkeyauthkey', msg91TemplateId: 'tmpl' },
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
