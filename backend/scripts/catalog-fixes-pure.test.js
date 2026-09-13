/**
 * Pure unit tests for the F-01..F-20 catalog fixes — NO Mongo required.
 *
 * Covers the highest-risk new logic in isolation:
 *   regex.js            — literal search patterns (F-10)
 *   optimisticLock      — version-gated atomic updates (F-02)
 *   fieldOwnership      — global-patch whitelist (F-03)
 *   responseCache       — per-user keying + write invalidation (F-01)
 *   deduplicate         — tenant/user-scoped keys, POST-only fingerprint (F-18)
 *   category.service    — isAncestorOrSelf + legacy-cycle tolerance (F-08)
 *   authenticate        — live-role RBAC (F-17)
 *   csv utils           — round-trip (F-14)
 *   catalogEvent        — backoff curve
 *
 * Run: node scripts/catalog-fixes-pure.test.js
 */
import './test-env-guard.js';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = '';
process.env.DEFAULT_TENANT_ID = '';

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

// ---------------- shared fakes ----------------
function fakeRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    _jsonBody: null,
    set(k, v) { this._headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return this._headers[String(k).toLowerCase()]; },
    status(v) { this.statusCode = v; return this; },
    json(body) { this._jsonBody = body; return this; },
    on() { return this; },
  };
  return res;
}

console.log('\n[regex] escapeRegExp / literalRegex (F-10)');

const { escapeRegExp, literalRegex } = await import('../src/utils/regex.js');

