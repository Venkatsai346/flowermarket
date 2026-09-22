/** Migration 005 — structural entities that complete the universal product graph. */
export const id = '005_catalog_structural_entities';
export const description = 'Backfill product unit policies and create variant-EAV, package, bundle and compliance indexes';

const mass = new Set(['kilogram', 'gram', 'milligram']);
const volume = new Set(['litre', 'millilitre']);
const length = new Set(['metre', 'centimetre']);

export async function up(db) {
  const masters = db.collection('productmasters');
  const cursor = masters.find({ $or: [{ unitPolicy: null }, { unitPolicy: { $exists: false } }] }, { projection: { defaultSellingUnit: 1, optionRules: 1 } });
  // Migration cursor traversal is deliberately sequential to bound database pressure.
  // eslint-disable-next-line no-await-in-loop
  while (await cursor.hasNext()) {
    // Migration cursor traversal is deliberately sequential to bound database pressure.
    // eslint-disable-next-line no-await-in-loop
    const row = await cursor.next();
    const baseUnit = String(row.defaultSellingUnit || 'piece').toLowerCase();
    const dimension = mass.has(baseUnit) ? 'mass' : volume.has(baseUnit) ? 'volume' : length.has(baseUnit) ? 'length' : baseUnit === 'service' ? 'time' : baseUnit === 'download' ? 'digital' : 'count';
    const allowFractional = ['mass', 'volume', 'length', 'area', 'time'].includes(dimension);
    // Each backfill write is deliberately sequential so a failed row identifies an exact resume point.
    // eslint-disable-next-line no-await-in-loop
    await masters.updateOne({ _id: row._id }, { $set: {
      unitPolicy: { dimension, baseUnit, allowFractional, precision: allowFractional ? 3 : 0, units: [{ code: baseUnit, label: baseUnit.replace(/_/g, ' '), toBaseFactor: 1, precision: allowFractional ? 3 : 0 }] },
      ...(!Array.isArray(row.optionRules) ? { optionRules: [] } : {}),
    } });
  }

  const variantAttributes = db.collection('productvariantattributevalues');
  await variantAttributes.createIndex({ productVariantId: 1, attributeKey: 1 }, { name: 'productVariantId_1_attributeKey_1', unique: true, partialFilterExpression: { isDeleted: false }, background: true });
  await variantAttributes.createIndex({ productMasterId: 1, attributeKey: 1, textValue: 1 }, { name: 'productMasterId_1_attributeKey_1_textValue_1', background: true });
  await variantAttributes.createIndex({ productMasterId: 1, attributeKey: 1, numberValue: 1 }, { name: 'productMasterId_1_attributeKey_1_numberValue_1', background: true });

  const packages = db.collection('productpackages');
  await packages.createIndex({ productMasterId: 1, code: 1 }, { name: 'productMasterId_1_code_1', unique: true, partialFilterExpression: { isDeleted: false }, background: true });
  await packages.createIndex({ containedPackageId: 1 }, { name: 'containedPackageId_1', background: true });
  await packages.createIndex({ 'identifiers.barcode': 1 }, { name: 'identifiers.barcode_1', unique: true, partialFilterExpression: { $and: [{ 'identifiers.barcode': { $type: 'string' } }, { isDeleted: false }] }, background: true });

  const bundles = db.collection('productbundlecomponents');
  await bundles.createIndex({ bundleMasterId: 1, componentMasterId: 1, componentVariantId: 1, selectionGroup: 1 }, { name: 'bundleMasterId_1_componentMasterId_1_componentVariantId_1_selectionGroup_1', unique: true, partialFilterExpression: { isDeleted: false }, background: true });
  await bundles.createIndex({ componentMasterId: 1, status: 1 }, { name: 'componentMasterId_1_status_1', background: true });

  const compliance = db.collection('productcompliances');
  await compliance.createIndex({ productMasterId: 1, variantId: 1, type: 1, code: 1 }, { name: 'productMasterId_1_variantId_1_type_1_code_1', unique: true, partialFilterExpression: { isDeleted: false }, background: true });
  await compliance.createIndex({ status: 1, validUntil: 1 }, { name: 'status_1_validUntil_1', background: true });
}
