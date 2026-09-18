import { badRequest } from '../ApiError.js';

const CODE_RX = /^[a-z][a-z0-9_]{0,39}$/;
const clean = (v) => String(v ?? '').trim();
const codeOf = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Normalize a universal option definition (`Color`, `Size`, `Storage`, ...).
 * Option codes are stable API identities; labels are presentation only.
 */
export function normalizeOptionDefinition(option) {
  const name = clean(option?.name);
  const code = codeOf(option?.code || name);
  if (!name || !CODE_RX.test(code)) throw badRequest('Every option needs a valid name/code', 'OPTION_INVALID');
  const values = [...new Set((option?.values || []).map(clean).filter(Boolean))];
  if (!values.length || values.length > 100) {
    throw badRequest(`Option "${name}" needs 1–100 unique values`, 'OPTION_INVALID');
  }
  return {
    code,
    name,
    values,
    displayType: ['text', 'swatch', 'image'].includes(option?.displayType) ? option.displayType : 'text',
    sortOrder: Number.isInteger(option?.sortOrder) ? option.sortOrder : 0,
  };
}

export function normalizeOptionDefinitions(options = []) {
  if (!Array.isArray(options) || options.length > 6) {
    throw badRequest('A product supports at most 6 option dimensions', 'OPTION_INVALID');
  }
  const normalized = options.map(normalizeOptionDefinition);
  const codes = normalized.map((o) => o.code);
  if (new Set(codes).size !== codes.length) throw badRequest('Option codes must be unique', 'OPTION_DUPLICATE');
  return normalized;
}

/**
 * Canonicalize one variant combination. Ordering never changes identity:
 * Color=Red + Size=M and Size=M + Color=Red produce the same key.
 */
export function normalizeOptionValues(values = [], definitions = []) {
  if (!Array.isArray(values) || values.length > 6) {
    throw badRequest('A variant supports at most 6 option values', 'VARIANT_OPTIONS_INVALID');
  }
  const defs = new Map((definitions || []).map((d) => [d.code, d]));
  const out = values.map((entry) => {
    const code = codeOf(entry?.code || entry?.name);
    const value = clean(entry?.value);
    if (!CODE_RX.test(code) || !value || value.length > 100) {
      throw badRequest('Every variant option needs a valid code and value', 'VARIANT_OPTIONS_INVALID');
    }
    const def = defs.get(code);
    if (definitions.length && !def) throw badRequest(`Unknown product option: ${code}`, 'VARIANT_OPTION_UNKNOWN');
    if (def && !def.values.includes(value)) {
      throw badRequest(`Value "${value}" is not allowed for ${def.name}`, 'VARIANT_OPTION_VALUE_INVALID');
    }
    return { code, name: clean(entry?.name || def?.name || code), value };
  });
  if (new Set(out.map((o) => o.code)).size !== out.length) {
    throw badRequest('A variant cannot repeat an option dimension', 'VARIANT_OPTION_DUPLICATE');
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function combinationKey(optionValues = [], legacy = {}) {
  const normalized = [...optionValues].sort((a, b) => a.code.localeCompare(b.code));
  if (normalized.length) {
    return normalized.map((o) => `${encodeURIComponent(o.code)}=${encodeURIComponent(clean(o.value).toLowerCase())}`).join('&');
  }
  const type = codeOf(legacy.variantType || 'option');
  const value = clean(legacy.value).toLowerCase();
  return `${encodeURIComponent(type)}=${encodeURIComponent(value)}`;
}

/** Validate physical dimensions and return a storage-safe normalized object. */
export function normalizeMeasurements(input = null) {
  if (!input) return null;
  const number = (v, label) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} must be a non-negative number`, 'MEASUREMENT_INVALID');
    return n;
  };
  return {
    weight: {
      value: number(input.weight?.value, 'Weight'),
      unit: input.weight?.unit || 'g',
    },
    dimensions: {
      length: number(input.dimensions?.length, 'Length'),
      width: number(input.dimensions?.width, 'Width'),
      height: number(input.dimensions?.height, 'Height'),
      unit: input.dimensions?.unit || 'cm',
    },
  };
}

export default { normalizeOptionDefinitions, normalizeOptionValues, combinationKey, normalizeMeasurements };