await test('escapes every regex metacharacter', () => {
  const escaped = escapeRegExp('.^$*+?()[]{}|\\');
  // every metachar must be preceded by a backslash in the output
  for (const ch of ['^', '$', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']) {
    const idx = escaped.indexOf(ch);
    assert.ok(idx > 0, `metachar ${ch} missing`);
    assert.equal(escaped[idx - 1], '\\', `metachar ${ch} not escaped in "${escaped}"`);
  }
});

await test('literalRegex matches only the literal text (case-insensitive)', () => {
  const rx = literalRegex('roses (10+)*');
  assert.ok(rx.test('Red roses (10+)* bouquet'));
  assert.ok(rx.test('ROSES (10+)*'));
  assert.ok(!rx.test('roses (10)* plus')); // metachars are literal: (10+)* must appear verbatim
});

await test('hostile patterns cannot throw or match broadly', () => {
  for (const p of ['(', '(a+)+', '[', '\\', '*', '.*', '^x$', 'a|b', '$$$', '()()()', '%']) {
    const rx = literalRegex(p);
    assert.doesNotThrow(() => rx.test('anything (a+)+ [ ] \\ * %'));
  }
  assert.ok(!literalRegex('a|b').test('x|y'));
  assert.ok(literalRegex('a|b').test('has a|b inside'));
  assert.ok(!literalRegex('^x$').test('x in the middle'));
});

console.log('\n[optimisticLock] updateWithVersion (F-02)');

const { default: mongoose } = await import('mongoose');
const { default: updateWithVersion } = await import('../src/utils/catalog/optimisticLock.js');

function makeModelStub(initial) {
  const M = mongoose.model(
    `LockTest${Math.random().toString(36).slice(2, 8)}`,
    new mongoose.Schema({ name: String, price: Number, version: { type: Number, default: 1 } })
  );
  const dbState = { ...initial, _id: new mongoose.Types.ObjectId() };
  let updateCalls = 0;
  M.__db = () => dbState;
  M.__updateCalls = () => updateCalls;
  M.__setVersion = (v) => { dbState.version = v; };
  M.updateOne = async (filter, update) => {
    updateCalls += 1;
    const match = filter.version === undefined || filter.version === dbState.version;
    if (match) Object.assign(dbState, update.$set || {});
    return { matchedCount: match ? 1 : 0, modifiedCount: match ? 1 : 0 };
  };
  // used by the 409 re-sync path — no connection in unit tests
  M.findById = async (id) => {
    const s = M.__db();
    return id && String(s._id) === String(id) ? { ...s } : null;
  };
  return M;
}

await test('successful update applies the patch and bumps version atomically', async () => {
  const M = makeModelStub({ name: 'A', price: 10, version: 1 });
  const doc = new M({ name: 'A', price: 10, version: 1 });
  doc._id = M.__db()._id;
  await updateWithVersion(doc, 1, { price: 20 });
  assert.equal(M.__db().price, 20);
  assert.equal(M.__db().version, 2);
  assert.equal(M.__updateCalls(), 1);
  assert.ok(!doc.isModified(), 'doc must be marked clean after a successful atomic update');
});

await test('fast-path stale version 409s WITHOUT touching the database', async () => {
  const M = makeModelStub({ name: 'A', price: 10, version: 5 });
  const doc = new M({ name: 'A', price: 10, version: 4 });
  doc._id = M.__db()._id;
  await assert.rejects(
    () => updateWithVersion(doc, 5, { price: 20 }), // doc says 4, caller claims 5
    (e) => e.code === 'VERSION_CONFLICT' && e.status === 409
  );
  assert.equal(M.__updateCalls(), 0, 'fast-path mismatch must not issue a DB write');
  assert.equal(M.__db().price, 10);
});

await test('slow path: doc and caller agree but DB drifted → atomic 409', async () => {
  const M = makeModelStub({ name: 'A', price: 10, version: 1 });
  const doc = new M({ name: 'A', price: 10, version: 1 });
  doc._id = M.__db()._id;
  M.__setVersion(9); // another writer committed while we held the doc
  await assert.rejects(
    () => updateWithVersion(doc, 1, { price: 20 }),
    (e) => e.code === 'VERSION_CONFLICT' && e.status === 409
  );
  assert.equal(M.__updateCalls(), 1, 'the conditional write was attempted and matched 0 rows');
  assert.equal(M.__db().price, 10);
});

await test('concurrent same-version writers: one wins, the other 409s', async () => {
  const M = makeModelStub({ name: 'A', price: 10, version: 1 });
  const mkDoc = () => { const d = new M({ name: 'A', price: 10, version: 1 }); d._id = M.__db()._id; return d; };
  const results = await Promise.allSettled([
    updateWithVersion(mkDoc(), 1, { price: 11 }),
    updateWithVersion(mkDoc(), 1, { price: 22 }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const conflict = results.filter((r) => r.status === 'rejected' && r.reason.code === 'VERSION_CONFLICT').length;
  assert.equal(ok + conflict, 2, JSON.stringify(results.map((r) => r.status)));
  assert.ok(ok >= 1 && conflict >= 1, 'exactly one writer may win');
  assert.equal(M.__db().version, 2, 'version must bump exactly once');
});

await test('empty patch still bumps the version (lock heartbeat)', async () => {
  const M = makeModelStub({ name: 'A', price: 10, version: 7 });
  const doc = new M({ name: 'A', price: 10, version: 7 });
  doc._id = M.__db()._id;
  await updateWithVersion(doc, 7, {});
  assert.equal(M.__db().version, 8);
});

console.log('\n[fieldOwnership] whitelistMasterPatch (F-03)');

const { whitelistMasterPatch } = await import('../src/utils/catalog/fieldOwnership.js');

await test('keeps only central-owned global fields; smuggled keys are refused', () => {
  const { clean, dropped } = whitelistMasterPatch({
    title: 'T', description: 'D', barcode: 'BC', categoryId: 'c1',
    // smuggled: lifecycle, ownership, tenant-level, and identity fields
    status: 'deprecated', version: 999, soldCount: 42,
    price: { mrp: 1 }, stockQty: 5, slug: 'slug-attack',
    skuGlobal: 'SKU-1', images: ['u'], tenantId: 'evil',
  });
  assert.deepEqual(Object.keys(clean).sort(), ['barcode', 'categoryId', 'description', 'title']);
  assert.ok(dropped.includes('status') && dropped.includes('version') && dropped.includes('soldCount'));
  assert.ok(dropped.includes('price') && dropped.includes('slug') && dropped.includes('tenantId'));
  assert.equal(clean.status, undefined, 'lifecycle fields must never apply from an approved diff');
});

await test('null/undefined/status-only input -> empty clean patch', () => {
  assert.deepEqual(whitelistMasterPatch(null), { clean: {}, dropped: [] });
  assert.deepEqual(whitelistMasterPatch(undefined), { clean: {}, dropped: [] });
  assert.deepEqual(whitelistMasterPatch({ status: 'active', version: 3 }), {
    clean: {}, dropped: ['status', 'version'],
  });
});

console.log('\n[responseCache] per-user keying + write invalidation (F-01)');

const { localEmit, LOCAL_EVENTS } = await import('../src/utils/localEvents.js');
const { responseCache, invalidateAll } = await import('../src/middleware/responseCache.js');
const mwCache = responseCache({});

function cacheCall(headers, url, tenantId = 't1', handler = null) {
  const res = fakeRes();
  mwCache(
    {
      method: 'GET',
      path: url,
      originalUrl: url,
      tenantId,
      headers: { host: 'shop.test', ...headers },
      get: (k) => headers[k.toLowerCase()] ?? null,
    },
    res,
    () => {
      if (handler) handler(res);
      res.json({ served: (res._headers['x-marker'] || 'fresh') });
    }
  );
  return res;
}

await test('different users (Authorization) get SEPARATE entries — no leak', () => {
  invalidateAll();
  const r1 = cacheCall({ authorization: 'Bearer A' }, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'A'));
  const r2 = cacheCall({ authorization: 'Bearer B' }, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'B'));
  let handlerRanOnHit = false;
  const r1again = cacheCall({ authorization: 'Bearer A' }, '/api/v1/catalog', 't1', () => { handlerRanOnHit = true; });

  assert.equal(r1.getHeader('x-cache'), 'MISS');
  assert.equal(r2.getHeader('x-cache'), 'MISS', 'user B must get their own fresh response');
  assert.equal(r2._jsonBody.served, 'B', 'user B must have received B\'s data, not A\'s');
  assert.equal(r1again.getHeader('x-cache'), 'HIT');
  assert.equal(handlerRanOnHit, false, 'handler must not run on a cache hit');
  assert.deepEqual(r1again._jsonBody, { served: 'A' }, 'user A must replay user A\'s response, not B\'s');
});

await test('anonymous and authenticated views are separate', () => {
  invalidateAll();
  const rAnon = cacheCall({}, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'anon'));
  const rAuth = cacheCall({ authorization: 'Bearer X' }, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'auth'));
  assert.equal(rAnon._jsonBody.served, 'anon');
  assert.equal(rAuth._jsonBody.served, 'auth', 'authenticated view must be computed independently of the anonymous cache entry');
});

