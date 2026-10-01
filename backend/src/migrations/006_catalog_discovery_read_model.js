/**
 * Catalog discovery read-model indexes.
 *
 * Production disables Mongoose auto-indexing, so schema declarations alone do
 * not protect the customer PLP. These indexes support tenant publication
 * pruning and governed dynamic attribute filters in the ranked projection.
 */

export async function up(db) {
  await db.collection('tenantproducts').createIndex(
    { tenantId: 1, status: 1, 'channels.storefront': 1, productMasterId: 1, variantId: 1 },
    { name: 'catalog_family_read_idx', background: true },
  );
  await db.collection('searchdocuments').createIndex(
    { tenantId: 1, status: 1, 'attributes.$**': 1 },
    { name: 'search_attribute_facets_idx', background: true },
  );
}

export default { up };
