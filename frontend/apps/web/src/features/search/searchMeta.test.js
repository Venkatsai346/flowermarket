import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WEIGHTS,
  DEFAULT_TUNING,
  RANKING_SIGNAL_META,
  emptyProfile,
  profilePayload,
  profileToForm,
  synonymPayload,
  trafficProjection,
} from './searchMeta.js';

test('ranking signal meta covers every backend signal', () => {
  for (const key of ['text', 'popularity', 'ctr', 'availability', 'freshness', 'discount', 'vendor', 'margin']) {
    assert.ok(RANKING_SIGNAL_META[key], `missing signal ${key}`);
    assert.ok(DEFAULT_WEIGHTS[key] != null, `missing default weight ${key}`);
  }
  assert.equal(DEFAULT_WEIGHTS.text, 1);
  assert.equal(DEFAULT_TUNING.outOfStockFloor, true);
});

test('profile payload lowercases code and normalizes editorial fields', () => {
  const payload = profilePayload({
    code: '  Premium  ',
    name: 'Premium weekdays',
    description: ' Freshness first ',
    trafficPct: 15,
    isActive: true,
    isDefault: false,
    weights: { text: 1.4, freshness: 2 },
    tuning: { freshnessHalfLifeHours: 48, outOfStockFloor: true },
    pins: [{ query: 'rose', listingIds: 'a, b ,   ' }, { query: '', listingIds: '' }],
    buries: 'x, y, ',
  });
  assert.equal(payload.code, 'premium');
  assert.equal(payload.description, 'Freshness first');
  assert.equal(payload.weights.freshness, 2);
  assert.equal(payload.weights.text, 1.4);
  assert.deepEqual(payload.pins, [{ query: 'rose', listingIds: ['a', 'b'] }]);
  assert.deepEqual(payload.buries, ['x', 'y']);
});

test('profile roundtrip keeps tuning booleans and pins', () => {
  const form = profileToForm({
    code: 'fresh',
    name: 'Fresh',
    weights: { freshness: 2 },
    tuning: { outOfStockFloor: false },
    pins: [{ query: 'rose', listingIds: ['a', 'b'] }],
    buries: ['x'],
  }, { weights: DEFAULT_WEIGHTS, tuning: DEFAULT_TUNING });
  const payload = profilePayload(form);
  assert.equal(payload.tuning.outOfStockFloor, false);
  assert.deepEqual(payload.pins[0].listingIds, ['a', 'b']);
  assert.deepEqual(payload.buries, ['x']);
});

test('traffic projection excludes the profile being edited', () => {
  const profiles = [
    { id: '1', isActive: true, trafficPct: 30 },
    { id: '2', isActive: true, trafficPct: 40 },
    { id: 'off', isActive: false, trafficPct: 90 },
  ];
  assert.equal(trafficProjection({ profiles, current: { id: '1' }, trafficPct: 35 }), 75);
  assert.equal(trafficProjection({ profiles, current: null, trafficPct: 35 }), 105);
});

test('synonym payload trims, lowercases and only carries `from` for one-way rules', () => {
  const eq = synonymPayload({ terms: 'Rose,  Roses ,Gulab', type: 'equivalent', from: 'rose', note: 'vocab' });
  assert.deepEqual(eq.terms, ['rose', 'roses', 'gulab']);
  assert.equal(eq.from, null);
  assert.equal(eq.note, 'vocab');
  const ow = synonymPayload({ terms: 'bouquet', type: 'oneway', from: ' guldasta ', note: '' });
  assert.equal(ow.from, 'guldasta');
  assert.equal(ow.note, null);
});

test('empty profile seeds weights from the backend defaults', () => {
  const f = emptyProfile({ weights: { text: 1.2 } });
  assert.equal(f.weights.text, 1.2);
  assert.equal(f.weights.popularity, DEFAULT_WEIGHTS.popularity);
  assert.deepEqual(profilePayload(f).pins, []);
});