await test('catalog write event invalidates the cache', () => {
  invalidateAll();
  const before = cacheCall({}, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'before'));
  assert.equal(before.getHeader('x-cache'), 'MISS');
  localEmit(LOCAL_EVENTS.CATALOG_WRITE, { tenantId: 't1' });
  const after = cacheCall({}, '/api/v1/catalog', 't1', (res) => res.set('x-marker', 'after'));
  assert.equal(after._jsonBody.served, 'after', 'cache must be empty after the write event');
});

await test('authenticated/admin/tenant paths are NEVER cached (allowlist)', () => {
  invalidateAll();
  const adminPath = '/api/v1/catalog/admin/categories';
  const tenantPath = '/api/v1/catalog/tenant/listings';
  const userPath = '/api/v1/users/me';
  for (const p of [adminPath, tenantPath, userPath]) {
    const resA = cacheCall({ authorization: 'Bearer Z' }, p, 't1', (res2) => res2.set('x-marker', 'once'));
    const resB = cacheCall({ authorization: 'Bearer Z' }, p, 't1', (res2) => res2.set('x-marker', 'twice'));
    assert.equal(resA.getHeader('x-cache'), undefined, `${p} must not be cached at all (no X-Cache header)`);
    assert.equal(resB.getHeader('x-cache'), undefined, `${p} second call must also bypass the cache`);
    assert.equal(resB._jsonBody.served, 'twice', 'the handler must run every time');
  }
  // public paths still cache
  const pub = cacheCall({ authorization: 'Bearer Z' }, '/api/v1/catalog', 't1', (res2) => res2.set('x-marker', 'pub'));
  const pub2 = cacheCall({ authorization: 'Bearer Z' }, '/api/v1/catalog', 't1');
  assert.equal(pub.getHeader('x-cache'), 'MISS');
  assert.equal(pub2.getHeader('x-cache'), 'HIT', 'public catalog must still be cached');
});

await test('non-2xx responses are not cached', () => {
  invalidateAll();
  const res = fakeRes();
  mwCache(
    { method: 'GET', path: '/api/v1/catalog/err', originalUrl: '/api/v1/catalog/err', tenantId: 't1', headers: { host: 'h' }, get: () => null },
    res,
    () => { res.statusCode = 500; res.json({ err: true }); }
  );
  const res2 = fakeRes();
  mwCache(
    { method: 'GET', path: '/api/v1/catalog/err', originalUrl: '/api/v1/catalog/err', tenantId: 't1', headers: { host: 'h' }, get: () => null },
    res2,
    () => res2.json({ served: 'again' })
  );
  assert.equal(res2._jsonBody.served, 'again', '500 must not be cached');
});

