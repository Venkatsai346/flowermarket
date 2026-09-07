// Shared browser-E2E harness for the Flower Market UI suites.
// Real Chromium (from @sparticuz/chromium npm pkg) driven by puppeteer-core,
// against the running Vite dev servers (:5173 admin web, :5174 storefront)
// which proxy /api to the live backend on :4000.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SHOT_DIR = path.join(here, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

export const API = 'http://127.0.0.1:4000/api/v1';
// CI re-seeds a fresh tenant per run; scripts/ci/boot-live-stack.sh exports
// FM_TENANT_ID via /tmp/fm-ci/env.sh.
export const TENANT = process.env.FM_TENANT_ID || '6a9d8621360a608803fe1a62';
export const ADMIN_EMAIL = 'admin@flowermarket.in';
export const ADMIN_PASSWORD = 'Admin@12345';

// API stdout log — the OTP console provider prints one-time codes here.
// Resolution: $API_LOG_FILE → scripts/ci convention (/tmp/fm-ci/api.out.log,
// set by scripts/ci/boot-live-stack.sh) → newest flower-market-api-* process
// dir's out.log (sandbox start_process convention).
function resolveLogFile() {
  if (process.env.API_LOG_FILE) return process.env.API_LOG_FILE;
  // The live API process's log wins by mtime — a stale conventional path
  // (left over from a previous CI-style run) must not shadow the process
  // that is actually serving requests right now.
  let chosen = null, mtime = 0;
  const consider = (p) => {
    if (!p || !fs.existsSync(p)) return;
    const m = fs.statSync(p).mtimeMs;
    if (m >= mtime) { mtime = m; chosen = p; }
  };
  consider('/tmp/fm-ci/api.out.log');
  const dir = '/tmp/arena-workspace/procs';
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.name.startsWith('flower-market-api-')) continue;
      consider(path.join(dir, e.name, 'out.log'));
    }
  }
  return chosen;
}
export const LOG_FILE = resolveLogFile();

// Browser binary + NSS/NSPR lib dir (see scripts/ci — CI provisions its own
// Chromium via @sparticuz/chromium and points these at it).
export const CHROMIUM_BIN = process.env.CHROMIUM_BIN || '/tmp/chromium';
export const BROWSER_LIBS_DIR = process.env.BROWSER_LIBS_DIR || '/home/user/.browser-libs';

