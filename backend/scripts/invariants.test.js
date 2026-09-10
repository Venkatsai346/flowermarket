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
 *
 * 11. ONE MONEY-SPLITTING ALGORITHM — `utils/money.js` documents allocatePaise
 *     as the replacement for "last line absorbs the rounding", and every paise
 *     split honoured that except pricingPolicy.allocateDiscount(), which still
 *     hand-rolled it. That version could assign a ₹0 freebie a NEGATIVE share
 *     (−0.009999999999999787, unrounded, persisted to OrderItem) and its error
 *     grew with cart size: 1.5 paisa at 4 lines, 9.5 at 20.
 *
 * 12. BRAND-KIT PARITY — backend/src/constants/brandKits.js and
 *     frontend/packages/shared/src/brand/kits.js were joined only by a comment
 *     saying "keep in lockstep". They had drifted: the frontend grew
 *     blurb/paper, and the two resolvers applied DIFFERENT precedence to
 *     heroUrl, so a tenant-stored heroUrl would have been silently discarded by
 *     the backend. Both modules are imported and compared here — structurally
 *     and behaviourally — because §3 already exists for exactly this class of
 *     cross-layer contract drift.
 *
 * 13. A NEW STORE CAN SELL — registerStore() created a Tenant, an owner and a
 *     subscription, but no hub, pincode, slot or fee policy, so checkout refused
 *     every customer while isPublished could still be switched on. The seeding,
 *     the publish gate, the removal of the hardcoded ₹49, and the deliberate
 *     decision NOT to guess pincodes are all asserted here.
 *
 * 15. TWO SUBSCRIPTIONS, TWO MODELS, ATOMIC REGISTRATION — Phase-5 billing
 *     squatted on the bare `Subscription` name, so the customer
 *     recurring-order schema made every billing write fail with a cryptic
 *     VALIDATION_ERROR — after the tenant already existed, orphaning it and
 *     wedging the slug (retry → 409 on a store that never completed). Now
 *     Subscription (customer) and TenantSubscription (store billing) are
 *     asserted separately shaped and never cross-wired, a runtime guard fails
 *     LOUD before writing, and registration commits all-or-nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

  const allSmoke = jsFiles(path.join(BACKEND, 'scripts'))
    .filter((f) => /smoke.*\.test\.js$/.test(path.basename(f)));
  // Only DB-backed smoke suites need the hermetic helper — filter out pure
  // unit tests that test middleware / headers / TOTP without touching MongoDB.
  const suites = allSmoke.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /hermeticMongo|createHermeticMongo|MongoMemoryServer|mongoose|mongoDb/i.test(src);
  });
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
section('11. every money split uses allocatePaise, not "last line absorbs rounding"');
{
  const MONEY = path.join(BACKEND, 'src/utils/money.js');
  const moneySrc = fs.readFileSync(MONEY, 'utf8');
  check('allocatePaise is the declared single algorithm',
    /export function allocatePaise\(/.test(moneySrc)
    && /Replaces the previous "last line absorbs the rounding"/.test(moneySrc));

  // Every site that splits money across lines. These are the six the deep dive
  // enumerated, plus pricingPolicy once it was converted.
  const expectedSites = [
    ['src/services/ledger.service.js', 1],
    ['src/services/payout.service.js', 2],
    ['src/services/taxDocument.service.js', 2],
    ['src/services/pricingPolicy.service.js', 1],
  ];
  for (const [file, minCalls] of expectedSites) {
    const src = fs.readFileSync(path.join(BACKEND, file), 'utf8');
    const calls = (src.match(/allocatePaise\(/g) || []).length;
    check(`${file} splits via allocatePaise (${calls} call${calls === 1 ? '' : 's'})`,
      calls >= minCalls, `expected >= ${minCalls}, found ${calls}`);
  }

  // allocateDiscount specifically must route through it, not reimplement.
  const pricingSrc = fs.readFileSync(path.join(BACKEND, 'src/services/pricingPolicy.service.js'), 'utf8');
  const allocBody = (pricingSrc.match(/allocateDiscount\(lineItems, discountTotal\) \{([\s\S]*?)\n  \}/) || [])[1] || '';
  check('allocateDiscount calls allocatePaise', /allocatePaise\(/.test(allocBody));
  check('allocateDiscount imports it rather than shadowing it',
    /import \{[^}]*\ballocatePaise\b[^}]*\} from '\.\.\/utils\/money\.js'/.test(pricingSrc));
  check('allocateDiscount converts through integer paise',
    /toPaise\(/.test(allocBody) && /fromPaise\(/.test(allocBody));

  // The anti-pattern, scanned across CODE ONLY — several files legitimately
  // discuss it in a comment explaining why it was removed.
  const residue = /\b\w*[Tt]otal\w*\s*-\s*(?:allocated|accumulated|accrued|running|sumSoFar)\b/;
  const offenders = [];
  for (const f of jsFiles(path.join(BACKEND, 'src'))) {
    const code = fs.readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l))
      .join('\n');
    if (residue.test(code)) offenders.push(rel(f));
  }
  check('no file re-derives a remainder as "total minus what was already allocated"',
    offenders.length === 0, offenders.join(', '));
}

// ---------------------------------------------------------------------------
section('12. the two brand-kit copies agree, structurally and behaviourally');
{
  const BACKEND_KITS = path.join(BACKEND, 'src/constants/brandKits.js');
  const SHARED_KITS = path.join(REPO, 'frontend/packages/shared/src/brand/kits.js');
  check('both brand-kit modules exist',
    fs.existsSync(BACKEND_KITS) && fs.existsSync(SHARED_KITS),
    `${rel(BACKEND_KITS)} / ${rel(SHARED_KITS)}`);

  // Import both rather than diffing text: the contract is what the resolvers
  // RETURN, and a text comparison would pass on two files that differ in ways
  // that matter (or fail on two that differ only in comments).
  const be = await import(pathToFileURL(BACKEND_KITS).href);
  const fe = await import(pathToFileURL(SHARED_KITS).href);

  check('the same kit ids, in the same order',
    JSON.stringify([...be.BRAND_KIT_IDS]) === JSON.stringify([...fe.BRAND_KIT_IDS]),
    `backend ${JSON.stringify([...be.BRAND_KIT_IDS])} vs shared ${JSON.stringify([...fe.BRAND_KIT_IDS])}`);
  check('three kits are offered', be.BRAND_KIT_IDS.length === 3, `${be.BRAND_KIT_IDS.length}`);

  // Every field of every kit, both directions — an extra key on either side is
  // drift even if all the shared keys match.
  const fieldDrift = [];
  for (const id of be.BRAND_KIT_IDS) {
    const b = be.BRAND_KITS[id] || {};
    const f = fe.BRAND_KITS[id] || {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(f)])].sort();
    for (const k of keys) {
      if (!(k in b)) fieldDrift.push(`${id}.${k} missing from backend`);
      else if (!(k in f)) fieldDrift.push(`${id}.${k} missing from shared`);
      else if (b[k] !== f[k]) fieldDrift.push(`${id}.${k}: backend ${JSON.stringify(b[k])} vs shared ${JSON.stringify(f[k])}`);
    }
  }
  check('every kit has identical fields and values on both sides',
    fieldDrift.length === 0, fieldDrift.join('; '));

  // The field that actually diverged. Asserted separately so a future edit that
  // re-breaks only this one produces an obvious failure.
  check('both catalogues carry id/name/blurb/primaryColor/accentColor/hero/paper',
    be.BRAND_KIT_IDS.every((id) => ['id', 'name', 'blurb', 'primaryColor', 'accentColor', 'hero', 'paper']
      .every((k) => k in be.BRAND_KITS[id] && k in fe.BRAND_KITS[id])));

  const CASES = [
    ['absent', undefined],
    ['null (a tenant row with no theme)', null],
    ['empty', {}],
    ['rose', { kit: 'rose' }],
    ['marigold', { kit: 'marigold' }],
    ['tropical', { kit: 'tropical' }],
    ['an unknown kit falls back to rose', { kit: 'not-a-kit' }],
    ['a colour override wins over the kit', { kit: 'tropical', primaryColor: '#112233' }],
    ['an accent override wins over the kit', { kit: 'tropical', accentColor: '#445566' }],
    ['both colours overridden', { kit: 'marigold', primaryColor: '#111111', accentColor: '#222222' }],
    ['THE DIVERGENCE: a tenant heroUrl must survive', { kit: 'rose', heroUrl: '/media/tenant-hero.jpg' }],
    ['heroUrl with an unknown kit', { kit: 'bogus', heroUrl: '/media/h.jpg' }],
    ['a colour override with no kit at all', { primaryColor: '#123456' }],
    ['falsy overrides fall through to the kit', { kit: 'tropical', primaryColor: '', heroUrl: '' }],
    ['an explicitly null kit', { kit: null }],
  ];

  const resolverDrift = [];
  for (const [label, input] of CASES) {
    const b = be.resolveBrandTheme(input);
    const f = fe.resolveBrandTheme(input);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(f)])].sort();
    for (const k of keys) {
      if (b[k] !== f[k]) resolverDrift.push(`${label} → ${k}: backend ${JSON.stringify(b[k])} vs shared ${JSON.stringify(f[k])}`);
    }
  }
  check(`both resolvers return identical themes for all ${CASES.length} inputs`,
    resolverDrift.length === 0, resolverDrift.join('; '));

  // Stated on its own, because it is the bug that was found.
  const hero = be.resolveBrandTheme({ kit: 'rose', heroUrl: '/media/tenant-hero.jpg' });
  check('a tenant heroUrl is honoured by the backend resolver (it used to be dropped)',
    hero.heroUrl === '/media/tenant-hero.jpg', hero.heroUrl);
  check('…and by the shared resolver',
    fe.resolveBrandTheme({ kit: 'rose', heroUrl: '/media/tenant-hero.jpg' }).heroUrl === '/media/tenant-hero.jpg');

  // Resolving an already-resolved theme must be a fixed point. The storefront
  // calls resolveBrandTheme on the theme bootstrap already resolved, so if this
  // ever stopped holding, the second pass would corrupt the first.
  const notFixed = [];
  for (const [label, input] of CASES) {
    for (const [side, mod] of [['backend', be], ['shared', fe]]) {
      const once = mod.resolveBrandTheme(input);
      const twice = mod.resolveBrandTheme(once);
      if (JSON.stringify(once) !== JSON.stringify(twice)) notFixed.push(`${side}: ${label}`);
    }
  }
  check('resolveBrandTheme is idempotent on both sides (safe to resolve twice)',
    notFixed.length === 0, notFixed.join('; '));

  // Both catalogues must be immutable — a runtime mutation would break parity in
  // a way no static check could ever see.
  check('both catalogues are frozen',
    Object.isFrozen(be.BRAND_KITS) && Object.isFrozen(fe.BRAND_KITS)
    && be.BRAND_KIT_IDS.every((id) => Object.isFrozen(be.BRAND_KITS[id]) && Object.isFrozen(fe.BRAND_KITS[id])));

  // And the shared copy must still satisfy its own unit test's contract, so
  // "identical" cannot be achieved by breaking both.
  check('colours are 6-digit hex and heroes live under /brand/',
    be.BRAND_KIT_IDS.every((id) => {
      const k = be.BRAND_KITS[id];
      return /^#[0-9A-Fa-f]{6}$/.test(k.primaryColor)
        && /^#[0-9A-Fa-f]{6}$/.test(k.accentColor)
        && /^\/brand\/hero-/.test(k.hero);
    }));
}