console.log('\n[deduplicate] scoping rules (F-18)');

const { deduplicate } = await import('../src/middleware/deduplicate.js');
const mwDedup = deduplicate();

function dedupCall({ method = 'POST', tenantHeader, auth, path = '/api/v1/x', body, idemKey, host = 'shop.test' }, runNext) {
  const res = fakeRes();
  const req = {
    method,
    path,
    originalUrl: path,
    body: body ?? {},
    headers: {
      host,
      'content-type': 'application/json',
      ...(tenantHeader ? { 'x-tenant-id': tenantHeader } : {}),
      ...(auth ? { authorization: auth } : {}),
      ...(idemKey ? { 'idempotency-key': idemKey } : {}),
    },
    get: (k) => req.headers[k.toLowerCase()] ?? null,
  };
  mwDedup(req, res, () => {
    if (runNext) runNext(res);
    res.json({ ok: true, fresh: true });
  });
  return res;
}

await test('same user+tenant+identical POST body: second call is deduped', () => {
  const r1 = dedupCall({ tenantHeader: 't1', auth: 'Bearer u1', body: { skuGlobal: 'DUP-1' } });
  const r2 = dedupCall({ tenantHeader: 't1', auth: 'Bearer u1', body: { skuGlobal: 'DUP-1' } });
  assert.equal(r1.getHeader('x-dedup-cached'), undefined, 'first call is fresh');
  assert.equal(r2.getHeader('x-dedup-cached'), 'true', 'second call must be a replay');
  assert.ok(r2.getHeader('x-dedup-key'));
});

await test('DIFFERENT tenants with identical body are NOT deduped', () => {
  dedupCall({ tenantHeader: 'tA', auth: 'Bearer uA', body: { skuGlobal: 'X-TENANT' } });
  const r2 = dedupCall({ tenantHeader: 'tB', auth: 'Bearer uB', body: { skuGlobal: 'X-TENANT' } });
  assert.equal(r2.getHeader('x-dedup-cached'), undefined, 'tenant B must not replay tenant A\'s response');
});

await test('DIFFERENT users of the same tenant are NOT deduped', () => {
  dedupCall({ tenantHeader: 't1', auth: 'Bearer uA', body: { skuGlobal: 'U-ISO' } });
  const r2 = dedupCall({ tenantHeader: 't1', auth: 'Bearer uB', body: { skuGlobal: 'U-ISO' } });
  assert.equal(r2.getHeader('x-dedup-cached'), undefined, 'user B must not replay user A\'s response');
});

await test('PUT is NOT auto-fingerprinted (identical PUTs both execute)', () => {
  dedupCall({ method: 'PUT', tenantHeader: 't1', auth: 'Bearer u1', body: { title: 'same' } });
  const r2 = dedupCall({ method: 'PUT', tenantHeader: 't1', auth: 'Bearer u1', body: { title: 'same' } });
  assert.equal(r2.getHeader('x-dedup-cached'), undefined, 'PUT must not be deduped');
  assert.equal(r2.getHeader('x-dedup-key'), undefined);
});

await test('PATCH is NOT auto-fingerprinted (repeatable adjustments)', () => {
  dedupCall({ method: 'PATCH', tenantHeader: 't1', auth: 'Bearer u1', body: { delta: 10 } });
  const r2 = dedupCall({ method: 'PATCH', tenantHeader: 't1', auth: 'Bearer u1', body: { delta: 10 } });
  assert.equal(r2.getHeader('x-dedup-cached'), undefined, 'PATCH adjust must not be deduped');
});

await test('explicit Idempotency-Key on PUT IS honored', () => {
  dedupCall({ method: 'PUT', tenantHeader: 't1', auth: 'Bearer u1', idemKey: 'K-1', body: { title: 'same' } });
  const r2 = dedupCall({ method: 'PUT', tenantHeader: 't1', auth: 'Bearer u1', idemKey: 'K-1', body: { title: 'same' } });
  assert.equal(r2.getHeader('x-dedup-cached'), 'true');
});

await test('GET is untouched', () => {
  const r = dedupCall({ method: 'GET', tenantHeader: 't1', auth: 'Bearer u1' });
  assert.equal(r.getHeader('x-dedup-cached'), undefined);
  assert.equal(r.getHeader('x-dedup-key'), undefined);
});

