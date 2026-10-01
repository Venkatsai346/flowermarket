#!/usr/bin/env node
/** Keep the production-safe backend snapshot aligned with the UI guidance book. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_PLAYBOOKS } from '../../frontend/apps/web/src/features/catalog/catalogGuidance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, '../src/data/catalogCategoryPlaybooks.js');
const expected = `/**
 * GENERATED FILE — canonical seed snapshot from the Catalog Guidance Book.
 * Regenerate with: npm run catalog:taxonomy:sync
 * Do not edit manually.
 */
export const CATEGORY_PLAYBOOKS = ${JSON.stringify(CATEGORY_PLAYBOOKS, null, 2)};
`;
const check = process.argv.includes('--check');
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';

if (check) {
  if (current !== expected) {
    console.error('Catalog playbook snapshot is stale. Run: npm run catalog:taxonomy:sync');
    process.exitCode = 1;
  } else {
    console.log('Catalog playbook snapshot is current.');
  }
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
  console.log(`Wrote ${CATEGORY_PLAYBOOKS.length} catalog playbooks to ${target}`);
}
