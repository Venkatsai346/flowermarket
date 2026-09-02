/**
 * E2E: media upload through the Vite proxy (:5173) — the exact path the
 * browser takes (login → presign → PUT via /api → confirm → list → serve
 * public URL via /media/local proxy → category with uploaded image).
 * Run: node scripts/smoke-media-e2e-proxy.js
 */
const BASE = 'http://localhost:5173';
const TENANT = '6a97a2441663c828e0287f85';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
};

async function main() {
  console.log('→ login through proxy (x-tenant-id scoped)');
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
    body: JSON.stringify({ email: 'admin@flowermarket.in', password: 'Admin@12345' }),
  });
  const loginJson = await login.json();
  check('login 200', login.status === 200);
  const token = loginJson?.data?.tokens?.accessToken;
  check('access token issued', Boolean(token));
  const auth = { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT };

  console.log('→ presign through proxy');
  const presign = await fetch(`${BASE}/api/v1/media/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ filename: 'e2e.png', contentType: 'image/png', size: PNG.length, purpose: 'product_image' }),
  });
  const presignJson = await presign.json();
  check('presign 201', presign.status === 201, JSON.stringify(presignJson).slice(0, 160));
  const asset = presignJson?.data?.asset;
  const uploadUrl = presignJson?.data?.uploadUrl;
  check('uploadUrl is same-origin absolute path', typeof uploadUrl === 'string' && uploadUrl.startsWith('/api/v1/media/upload?key='), uploadUrl);

  console.log('→ direct PUT (raw body, session auth — like browser XHR)');
  const put = await fetch(`${BASE}${uploadUrl}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png', ...auth },
    body: PNG,
  });
  const putJson = await put.json().catch(() => ({}));
  check('PUT 200', put.status === 200, String(put.status));
  check('PUT size matches', putJson?.data?.size === PNG.length, String(putJson?.data?.size));

  console.log('→ confirm');
  const confirm = await fetch(`${BASE}/api/v1/media/${asset.id}/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth },
  });
  const confirmJson = await confirm.json();
  check('confirm 200 + ready', confirm.status === 200 && confirmJson?.data?.status === 'ready', JSON.stringify(confirmJson).slice(0, 120));
  const url = confirmJson?.data?.url;

  console.log('→ public URL served through /media/local proxy');
  const fetchFile = await fetch(`${BASE}${url}`);
  const fileBuf = Buffer.from(await fetchFile.arrayBuffer());
  check('public URL 200 + bytes match', fetchFile.status === 200 && fileBuf.equals(PNG), `${fetchFile.status} len=${fileBuf.length}`);

  console.log('→ list');
  const list = await fetch(`${BASE}/api/v1/media?limit=10`, { headers: auth });
  const listJson = await list.json();
  const items = Array.isArray(listJson?.data) ? listJson.data : [];
  check('list 200 + contains asset', list.status === 200 && items.some((i) => i.id === asset.id && i.status === 'ready'), `items=${items.length}`);

  console.log('→ category with uploaded image URL (form-facing integration)');
  const cat = await fetch(`${BASE}/api/v1/catalog/admin/categories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ name: 'E2E Media Cat', slug: 'e2e-media-cat', description: 'uploaded-image category', imageUrl: url }),
  });
  const catJson = await cat.json();
  check('category created with imageUrl', cat.status === 201 && catJson?.data?.imageUrl === url, JSON.stringify(catJson).slice(0, 140));

  console.log('→ guards: unauthenticated presign → 401');
  const unauth = await fetch(`${BASE}/api/v1/media/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'x.png', contentType: 'image/png', size: 10, purpose: 'product_image' }),
  });
  check('unauth presign 401', unauth.status === 401);

  console.log('→ guards: bad extension → 400 MEDIA_TYPE_NOT_ALLOWED');
  const badExt = await fetch(`${BASE}/api/v1/media/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ filename: 'evil.exe', contentType: 'application/octet-stream', size: 100, purpose: 'product_image' }),
  });
  const badJson = await badJsonP(badExt);
  check('bad ext 400 MEDIA_TYPE_NOT_ALLOWED', badExt.status === 400 && badJson?.code === 'MEDIA_TYPE_NOT_ALLOWED', JSON.stringify(badJson));

  console.log(`\nmedia-e2e-proxy: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
const badJsonP = async (r) => r.json().catch(() => ({}));
main().catch((e) => { console.error(e); process.exit(1); });