console.log('\n[category] isAncestorOrSelf + legacy cycle tolerance (F-08)');

const { default: Category } = await import('../src/models/category.model.js');
const { default: categoryService } = await import('../src/services/category.service.js');

function wireCategory(rows) {
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const origFindById = Category.findById;
  const origFind = Category.find;
  Category.findById = (id) => {
    const row = byId.get(String(id)) || null;
    return {
      select: () => ({
        lean: async () => (row ? { _id: row._id, parentId: row.parentId || null } : null),
      }),
    };
  };
  Category.find = () => ({
    sort: () => ({ lean: async () => rows }),
  });
  return () => { Category.findById = origFindById; Category.find = origFind; };
}

await test('isAncestorOrSelf walks up: parent + grandparent are ancestors', async () => {
  const restore = wireCategory([
    { _id: 'root', parentId: null },
    { _id: 'mid', parentId: 'root' },
    { _id: 'leaf', parentId: 'mid' },
    { _id: 'sibling', parentId: 'root' },
  ]);
  try {
    assert.equal(await categoryService.isAncestorOrSelf('leaf', 'mid'), true);
    assert.equal(await categoryService.isAncestorOrSelf('leaf', 'root'), true);
    assert.equal(await categoryService.isAncestorOrSelf('leaf', 'leaf'), true);
    assert.equal(await categoryService.isAncestorOrSelf('leaf', 'sibling'), false);
    assert.equal(await categoryService.isAncestorOrSelf('root', 'leaf'), false);
    assert.equal(await categoryService.isAncestorOrSelf('leaf', 'missing'), false);
  } finally { restore(); }
});

await test('isAncestorOrSelf survives a LEGACY cycle (A->B->C->A) without hanging', async () => {
  const restore = wireCategory([
    { _id: 'A', parentId: 'C' },
    { _id: 'B', parentId: 'A' },
    { _id: 'C', parentId: 'B' },
    { _id: 'outside', parentId: null },
  ]);
  try {
    await assert.doesNotReject(async () => {
      // inside a cycle every node is an ancestor of every other — the
      // conservative answer is "yes" (moves between them stay rejected),
      // but the walk MUST terminate.
      assert.equal(await categoryService.isAncestorOrSelf('A', 'B'), true);
      assert.equal(await categoryService.isAncestorOrSelf('B', 'C'), true);
      // a node outside the cycle is correctly not an ancestor
      assert.equal(await categoryService.isAncestorOrSelf('A', 'outside'), false);
    });
  } finally { restore(); }
});

await test('tree() with a legacy cycle terminates and keeps the healthy roots', async () => {
  const restore = wireCategory([
    { _id: 'root1', parentId: null, name: 'R1', status: 'active' },
    { _id: 'kid', parentId: 'root1', name: 'K', status: 'active' },
    { _id: 'A', parentId: 'C', name: 'A', status: 'active' },
    { _id: 'B', parentId: 'A', name: 'B', status: 'active' },
    { _id: 'C', parentId: 'B', name: 'C', status: 'active' },
  ]);
  try {
    const tree = await categoryService.tree({ includeInactive: false });
    assert.ok(Array.isArray(tree));
    const names = tree.map((c) => c.name);
    assert.ok(names.includes('R1'), 'healthy root must survive');
    assert.ok(!names.includes('A') && !names.includes('B') && !names.includes('C'), 'cycle branch is unreachable from roots — and nothing hung');
    const kid = tree[0].children.find((c) => c.name === 'K');
    assert.ok(kid, 'children of healthy roots must still attach');
  } finally { restore(); }
});

console.log('\n[authenticate] live-role RBAC (F-17)');

