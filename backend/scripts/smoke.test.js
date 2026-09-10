/**
 * Smoke test — boots the app against an in-memory MongoDB (mongodb-memory-server)
 * and runs the complete user-domain flow end to end:
 *
 *   tenant bootstrap -> OTP request -> register -> login (OTP-first auto-create)
 *   -> profile update -> address create/update/default -> ownership guard
 *   -> refresh-token rotation -> logout -> RBAC -> tenant-scope guard
 *   -> token-tenant self fallback -> password login (global email resolution)
 *   -> password reset by email (global email resolution)
 *
 * Run: npm run smoke   (downloads the MongoDB binary once on first run)
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo, stopHermeticMongoSync } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

// NOTE: env vars MUST be set before config is imported — config reads env at
// module load, so it is imported dynamically inside main() below.
process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = ''; // hermetic: never leak the dev .env default tenant into the in-memory DB
process.env.MONGODB_URI = ''; // hermetic: never leak the dev .env DB into test runs (always use the in-memory mongod)
let mongod;

process.env.OTP_PROVIDER = 'memory';

async function main() {
  const config = (await import('../src/config/index.js')).default;

  // tiny wiredTiger cache keeps it sandbox-friendly (2GB RAM here)
  mongod = await createHermeticMongo({
    instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] },
  });
  // always try to stop the in-memory server, even on early failures (no /tmp leaks)
  process.on('exit', () => { stopHermeticMongoSync(mongod); });
  config.mongoUri = mongod.getUri('flower_market_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  // ---- bootstrap tenant ----
  const Tenant = (await import('../src/models/tenant.model.js')).default;
  const TenantAuthConfig = (await import('../src/models/tenantAuthConfig.model.js')).default;
  const User = (await import('../src/models/user.model.js')).default;
  const ServiceablePincode = (await import('../src/models/serviceablePincode.model.js')).default;
  const smsSender = (await import('../src/services/smsSender.service.js')).default;

  // build only the indexes the exercised flows rely on (keeps memory low)
  await Promise.all([
    Tenant.init(),
    TenantAuthConfig.init(),
    ServiceablePincode.init(),
    User.init(),
    (await import('../src/models/address.model.js')).default.init(),
    (await import('../src/models/authToken.model.js')).default.init(),
    (await import('../src/models/otpVerification.model.js')).default.init(),
  ]);

  const tenant = await Tenant.create({ name: 'Flower Market', slug: 'flower-market', status: 'active' });
  await TenantAuthConfig.create({ tenantId: tenant.id });
  await ServiceablePincode.create({ tenantId: tenant.id, pincode: '533001', isServiceable: true });

  // ---- build app + agent ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  // tenantless: omit the default test header entirely (a truly headerless call —
  // required for the token-tenant and global-login fallbacks, which only kick
  // in when the client named NO tenant).
  const call = async (path, { method = 'GET', body, token, headers = {}, tenantless = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(tenantless ? {} : { 'x-tenant-id': tenant.id }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const otpFor = (purpose, target) => smsSender.getLastCode({ channel: 'phone', target, purpose });

  // ---- 1. health ----
  let r = await call('/health');
  assert.equal(r.status, 200);

  // ---- 2. request OTP ----
  r = await call('/auth/otp/request', {
    method: 'POST',
    body: { purpose: 'signup', channel: 'phone', phone: { countryCode: '+91', number: '9876543210' } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // ---- 3. register (OTP verified) ----
  r = await call('/auth/register', {
    method: 'POST',
    body: {
      phone: { countryCode: '+91', number: '9876543210' },
      otpCode: otpFor('signup', '9876543210'),
      profile: { firstName: 'Ravi', lastName: 'Kumar' },
      source: 'app',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.user.phone.number, '9876543210');
  const tokens = r.body.data.tokens;
  assert.ok(tokens.accessToken && tokens.refreshToken);

  // ---- 4. me ----
  r = await call('/users/me', { token: tokens.accessToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.profile.firstName, 'Ravi');
  assert.equal(r.body.data.passwordHash, undefined, 'passwordHash must never be serialized');
  assert.equal(r.body.data.password, undefined, 'password must never be serialized');

  // ---- 5. update profile ----
  r = await call('/users/me', {
    method: 'PATCH',
    token: tokens.accessToken,
    body: { profile: { lastName: 'Reddy' }, preferences: { language: 'te' } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.profile.lastName, 'Reddy');

  // ---- 6. address create + serviceability stamp ----
  r = await call('/users/me/addresses', {
    method: 'POST',
    token: tokens.accessToken,
    body: { line1: '4-1-22, Temple Street', city: 'Kakinada', pincode: '533001', type: 'home', isDefault: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.serviceability.status, 'serviceable');
  const addressId = r.body.data.id;

  // ---- 7. second address (unserviceable pincode) ----
  r = await call('/users/me/addresses', {
    method: 'POST',
    token: tokens.accessToken,
    body: { line1: 'Far lane', city: 'Nowhere', pincode: '000000', type: 'work' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.serviceability.status, 'unserviceable');

  // ---- 8. set default + list ----
  r = await call(`/users/me/addresses/${addressId}/default`, { method: 'PATCH', token: tokens.accessToken });
  assert.equal(r.status, 200);
  r = await call('/users/me/addresses', { token: tokens.accessToken });
  assert.equal(r.body.data.length, 2);

  // ---- 9. ownership guard: another user cannot read this address ----
  const other = await User.create({ tenantId: tenant.id, phone: { number: '9999999999', verified: true }, status: 'active' });
  const AuthService = (await import('../src/services/auth.service.js')).default;
  const otherTokens = await AuthService.issueTokens(other);
  r = await call(`/users/me/addresses/${addressId}`, { token: otherTokens.accessToken });
  assert.equal(r.status, 404, 'cross-user address access must 404');

  // ---- 10. refresh token rotation ----
  r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.tokens.accessToken);
  const newRefresh = r.body.data.tokens.refreshToken;
  assert.notEqual(newRefresh, tokens.refreshToken, 'refresh token must rotate');

  // old refresh token must now be rejected
  r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } });
  assert.equal(r.status, 401, 'reused refresh token must be rejected');

  // ---- 11. logout revokes the session ----
  r = await call('/auth/logout', { method: 'POST', body: { refreshToken: newRefresh } });
  assert.equal(r.status, 200);
  r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: newRefresh } });
  assert.equal(r.status, 401, 'token revoked on logout must be rejected');

  // ---- 12. OTP login auto-creates account (OTP-first signup) ----
  r = await call('/auth/otp/request', {
    method: 'POST',
    body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: '9123456789' } },
  });
  assert.equal(r.status, 200);
  r = await call('/auth/otp/verify', {
    method: 'POST',
    body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: '9123456789' }, code: otpFor('login', '9123456789') },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.isNewUser, true);

  // ---- 13. wrong OTP is rejected with OTP_INVALID ----
  r = await call('/auth/otp/request', {
    method: 'POST',
    body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: '9012345678' } },
  });
  assert.equal(r.status, 200);
  r = await call('/auth/otp/verify', {
    method: 'POST',
    body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: '9012345678' }, code: '000000' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'OTP_INVALID');

  // ---- 14. admin list (super_admin) ----
  const adminUser = await User.create({
    tenantId: tenant.id,
    email: { address: 'boss@flowermarket.in', verified: true },
    role: 'super_admin',
    status: 'active',
  });
  const adminTokens = await AuthService.issueTokens(adminUser);
  r = await call('/users?page=1&limit=5', { token: adminTokens.accessToken });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.data));
  assert.ok(r.body.meta.total >= 4);

  // ---- 15. non-admin cannot list users (RBAC) ----
  r = await call('/users', { token: otherTokens.accessToken });
  assert.equal(r.status, 403);

  // ---- 16. no token -> 401 ----
  r = await call('/users/me');
  assert.equal(r.status, 401);

  // ---- 17. tenant-scope guard: token for tenant B rejected under tenant A ----
  const tenantB = await Tenant.create({ name: 'Tenant B', slug: 'tenant-b', status: 'active' });
  const bUser = await User.create({ tenantId: tenantB.id, phone: { number: '8000000000', verified: true }, status: 'active' });
  const bTokens = await AuthService.issueTokens(bUser);
  r = await call('/users/me', { token: bTokens.accessToken, headers: { 'x-tenant-id': tenant.id } });
  assert.equal(r.status, 401, 'tenant-scope guard must reject cross-tenant tokens');
  assert.equal(r.body.code, 'TENANT_MISMATCH');

  // ---- 18. /users/me resolves the token tenant when the header is absent ----
  // A headerless call can only mean "myself" — default-resolving it 401s every
  // non-default session (a fresh store owner's console spun "loading" forever
  // behind a 401→refresh storm). tenantC is created LAST, so the default/first
  // resolution provably differs from its token: only the fallback passes this.
  const tenantC = await Tenant.create({ name: 'Tenant C', slug: 'tenant-c', status: 'active' });
  const cUser = await User.create({ tenantId: tenantC.id, phone: { number: '8000000001', verified: true }, status: 'active' });
  const cTokens = await AuthService.issueTokens(cUser);
  r = await call('/users/me', { token: cTokens.accessToken, tenantless: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.id, String(cUser._id));

  // ---- 19. password login resolves the account by email, ALWAYS ----
  // Emails are globally unique, so a logged-out store owner cannot be asked for
  // a tenant id they were never shown: the lookup is global and the tenant is an
  // output of login. Wrong passwords / unknown emails stay opaque (no
  // enumeration), and an OTP-first account is told PASSWORD_NOT_SET instead of
  // being lied to as "wrong password".
  const dUser = await User.create({
    tenantId: tenantC.id,
    email: { address: 'owner@tenantc.in', verified: true },
    role: 'admin',
    status: 'active',
  });
  await dUser.setPassword('Store@12345');
  await dUser.save();
  // headerless + correct → 200, session bound to the OWNER's tenant, not the guess
  r = await call('/auth/login', { method: 'POST', tenantless: true, body: { email: 'owner@tenantc.in', password: 'Store@12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(String(r.body.data.user.tenantId), String(tenantC._id));
  assert.equal(r.body.data.user.passwordHash, undefined, 'login must never serialize the hash');
  // headerless + wrong password → opaque 401, identical to an unknown email (no enumeration)
  r = await call('/auth/login', { method: 'POST', tenantless: true, body: { email: 'owner@tenantc.in', password: 'Wrong@12345' } });
  assert.equal(r.status, 401, JSON.stringify(r.body));
  assert.equal(r.body.code, 'INVALID_CREDENTIALS');
  r = await call('/auth/login', { method: 'POST', tenantless: true, body: { email: 'nobody@nowhere.in', password: 'Wrong@12345' } });
  assert.equal(r.status, 401, JSON.stringify(r.body));
  assert.equal(r.body.code, 'INVALID_CREDENTIALS');
  // a WRONG explicit header no longer forces a miss: the account is found by
  // email and the token is minted for the account's OWN tenant, never the one
  // the header named (no cross-tenant escalation is possible)
  r = await call('/auth/login', { method: 'POST', headers: { 'x-tenant-id': tenant.id }, body: { email: 'owner@tenantc.in', password: 'Store@12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(String(r.body.data.user.tenantId), String(tenantC._id));
  // explicit RIGHT header → 200 (unchanged)
  r = await call('/auth/login', { method: 'POST', headers: { 'x-tenant-id': tenantC.id }, body: { email: 'owner@tenantc.in', password: 'Store@12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // an OTP-first account has NO password: the server says PASSWORD_NOT_SET
  // (actionable) instead of pretending it was a wrong password
  const eUser = await User.create({
    tenantId: tenantC.id,
    email: { address: 'nopass@tenantc.in', verified: true },
    role: 'admin',
    status: 'active',
  });
  r = await call('/auth/login', { method: 'POST', tenantless: true, body: { email: 'nopass@tenantc.in', password: 'Whatever@123' } });
  assert.equal(r.status, 401, JSON.stringify(r.body));
  assert.equal(r.body.code, 'PASSWORD_NOT_SET');

  // ---- 20. password reset by email resolves the account globally ----
  // The same guessed-tenant miss that broke login also broke reset for owners;
  // the reset OTP is requested headerless, then the account is found by email.
  r = await call('/auth/otp/request', { method: 'POST', tenantless: true, body: { purpose: 'password_reset', channel: 'email', email: 'owner@tenantc.in' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const resetCode = smsSender.getLastCode({ channel: 'email', target: 'owner@tenantc.in', purpose: 'password_reset' });
  assert.ok(resetCode, 'email OTP must be captured by the memory provider');
  r = await call('/auth/password/reset', { method: 'POST', tenantless: true, body: { channel: 'email', email: 'owner@tenantc.in', otpCode: resetCode, newPassword: 'NewPass@12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // the new password now signs in headerless (global lookup again)
  r = await call('/auth/login', { method: 'POST', tenantless: true, body: { email: 'owner@tenantc.in', password: 'NewPass@12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(String(r.body.data.user.tenantId), String(tenantC._id));

  console.log('✅ ALL SMOKE TESTS PASSED (20 scenarios)');

  server.close();
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
  process.exit(0);
}

async function run() {
  try { await main(); } catch (err) { console.error('❌', err); await mongoose.disconnect().catch(()=>{}); await stopHermeticMongo(mongod); process.exit(1); }
}
run();
