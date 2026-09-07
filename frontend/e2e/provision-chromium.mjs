#!/usr/bin/env node
/**
 * Provision the CI/local browser from @sparticuz/chromium (installed in this
 * package): extracts the chromium binary to $CHROMIUM_BIN (default
 * /tmp/chromium) and the NSS/NSPR shared libs to $BROWSER_LIBS_DIR (default
 * ~/.browser-libs). Idempotent — existing artifacts are kept.
 *
 * Run from anywhere:  node frontend/e2e/provision-chromium.mjs
 * (resolves the package from this directory's node_modules)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(here, 'node_modules/@sparticuz/chromium');
const BIN = path.join(PKG, 'bin');
const CHROMIUM_BIN = process.env.CHROMIUM_BIN || '/tmp/chromium';
const LIBS_DIR = process.env.BROWSER_LIBS_DIR || path.join(os.homedir(), '.browser-libs');

for (const f of ['chromium.br', 'al2023.tar.br']) {
  if (!fs.existsSync(path.join(BIN, f))) {
    console.error(`[provision] missing ${path.join(BIN, f)} — run "npm ci" in frontend/e2e first`);
    process.exit(1);
  }
}
const { inflate } = await import(path.join(PKG, 'build', 'lambdafs.js'));

fs.mkdirSync(LIBS_DIR, { recursive: true });

if (!fs.existsSync(CHROMIUM_BIN)) {
  const src = await inflate(path.join(BIN, 'chromium.br'));
  fs.copyFileSync(src, CHROMIUM_BIN);
  fs.chmodSync(CHROMIUM_BIN, 0o755);
  console.log(`[provision] chromium → ${CHROMIUM_BIN}`);
} else {
  console.log(`[provision] chromium already at ${CHROMIUM_BIN}`);
}

const libsRoot = await inflate(path.join(BIN, 'al2023.tar.br'));
let n = 0;
for (const entry of fs.readdirSync(libsRoot, { recursive: true })) {
  const name = path.basename(entry);
  const p = path.join(libsRoot, entry);
  if (fs.statSync(p).isFile() && name.includes('.so')) {
    fs.copyFileSync(p, path.join(LIBS_DIR, name));
    n++;
  }
}
console.log(`[provision] ${n} shared libs → ${LIBS_DIR}`);
console.log(`[provision] done (CHROMIUM_BIN=${CHROMIUM_BIN} BROWSER_LIBS_DIR=${LIBS_DIR})`);