await test('role comes from the LIVE user doc; demotion applies next request', async () => {
  const { default: TokenService } = await import('../src/utils/jwt.js');
  const { default: User } = await import('../src/models/user.model.js');
  const { authenticate } = await import('../src/middleware/authenticate.js');

  const token = TokenService.signAccessToken({ userId: 'user-xyz', tenantId: 't1', role: 'admin' });
  const origFindById = User.findById;
  let liveUser = { status: 'active', isDeleted: false, role: 'admin' };
  User.findById = () => ({
    select: async () => liveUser,
  });

  const makeReq = () => ({
    headers: { authorization: `Bearer ${token}` },
    tenantId: 't1',
    socket: { remoteAddress: '1.1.1.1' },
    query: {},
  });
  const run = () => new Promise((resolve, reject) => {
    const req = makeReq();
    authenticate(req, { setHeader() {}, statusCode: 0 }, (err) => {
      if (err) return reject(err);
      resolve(req.auth);
    });
  });

  try {
    const auth1 = await run();
    assert.equal(auth1.role, 'admin');

    liveUser = { status: 'active', isDeleted: false, role: 'customer' };
    const auth2 = await run();
    assert.equal(auth2.role, 'customer', 'demotion must apply on the very next request, not at token expiry');

    // a user doc without a role field falls back to the token claim
    liveUser = { status: 'active', isDeleted: false };
    const auth3 = await run();
    assert.equal(auth3.role, 'admin', 'fallback to token claim when doc has no role');

    // deleted account -> 401 even with a syntactically valid token
    User.findById = () => ({ select: async () => null });
    await assert.rejects(run(), (e) => e.status === 401);

    // blocked account -> 401
    User.findById = () => ({ select: async () => ({ status: 'blocked', isDeleted: false, role: 'admin' }) });
    await assert.rejects(run(), (e) => e.status === 401);
  } finally {
    User.findById = origFindById;
  }
});

console.log('\n[csv] round-trip (F-14)');

const { parseCSV, toCSV } = await import('../src/utils/catalog/csv.js');

await test('toCSV/parseCSV round-trips quotes, commas, empty cells', () => {
  const rows = [
    { sku: 'ROS-1', title: 'Roses, "red"', price: '399' },
    { sku: 'ROS-2', title: 'plain', price: '' },
  ];
  const text = toCSV(rows, ['sku', 'title', 'price']);
  const back = parseCSV(text);
  assert.deepEqual(back, rows);
});

await test('parseCSV handles CRLF, BOM and trailing newline', () => {
  const text = '\uFEFFa,b,c\r\n1,2,3\r\n\r\n';
  const back = parseCSV(text);
  // trailing blank line should not yield a phantom data row
  assert.ok(Array.isArray(back));
  const data = back.filter((r) => r.a === '1');
  assert.equal(data.length, 1);
  assert.equal(data[0].b, '2');
});

console.log('\n[inventory] bumpSoldCount (F-19)');

const { default: inventoryService } = await import('../src/services/inventory.service.js');
const { default: ProductMaster } = await import('../src/models/productMaster.model.js');

await test('commit bumps soldCount +qty; restore undoes it; failures never propagate', async () => {
  const origUpdateOne = ProductMaster.updateOne;
  const calls = [];
  ProductMaster.updateOne = async (filter, update) => { calls.push({ filter, update }); return { matchedCount: 1 }; };
  try {
    const listing = { productMasterId: 'm1' };
    await inventoryService.bumpSoldCount(listing, 3, 1);
    await inventoryService.bumpSoldCount(listing, 3, -1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].update, { $inc: { soldCount: 3 } });
    assert.deepEqual(calls[1].update, { $inc: { soldCount: -3 } });
    assert.equal(String(calls[0].filter._id), 'm1');

    // no-op guards: missing master id / bad qty
    await inventoryService.bumpSoldCount({}, 3, 1);
    await inventoryService.bumpSoldCount(listing, 0, 1);
    await inventoryService.bumpSoldCount(listing, 1.5, 1);
    assert.equal(calls.length, 2, 'invalid inputs must not write');

    // a failed write (ranking hint) must NOT throw
    ProductMaster.updateOne = async () => { throw new Error('db down'); };
    await assert.doesNotReject(() => inventoryService.bumpSoldCount(listing, 2, 1));
  } finally {
    ProductMaster.updateOne = origUpdateOne;
  }
});

console.log('\n[tenantProduct] assertActivatable gates (F-05)');

const { default: tenantProductService } = await import('../src/services/tenantProduct.service.js');

