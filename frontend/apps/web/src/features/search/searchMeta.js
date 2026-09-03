/** Search-relevance metadata + profile form converters (matches backend enums). */

export const RANKING_SIGNALS = [
  ['text', 'Text match', 'How well the query matches the title, description and tags.'],
  ['popularity', 'Popularity', 'Log-damped 30-day sales — a bestseller does not run away with the list.'],
  ['ctr', 'Click-through', 'Bayesian-smoothed click-through rate so one lucky click is not a signal.'],
  ['availability', 'Availability', 'Out-of-stock is demoted, never hidden; low stock is gently softened.'],
  ['freshness', 'Freshness', 'Exponential age decay — decisive for cut flowers.'],
  ['discount', 'Discount', 'How deep the discount is versus a deep-discount reference.'],
  ['vendor', 'Vendor quality', 'Seller rating so a bad seller cannot buy the top slot.'],
  ['margin', 'Margin', 'Deliberately small business signal, always disclosed.'],
];

export const RANKING_SIGNAL_META = Object.fromEntries(
  RANKING_SIGNALS.map(([key, label, hint]) => [key, { label, hint }]),
);

export const DEFAULT_WEIGHTS = Object.freeze({
  text: 1,
  popularity: 0.6,
  ctr: 0.5,
  availability: 0.8,
  freshness: 0.4,
  discount: 0.2,
  vendor: 0.2,
  margin: 0.1,
});

export const DEFAULT_TUNING = Object.freeze({
  popularityReference: 1000,
  ctrPrior: 0.08,
  ctrWeight: 50,
  freshnessHalfLifeHours: 72,
  lowStockThreshold: 5,
  promotedBoost: 0.25,
  returnPenalty: 0.3,
  outOfStockFloor: true,
});

import { SYNONYM_TYPE_META } from '@flower-market/shared';

export { SYNONYM_TYPE_META };

/** 0.923 -> "92.3" (percentage display without the trailing sign). */
export const ctrTooltip = (n) => (Number(n) || 0).toFixed(1);

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const emptyProfile = (defaults = {}) => ({
  code: '',
  name: '',
  description: '',
  trafficPct: 0,
  isActive: true,
  isDefault: false,
  weights: { ...DEFAULT_WEIGHTS, ...(defaults.weights || {}) },
  tuning: { ...DEFAULT_TUNING, ...(defaults.tuning || {}) },
  pins: [],
  buries: '',
});

export const profileToForm = (p, defaults = {}) => ({
  code: p.code || '',
  name: p.name || '',
  description: p.description || '',
  trafficPct: num(p.trafficPct, 0),
  isActive: Boolean(p.isActive),
  isDefault: Boolean(p.isDefault),
  weights: { ...DEFAULT_WEIGHTS, ...(defaults.weights || {}), ...(p.weights || {}) },
  tuning: { ...DEFAULT_TUNING, ...(defaults.tuning || {}), ...(p.tuning || {}) },
  pins: (p.pins || []).map((pin) => ({
    query: pin?.query || '',
    listingIds: (pin?.listingIds || []).map(String).join(', '),
  })),
  buries: (p.buries || []).map(String).join(', '),
});

const parseIds = (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean);

export const profilePayload = (f) => ({
  code: String(f.code || '').trim().toLowerCase(),
  name: String(f.name || '').trim(),
  description: String(f.description || '').trim() || null,
  trafficPct: num(f.trafficPct, 0),
  isActive: Boolean(f.isActive),
  isDefault: Boolean(f.isDefault),
  weights: Object.fromEntries(
    RANKING_SIGNALS.map(([key]) => [key, num(f.weights?.[key], DEFAULT_WEIGHTS[key])]),
  ),
  tuning: {
    popularityReference: num(f.tuning?.popularityReference, DEFAULT_TUNING.popularityReference),
    ctrPrior: num(f.tuning?.ctrPrior, DEFAULT_TUNING.ctrPrior),
    ctrWeight: num(f.tuning?.ctrWeight, DEFAULT_TUNING.ctrWeight),
    freshnessHalfLifeHours: num(f.tuning?.freshnessHalfLifeHours, DEFAULT_TUNING.freshnessHalfLifeHours),
    lowStockThreshold: num(f.tuning?.lowStockThreshold, DEFAULT_TUNING.lowStockThreshold),
    promotedBoost: num(f.tuning?.promotedBoost, DEFAULT_TUNING.promotedBoost),
    returnPenalty: num(f.tuning?.returnPenalty, DEFAULT_TUNING.returnPenalty),
    outOfStockFloor: Boolean(f.tuning?.outOfStockFloor ?? DEFAULT_TUNING.outOfStockFloor),
  },
  pins: (f.pins || [])
    .map((pin) => ({
      query: String(pin?.query || '').trim() || null,
      listingIds: parseIds(pin?.listingIds || ''),
    }))
    .filter((pin) => pin.listingIds.length > 0),
  buries: parseIds(f.buries || ''),
});

export const trafficProjection = ({ profiles = [], current, trafficPct }) => {
  const others = (profiles || [])
    .filter((p) => p.isActive && (!current || String(p.id || '') !== String(current.id || '')))
    .reduce((sum, p) => sum + (Number(p.trafficPct) || 0), 0);
  return others + (Number(trafficPct) || 0);
};

export const emptySynonym = () => ({
  terms: '',
  type: 'equivalent',
  from: '',
  note: '',
  isActive: true,
});

export const synonymPayload = (f) => ({
  terms: String(f.terms || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  type: f.type,
  from: f.type === 'oneway' ? String(f.from || '').trim().toLowerCase() || null : null,
  note: String(f.note || '').trim() || null,
  isActive: Boolean(f.isActive),
});
