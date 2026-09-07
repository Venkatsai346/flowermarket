import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_KITS, BRAND_KIT_IDS, resolveBrandTheme } from './kits.js';

test('three florist kits with WCAG-safe-enough contrast colours', () => {
  assert.deepEqual([...BRAND_KIT_IDS].sort(), ['marigold', 'rose', 'tropical']);
  for (const id of BRAND_KIT_IDS) {
    const k = BRAND_KITS[id];
    assert.match(k.primaryColor, /^#[0-9A-Fa-f]{6}$/);
    assert.match(k.accentColor, /^#[0-9A-Fa-f]{6}$/);
    assert.match(k.hero, /^\/brand\/hero-/);
  }
});

test('resolveBrandTheme defaults to classic rose and fills missing hex', () => {
  const empty = resolveBrandTheme({});
  assert.equal(empty.kit, 'rose');
  assert.equal(empty.primaryColor, BRAND_KITS.rose.primaryColor);

  const marigold = resolveBrandTheme({ kit: 'marigold' });
  assert.equal(marigold.kit, 'marigold');
  assert.equal(marigold.primaryColor, BRAND_KITS.marigold.primaryColor);

  const override = resolveBrandTheme({ kit: 'tropical', primaryColor: '#112233' });
  assert.equal(override.primaryColor, '#112233');
  assert.equal(override.accentColor, BRAND_KITS.tropical.accentColor);
});
