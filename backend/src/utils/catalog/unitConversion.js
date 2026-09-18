import { badRequest } from '../ApiError.js';

const UNIT_CODE_RX = /^[a-z][a-z0-9_]{0,39}$/;
const DIMENSIONS = new Set(['count', 'mass', 'volume', 'length', 'area', 'time', 'digital', 'custom']);

/** Normalize a product-local unit vocabulary into factors relative to one base unit. */
export function normalizeUnitPolicy(policy = null, legacyUnit = 'piece') {
  const fallback = String(legacyUnit || 'piece').toLowerCase();
  if (!policy) {
    const allowFractional = ['kilogram', 'gram', 'milligram', 'litre', 'millilitre', 'metre', 'centimetre'].includes(fallback);
    return {
      dimension: ['kg', 'kilogram', 'gram', 'milligram'].includes(fallback) ? 'mass' : ['litre', 'millilitre'].includes(fallback) ? 'volume' : ['metre', 'centimetre'].includes(fallback) ? 'length' : 'count',
      baseUnit: fallback,
      allowFractional,
      precision: allowFractional ? 3 : 0,
      units: [{ code: fallback, label: fallback.replace(/_/g, ' '), toBaseFactor: 1, precision: allowFractional ? 3 : 0 }],
    };
  }
  const dimension = String(policy.dimension || 'count');
  if (!DIMENSIONS.has(dimension)) throw badRequest('Unsupported unit dimension', 'UNIT_DIMENSION_INVALID');
  const baseUnit = String(policy.baseUnit || fallback).trim().toLowerCase();
  if (!UNIT_CODE_RX.test(baseUnit)) throw badRequest('baseUnit must be a normalized unit code', 'UNIT_CODE_INVALID');
  const units = (policy.units || []).map((unit) => ({
    code: String(unit.code || '').trim().toLowerCase(),
    label: String(unit.label || unit.code || '').trim(),
    toBaseFactor: Number(unit.toBaseFactor),
    precision: Number.isInteger(unit.precision) ? unit.precision : (Number.isInteger(policy.precision) ? policy.precision : 3),
  }));
  if (!units.some((unit) => unit.code === baseUnit)) {
    units.unshift({ code: baseUnit, label: baseUnit.replace(/_/g, ' '), toBaseFactor: 1, precision: policy.precision || 0 });
  }
  if (units.length > 50 || new Set(units.map((unit) => unit.code)).size !== units.length) {
    throw badRequest('Unit codes must be unique and limited to 50', 'UNIT_POLICY_INVALID');
  }
  for (const unit of units) {
    if (!UNIT_CODE_RX.test(unit.code) || !unit.label || !Number.isFinite(unit.toBaseFactor) || unit.toBaseFactor <= 0) {
      throw badRequest('Every unit needs a code, label and positive base factor', 'UNIT_POLICY_INVALID');
    }
    if (unit.precision < 0 || unit.precision > 6) throw badRequest('Unit precision must be 0–6', 'UNIT_POLICY_INVALID');
  }
  const base = units.find((unit) => unit.code === baseUnit);
  if (Math.abs(base.toBaseFactor - 1) > Number.EPSILON) {
    throw badRequest('The base unit conversion factor must equal 1', 'UNIT_BASE_FACTOR_INVALID');
  }
  return {
    dimension,
    baseUnit,
    allowFractional: Boolean(policy.allowFractional),
    precision: Number.isInteger(policy.precision) ? policy.precision : 3,
    units,
  };
}

export function convertQuantity(value, fromUnit, toUnit, policy) {
  const normalized = normalizeUnitPolicy(policy);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw badRequest('Quantity must be a non-negative number', 'QUANTITY_INVALID');
  const from = normalized.units.find((unit) => unit.code === fromUnit);
  const to = normalized.units.find((unit) => unit.code === toUnit);
  if (!from || !to) throw badRequest('Unit is not allowed for this product', 'UNIT_NOT_ALLOWED');
  const converted = (amount * from.toBaseFactor) / to.toBaseFactor;
  return Number(converted.toFixed(to.precision));
}

export function assertQuantity(value, unitCode, policy) {
  const normalized = normalizeUnitPolicy(policy);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Quantity must be greater than zero', 'QUANTITY_INVALID');
  if (!normalized.units.some((unit) => unit.code === unitCode)) throw badRequest('Unit is not allowed for this product', 'UNIT_NOT_ALLOWED');
  if (!normalized.allowFractional && !Number.isInteger(amount)) throw badRequest('This product requires whole-number quantities', 'FRACTIONAL_QUANTITY_NOT_ALLOWED');
  return amount;
}

export default { normalizeUnitPolicy, convertQuantity, assertQuantity };
