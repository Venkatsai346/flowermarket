/**
 * Migration 003: soft-delete-aware unique indexes.
 *
 * Background: soft-deleted documents (isDeleted: true) kept holding their
 * unique keys (slug / skuGlobal / barcode / variant sku / listing triple)
 * forever — a deleted category could never be re-created with the same
 * slug (409), REJECTED masters permanently held their SKUs, etc.
 *
 * Fix: the unique indexes become PARTIAL (partialFilterExpression
 * isDeleted: false). A soft-deleted row releases its key; re-creation works.
 * The schema files already declare the new index shapes — this migration
 * reconciles EXISTING databases (mongoose autoIndex only reconciles on a
 * name+spec mismatch, which is unreliable across versions, so we do it
 * explicitly and idempotently here).
 *
 * Safe to run multiple times. Each step: dropIndex (ignore "not found")
 * then createIndex (background where supported).
 */

export const id = '003_softdelete_aware_unique_indexes';
export const description = 'Make catalog unique indexes soft-delete-aware (partial on isDeleted: false)';

/** Drop by index spec; missing index is a no-op. */
async function dropBySpec(collection, spec) {
  try {
    await collection.dropIndex(spec);
  } catch (err) {
    if (!/index.*not.*found|IndexNotFound|no such index/i.test(String(err?.message || err))) {
      throw err;
    }
  }
}

async function makeUniquePartial(db, collection, name, spec, filter) {
  const col = db.collection(collection);
  try {
    await col.dropIndex({ name });
  } catch { /* not present — fine */ }
  await dropBySpec(col, spec);
  await col.createIndex(spec, {
    unique: true,
    name,
    partialFilterExpression: filter,
    background: true,
    sparse: false,
  });
}

export async function up(db) {
  // ProductMaster — skuGlobal / slug / barcode
  await makeUniquePartial(
    db, 'productmasters', 'skuGlobal_1', { skuGlobal: 1 }, { isDeleted: false }
  );
  await makeUniquePartial(
    db, 'productmasters', 'slug_1', { slug: 1 }, { isDeleted: false }
  );
  await makeUniquePartial(
    db, 'productmasters', 'barcode_1', { barcode: 1 },
    { $and: [{ barcode: { $type: 'string' } }, { isDeleted: false }] }
  );

  // Category — slug
  await makeUniquePartial(
    db, 'categories', 'slug_1', { slug: 1 }, { isDeleted: false }
  );

  // Brand — slug
  await makeUniquePartial(
    db, 'brands', 'slug_1', { slug: 1 }, { isDeleted: false }
  );

  // ProductVariant — (master, type, value) and sku
  await makeUniquePartial(
    db, 'productvariants',
    'productMasterId_1_variantType_1_value_1',
    { productMasterId: 1, variantType: 1, value: 1 },
    { isDeleted: false }
  );
  await makeUniquePartial(
    db, 'productvariants', 'sku_1', { sku: 1 },
    { $and: [{ sku: { $type: 'string' } }, { isDeleted: false }] }
  );

  // TenantProduct — (tenant, master, variant) listing triple
  await makeUniquePartial(
    db, 'tenantproducts',
    'tenantId_1_productMasterId_1_variantId_1',
    { tenantId: 1, productMasterId: 1, variantId: 1 },
    { isDeleted: false }
  );
}
