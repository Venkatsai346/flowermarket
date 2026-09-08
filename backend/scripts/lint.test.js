/**
 * lint.test.js — the lint gate that runs today, without ESLint installed.
 *
 *   node scripts/lint.test.js            (also: npm run lint)
 *   node scripts/lint.test.js --rebase   rewrite the baseline to today's counts
 *
 * The repo carries ~70 disable annotations and had no linter at all: no
 * dependency, no config, no script, no CI step. So every one of those annotations
 * was a note to a human rather than a contract with a tool — nothing failed when a
 * disable named a rule nobody ran, and nothing failed when one went stale.
 *
 * `no-await-in-loop` was disabled 51 times. In several loops the sequential await
 * is load-bearing (saga compensation ordering, chain-anchor CAS, index
 * migrations). In the cart path it was not: `revalidate()`, `applyLivePrices()`
 * and `mergeGuestCart()` each issued two sequential queries PER LINE on the
 * hottest read in the application, while `inventoryService.bulkGetStock()` — the
 * batched equivalent — already existed and went unused. Thirteen of those
 * disables were N+1 queries wearing a comment that made them look intentional.
 *
 * Check C1 is the one that makes that class visible. It is validated in both
 * directions: it flags all thirteen awaits in the pre-fix cart.service.js, and
 * the current tree adds none.
 *
 * ── THE RATCHET ─────────────────────────────────────────────────────────────
 * Three checks (C1, A4, B) have a large pre-existing population. A gate that
 * fails on 100 legacy findings gets switched off within a week, so those three
 * are baselined per file in scripts/lint-baseline.json and only an INCREASE
 * fails — the standard ratchet. Everything else is strict, because it already
 * passes and a new occurrence is unambiguously a regression.
 *
 * The baseline is debt with a number on it, not debt with an excuse: `--rebase`
 * will happily record a lower count after a cleanup, and CI refuses a higher one.
 *
 * The rule list lives in ../eslint.rules.js, which eslint.config.js also reads,
 * so activating real ESLint later cannot drift from what is enforced here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RULES,
  DISABLE_ALLOWED,
  DISABLE_REQUIRES_JUSTIFICATION,
  JUSTIFICATION_MARKERS,
  FORBIDDEN_IN_TESTS,
  MERGE_MARKERS,
} from '../eslint.rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');
const BASELINE_PATH = path.join(BACKEND, 'scripts/lint-baseline.json');
const REBASE = process.argv.includes('--rebase');

let passed = 0;
const violations = [];
const notes = [];
const check = (name, bad, detail = '') => {
  if (!bad || bad.length === 0) { passed += 1; console.log(`  ✅ ${name}`); }
  else {
    violations.push(`${name}${detail ? `\n       ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

function jsFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p); }
      else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const rel = (p) => path.relative(BACKEND, p);
const isCommentLine = (line) => /^\s*(?:\*|\/\/|\/\*)/.test(line);

/**
 * The linter's own files are excluded from the scan.
 *
 * They necessarily contain the patterns they detect — the string "debugger" in a
 * regex that forbids debugger statements, the word "eslint-disable" in the parser
 * for eslint-disable comments. Scanning them makes the gate report itself, which
 * is noise, not signal.
 */
const SELF = new Set([
  'scripts/lint.test.js',
  'eslint.rules.js',
  'eslint.config.js',
  'scripts/lint-baseline.json',
]);

const SRC = jsFiles(path.join(BACKEND, 'src')).filter((f) => !SELF.has(rel(f)));
const SCRIPTS = jsFiles(path.join(BACKEND, 'scripts')).filter((f) => !SELF.has(rel(f)));
const ALL = [...SRC, ...SCRIPTS];
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n');

/** Every disable annotation in the tree, with its location and named rules. */
function collectDisables(files) {
  const found = [];
  for (const f of files) {
    readLines(f).forEach((line, i) => {
      const m = line.match(/eslint-disable(?<kind>-next-line|-line)?\s*(?<rules>[^*]*?)(?:\*\/)?\s*$/);
      if (!m) return;
      const raw = (m.groups.rules || '').trim();
      found.push({
        file: rel(f),
        abs: f,
        lineNo: i + 1,
        line,
        kind: m.groups.kind || 'file',
        rules: raw ? raw.split(',').map((r) => r.trim()).filter(Boolean) : [],
      });
    });
  }
  return found;
}

const disables = collectDisables(ALL);

// ---------------------------------------------------------------------------
// Baseline (ratchet) support
// ---------------------------------------------------------------------------
const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  : {};

