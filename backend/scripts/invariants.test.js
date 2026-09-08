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
 *
 *  7. REPLAY COVERAGE — every event kind in DOMAIN_EVENT_JOURNAL_KINDS must
 *     have a `case` in _repostJournal, or the nightly self-heal reports drift it
 *     can never repair.
 *
 *  8. CASH ON DELIVERY WIRING — COD was once offered by the validators and the
 *     storefront with no backend handling: a cash checkout created a gateway
 *     order nobody captured, and the reconciliation sweep cancelled it ~15
 *     minutes later. Ten static links in the chain that must hold.
 *
 *  9. ONE DELIVERY CLOCK — returns.service measured the customer's 7-day window
 *     from paymentSummary.paidAt (into a variable named deliveredAt), charging
 *     customers for transit time and desynchronising the return gate from the
 *     payout gate.
 *
 * 10. HERMETIC SUITE BOOTSTRAP — 22 DB-backed suites each hand-rolled the same
 *     `MongoMemoryServer.create()` / `mongod.stop()` pair, and 7 of them called
 *     stop() unguarded. When the failure happened during create(), `mongod` was
 *     still undefined, so teardown threw a second TypeError that became the LAST
 *     line in the log — masking the real cause twice in one day. All of it now
 *     goes through scripts/lib/hermeticMongo.js.
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
section('7. every money FACT that must have a journal can be replayed');
// ---------------------------------------------------------------------------
// DOMAIN_EVENT_JOURNAL_KINDS is the promise that "if the event exists, the
// journal exists — and if it does not, replay() can rebuild it". A kind in that
// list with no `case` in _repostJournal is a silent hole: findDrift() reports
// the gap, replay() throws, and the nightly self-heal never closes it.
{
  const enums = fs.readFileSync(path.join(BACKEND, 'src/constants/enums.js'), 'utf8');
  const listBlock = enums.match(/export const DOMAIN_EVENT_JOURNAL_KINDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  check('DOMAIN_EVENT_JOURNAL_KINDS is declared', Boolean(listBlock));
  const kinds = [...(listBlock ? listBlock[1] : '').matchAll(/DOMAIN_EVENT_TYPE\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  check('the journal-kind list is not empty', kinds.length > 0, `found ${kinds.length}`);

  const svc = fs.readFileSync(path.join(BACKEND, 'src/services/domainEvent.service.js'), 'utf8');
  const cases = new Set([...svc.matchAll(/case DOMAIN_EVENT_TYPE\.([A-Z0-9_]+)/g)].map((m) => m[1]));
  const unreplayable = kinds.filter((k) => !cases.has(k));
  check(
    `every journal-backed event kind has a _repostJournal case (${kinds.length} kinds)`,
    unreplayable.length === 0,
    `no replay case for: ${unreplayable.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
section('8. cash on delivery is wired end to end');
// ---------------------------------------------------------------------------
// COD was once offered by the validators and the storefront with NO backend
// handling: in production a cash checkout created a gateway order that was
// never captured, and the reconciliation sweep cancelled it ~15 minutes later.
// Each check below is one link in the chain that has to hold for cash to be
// real. They are static because the failure mode is structural, not numerical.
{
  const paymentSvc = fs.readFileSync(path.join(BACKEND, 'src/services/payment.service.js'), 'utf8');
  const orderSvc = fs.readFileSync(path.join(BACKEND, 'src/services/order.service.js'), 'utf8');
  const posting = fs.readFileSync(path.join(BACKEND, 'src/services/ledgerPosting.service.js'), 'utf8');
  const orderModel = fs.readFileSync(path.join(BACKEND, 'src/models/order.model.js'), 'utf8');

  // (a) a distinct state, because 'pending' is what the sweep hunts
  check(
    'AWAITING_COLLECTION exists as its own payment state',
    /AWAITING_COLLECTION:\s*'awaiting_collection'/.test(fs.readFileSync(path.join(BACKEND, 'src/constants/enums.js'), 'utf8')),
  );
  check(
    'order.paymentSummary.status can hold awaiting_collection (or the write throws)',
    /'awaiting_collection'/.test(orderModel),
  );

  // (b) the sweep must only ever look at genuine gateway pendings
  const sweepBlock = paymentSvc.slice(paymentSvc.indexOf('async reconcilePending'));
  const sweepFilter = sweepBlock.slice(0, sweepBlock.indexOf('\n  }'));
  check(
    'reconcilePending filters on PENDING only — never on awaiting_collection',
    /status:\s*PAYMENT_STATUS\.PENDING/.test(sweepFilter) && !/AWAITING_COLLECTION/.test(sweepFilter),
  );

  // (c) COD must short-circuit BEFORE any provider call, or a gateway order is
  //     created for money that will be handed to a rider in notes
  const codBranch = paymentSvc.indexOf('if (isCod) {\n      return { payment, transaction: txn, chargeResult: codChargeResult(payment) };');
  const providerCall = paymentSvc.indexOf('await paymentProvider.charge(');
  check('charge() short-circuits COD before calling any payment provider', codBranch > 0 && providerCall > 0 && codBranch < providerCall);
  check(
    'the COD charge result reports success (so the saga commits stock and slot)',
    /success: true,\s*\n\s*cod: true,/.test(paymentSvc),
  );

  // (d) a cash sale must never claim a PSP is holding the money
  check('a COD sale debits cod_receivable, not gateway_clearing', /codReceivable\(\)/.test(posting) && /isCodPayment/.test(posting));
  check('cod_receivable and cash_on_hand are registered asset accounts', /COD_RECEIVABLE\]:\s*LEDGER_ACCOUNT_TYPE\.ASSET/.test(fs.readFileSync(path.join(BACKEND, 'src/services/ledger.service.js'), 'utf8')) && /CASH_ON_HAND\]:\s*LEDGER_ACCOUNT_TYPE\.ASSET/.test(fs.readFileSync(path.join(BACKEND, 'src/services/ledger.service.js'), 'utf8')));

  // (e) BOTH delivery paths must refuse to complete with cash outstanding —
  //     after DELIVERED there is no collection UI left, so the receivable would
  //     become uncollectable
  const riderComplete = orderSvc.slice(orderSvc.indexOf("case 'complete':"), orderSvc.indexOf("case 'fail':"));
  check('the rider delivery path gates on cash collection', /COD_COLLECTION_REQUIRED/.test(riderComplete));
  const opsDeliver = orderSvc.slice(orderSvc.indexOf('async deliver('), orderSvc.indexOf('async deliveryFailed('));
  check('the ops delivery path gates on cash collection too', /COD_COLLECTION_REQUIRED/.test(opsDeliver));

  // (f) the risk cap is enforced before the order exists, so a refusal cannot
  //     strand a half-built order and a live slot hold
  const capInCheckout = orderSvc.indexOf('assertCodCheckoutAllowed');
  const createDoc = orderSvc.indexOf('await this.createOrderDoc({');
  check('the cash cap is enforced before createOrderDoc', capInCheckout > 0 && createDoc > 0 && capInCheckout < createDoc);

  // (g) cancelling uncollected cash must unwind the receivable
  check('cancelling an uncollected cash order waives the receivable', /postCodReceivableWaived/.test(orderSvc) && /postCodReceivableWaived/.test(posting));

  // (h) the payout settlement gate must accept cash as proof, or every cash
  //     order is blocked forever once the gate is switched on
  const payoutSvc = fs.readFileSync(path.join(BACKEND, 'src/services/payout.service.js'), 'utf8');
  check('payout gate 2 accepts cod_collected as cash-in-hand proof', /LEDGER_JOURNAL_KIND\.COD_COLLECTED/.test(payoutSvc));

  // (i) the storefront must be TOLD, not discover by a failed checkout
  const bootstrap = fs.readFileSync(path.join(BACKEND, 'src/controllers/domain.controller.js'), 'utf8');
  check('the storefront bootstrap publishes payments.cod', /cod:\s*\{/.test(bootstrap) && /maxAmountPaise/.test(bootstrap));
  const checkoutPage = fs.readFileSync(path.join(REPO, 'frontend/apps/storefront/src/pages/Checkout.jsx'), 'utf8');
  check('Checkout hides cash using the published cap and flag', /codOverCap/.test(checkoutPage) && /codAvailable/.test(checkoutPage));

  // (j) the rider app has somewhere to record the cash
  const riderRoutes = fs.readFileSync(path.join(BACKEND, 'src/routes/rider.routes.js'), 'utf8');
  check('the rider API exposes a collect-cash action', /collect-cash/.test(riderRoutes));
}

// ---------------------------------------------------------------------------
section('9. the delivery clock has exactly one home');
// ---------------------------------------------------------------------------
// returns.service used to measure the customer's 7-day window from
// paymentSummary.paidAt — assigning it to a variable NAMED deliveredAt — which
// charged customers for transit time and desynchronised the return gate from the
// payout gate. Both now resolve the stamp through utils/returnWindow.js.
{
  const utilPath = path.join(BACKEND, 'src/utils/returnWindow.js');
  check('utils/returnWindow.js exists (the single delivery-clock home)', fs.existsSync(utilPath));
  const util = fs.existsSync(utilPath) ? fs.readFileSync(utilPath, 'utf8') : '';
  check('the clock helper is pure (injectable now, no imports of models)', /now = Date\.now\(\)/.test(util) && !/from '\.\.\/models\//.test(util));

  for (const [file, what] of [
    ['src/services/returns.service.js', 'the return window'],
    ['src/services/payout.service.js', 'payout eligibility (gate 1)'],
  ]) {
    const src = fs.readFileSync(path.join(BACKEND, file), 'utf8');
    check(`${file} reads the clock from utils/returnWindow.js (${what})`, /from '\.\.\/utils\/returnWindow\.js'/.test(src));
  }

  // The original bug, stated as a pattern: a variable called deliveredAt being
  // assigned from a payment timestamp.
  const offenders = [];
  for (const f of jsFiles(path.join(BACKEND, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    if (/deliveredAt\s*=\s*[^;\n]*paymentSummary\?\.paidAt/.test(src)
      || /deliveredAt\s*=\s*[^;\n]*\bpaidAt\b(?!\s*\|\|\s*order\.updatedAt)/.test(src)) {
      offenders.push(path.relative(BACKEND, f));
    }
  }
  check(
    'no service derives a delivery moment straight from a payment timestamp',
    offenders.length === 0,
    offenders.join(', '),
  );
}

// ---------------------------------------------------------------------------
section('10. every DB-backed suite bootstraps mongod through the shared helper');
{
  const HELPER = path.join(BACKEND, 'scripts/lib/hermeticMongo.js');
  check('scripts/lib/hermeticMongo.js exists', fs.existsSync(HELPER));

  const suites = jsFiles(path.join(BACKEND, 'scripts'))
    .filter((f) => /smoke.*\.test\.js$/.test(path.basename(f)));
  check(`found the DB-backed suite family (${suites.length} suites)`, suites.length >= 20,
    `only ${suites.length}`);

  const helperSrc = fs.readFileSync(HELPER, 'utf8');

  // The helper is the only place allowed to touch the library directly.
  check('the helper owns the mongodb-memory-server import',
    /await import\('mongodb-memory-server'\)/.test(helperSrc));
  check('the helper retries on a version/distro mismatch instead of failing all 22 suites',
    /isVersionIncompatible/.test(helperSrc) && /suggestedVersion/.test(helperSrc)
    && /binary:\s*\{[\s\S]{0,80}?version:\s*suggested/.test(helperSrc));
  check('stopHermeticMongo is null-safe (the masked-error bug)',
    /export async function stopHermeticMongo\(mongod\) \{\s*\n\s*if \(!mongod\) return;/.test(helperSrc));
  check('stopHermeticMongo never lets a teardown error escape',
    /catch \{[\s\S]{0,80}?teardown is best-effort/.test(helperSrc));
  check('a synchronous teardown variant exists for .finally()/.catch() contexts',
    /export function stopHermeticMongoSync\(mongod\) \{\s*\n\s*if \(!mongod\) return;/.test(helperSrc));

  const directCreate = [];
  const directStop = [];
  const directImport = [];
  const missingHelper = [];

  for (const f of suites) {
    const src = fs.readFileSync(f, 'utf8');
    const name = path.relative(BACKEND, f);

    // No suite may talk to the library directly: that is how the guards drifted.
    if (/MongoMemoryServer/.test(src)) directImport.push(name);
    if (/from 'mongodb-memory-server'|import\('mongodb-memory-server'\)/.test(src)) directImport.push(name);

    // The two shapes that caused the masked error: a bare stop(), or a
    // hand-written `if (mongod)` guard instead of the helper.
    if (/[^\w?]mongod\??\.stop\(\)/.test(src)) directStop.push(name);
    if (/if \(mongod\)\s*(await\s*)?mongod/.test(src)) directStop.push(name);

    // Anything that starts a mongod must start it through the helper.
    if (/createHermeticMongo\(/.test(src) && !/from '\.\/lib\/hermeticMongo\.js'/.test(src)) {
      missingHelper.push(name);
    }
  }

  check('no suite imports mongodb-memory-server directly', directImport.length === 0,
    [...new Set(directImport)].join(', '));
  check('no suite calls mongod.stop() directly (must use the null-safe helper)',
    directStop.length === 0, [...new Set(directStop)].join(', '));
  check('every suite that starts mongod imports the helper', missingHelper.length === 0,
    missingHelper.join(', '));

  // And the positive assertion: the family really is wired up, not merely clean
  // because nothing matched.
  const usingHelper = suites.filter((f) => /createHermeticMongo\(/.test(fs.readFileSync(f, 'utf8')));
  check(`all ${suites.length} suites bootstrap through createHermeticMongo`,
    usingHelper.length === suites.length,
    `${usingHelper.length}/${suites.length}`);
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
