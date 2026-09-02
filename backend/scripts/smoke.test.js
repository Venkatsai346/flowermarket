/**
 * Smoke test — boots the app against an in-memory MongoDB (mongodb-memory-server)
 * and runs the complete user-domain flow end to end:
 *
 *   tenant bootstrap -> OTP request -> register -> login (OTP-first auto-create)
 *   -> profile update -> address create/update/default -> ownership guard
 *   -> refresh-token rotation -> logout -> RBAC -> tenant-scope guard
 *
 * Run: npm run smoke   (downloads the MongoDB binary once on first run)
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// NOTE: env vars MUST be set before config is imported — config reads env at
// module load, so it is imported dynamically inside main() below.
process.env.NODE_ENV = 'test';
let mongod;

process.env.OTP_PROVIDER = 'memory';

async function main() {
  const config = (await import('../src/config/index.js')).default;

  // tiny wiredTiger cache keeps it sandbox-friendly (2GB RAM here)
  mongod = await MongoMemoryServer.create({
    instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] },
  });
  // always try to stop the in-memory server, even on early failures (no /tmp leaks)
  process.on('exit', () => { try { mongod.stop(); } catch {} });
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

  const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenant.id, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
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

  console.log('✅ ALL SMOKE TESTS PASSED (17 scenarios)');

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}

async function run() {
  try { await main(); } catch (err) { console.error('❌', err); await mongoose.disconnect().catch(()=>{}); await mongod.stop().catch(()=>{}); process.exit(1); }
}
run();