/** Count findings per file, then compare against the baseline. */
function ratchet(label, findings) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, (byFile.get(f.file) || 0) + 1);

  const current = Object.fromEntries([...byFile.entries()].sort());
  if (REBASE) {
    baseline[label] = current;
    return { regressions: [], improved: [] };
  }

  const known = baseline[label] || {};
  const regressions = [];
  const improved = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = known[file] ?? 0;
    if (count > allowed) {
      regressions.push(`${file}: ${count} (baseline ${allowed})`);
    } else if (count < allowed) {
      improved.push(`${file}: ${allowed} → ${count}`);
    }
  }
  return { regressions, improved, current };
}

console.log(`\nscanning ${ALL.length} files (${SRC.length} in src/, ${SCRIPTS.length} in scripts/)`);
console.log(`found ${disables.length} eslint-disable annotations\n`);

// ---------------------------------------------------------------------------
console.log('A. every eslint-disable annotation means something');
{
  // A1 — a disable naming no rule silences everything on that line, including
  // rules added later. That is how a file stops being lintable unnoticed.
  const blanket = disables.filter((d) => d.rules.length === 0);
  check('every disable names at least one rule (no blanket silencing)', blanket,
    blanket.map((d) => `${d.file}:${d.lineNo}`).join(', '));

  const fileWide = disables.filter((d) => d.kind === 'file');
  check('no file-wide eslint-disable', fileWide,
    fileWide.map((d) => `${d.file}:${d.lineNo}`).join(', '));

  const named = disables.flatMap((d) => d.rules.map((rule) => ({ ...d, rule })));

  // A2 — naming a rule this repo has not agreed to silence.
  const unknown = named.filter((d) => !DISABLE_ALLOWED.includes(d.rule));
  check('every named rule is one this repo allows disabling', unknown,
    [...new Set(unknown.map((d) => `${d.rule} (${d.file}:${d.lineNo})`))].join(', '));

  // A3 — disabling a rule that is not configured is dead weight: it reads as
  // deliberate while enforcing nothing.
  const notEnabled = named.filter((d) => {
    const level = Array.isArray(RULES[d.rule]) ? RULES[d.rule][0] : RULES[d.rule];
    return level === undefined || level === 'off';
  });
  check('every disabled rule is actually enabled in eslint.rules.js', notEnabled,
    [...new Set(notEnabled.map((d) => d.rule))].join(', '));

  // A4 — the check that turns a comment into a reason. Ratcheted: 28 bare
  // disables predate this gate, and each one needs a human to say why the await
  // must be sequential. That is real work, so it is scheduled, not demanded
  // instantly — but no NEW unjustified disable can land.
  const needsWhy = named.filter((d) => DISABLE_REQUIRES_JUSTIFICATION.includes(d.rule));
  const unjustified = [];
  for (const d of needsWhy) {
    const lines = readLines(d.abs);
    const window = lines.slice(Math.max(0, d.lineNo - 6), d.lineNo).join(' ').toLowerCase();
    if (!JUSTIFICATION_MARKERS.some((marker) => window.includes(marker))) unjustified.push(d);
  }
  const a4 = ratchet('awaitInLoopJustification', unjustified);
  check('every NEW no-await-in-loop disable says WHY it must be sequential', a4.regressions,
    a4.regressions.join(', '));
  if (a4.improved?.length) notes.push(`justifications improved in: ${a4.improved.join(', ')} — run --rebase to lock it in`);
  const a4Total = unjustified.length;
  console.log(`  ℹ️  ${a4Total} pre-existing bare disables remain on the baseline (was ${Object.values(baseline.awaitInLoopJustification || {}).reduce((a, b) => a + b, 0)})`);
}

// ---------------------------------------------------------------------------
console.log('\nB. no-console is enforced, not just annotated');
{
  const allowed = (Array.isArray(RULES['no-console']) && RULES['no-console'][1]?.allow) || [];
  const levels = ['log', 'debug', 'trace'].filter((l) => !allowed.includes(l));
  const rx = new RegExp(`\\bconsole\\.(${levels.join('|')})\\s*\\(`);

  const offenders = [];
  for (const f of SRC) {
    readLines(f).forEach((line, i) => {
      if (isCommentLine(line) || !rx.test(line)) return;
      const prev = readLines(f)[i - 1] || '';
      if (!/no-console/.test(line) && !/no-console/.test(prev)) {
        offenders.push({ file: rel(f), lineNo: i + 1 });
      }
    });
  }
  // Ratcheted: server.js, worker.js and db.js log their own boot sequence and
  // predate this gate. console.warn/error are allowed outright by the rule.
  const b = ratchet('consoleLog', offenders);
  check(`every NEW console.${levels.join('/console.')} in src/ carries a no-console disable`,
    b.regressions, b.regressions.join(', '));
  if (b.improved?.length) notes.push(`console usage reduced in: ${b.improved.join(', ')} — run --rebase to lock it in`);
  console.log(`  ℹ️  ${offenders.length} pre-existing bare console calls remain on the baseline`);
}

