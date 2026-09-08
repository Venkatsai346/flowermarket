/**
 * eslint.config.js — flat config for the backend, built from eslint.rules.js.
 *
 * ── STATUS: READY, NOT YET ARMED ────────────────────────────────────────────
 * ESLint is not installed and cannot be added offline: putting it in
 * package.json without a matching package-lock.json entry makes `npm ci` fail
 * outright in CI ("package.json and package-lock.json are not in sync"), which is
 * worse than having no linter. So today the rule list is enforced by
 * `scripts/lint.test.js` (npm run lint), which imports the SAME eslint.rules.js.
 *
 * To arm the real thing:
 *   1. npm i -D eslint @eslint/js globals          (needs network)
 *   2. npm run lint:eslint                        (this file)
 *   3. change "lint" in package.json to run both, and keep the ratchet gate —
 *      it checks things ESLint does not (stale disables, unjustified
 *      no-await-in-loop, per-file baselines).
 *
 * This file deliberately imports NOTHING but eslint.rules.js, so it loads and can
 * be validated today instead of being a dead artifact that rots until someone
 * installs ESLint. When `@eslint/js` and `globals` are available, extend
 * languageOptions.globals from the `globals` package and spread
 * js.configs.recommended ahead of these rules; nothing below needs to change.
 */

import { RULES } from './eslint.rules.js';

/** Node built-ins this codebase uses as bare globals. */
const NODE_GLOBALS = Object.freeze({
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  fetch: 'readonly',
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
});

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'storage/**', 'uploads/**'],
  },

  // ---- application + worker code ----
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    linterOptions: {
      // A disable comment naming a rule that is not configured is dead weight —
      // it reads as deliberate while enforcing nothing. Report it.
      reportUnusedDisableDirectives: 'error',
    },
    rules: { ...RULES },
  },

  // ---- suites and tooling: console is the output channel, not a smell ----
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    rules: {
      ...RULES,
      'no-console': 'off',
      // suites assert on purpose-built nonsense (NaN, negative money, null
      // tenants); flagging it would argue with the test
      'no-constant-condition': 'off',
    },
  },
];
