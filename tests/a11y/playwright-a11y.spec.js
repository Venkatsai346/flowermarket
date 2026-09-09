/**
 * Playwright accessibility test — runs axe-core against live pages.
 *
 * Prerequisites:
 *   npm i -D @axe-core/playwright playwright
 *
 * Run: npx playwright test tests/a11y/playwright-a11y.spec.js
 *
 * Tests the critical pages against WCAG 2.1 AA.
 * Reports violations as test failures with full details.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const PAGES = [
  { name: 'Login', path: '/login' },
  { name: 'Dashboard', path: '/' },
  { name: 'Catalog', path: '/catalog' },
  { name: 'Orders', path: '/orders' },
  { name: 'Search', path: '/search' },
];

test.describe('Accessibility', () => {
  for (const page of PAGES) {
    test(`${page.name} (${page.path}) has no critical a11y violations`, async ({ page: p }) => {
      await p.goto(`${BASE_URL}${page.path}`, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (critical.length > 0) {
        console.log(`\n${page.name} a11y violations:`);
        for (const v of critical) {
          console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
          console.log(`    Help: ${v.helpUrl}`);
          for (const node of v.nodes.slice(0, 3)) {
            console.log(`    → ${node.html}`);
          }
        }
      }

      expect(critical).toHaveLength(0);
    });
  }
});
