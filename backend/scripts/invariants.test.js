/**
 * invariants.test.js — repo-wide static invariants. No database, no network.
 *
 *   node scripts/invariants.test.js
 *
 * These are the "this class of bug can never come back" gates. Each one exists
 * because the bug it checks for was actually found in this codebase:
 *
 *  1. ORPHAN AUDIT ACTIONS — `auditService.record({action:'x'})` where 'x' is
 *     not in the AUDIT_ACTION enum. The Mongoose enum rejects the write and
 *     every call site swallows it with `.catch(() => {})`, so the audit record
 *     silently never exists. Found: 14 of them, including every billing event
 *     (invoice_generated / invoice_paid / invoice_void / plan_change).
 *
 *  2. MISSING IMPORTS — a helper used but never imported or defined. ESM only
 *     fails at call time, so an untested route 500s in production.
 *     Found: `serializeList` in wallet.service.ledger().
 *
 *  3. FRONTEND↔BACKEND CONTRACT DRIFT — an endpoint the shared client calls
 *     that no Express route serves. Found: adminInvoiceDetail →
 *     GET /marketplace/admin/billing/invoices/:id.
 *
 *  4. LEDGER ACCOUNT SAFETY — every account code the posting service can emit
 *     must have a known type, or `post()` throws at runtime instead of at boot.
 *
 *  5. ENV DOCUMENTATION — every `process.env.X` read in the codebase must be
 *     documented in .env.example. Found: 25 of 51 undocumented, including the
 *     entire S3/storage, notification, export and marketplace surfaces — so a
 *     deploy from .env.example silently ran on local-disk storage and default
 *     commission rates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? `\n       ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

function jsFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const rel = (p) => path.relative(REPO, p);

// ---------------------------------------------------------------------------
section('1. audit actions are all declared in the AUDIT_ACTION enum');
// ---------------------------------------------------------------------------
{
  const { AUDIT_ACTION } = await import('../src/constants/enums.js');
  const allowed = new Set(Object.values(AUDIT_ACTION));
  const orphans = new Map();

  const scanned = [...jsFiles(path.join(BACKEND, 'src')), ...jsFiles(path.join(BACKEND, 'scripts'))]
    .filter((f) => !f.endsWith('invariants.test.js')); // this file documents the bug shape
  for (const f of scanned) {
    const src = fs.readFileSync(f, 'utf8');
    // `action: 'foo'` — the shape auditService.record() takes
    for (const m of src.matchAll(/\baction:\s*'([a-z_]+)'/g)) {
      if (!allowed.has(m[1])) {
        if (!orphans.has(m[1])) orphans.set(m[1], new Set());
        orphans.get(m[1]).add(rel(f));
      }
    }
  }

  check(
    'no audit action is written that the model would reject',
    orphans.size === 0,
    [...orphans.entries()].map(([a, files]) => `'${a}' in ${[...files].join(', ')}`).join('\n       ')
  );
}

// ---------------------------------------------------------------------------
section('2. no helper is used without being imported or defined');
// ---------------------------------------------------------------------------
{
  const HELPERS = [
    'serializeList', 'serializeDoc', 'roundMoney', 'moneySum', 'toPaise', 'fromPaise',
    'sumPaise', 'allocatePaise', 'splitTaxPaise', 'applyBps',
    'notFound', 'badRequest', 'conflict', 'forbidden', 'unauthorized', 'tooMany',
    'asyncHandler', 'success', 'created', 'slugify', 'generateOpaqueToken',
  ];
  const offenders = [];

  for (const f of jsFiles(path.join(BACKEND, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');

    const imported = new Set();
    for (const m of src.matchAll(/import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}|(\w+))\s+from/g)) {
      if (m[1]) imported.add(m[1]);
      if (m[3]) imported.add(m[3]);
      if (m[2]) for (const part of m[2].split(',')) imported.add(part.trim().split(/\s+as\s+/).pop());
    }
    // dynamic: const { badRequest } = await import(...)  |  const x = await import(...)
    for (const m of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:await\s+import|require)/g)) {
      for (const part of m[1].split(',')) imported.add(part.trim().split(':').pop().trim());
    }
    // any local binding at all (function, const, let, destructured, class method)
    const local = new Set();
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) local.add(m[1]);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g)) local.add(m[1]);
    for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
      for (const part of m[1].split(',')) local.add(part.trim().split(':').pop().trim());
    }

    for (const h of HELPERS) {
      const used = new RegExp(`(?<![\\w.$])${h}\\s*\\(`).test(src);
      if (used && !imported.has(h) && !local.has(h)) offenders.push(`${h}() in ${rel(f)}`);
    }
  }

  check('every helper call resolves to an import or a local binding', offenders.length === 0, offenders.join('\n       '));
}

// ---------------------------------------------------------------------------
section('3. the shared API client matches the Express route table');
// ---------------------------------------------------------------------------
{
  const endpointsPath = path.join(REPO, 'frontend/packages/shared/src/api/endpoints.js');
  if (!fs.existsSync(endpointsPath)) {
    console.log('  ⏭  frontend package not present — contract check skipped');
  } else {
    const idx = fs.readFileSync(path.join(BACKEND, 'src/routes/index.js'), 'utf8');
    const mounts = {};
    const imports = {};
    for (const m of idx.matchAll(/apiRouter\.use\('([^']+)',\s*(\w+)\)/g)) mounts[m[2]] = m[1];
    for (const m of idx.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w.]+)\.js'/g)) imports[m[1]] = m[2];

    const routes = new Set(['GET /health']);
    for (const [varName, prefix] of Object.entries(mounts)) {
      const file = path.join(BACKEND, 'src/routes', `${imports[varName]}.js`);
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const r of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']*)'/g)) {
        routes.add(`${r[1].toUpperCase()} ${prefix}${r[2] === '/' ? '' : r[2]}`);
      }
    }

    const norm = (s) => s.replace(/:[A-Za-z_]+/g, ':x').replace(/\/$/, '');
    const backend = new Set([...routes].map(norm));

    const fe = fs.readFileSync(endpointsPath, 'utf8');
    const calls = [...fe.matchAll(/c\.(get|post|patch|put|del)\(\s*(`[^`]*`|'[^']*')/g)].map((m) => {
      const method = m[1] === 'del' ? 'DELETE' : m[1].toUpperCase();
      const p = m[2].slice(1, -1).replace(/\$\{[^}]+\}/g, ':x');
      return `${method} ${p}`;
    });

    const missing = [...new Set(calls.filter((c) => !backend.has(norm(c))))];
    check(
      `all ${calls.length} shared-client calls hit a real route (${backend.size} routes)`,
      missing.length === 0,
      missing.join('\n       ')
    );
  }
}

// ---------------------------------------------------------------------------
section('4. every ledger account code has a declared type');
// ---------------------------------------------------------------------------
{
  const { ledgerAccounts, accountTypeFor } = await import('../src/services/ledger.service.js');
  const sample = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const codes = Object.entries(ledgerAccounts).map(([name, fn]) => [name, fn(sample)]);
  const bad = [];
  for (const [name, code] of codes) {
    try { accountTypeFor(code); } catch { bad.push(`${name} → ${code}`); }
  }
  check(`all ${codes.length} account builders produce a typed account`, bad.length === 0, bad.join(', '));

  const { default: ledgerService } = await import('../src/services/ledger.service.js');
  check('ledgerService exposes the full posting API',
    ['post', 'reverseProportional', 'balance', 'statement', 'verifyBalances', 'trialBalance', 'ensureChartOfAccounts']
      .every((m) => typeof ledgerService[m] === 'function'));
}

// ---------------------------------------------------------------------------
section('5. every env var read in code is documented in .env.example');
// ---------------------------------------------------------------------------
{
  const examplePath = path.join(BACKEND, '.env.example');
  const example = fs.readFileSync(examplePath, 'utf8');
  const documented = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));

  const read = new Map();
  const envScanned = [...jsFiles(path.join(BACKEND, 'src')), ...jsFiles(path.join(BACKEND, 'scripts'))]
    .filter((f) => !f.endsWith('invariants.test.js')); // this file documents the pattern
  for (const f of envScanned) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!read.has(m[1])) read.set(m[1], new Set());
      read.get(m[1]).add(rel(f));
    }
  }

  const undocumented = [...read.keys()].filter((k) => !documented.has(k)).sort();
  check(
    `all ${read.size} env vars read in code are documented (.env.example declares ${documented.size})`,
    undocumented.length === 0,
    undocumented.map((k) => `${k} ← ${[...read.get(k)].join(', ')}`).join('\n       ')
  );

  // Documented-but-unread is a warning, not a failure: a variable may be
  // consumed by infrastructure (docker-compose, the process manager) rather
  // than by application code.
  const unread = [...documented].filter((k) => !read.has(k)).sort();
  if (unread.length) console.log(`  ℹ️  documented but not read by app code: ${unread.join(', ')}`);

  // A secret containing '#' must be quoted or dotenv truncates it silently.
  const risky = [...example.matchAll(/^([A-Z0-9_]+)=([^"'\s][^\s]*#[^\s]*)$/gm)].map((m) => m[1]);
  check('no unquoted value contains a # (dotenv would truncate it)', risky.length === 0, risky.join(', '));
}

// ---------------------------------------------------------------------------
section('6. financial write paths are role-guarded');
// ---------------------------------------------------------------------------
{
  const mustGuard = [
    ['src/routes/catalog.tenant.routes.js', 'price/stock writes'],
    ['src/routes/media.routes.js', 'uploads'],
    ['src/routes/admin.routes.js', 'admin surface'],
  ];
  const unguarded = [];
  for (const [file, what] of mustGuard) {
    const src = fs.readFileSync(path.join(BACKEND, file), 'utf8');
    if (!/authorize\s*\(/.test(src)) unguarded.push(`${file} (${what})`);
  }
  check('sensitive routers all apply authorize()', unguarded.length === 0, unguarded.join(', '));
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`invariants: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ all repo invariants hold\n');
