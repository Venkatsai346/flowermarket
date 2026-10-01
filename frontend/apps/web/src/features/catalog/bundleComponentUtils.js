export const bundleVariantLabel = (variant) => variant?.displayLabel
  || (variant?.optionValues || []).map((option) => `${option.name || option.code}: ${option.value}`).join(' · ')
  || variant?.value
  || variant?.sku
  || 'Unnamed variant';

/** Strip display-only joins and validate the bounded replacement contract. */
export const serializeBundleComponents = (rows) => {
  const seen = new Set();
  return rows.map((row, index) => {
    const number = index + 1;
    const componentMasterId = String(row.componentMasterId || '');
    const componentVariantId = row.componentVariantId ? String(row.componentVariantId) : null;
    const selectionGroup = String(row.selectionGroup || '').trim();
    const quantity = Number(row.quantity);
    const unitCode = String(row.unitCode || '').trim();
    const minSelections = Number(row.minSelections ?? 1);
    const maxSelections = Number(row.maxSelections ?? 1);
    const priceAdjustment = Number(row.priceAdjustment || 0);
    if (!componentMasterId) throw new Error(`Bundle component ${number} needs a product.`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Bundle component ${number} needs a quantity greater than zero.`);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(unitCode)) throw new Error(`Bundle component ${number} needs a valid unit code.`);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(selectionGroup)) throw new Error(`Bundle component ${number} needs a valid selection group.`);
    if (!Number.isInteger(minSelections) || minSelections < 0 || !Number.isInteger(maxSelections) || maxSelections < 1) throw new Error(`Bundle component ${number} needs valid whole-number selection limits.`);
    if (minSelections > maxSelections) throw new Error(`Bundle component ${number} has a minimum greater than its maximum.`);
    if (!Number.isFinite(priceAdjustment)) throw new Error(`Bundle component ${number} needs a valid price adjustment.`);
    const identity = `${componentMasterId}:${componentVariantId || 'any'}:${selectionGroup}`;
    if (seen.has(identity)) throw new Error(`Bundle component ${number} duplicates another product, variant and selection group.`);
    seen.add(identity);
    return {
      componentMasterId,
      componentVariantId,
      quantity,
      unitCode,
      selectionGroup,
      required: row.required !== false,
      defaultSelected: row.defaultSelected !== false,
      minSelections,
      maxSelections,
      priceAdjustment,
      status: row.status || 'active',
      sortOrder: index,
    };
  });
};
