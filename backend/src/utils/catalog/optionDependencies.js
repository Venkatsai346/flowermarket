import { badRequest } from '../ApiError.js';

const codeOf = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

export function normalizeOptionRules(rules = [], definitions = []) {
  if (!Array.isArray(rules) || rules.length > 100) throw badRequest('A product supports at most 100 option rules', 'OPTION_RULE_INVALID');
  const defs = new Map(definitions.map((definition) => [definition.code, definition]));
  return rules.map((rule, index) => {
    const whenCode = codeOf(rule.when?.code);
    const targetCode = codeOf(rule.then?.code);
    const whenDef = defs.get(whenCode);
    const targetDef = defs.get(targetCode);
    if (!whenDef || !targetDef || whenCode === targetCode) {
      throw badRequest('Option rules must connect two different defined options', 'OPTION_RULE_INVALID');
    }
    const whenValues = [...new Set((rule.when?.values || []).map(String))];
    const allowedValues = [...new Set((rule.then?.allowedValues || []).map(String))];
    const excludedValues = [...new Set((rule.then?.excludedValues || []).map(String))];
    if (!whenValues.length || whenValues.some((value) => !whenDef.values.includes(value))) {
      throw badRequest(`Option rule contains an invalid ${whenDef.name} value`, 'OPTION_RULE_VALUE_INVALID');
    }
    if (allowedValues.some((value) => !targetDef.values.includes(value)) || excludedValues.some((value) => !targetDef.values.includes(value))) {
      throw badRequest(`Option rule contains an invalid ${targetDef.name} value`, 'OPTION_RULE_VALUE_INVALID');
    }
    if (allowedValues.some((value) => excludedValues.includes(value))) {
      throw badRequest('An option value cannot be both allowed and excluded', 'OPTION_RULE_CONFLICT');
    }
    return {
      code: codeOf(rule.code || `rule_${index + 1}`),
      when: { code: whenCode, values: whenValues },
      then: {
        code: targetCode,
        allowedValues,
        excludedValues,
        required: rule.then?.required !== false,
      },
      priority: Number.isInteger(rule.priority) ? rule.priority : index,
    };
  });
}

export function evaluateOptionCombination(optionValues = [], rules = []) {
  const selected = new Map(optionValues.map((option) => [option.code, option.value]));
  const violations = [];
  for (const rule of [...rules].sort((a, b) => (a.priority || 0) - (b.priority || 0))) {
    if (!rule.when.values.includes(selected.get(rule.when.code))) continue;
    const target = selected.get(rule.then.code);
    if (!target && rule.then.required) {
      violations.push({ rule: rule.code, option: rule.then.code, reason: 'required' });
    } else if (target && rule.then.allowedValues.length && !rule.then.allowedValues.includes(target)) {
      violations.push({ rule: rule.code, option: rule.then.code, value: target, reason: 'not_allowed' });
    } else if (target && rule.then.excludedValues.includes(target)) {
      violations.push({ rule: rule.code, option: rule.then.code, value: target, reason: 'excluded' });
    }
  }
  return { valid: violations.length === 0, violations };
}

export function assertOptionCombinationAllowed(optionValues, rules) {
  const result = evaluateOptionCombination(optionValues, rules);
  if (!result.valid) throw badRequest('Variant violates product option dependencies', 'OPTION_COMBINATION_FORBIDDEN', result.violations);
  return optionValues;
}

export default { normalizeOptionRules, evaluateOptionCombination, assertOptionCombinationAllowed };
