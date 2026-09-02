/**
 * Duplicate-detection similarity for product masters.
 * Uses token (word) overlap + character bigram Dice coefficient.
 * Thresholds: barcode exact -> hard duplicate; title similarity >= 0.8 -> flag.
 */

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'with', 'and', 'or', 'in', 'on', 'pack', 'pkt', 'box']);

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter(Boolean)
    .filter((t) => !STOP.has(t));
}

function bigrams(word) {
  const out = new Set();
  const w = ` ${word} `.toLowerCase();
  for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams of the full normalized string. */
export function bigramDice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

/** Jaccard similarity over word tokens. */
export function tokenJaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size);
}

/** Combined title similarity in [0,1]. */
export function titleSimilarity(a, b) {
  return Math.max(bigramDice(a, b), tokenJaccard(a, b));
}

export const DUPLICATE_TITLE_THRESHOLD = 0.8;
