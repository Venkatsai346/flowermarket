/**
 * eslint.rules.js — the single source of truth for this codebase's lint rules.
 *
 * ── WHY THIS IS A DATA MODULE ───────────────────────────────────────────────
 * The repo carries ~70 `eslint-disable` comments and no linter: no ESLint
 * dependency, no config file, no `lint` script, and CI never lints. So the
 * annotations enforce nothing — a disable comment is a note to a reader, not a
 * contract with a tool, and nothing notices when the rule it names stops being a
 * rule anyone runs.
 *
 * Installing ESLint properly needs a lockfile update, and the lockfile cannot be
 * regenerated without network access. Adding the dependency to package.json
 * alone would break `npm ci` in CI outright ("package.json and package-lock.json
 * are not in sync"), which is worse than not having a linter. So:
 *
 *   • THIS FILE holds the rules as plain data, with no imports at all.
 *   • `eslint.config.js` builds a real ESLint flat config from it — ready to
 *     activate the moment ESLint is installed (see docs/PRODUCTION.md).
 *   • `scripts/lint.test.js` imports the SAME data and enforces the subset that
 *     can be checked without ESLint, today, in CI.
 *
 * One rule list, two consumers, and neither can drift from the other — which is
 * also what stops this file from being a dead artifact until ESLint arrives.
 */

/**
 * Rules this codebase actually wants. Kept deliberately small: a config that
 * flags a thousand existing lines gets switched off, and the point is that the
 * annotations start meaning something.
 *
 * Values use ESLint's own shapes so eslint.config.js can pass them straight
 * through: 'off' | 'warn' | 'error' | [severity, options].
 */
export const RULES = Object.freeze({
  // The two the code already annotates for, 38 and 28 times respectively.
  // `no-await-in-loop` is the one that matters: several of those disables are
  // load-bearing (saga compensation ordering, chain-anchor CAS) but the cart path
  // had thirteen that were pure N+1 — two sequential queries per line on the
  // hottest read in the app. Warn rather than error, because the correct answer
  // is often "keep it sequential and say why".
  'no-await-in-loop': 'warn',
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

  // Correctness, not style.
  'no-debugger': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error',
  // Standard recommended rule. The SMTP MIME encoder disables it once,
  // deliberately: /^[\x00-\x7F]*$/ is how it decides whether a header is pure
  // ASCII or needs RFC 2047 encoding, which is a control-character range by
  // necessity rather than by accident.
  'no-control-regex': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],

  // ESM-only backend: a stray require() would only fail at runtime.
  'no-restricted-globals': ['error', 'require'],

  // Hygiene that costs nothing to satisfy and catches real slips.
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'object-shorthand': ['warn', 'properties'],
});

/**
 * Rules a disable comment is allowed to name.
 *
 * This is the check that makes the annotations mean something. A comment naming a
 * rule that is not configured — or a blanket `// eslint-disable-next-line` with no
 * rule at all — silences nothing and tells the reader nothing. Every disable in
 * the tree must name one of these.
 */
export const DISABLE_ALLOWED = Object.freeze([
  'no-await-in-loop',
  'no-console',
  'no-unused-vars',
  // used by the SMTP MIME encoder, which must match a control-character range to
  // decide whether a header needs RFC 2047 encoding at all
  'no-control-regex',
]);

/**
 * Rules that must be justified in prose, not just disabled.
 *
 * `no-await-in-loop` is the one that hides N+1 queries, and "the codebase always
 * did it this way" is not a reason. A disable for it must carry an adjacent
 * comment saying whether the sequential await is load-bearing (ordering, CAS,
 * contention) or incidental — which is exactly the distinction that let thirteen
 * cart queries go unbatched for as long as they did.
 */
export const DISABLE_REQUIRES_JUSTIFICATION = Object.freeze(['no-await-in-loop']);

/** Words that make a justification a justification, checked case-insensitively. */
export const JUSTIFICATION_MARKERS = Object.freeze([
  'on purpose', 'deliberate', 'intentional', 'must be sequential', 'sequential',
  'order', 'ordering', 'cas', 'atomic', 'compensat', 'contention', 'contend',
  'one at a time', 'in turn', 'depends on the previous', 'previous iteration',
  'rare', 'once per process', 'migration', 'bounded',
]);

/**
 * Test-runner patterns that must never reach a committed suite.
 *
 * Anchored to the runner's own globals on purpose. A bare `\\.skip\\(` would flag
 * every paginated query in the codebase — `Model.find(q).skip(n).limit(m)` appears
 * in dozens of services and has nothing to do with a skipped test — and a bare
 * `\\.only\\(` would flag `Object.prototype.hasOwnProperty` style calls. The false
 * positives would get the rule switched off, which is how linters die.
 */
export const FORBIDDEN_IN_TESTS = Object.freeze([
  { pattern: '\\b(describe|it|test)\\.only\\s*\\(', label: 'a focused test (.only) silently skips every other suite' },
  { pattern: '\\b(describe|it|test)\\.skip\\s*\\(', label: 'a skipped test silently stops protecting anything' },
]);

/**
 * Merge conflict markers — cheap to check, catastrophic to commit.
 *
 * Anchored to the start of a line and, for the separator, to EXACTLY seven equals
 * with nothing after it. Git writes `=======` alone on its line; this codebase
 * writes `// =====...` banners as section separators in dozens of files, so an
 * unanchored check would flag all of them.
 */
export const MERGE_MARKERS = Object.freeze([/^<{7}( |$)/m, /^={7}$/m, /^>{7}( |$)/m]);

export default {
  RULES,
  DISABLE_ALLOWED,
  DISABLE_REQUIRES_JUSTIFICATION,
  JUSTIFICATION_MARKERS,
  FORBIDDEN_IN_TESTS,
  MERGE_MARKERS,
};