await test('activation requires a valid price AND an ACTIVE master', () => {
  const activeMaster = { status: 'active' };
  const pendingMaster = { status: 'pending_review' };
  const priced = { price: { sellingPrice: 100 } };
  const priceless = { price: {} };

  // sync method: throws (doesn't reject)
  assert.doesNotThrow(() => tenantProductService.assertActivatable({ listing: priced, master: activeMaster }));
  assert.throws(
    () => tenantProductService.assertActivatable({ listing: priceless, master: activeMaster }),
    (e) => e.code === 'PRICE_REQUIRED' && e.status === 400
  );
  assert.throws(
    () => tenantProductService.assertActivatable({ listing: { price: { sellingPrice: -1 } }, master: activeMaster }),
    (e) => e.code === 'PRICE_REQUIRED'
  );
  assert.throws(
    () => tenantProductService.assertActivatable({ listing: priced, master: pendingMaster }),
    (e) => e.code === 'MASTER_NOT_ACTIVE' && e.status === 409
  );
  assert.throws(
    () => tenantProductService.assertActivatable({ listing: priced, master: null }),
    (e) => e.code === 'MASTER_NOT_ACTIVE'
  );
});

console.log('\n[inventory] atomic stock guards (F-11)');

const { default: Inventory } = await import('../src/models/inventory.model.js');
const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');

function stockHarness({ qtyOnHand = 10, rowExists = true } = {}) {
  const calls = [];
  const origInv = { findOneAndUpdate: Inventory.findOneAndUpdate, exists: Inventory.exists };
  const origTp = { findOne: TenantProduct.findOne, updateOne: TenantProduct.updateOne };
  const origRefresh = inventoryService.refreshListingStock;
  const origLogOp = inventoryService.logOp;
  Inventory.findOneAndUpdate = async (filter, update, opts) => {
    calls.push({ filter, update, opts });
    // emulate Mongo: an upsert always succeeds (inserts when absent)
    if (!rowExists && opts?.upsert) {
      return { qtyOnHand: (update.$inc?.qtyOnHand || 0), qtyReserved: 0 };
    }
    // non-upsert: match when the row exists AND any $expr guard holds
    if (!rowExists) return null;
    const guard = filter.$expr;
    let ok = true;
    if (guard) {
      const gte = guard.$gte;
      if (gte) {
        const [lhs, rhs] = gte;
        const val = lhs.$add[0] === '$qtyOnHand' ? qtyOnHand + lhs.$add[1] : qtyOnHand;
        ok = val >= (typeof rhs === 'number' ? rhs : qtyOnHand);
      }
    }
    if (!ok) return null;
    if (update.$inc) return { qtyOnHand: qtyOnHand + update.$inc.qtyOnHand, qtyReserved: 0 };
    return { qtyOnHand: 0, qtyReserved: 0, ...(update.$set || {}) };
  };
  Inventory.exists = async () => rowExists;
  TenantProduct.findOne = async () => ({ _id: 'listing-1', id: 'listing-1', status: 'active' });
  TenantProduct.updateOne = async () => ({ matchedCount: 1 });
  inventoryService.refreshListingStock = async () => {};
  inventoryService.logOp = async () => {};
  return {
    calls,
    restore: () => {
      Inventory.findOneAndUpdate = origInv.findOneAndUpdate;
      Inventory.exists = origInv.exists;
      TenantProduct.findOne = origTp.findOne;
      TenantProduct.updateOne = origTp.updateOne;
      inventoryService.refreshListingStock = origRefresh;
      inventoryService.logOp = origLogOp;
    },
  };
}

await test('setStock: single upserting write, validated', async () => {
  const h = stockHarness();
  try {
    const row = await inventoryService.setStock({ tenantId: 't', listingId: 'listing-1', qty: 50 });
    assert.equal(row.qtyOnHand, 50);
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].opts?.upsert === true, 'setStock must be a single upserting findOneAndUpdate');
    assert.deepEqual(h.calls[0].update.$set.qtyOnHand, 50);
    await assert.rejects(
      () => inventoryService.setStock({ tenantId: 't', listingId: 'listing-1', qty: -1 }),
      (e) => e.code === 'INVALID_QTY'
    );
  } finally { h.restore(); }
});