// ---------------------------------------------------------------------------
console.log('\nC. sequential awaits in loops are annotated (the N+1 gate)');
{
  /**
   * Indentation-based loop-body detection.
   *
   * A real AST would be better, but this must run without ESLint installed, and
   * the alternative — a hand-rolled tokenizer that blanks strings, template
   * literals and regexes before counting braces — mis-parses on the first regex
   * containing a quote character and then reports nonsense. Indentation is
   * consistent across this codebase (2 spaces), so: a for/while whose line ends
   * in `{` opens a body that runs until the next line indented no deeper.
   *
   * The failure direction is deliberate. A multi-line loop header is missed, and
   * a nested block can only extend the scan — so this can under-report, never
   * invent. Under-reporting is acceptable for a ratchet; false positives are not,
   * because they are what gets a lint gate switched off.
   */
  function awaitsInLoops(lines) {
    const hits = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const opener = line.match(/^(\s*)(?:for await|for|while)\s*\(.*\)\s*\{\s*$/);
      if (!opener) continue;
      const baseIndent = opener[1].length;

      for (let j = i + 1; j < lines.length; j += 1) {
        const inner = lines[j];
        if (!inner.trim()) continue;
        if (inner.match(/^\s*/)[0].length <= baseIndent) break;
        if (isCommentLine(inner)) continue;
        if (!/\bawait\b/.test(inner)) continue;
        if (/^\s*for await\s*\(/.test(inner)) continue; // the header, not a body await
        const prev = lines[j - 1] || '';
        const annotated = /no-await-in-loop/.test(inner) || /no-await-in-loop/.test(prev);
        if (!annotated) hits.push({ lineNo: j + 1, text: inner.trim().slice(0, 88) });
      }
    }
    return hits;
  }

  const offenders = [];
  for (const f of SRC) {
    const lines = readLines(f);
    for (const h of awaitsInLoops(lines)) offenders.push({ file: rel(f), lineNo: h.lineNo, text: h.text });
  }

  const c = ratchet('awaitInLoop', offenders);
  check('no NEW unannotated await inside a loop in src/', c.regressions,
    c.regressions.join(', '));
  if (c.improved?.length) notes.push(`sequential awaits batched or annotated in: ${c.improved.join(', ')} — run --rebase to lock it in`);
  console.log(`  ℹ️  ${offenders.length} pre-existing unannotated awaits remain on the baseline`);

  if (!REBASE && offenders.length) {
    const worst = Object.entries(
      offenders.reduce((acc, o) => { acc[o.file] = (acc[o.file] || 0) + 1; return acc; }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  ℹ️  largest remaining backlogs: ${worst.map(([f, n]) => `${path.basename(f)} (${n})`).join(', ')}`);
  }

  // A5 — the other direction, and strict: a disable that no longer sits above an
  // await is stale, telling the next reader the sequential behaviour is
  // intentional when nothing sequential is left. Thirteen were removed from
  // cart.service.js when its queries were batched; this stops them creeping back.
  const stale = [];
  for (const d of disables.filter((x) => x.rules.includes('no-await-in-loop'))) {
    const lines = readLines(d.abs);
    const next = (lines[d.lineNo] || '').trim();
    const sameLine = /\bawait\b/.test(d.line.replace(/\/\/.*$/, ''));
    if (!sameLine && !/\bawait\b/.test(next)) stale.push(`${d.file}:${d.lineNo}`);
  }
  check('no stale no-await-in-loop disable (each sits above a real await)', stale, stale.join(', '));

  const remaining = disables.filter((d) => d.rules.includes('no-await-in-loop')).length;
  console.log(`  ℹ️  ${remaining} sequential awaits are annotated as deliberate`);
}

// ---------------------------------------------------------------------------
console.log('\nD. hygiene the annotations cannot cover');
{
  const find = (files, rx) => {
    const hits = [];
    for (const f of files) {
      readLines(f).forEach((line, i) => {
        if (isCommentLine(line)) return;
        if (rx.test(line)) hits.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 76)}`);
      });
    }
    return hits;
  };

  check('no var declarations (ESM, const/let only)', find(SRC, /(^|[\s;({])var\s+[A-Za-z_$]/));
  check('no debugger statements', find(ALL, /(^|[\s;({])debugger\b/));
  check('no CommonJS require() in src/', find(SRC, /[^.\w]require\s*\(/));
  check('no merge conflict markers', ALL.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return MERGE_MARKERS.some((re) => re.test(src));
  }).map(rel));

  const testFiles = ALL.filter((f) => /\.test\.(js|mjs)$/.test(path.basename(f)));
  const focused = [];
  for (const f of testFiles) {
    readLines(f).forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const rule of FORBIDDEN_IN_TESTS) {
        if (new RegExp(rule.pattern).test(line)) focused.push(`${rel(f)}:${i + 1} — ${rule.label}`);
      }
    });
  }
  check(`no focused or skipped tests across ${testFiles.length} suites`, focused, focused.join(', '));

  const noNewline = ALL.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return src.length > 0 && !src.endsWith('\n');
  }).map(rel);
  check('every file ends with a newline', noNewline, noNewline.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nE. the real ESLint configs are loadable and cannot rot');
{
  // These two files are not armed yet (ESlint cannot be installed offline), which
  // is exactly when unexecuted config goes stale. Importing them here means a
  // syntax error, a renamed rule, or a block that stops matching the tree fails CI
  // today rather than on the day somebody finally runs eslint.
  let be = null;
  let fe = null;
  try {
    be = (await import(pathToFileURL(path.join(BACKEND, 'eslint.config.js')).href)).default;
  } catch (err) {
    check('backend/eslint.config.js loads', [{ at: err.message }], err.message);
  }
  try {
    fe = (await import(pathToFileURL(path.join(REPO, 'frontend/eslint.config.js')).href)).default;
  } catch (err) {
    check('frontend/eslint.config.js loads', [{ at: err.message }], err.message);
  }

  if (be) {
    check('backend/eslint.config.js loads and exports a flat config array',
      Array.isArray(be) ? [] : [{ at: 'not an array' }]);

    const srcBlock = be.find((b) => b.files?.includes('src/**/*.js'));
    check('it has a block for src/**', srcBlock ? [] : [{ at: 'missing' }]);

    if (srcBlock) {
      // The config spreads RULES, so a per-rule comparison would be a tautology —
      // there is deliberately only one list. What CAN go wrong is the severity:
      // turning a rule off is a one-word edit that both consumers would happily
      // agree on, silently un-enforcing it everywhere. So assert the rules that
      // matter are still on, rather than merely still present.
      check('the src block still spreads eslint.rules.js unchanged',
        JSON.stringify(srcBlock.rules) === JSON.stringify(RULES) ? [] : [{ at: 'rules diverged from eslint.rules.js' }]);

      const CRITICAL = {
        'no-await-in-loop': 'warn',
        'no-console': 'warn',
        'no-unused-vars': 'error',
        eqeqeq: 'error',
        'no-var': 'error',
        'no-debugger': 'error',
      };
      const softened = Object.entries(CRITICAL).filter(([rule, want]) => {
        const got = Array.isArray(srcBlock.rules[rule]) ? srcBlock.rules[rule][0] : srcBlock.rules[rule];
        return got !== want;
      });
      check('no critical rule has been silently softened or switched off', softened,
        softened.map(([r, want]) => `${r}: expected ${want}, got ${JSON.stringify(srcBlock.rules[r])}`).join('; '));

      // A disable comment for a rule that is off is dead weight: it reads as
      // deliberate while enforcing nothing. This is the check that caught
      // no-control-regex being disabled in smtpClient before it was configured.
      const disabledButOff = DISABLE_ALLOWED.filter((rule) => {
        const level = Array.isArray(RULES[rule]) ? RULES[rule][0] : RULES[rule];
        return level === undefined || level === 'off';
      });
      check('every rule the repo disables is actually switched on', disabledButOff,
        disabledButOff.join(', '));

      check('a stale disable is reported rather than ignored',
        srcBlock.linterOptions?.reportUnusedDisableDirectives === 'error' ? [] : [{ at: 'reportUnusedDisableDirectives' }]);
      check('it parses as ESM at a modern ecmaVersion',
        srcBlock.languageOptions?.sourceType === 'module' ? [] : [{ at: 'sourceType' }]);
    }

    const scriptsBlock = be.find((b) => b.files?.includes('scripts/**/*.js'));
    check('suites may log to the console (it is their output channel)',
      scriptsBlock?.rules?.['no-console'] === 'off' ? [] : [{ at: 'scripts no-console' }]);

    check('build output and dependencies are ignored',
      be.some((b) => b.ignores?.some((i) => i.includes('node_modules'))) ? [] : [{ at: 'ignores' }]);
  }

  if (fe) {
    check('frontend/eslint.config.js loads and exports a flat config array',
      Array.isArray(fe) ? [] : [{ at: 'not an array' }]);
    const appBlock = fe.find((b) => b.files?.some((f) => f.startsWith('apps/')));
    check('it covers the app workspaces', appBlock ? [] : [{ at: 'missing' }]);
    check('JSX parsing is enabled (a .jsx file must not be a parse error)',
      appBlock?.languageOptions?.parserOptions?.ecmaFeatures?.jsx === true ? [] : [{ at: 'jsx' }]);
    check('browser globals are declared, so window/document are not undefined',
      appBlock?.languageOptions?.globals?.window === 'readonly' ? [] : [{ at: 'globals' }]);
    check('dist and node_modules are ignored',
      fe.some((b) => b.ignores?.some((i) => i.includes('dist'))) ? [] : [{ at: 'ignores' }]);
  }
}

// ---------------------------------------------------------------------------
if (REBASE) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`baseline written to ${rel(BASELINE_PATH)}`);
  for (const [label, files] of Object.entries(baseline)) {
    const total = Object.values(files).reduce((a, b) => a + b, 0);
    console.log(`  ${label}: ${total} across ${Object.keys(files).length} files`);
  }
  console.log('\nCommit it. CI fails on any increase.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
console.log('\nF. temporal dead zone — a binding that calls the name it shadows');
{
  // The shape this catches:
  //
  //   export function isCodPayment(payment, order) { … }
  //   …
  //   const isCodPayment = !isWallet && isCodPayment(payment, order);
  //
  // The `const` shadows the module-level predicate, and a binding is inside its
  // own temporal dead zone until its initializer finishes — so the call on the
  // right-hand side resolves to the binding under construction and throws
  // ReferenceError. This is not a style nit. That exact line shipped in postSale,
  // fired on every sale, was swallowed by non-strict ledger posting as "will be
  // backfilled", and the backfill re-ran the same line and failed identically
  // forever. It reached main, and CI's first-ever successful run found it as two
  // missing sale_captured journals and ₹248 of wallet drift. Review did not.
  //
  // It is statically detectable, which is why it belongs in a gate rather than in
  // someone's memory. Named function and class expressions (`const f = function
  // f () {}`) are legal self-reference and are excluded.
  const hits = [];
  for (const f of ALL) {
    const src = fs.readFileSync(f, 'utf8');

    // Names bound to a function in this module — declarations plus imports. An
    // imported *constant* shadowed this way is the same bug, so imports count too.
    const fnNames = new Set();
    for (const m of src.matchAll(/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)/g)) {
      fnNames.add(m[1]);
    }
    for (const m of src.matchAll(/import[ \t]*\{([\s\S]*?)\}[ \t]*from/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) fnNames.add(name);
      }
    }
    if (fnNames.size === 0) continue;

    for (const m of src.matchAll(/(?:^|\n)[ \t]*(?:const|let)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*([^\n]*)/g)) {
      const name = m[1];
      const init = m[2];
      if (!fnNames.has(name)) continue;
      if (/^(?:async[ \t]+)?function\b/.test(init) || /^class\b/.test(init)) continue;
      // A call, not a property of the same name: `foo(` with no leading dot.
      const call = new RegExp(`(^|[^.\\w$])${name.replace(/[$]/g, '\\$')}[ \t]*\\(`);
      if (!call.test(init)) continue;
      const line = src.slice(0, m.index + 1).split('\n').length;
      hits.push(`${rel(f)}:${line}  const ${name} = …${name}(…) shadows a function of the same name`);
    }
  }
  check('no const/let initializer calls the function name it shadows (TDZ)', hits,
    hits.slice(0, 8).join('\n       '));
}

console.log(`\n${'─'.repeat(64)}`);
if (notes.length) {
  console.log('Ratchet tightened (lower than baseline — rebase to lock it in):');
  for (const n of notes) console.log(`  • ${n}`);
  console.log();
}
if (violations.length) {
  console.log(`lint: ${passed} checks passed, ${violations.length} FAILED`);
  console.log('\nFailures:');
  for (const v of violations) console.log(`  • ${v}`);
  console.log('\nReal ESLint is not installed — adding it to package.json without a');
  console.log('matching lockfile entry would break `npm ci`. This gate runs the rule');
  console.log('list in eslint.rules.js directly; eslint.config.js is ready for the');
  console.log('real thing the moment the dependency can be added.\n');
  process.exit(1);
}
console.log(`lint: all ${passed} checks passed ✔`);
console.log(`(${disables.length} annotations verified, ratcheted baseline holding)\n`);
