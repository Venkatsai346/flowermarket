/**
 * Media upload smoke test — presign → PUT → confirm → registry lifecycle
 * (per `uploads/media_upload.md`).
 *
 * Covers:
 *   1. presign happy path (image) → pending asset + uploadUrl
 *   2. PUT bytes → confirm → ready; public URL serves the object
 *   3. tenant isolation (tenant B cannot see tenant A's assets)
 *   4. validation: bad extension 400, oversized 400, type/purpose mismatch 400, unauth 401
 *   5. magic-byte guard: text bytes renamed .jpg → confirm fails → status failed
 *   6. delete → soft-deleted + gone from list
 *   7. confirm-before-upload fails cleanly
 *
 * Run: node scripts/smoke-media.test.js   (STORAGE_PROVIDER defaults to local)
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.OTP_PROVIDER = 'memory';
// hermetic local storage for this run
process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `fm-media-smoke-${Date.now()}`);

let mongod;

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_media_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const modelFiles = [
    'tenant.model.js', 'tenantAuthConfig.model.js', 'user.model.js', 'mediaAsset.model.js',
  ];
  const models = await Promise.all(modelFiles.map((f) => import(`../src/models/${f}`)));
  const M = {};
  for (const m of models) { const mod = m.default; M[mod.modelName] = mod; await mod.init(); }

  // ---- two tenants for isolation checks ----
  const tenantA = await M.Tenant.create({ name: 'Store A', slug: 'store-a', status: 'active' });
  const tenantB = await M.Tenant.create({ name: 'Store B', slug: 'store-b', status: 'active' });
  await M.TenantAuthConfig.create({ tenantId: tenantA.id });
  await M.TenantAuthConfig.create({ tenantId: tenantB.id });
  const adminA = await M.User.create({ tenantId: tenantA.id, email: { address: 'a@fm.in', verified: true }, role: 'admin', status: 'active' });
  const adminB = await M.User.create({ tenantId: tenantB.id, email: { address: 'b@fm.in', verified: true }, role: 'admin', status: 'active' });

  const { default: AuthService } = await import('../src/services/auth.service.js');
  const tokA = (await AuthService.issueTokens(adminA)).accessToken;
  const tokB = (await AuthService.issueTokens(adminB)).accessToken;

  // ---- app harness ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const origin = `http://127.0.0.1:${port}`;

  const call = async (pathUrl, { method = 'GET', body, buffer, contentType, token, tenantId = null } = {}) => {
    const headers = {};
    if (tenantId) headers['x-tenant-id'] = tenantId;
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (buffer) {
      headers['content-type'] = contentType || 'application/octet-stream';
      payload = buffer;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    // uploadUrl is absolute (/api/v1/media/upload?key=…) — don't double-prefix
    const url = pathUrl.startsWith('/api/') ? origin + pathUrl : base + pathUrl;
    const res = await fetch(url, { method, headers, body: payload });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };

  let passed = 0;
  const ok = (l) => { passed += 1; console.log(`  ✓ ${l}`); };

  // tiny valid JPEG magic (FF D8 FF …)
  const tinyJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    Buffer.alloc(64, 0x11),
  ]);

  // ================= 1. presign happy path =================
  let r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'roses.jpg', contentType: 'image/jpeg', size: tinyJpeg.length, purpose: 'product_image' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.asset.status, 'pending');
  assert.ok(r.body.data.uploadUrl.includes('/api/v1/media/upload?key='), 'local uploadUrl');
  assert.ok(r.body.data.asset.key.startsWith(`${tenantA.id}/product_image/`), 'tenant-scoped key');
  const { asset: asset1, uploadUrl } = r.body.data;
  ok('presign returns pending asset + tenant-scoped uploadUrl');

  // ================= 2. PUT bytes → confirm → ready + public URL =================
  r = await call(uploadUrl, { method: 'PUT', buffer: tinyJpeg, contentType: 'image/jpeg', token: tokA, tenantId: tenantA.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(`/media/${asset1.id}/confirm`, { method: 'POST', token: tokA, tenantId: tenantA.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'ready');
  assert.ok(r.body.data.url.startsWith('/media/local/'), 'public url');
  ok('PUT → confirm → ready');

  // public URL serves the object
  const obj = await fetch(origin + r.body.data.url);
  assert.equal(obj.status, 200);
  assert.match(obj.headers.get('content-type') || '', /image\/jpeg/);
  ok('public URL serves the uploaded object');

  // ================= 3. tenant isolation =================
  r = await call('/media', { token: tokA, tenantId: tenantA.id });
  assert.equal(r.body.data.length, 1);
  r = await call('/media', { token: tokB, tenantId: tenantB.id });
  assert.equal(r.body.data.length, 0, 'tenant B must not see tenant A assets');
  ok('list is tenant-scoped');

  // ================= 4. validation =================
  r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'virus.exe', contentType: 'application/octet-stream', size: 10, purpose: 'product_image' },
  });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'MEDIA_TYPE_NOT_ALLOWED');
  r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'big.mp4', contentType: 'video/mp4', size: 300 * 1024 * 1024, purpose: 'product_video' },
  });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'MEDIA_TOO_LARGE');
  r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'clip.mp4', contentType: 'video/mp4', size: 1024, purpose: 'product_image' },
  });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'MEDIA_TYPE_NOT_ALLOWED');
  r = await call('/media/presign', {
    method: 'POST',
    body: { filename: 'x.jpg', contentType: 'image/jpeg', size: 10, purpose: 'product_image' },
  });
  assert.equal(r.status, 401);
  ok('validation: bad type / oversize / purpose mismatch / unauth all rejected');

  // ================= 5. magic-byte guard =================
  r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'fake.jpg', contentType: 'image/jpeg', size: 12, purpose: 'product_image' },
  });
  const fake = r.body.data;
  await call(fake.uploadUrl, { method: 'PUT', buffer: Buffer.from('not an image!'), contentType: 'image/jpeg', token: tokA, tenantId: tenantA.id });
  r = await call(`/media/${fake.asset.id}/confirm`, { method: 'POST', token: tokA, tenantId: tenantA.id });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'MEDIA_VERIFY_FAILED');
  r = await call(`/media/${fake.asset.id}`, { token: tokA, tenantId: tenantA.id });
  assert.equal(r.body.data.status, 'failed');
  ok('magic-byte sniff rejects a .jpg that is not a JPEG (status failed)');

  // ================= 6. delete =================
  r = await call(`/media/${asset1.id}`, { method: 'DELETE', token: tokA, tenantId: tenantA.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.deleted, true);
  r = await call('/media', { token: tokA, tenantId: tenantA.id });
  assert.ok(!r.body.data.some((a) => a.id === asset1.id), 'deleted asset gone from list');
  assert.equal(r.body.data.length, 1, 'the failed asset from the magic-byte check remains');
  ok('delete soft-deletes and hides from list');

  // ================= 7. confirm before upload =================
  r = await call('/media/presign', {
    method: 'POST', token: tokA, tenantId: tenantA.id,
    body: { filename: 'never.jpg', contentType: 'image/jpeg', size: 10, purpose: 'product_image' },
  });
  r = await call(`/media/${r.body.data.asset.id}/confirm`, { method: 'POST', token: tokA, tenantId: tenantA.id });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'MEDIA_VERIFY_FAILED');
  ok('confirm before upload fails cleanly');

  console.log(`\nsmoke-media: ${passed} checks passed ✅`);
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  return passed;
}

main()
  .then((n) => { process.exit(n > 0 ? 0 : 1); })
  .catch(async (err) => {
    console.error('❌', err);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    try { await mongod?.stop(); } catch { /* noop */ }
    process.exit(1);
  });