await test('adjustStock: floor guard rejects below-zero, missing row + delta>0 upserts', async () => {
  // existing row with 10 on hand: -99999 must fail cleanly
  let h = stockHarness({ qtyOnHand: 10 });
  try {
    await assert.rejects(
      () => inventoryService.adjustStock({ tenantId: 't', listingId: 'listing-1', delta: -99999 }),
      (e) => e.code === 'INVALID_QTY'
    );
  } finally { h.restore(); }

  // missing row + positive delta → one upserting $inc (no 2-step race)
  h = stockHarness({ rowExists: false });
  try {
    const row = await inventoryService.adjustStock({ tenantId: 't', listingId: 'listing-1', delta: 7 });
    assert.ok(row, 'adjustment must succeed via upsert');
    const upserts = h.calls.filter((c) => c.opts?.upsert);
    assert.equal(upserts.length, 1, 'exactly one upserting write');
    assert.deepEqual(upserts[0].update.$inc, { qtyOnHand: 7 });
  } finally { h.restore(); }

  // zero delta is rejected before any DB write
  h = stockHarness();
  try {
    await assert.rejects(
      () => inventoryService.adjustStock({ tenantId: 't', listingId: 'listing-1', delta: 0 }),
      (e) => e.code === 'INVALID_QTY'
    );
    assert.equal(h.calls.length, 0, 'zero delta must not reach the database');
  } finally { h.restore(); }
});

console.log('\n[bulkImport] parsePrice (F-14)');

const { default: bulkImportService } = await import('../src/services/bulkImport.service.js');

await test('parsePrice: valid, empty mrp, and invalid shapes', () => {
  assert.deepEqual(bulkImportService.parsePrice({ selling_price: '45', mrp: '' }), { mrp: null, sellingPrice: 45, currency: 'INR' });
  assert.deepEqual(bulkImportService.parsePrice({ price: 120, mrp: 150 }), { mrp: 150, sellingPrice: 120, currency: 'INR' });
  assert.throws(() => bulkImportService.parsePrice({ selling_price: 'x' }), (e) => e.code === 'PRICE_INVALID');
  assert.throws(() => bulkImportService.parsePrice({ selling_price: '-5' }), (e) => e.code === 'PRICE_INVALID');
  assert.throws(() => bulkImportService.parsePrice({ selling_price: '100', mrp: '50' }), (e) => e.code === 'PRICE_INVALID');
});

console.log('\n[models] F-20 partial unique index declarations');

await test('unique slug/sku indexes are partial on isDeleted:false (soft-delete-aware)', async () => {
  // find the index whose spec EXACTLY equals the given shape (pre-existing
  // non-unique helper indexes on the same keys must not interfere)
  const findIdx = (schema, wantSpec) => schema.indexes().find(([spec]) =>
    JSON.stringify(Object.entries(spec).sort()) === JSON.stringify(Object.entries(wantSpec).sort())
  );
  const assertPartialUnique = (schema, wantSpec, label) => {
    const hit = findIdx(schema, wantSpec);
    assert.ok(hit, `${label}: index ${JSON.stringify(wantSpec)} missing`);
    const [, opts] = hit;
    assert.equal(opts.unique, true, `${label}: must be unique`);
    const f = opts.partialFilterExpression || {};
    const isDeletedFalse = f.isDeleted === false || (f.$and || []).some((c) => c.isDeleted === false);
    assert.ok(isDeletedFalse, `${label}: must be partial on isDeleted:false — got ${JSON.stringify(f)}`);
  };
  assertPartialUnique(ProductMaster.schema, { skuGlobal: 1 }, 'master.skuGlobal');
  assertPartialUnique(ProductMaster.schema, { slug: 1 }, 'master.slug');
  assertPartialUnique(ProductMaster.schema, { barcode: 1 }, 'master.barcode');
  assertPartialUnique((await import('../src/models/category.model.js')).default.schema, { slug: 1 }, 'category.slug');
  assertPartialUnique((await import('../src/models/brand.model.js')).default.schema, { slug: 1 }, 'brand.slug');
  assertPartialUnique((await import('../src/models/productVariant.model.js')).default.schema, { sku: 1 }, 'variant.sku');
  assertPartialUnique((await import('../src/models/productVariant.model.js')).default.schema, { productMasterId: 1, variantType: 1, value: 1 }, 'variant triple');
  assertPartialUnique(TenantProduct.schema, { tenantId: 1, productMasterId: 1, variantId: 1 }, 'listing triple');
});

console.log('\n[catalogEvent] backoff curve');

const { backoffMs } = await import('../src/services/catalogEvent.service.js');

await test('backoff grows with attempts and stays capped (30m max)', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 2 * 60_000);
  assert.equal(backoffMs(3), 10 * 60_000);
  assert.equal(backoffMs(4), 30 * 60_000);
  assert.equal(backoffMs(99), 30 * 60_000, 'ladder must cap at 30m');
});

// ---------------- summary ----------------
console.log(`\n${failed === 0 ? '✅' : '❌'} catalog-fixes-pure: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAILED: ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
process.exit(0);