// ---------------------------------------------------------------------------
section('13. a newly registered store is told what it cannot yet do');
{
  const READINESS = path.join(BACKEND, 'src/utils/onboardingReadiness.js');
  const STORE = path.join(BACKEND, 'src/services/store.service.js');
  const PRICING = path.join(BACKEND, 'src/services/pricingPolicy.service.js');
  check('utils/onboardingReadiness.js exists', fs.existsSync(READINESS));

  const readiness = await import(pathToFileURL(READINESS).href);
  check('it exports the pure decision + a stable item vocabulary',
    typeof readiness.evaluateOnboarding === 'function'
    && readiness.ONBOARDING_ITEM && readiness.ITEM_STATE);

  // The decision is pure, so it is testable without mongod; the service only
  // gathers facts. If the service ever grew its own copy of the logic the two
  // would drift, exactly like the brand kits did.
  const storeSrc = fs.readFileSync(STORE, 'utf8');
  check('store.service delegates to evaluateOnboarding instead of re-deciding',
    /from '\.\.\/utils\/onboardingReadiness\.js'/.test(storeSrc)
    && (storeSrc.match(/evaluateOnboarding\(/g) || []).length >= 2);
  check('facts are gathered in one place',
    /async collectOnboardingFacts\(/.test(storeSrc)
    && /async getOnboardingStatus\(/.test(storeSrc));

  // ---- registration seeds the skeleton ----
  const registerBody = (storeSrc.match(/async registerStore\([\s\S]*?\n  \}/) || [])[0] || '';
  check('registerStore seeds the operational skeleton',
    /seedStarterSkeleton\(/.test(registerBody));
  const seedBody = (storeSrc.match(/async seedStarterSkeleton\([\s\S]*?\n  \}/) || [])[0] || '';
  check('the skeleton includes a hub', /Hub\.create\(/.test(seedBody));
  check('the skeleton includes a delivery fee policy', /DeliveryFeePolicy\.create\(/.test(seedBody));
  check('the skeleton opens delivery slots', /slotService\.generateForDates\(/.test(seedBody));

  // The deliberate omission. Seeding pincodes would mean guessing a merchant's
  // delivery area, which puts a store in front of customers it cannot serve. A
  // future "helpful" commit that adds one is a regression, not a fix.
  check('the skeleton does NOT invent serviceable pincodes (nobody can guess a delivery area)',
    !/ServiceablePincode\.(create|insertMany|updateOne|bulkWrite)\(/.test(seedBody));

  // A seeding failure must not orphan the tenant that already exists.
  check('seeding cannot fail the registration',
    /\.catch\(/.test(registerBody.slice(registerBody.indexOf('seedStarterSkeleton')))
    && /result\.errors\.push/.test(seedBody));

  // ---- publishing is gated ----
  const updateBody = (storeSrc.match(/async updateStore\([\s\S]*?\n  \}/) || [])[0] || '';
  check('publishing is gated on readiness', /canPublish/.test(updateBody));
  check('the refusal says WHY, with a machine-readable code',
    /STORE_NOT_READY/.test(updateBody) && /reasons/.test(updateBody));
  check('the gate is configurable as an incident escape hatch',
    /requireReadyToPublish/.test(updateBody));
  // Unpublishing is the emergency stop and must never be blocked.
  check('unpublishing is not gated', /wantsPublish && !alreadyPublished/.test(updateBody));

  // ---- the magic ₹49 is gone ----
  const pricingSrc = fs.readFileSync(PRICING, 'utf8');
  check('no hardcoded delivery fee survives in the pricing engine',
    !/if \(!policy\)\s*return\s*49/.test(pricingSrc) && !/return 49;/.test(pricingSrc));
  check('the no-policy fallback is configured, not literal',
    /config\.onboarding\.fallbackDeliveryFee/.test(pricingSrc));
  check('using the fallback is observable',
    /pricingFallback\.inc\(\{ kind: 'delivery_fee' \}\)/.test(pricingSrc));
  check('the silent nil-rated tax fallback is observable too',
    /pricingFallback\.inc\(\{ kind: 'tax_policy' \}\)/.test(pricingSrc));

  // ---- the whole chain is reachable from the console ----
  const route = fs.readFileSync(path.join(BACKEND, 'src/routes/marketplace.routes.js'), 'utf8');
  check('GET /marketplace/store/onboarding is served',
    /get\('\/store\/onboarding',\s*MarketplaceController\.myOnboarding\)/.test(route));
  const controller = fs.readFileSync(path.join(BACKEND, 'src/controllers/marketplace.controller.js'), 'utf8');
  check('the controller calls getOnboardingStatus',
    /myOnboarding[\s\S]{0,200}?getOnboardingStatus\(/.test(controller));

  const endpointsPath = path.join(REPO, 'frontend/packages/shared/src/api/endpoints.js');
  const endpoints = fs.readFileSync(endpointsPath, 'utf8');
  check('the shared API client exposes it',
    /myOnboarding:\s*\(\)\s*=>\s*c\.get\('\/marketplace\/store\/onboarding'\)/.test(endpoints));

  const uiPath = path.join(REPO, 'frontend/apps/web/src/features/dashboard/OnboardingChecklist.jsx');
  check('the admin console renders a checklist', fs.existsSync(uiPath));
  if (fs.existsSync(uiPath)) {
    const ui = fs.readFileSync(uiPath, 'utf8');
    check('the checklist calls the endpoint', /api\.marketplace\.myOnboarding\(\)/.test(ui));
    // Most items link to the page that fixes them — but an item can ALSO be
    // fixed inline (ownerEmail's code entry), which is strictly better UX than
    // a route. The allowlist is explicit and tiny: anything else without a
    // route is a dead end, exactly what this check was written to catch.
    const INLINE_HANDLED = new Set(['ownerEmail']);
    const hasFix = (id) => new RegExp(`${id}:\\s*\\{\\s*to:`).test(ui)
      || (INLINE_HANDLED.has(id) && new RegExp(`item\\.id === '${id}'`).test(ui));
    check('every item id the API can return has somewhere to go',
      Object.values(readiness.ONBOARDING_ITEM).every(hasFix),
      Object.values(readiness.ONBOARDING_ITEM).filter((id) => !hasFix(id)).join(', '));
    check('the publish control is disabled while blocked',
      /disabled=\{!canPublish\}/.test(ui));
    const dash = fs.readFileSync(
      path.join(REPO, 'frontend/apps/web/src/features/dashboard/StoreDashboard.jsx'), 'utf8');
    check('the dashboard mounts it', /<OnboardingChecklist/.test(dash));
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
section('14. tax document numbers are unique per supplier, not per platform');
{
  // GST Rule 46 requires a serial number that is unique and sequential for each
  // financial year FOR THE REGISTERED PERSON ISSUING IT. Two suppliers may
  // lawfully use the same number. A globally-unique index on `number` therefore
  // contradicted the law it exists to serve — and it made the marketplace's
  // mainline impossible: issueForOrder writes one document per selling entity,
  // the prefix is one global config value, and each supplier's sequence starts at
  // 1, so a vendor's and a store's first invoices in a financial year both
  // rendered FM/26-27/000001 and the second insert died with E11000.
  //
  // This is held statically because the suite that caught it (smoke-gst) needs a
  // database, and a DB-backed check is the last thing anyone re-runs by hand.
  const modelSrc = fs.readFileSync(path.join(BACKEND, 'src/models/taxDocument.model.js'), 'utf8');
  const svcSrc = fs.readFileSync(path.join(BACKEND, 'src/services/taxDocument.service.js'), 'utf8');
  const cfgSrc = fs.readFileSync(path.join(BACKEND, 'src/config/index.js'), 'utf8');

  check('`number` is not declared globally unique',
    !/TaxDocumentSchema\.index\(\s*\{\s*number:\s*1\s*\}\s*,\s*\{\s*unique:\s*true/.test(modelSrc),
    'src/models/taxDocument.model.js: index({ number: 1 }, { unique: true }) is back');

  check('`number` IS unique per supplier (supplierType + tenantId + vendorId)',
    /TaxDocumentSchema\.index\(\s*\{[^}]*supplierType[^}]*number:\s*1[^}]*\}\s*,\s*\{[^}]*unique:\s*true/.test(modelSrc),
    'the supplier-scoped unique index is missing');

  // The bug is a scope MISMATCH: a per-owner sequence rendered through a global
  // prefix, constrained by a global index. Pin the sequence's scope too, so the
  // two halves cannot drift apart again in either direction.
  check('the sequence is reserved per owner (ownerType + ownerId + docType + fyLabel)',
    /ownerType[\s\S]{0,40}?ownerId[\s\S]{0,40}?docType[\s\S]{0,40}?fyLabel/.test(svcSrc),
    'reserveNumber no longer keys its series on the owner');

  // A schema edit does not touch an index that already exists in a live database,
  // so the superseded global index has to be dropped explicitly — otherwise the
  // fix is real in a fresh test DB and fiction in production.
  check('the superseded global index is dropped at runtime, not just redefined',
    /isLegacyGlobalNumber/.test(svcSrc)
      && /dropIndex/.test(svcSrc)
      && /syncIndexes\(\)/.test(svcSrc),
    'taxDocument.service.ensureIndexes() must drop unique-on-number-alone and syncIndexes()');

  // GST caps a document number at 16 characters, and FM/26-27/000001 is already
  // 15 — which is precisely why the number cannot carry a supplier discriminator
  // and the index had to be scoped instead. Widening the prefix or the sequence
  // would break the law silently; reserveNumber refuses at runtime, this refuses
  // at commit time.
  const prefix = (cfgSrc.match(/invoicePrefix:\s*process\.env\.TAX_INVOICE_PREFIX\s*\|\|\s*'([^']*)'/) || [])[1] || '';
  const width = Number((cfgSrc.match(/numberWidth:\s*Number\(process\.env\.TAX_NUMBER_WIDTH\)\s*\|\|\s*(\d+)/) || [])[1] || 0);
  const longest = `${prefix}/26-27/${'0'.repeat(width)}`;
  check(`the default number "${longest}" fits GST's 16-character cap`,
    longest.length > 0 && longest.length <= 16, `${longest.length} characters`);
}

// ---------------------------------------------------------------------------
section('15. two subscription concepts, two models, zero cross-wiring');
// ---------------------------------------------------------------------------
{
  // `Subscription` is the CUSTOMER recurring-order schema (Phase 7.8.1) and
  // `TenantSubscription` the STORE plan-billing schema (Phase 5). Phase-5 code
  // once squatted on the bare name, so a same-named customer schema made every
  // billing write fail cryptically AFTER the tenant existed — orphaning it and
  // wedging the slug. The split vocabulary makes that unrepresentable; these
  // checks nail both halves down: one registration each, each shaped like its
  // own concept, neither leaking the other's fields.
  const MODELS = path.join(BACKEND, 'src/models');
  const modelFiles = jsFiles(MODELS)
    .map((f) => ({ file: rel(f), src: fs.readFileSync(f, 'utf8') }));
  const registering = (name) => modelFiles.filter(({ src }) =>
    new RegExp(`mongoose\\.model\\(\\s*['"]${name}['"]`).test(src));
  const customerRegs = registering('Subscription');
  const tenantRegs = registering('TenantSubscription');
  check('exactly one file registers mongoose.model(\'Subscription\')',
    customerRegs.length === 1, customerRegs.map((r) => r.file).join(', '));
  check('exactly one file registers mongoose.model(\'TenantSubscription\')',
    tenantRegs.length === 1, tenantRegs.map((r) => r.file).join(', '));

  const subSrc = fs.readFileSync(path.join(MODELS, 'subscription.model.js'), 'utf8');
  check('Subscription is the customer schema (userId/frequency/nextDeliveryAt)',
    /userId:\s*\{/.test(subSrc) && /frequency:\s*\{/.test(subSrc) && /nextDeliveryAt:\s*\{/.test(subSrc));
  check('no billing fields hide in the customer schema',
    !/planCode/.test(subSrc) && !/planSnapshot/.test(subSrc));

  const tenantSubSrc = fs.readFileSync(path.join(MODELS, 'tenantSubscription.model.js'), 'utf8');
  check('TenantSubscription is the billing schema (planCode/tenantId/planSnapshot)',
    /planCode:\s*\{/.test(tenantSubSrc) && /tenantId:\s*\{/.test(tenantSubSrc) && /planSnapshot:\s*\{/.test(tenantSubSrc));
  check('no customer-subscription fields hide in the billing schema',
    !/nextDeliveryAt/.test(tenantSubSrc) && !/\bfrequency\b/.test(tenantSubSrc) && !/userId/.test(tenantSubSrc));
  check('the two models live in different collections',
    /collection:\s*'subscriptions'/.test(subSrc) && /collection:\s*'tenant_subscriptions'/.test(tenantSubSrc));

  const enumsSrc = fs.readFileSync(path.join(BACKEND, 'src/constants/enums.js'), 'utf8');
  check('the customer enum can pause, the billing enum can trial',
    /SUBSCRIPTION_STATUS = Object\.freeze\(\{[\s\S]*?PAUSED:/.test(enumsSrc)
    && /TENANT_SUBSCRIPTION_STATUS = Object\.freeze\(\{[\s\S]*?TRIAL:\s*'trial'/.test(enumsSrc));

  // Billing must import the billing model — nowhere may it touch Subscription.
  const billingSrc = fs.readFileSync(path.join(BACKEND, 'src/services/billing.service.js'), 'utf8');
  check('billing.service imports TenantSubscription, never Subscription',
    /from '\.\.\/models\/tenantSubscription\.model\.js'/.test(billingSrc)
    && !/from '\.\.\/models\/subscription\.model\.js'/.test(billingSrc));

  // The runtime guard must actually be wired: fail LOUD before writing, both at
  // registration (before the tenant exists) and at every subscription write.
  check('ensureSubscription asserts the tenant-billing schema before writing',
    /async ensureSubscription\([\s\S]*?assertTenantSubscriptionSchema\(\)/.test(
      billingSrc.match(/async ensureSubscription\([\s\S]*?\n  \}/)?.[0] || ''));
  const storeSvc = fs.readFileSync(path.join(BACKEND, 'src/services/store.service.js'), 'utf8');
  check('registerStore asserts it before the first write',
    /assertTenantSubscriptionSchema\(\)/.test(
      storeSvc.match(/async registerStore\([\s\S]*?\n  \}/)?.[0] || ''));

  // And the atomicity the incident proved missing: a mid-flow failure must undo
  // the partial graph, never orphan a tenant that wedges the slug.
  check('registration commits through one core behind transaction-or-compensation',
    /createRegistrationCore\(/.test(
      storeSvc.match(/async registerStore\([\s\S]*?\n  \}/)?.[0] || '')
    && /withTransaction/.test(storeSvc) && /compensateRegistration\(/.test(storeSvc));
}

// Printed LAST, only after every section has run. This line used to sit above
// §14, so the runner announced "88 passed, 0 failed" and then failed two checks —
// a summary that disagrees with its own gate is worse than no summary, because it
// teaches the next reader to trust the number and skip the ❌ lines.
console.log(`invariants: ${passed} passed, ${failed} failed`);

if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ all repo invariants hold\n');
