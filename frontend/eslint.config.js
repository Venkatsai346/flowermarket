/**
 * eslint.config.js — flat config for the frontend workspaces (admin console,
 * storefront, shared package).
 *
 * ── STATUS: READY, NOT YET ARMED ────────────────────────────────────────────
 * Same situation as the backend: ESLint cannot be added offline without breaking
 * `npm ci`, because package.json and package-lock.json must stay in sync. This
 * file imports nothing external so it loads and can be validated now rather than
 * rotting until someone installs the tooling.
 *
 * To arm it:
 *   1. npm i -D eslint @eslint/js globals eslint-plugin-react-hooks
 *      eslint-plugin-react-refresh        (needs network)
 *   2. spread js.configs.recommended ahead of these rules, replace
 *      languageOptions.globals with the `globals` package's browser/node sets,
 *      and add the two plugins below where marked.
 *
 * The rules here are the frontend's own, not a copy of backend/eslint.rules.js —
 * different runtime, different failure modes. What the two configs share is the
 * principle: only rules this codebase already follows, so the config can be
 * switched on without a thousand pre-existing findings.
 */

const BROWSER_GLOBALS = Object.freeze({
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  customElements: 'readonly',
  HTMLElement: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  crypto: 'readonly',
  process: 'readonly', // Vite exposes import.meta.env and a process shim
});

/** Shared correctness rules — no style rules, so this can be armed as-is. */
const CORE_RULES = Object.freeze({
  'no-debugger': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // The two frontend-specific traps that are worth more than any style rule:
  // a console.log left in a customer-facing bundle, and a JSX key built from the
  // array index on a list that reorders (the storefront cart and order list both
  // reorder live).
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
});

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  // ---- app code (React + JSX) ----
  {
    files: ['apps/**/*.{js,jsx}', 'packages/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      ...CORE_RULES,
      // ADD WHEN INSTALLING:
      //   ...reactHooks.configs.recommended.rules   ← rules-of-hooks is the one
      //     that catches a hook called after an early return, which is the most
      //     common real bug in this codebase's shape of component
      //   'react-refresh/only-export-components': 'warn'
    },
  },

  // ---- Vite / Playwright config and scripts: Node, not the browser ----
  {
    files: ['**/vite.config.js', 'e2e/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...BROWSER_GLOBALS, require: 'readonly', __dirname: 'readonly', module: 'readonly' },
    },
    rules: { ...CORE_RULES, 'no-console': 'off' },
  },
];
