const valuesOf = (variant) => Object.fromEntries(
  (variant?.optionValues || []).map((option) => [option.code, option.value]),
);

export function variantOptionState(family, code, value) {
  const candidates = (family || []).filter((variant) => valuesOf(variant)[code] === value);
  const inStock = candidates.filter((variant) => Number(variant.stockQty || 0) > 0);
  const priced = (inStock.length ? inStock : candidates).map((variant) => Number(variant.price?.sellingPrice || 0));
  return {
    exists: candidates.length > 0,
    inStock: inStock.length > 0,
    candidates,
    fromPrice: priced.length ? Math.min(...priced) : null,
  };
}

/**
 * Resolve an option click in a sparse variant matrix. Commerce catalogs often
 * publish only valid combinations (e.g. 5in/20cm/white and 7in/35cm/clay), not
 * a Cartesian product. We therefore choose the available candidate that keeps
 * the most currently selected dimensions, preferring stock and deterministic
 * default/sort order, rather than disabling every non-exact option.
 */
export function resolveVariantForOption(family, selected, code, value) {
  const candidates = (family || []).filter((variant) => valuesOf(variant)[code] === value);
  if (!candidates.length) return null;
  const selectedValues = valuesOf(selected);
  return [...candidates].sort((left, right) => {
    const score = (variant) => {
      const values = valuesOf(variant);
      const retained = Object.entries(selectedValues)
        .filter(([key]) => key !== code)
        .reduce((total, [key, selectedValue]) => total + (values[key] === selectedValue ? 1 : 0), 0);
      return retained * 100 + (Number(variant.stockQty || 0) > 0 ? 20 : 0) + (variant.isDefault ? 2 : 0);
    };
    return score(right) - score(left)
      || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || String(left.listingId || '').localeCompare(String(right.listingId || ''));
  })[0];
}

export function selectedOptionValues(variant) {
  return valuesOf(variant);
}