// ---------- browser ----------

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROMIUM_BIN,
    headless: 'new',
    // the provisioned libs dir is passed to the child process directly, so
    // the launching shell does not need LD_LIBRARY_PATH set
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${BROWSER_LIBS_DIR}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`,
    },
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--hide-scrollbars',
    ],
    defaultViewport: { width: 1366, height: 900 },
    timeout: 30000,
  });
}

/** New page with console/pageerror/request-failure capture. */
export async function makePage(browser, tag) {
  const page = await browser.newPage();
  const issues = { console: [], pageerrors: [], netfail: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') issues.console.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => issues.pageerrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.startsWith('data:')) return;
    issues.netfail.push(`${r.failure()?.errorText} ${u.slice(0, 120)}`);
  });
  page._issues = issues;
  page._tag = tag;
  return page;
}

export async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  return p;
}

// ---------- result tracking ----------

export class Runner {
  constructor(suite) {
    this.suite = suite;
    this.results = [];
    this.notes = [];
  }

  note(msg) {
    this.notes.push(msg);
    console.log(`  · ${msg}`);
  }

  record(id, desc, ok, detail = '') {
    this.results.push({ id, desc, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}${detail ? `  — ${detail}` : ''}`);
  }

  /** Run an async assertion; PASS/FAIL with evidence on failure. */
  async check(id, desc, fn, { shot: shotName } = {}) {
    try {
      const detail = (await fn()) || '';
      this.record(id, desc, true, typeof detail === 'string' ? detail : '');
      if (shotName) await shot(this.#lastPage, shotName);
      return true;
    } catch (e) {
      const detail = String(e?.message || e).slice(0, 300);
      this.record(id, desc, false, detail);
      if (this.#lastPage) {
        await shot(this.#lastPage, `${shotName || id}-FAIL`);
        try {
          const t = await bodyText(this.#lastPage);
          this.note(`${id} page text: ${t.replace(/\s+/g, ' ').slice(0, 400)}`);
        } catch {}
      }
      return false;
    }
  }

  #lastPage = null;
  setPage(p) { this.#lastPage = p; return p; }

  async printSummary() {
    const pass = this.results.filter((r) => r.ok).length;
    const total = this.results.length;
    console.log(`\n=== ${this.suite}: ${pass}/${total} passed ===`);
    for (const r of this.results) if (!r.ok) console.log(`  FAIL ${r.id}: ${r.desc} — ${r.detail}`);
    return { pass, total };
  }
}

// ---------- page helpers ----------

export async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText || '');
}

export async function waitText(page, text, timeout = 10000) {
  const rx = text instanceof RegExp ? text : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeout) {
    last = await bodyText(page);
    if (rx.test(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${rx}; page had: …${last.replace(/\s+/g, ' ').slice(-300)}`);
}

export async function waitGone(page, text, timeout = 10000) {
  const rx = text instanceof RegExp ? text : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await bodyText(page);
    if (!rx.test(t)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return !rx.test(await bodyText(page));
}

/** Click the first visible element (button/a/label/div[role=button]) whose text matches. */
export async function clickText(page, text, opts = {}) {
  const { exact = false, tag = null, timeout = 8000 } = opts;
  const rx = text instanceof RegExp ? text : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeout) {
    const clicked = await page.evaluate(({ rxSrc, flags, exact, tag }) => {
      const rx = new RegExp(rxSrc, flags);
      const sel = tag
        ? `${tag}, [role=button], button, a`
        : 'button, a, [role=button], label, [class*=chip]';
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const t = (el.innerText || '').trim();
        if (!t) continue;
        if (exact ? t === rx.source || rx.test(t) : rx.test(t)) {
          if (el.offsetParent === null && getComputedStyle(el).visibility === 'hidden') continue;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return t;
        }
      }
      return null;
    }, { rxSrc: rx.source, flags: rx.flags, exact, tag });
    if (clicked) return clicked;
    lastErr = `no clickable element matching ${rx}`;
    await new Promise((r) => setTimeout(r, 250));
  }
  const t = (await bodyText(page)).replace(/\s+/g, ' ');
  throw new Error(`${lastErr}; page: …${t.slice(-300)}`);
}

/** Type into the first input/textarea matching a CSS selector (clears first). */
export async function typeInto(page, selector, value, { clear = true } = {}) {
  await page.waitForSelector(selector, { timeout: 8000 });
  const handle = await page.$(selector);
  if (clear) await handle.click({ clickCount: 3 });
  await handle.type(value, { delay: 12 });
}

/** Select option by value in first <select> matching selector. */
export async function selectOption(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.select(selector, value);
}

/** Wait until a CSS selector matches, return true/false. */
export async function hasSelector(page, selector, timeout = 8000) {
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    return true;
  } catch {
    return false;
  }
}

/** Count elements matching a selector. */
export async function countSel(page, selector) {
  return page.$$eval(selector, (els) => els.length).catch(() => 0);
}

// ---------- OTP (from backend console log) ----------

export function logOffset() {
  try {
    return fs.statSync(LOG_FILE).size;
  } catch {
    return 0;
  }
}

/** Read the most recent OTP code logged after `offset`. */
export function grabOtp(offset, { expectPhone } = {}) {
  try {
    const size = fs.statSync(LOG_FILE).size;
    if (size <= offset) return null;
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const chunk = buf.toString('utf8');
    const lines = chunk.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (expectPhone && !lines[i].includes(expectPhone)) continue;
      const m = lines[i].match(/code=(\d{6})/);
      if (m) return m[1];
    }
    // code may be on the line after the phone line
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/code=(\d{6})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- backend API (setup / cross-checks) ----------

export async function api(method, urlPath, body, { token, tenant = TENANT } = {}) {
  let url = `${API}${urlPath}`;
  const isGet = ['GET', 'HEAD'].includes(method.toUpperCase());
  if (isGet && body && typeof body === 'object') {
    const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
    body = undefined;
  }
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(tenant ? { 'x-tenant-id': tenant } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    const err = new Error(`${method} ${urlPath} -> ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data?.data ?? data;
}

export async function adminLogin() {
  const d = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, method: 'email_password' });
  return d.accessToken || d.tokens?.accessToken;
}

let _unique = null;
/** A phone number unique per process run (customers, riders, …). */
export function uniquePhone(prefix = '98') {
  if (!_unique) _unique = Math.floor(10000000 + Math.random() * 89999999);
  return prefix + _unique;
}
