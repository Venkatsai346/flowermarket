/** Migration 004 — universal product/variant/listing structures and indexes. */
export const id = '004_universal_product_model';
export const description = 'Backfill canonical variant combinations and add universal catalog indexes';

const enc = (v) => encodeURIComponent(String(v ?? '').trim().toLowerCase());

async function drop(col, name) {
  try { await col.dropIndex(name); } catch (err) {
    if (!/index.*not.*found|IndexNotFound|no such index/i.test(String(err?.message || err))) throw err;
  }
}

export async function up(db) {
  const variants = db.collection('productvariants');
  const cursor = variants.find({ $or: [{ combinationKey: null }, { combinationKey: { $exists: false } }] });
  // Migration cursor traversal is deliberately sequential to keep memory bounded.
  // eslint-disable-next-line no-await-in-loop
  while (await cursor.hasNext()) {
    // Migration cursor traversal is deliberately sequential to keep memory bounded.
    // eslint-disable-next-line no-await-in-loop
    const row = await cursor.next();
    const options = Array.isArray(row.optionValues) ? [...row.optionValues] : [];
    options.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const combinationKey = options.length
      ? options.map((o) => `${enc(o.code)}=${enc(o.value)}`).join('&')
      : `${enc(row.variantType || 'other')}=${enc(row.value)}`;
    // Migration backfill is deliberately sequential to keep memory and database pressure bounded.
    // eslint-disable-next-line no-await-in-loop
    await variants.updateOne({ _id: row._id }, { $set: { combinationKey } });
  }

  await drop(variants, 'productMasterId_1_variantType_1_value_1');
  await variants.createIndex(
    { productMasterId: 1, variantType: 1, value: 1 },
    { name: 'productMasterId_1_variantType_1_value_1', background: true }
  );
  await variants.createIndex(
    { productMasterId: 1, combinationKey: 1 },
    {
      name: 'productMasterId_1_combinationKey_1', unique: true, background: true,
      partialFilterExpression: { $and: [{ combinationKey: { $type: 'string' } }, { isDeleted: false }] },
    }
  );
  await variants.createIndex(
    { barcode: 1 },
    { name: 'barcode_1', unique: true, background: true, partialFilterExpression: { $and: [{ barcode: { $type: 'string' } }, { isDeleted: false }] } }
  );
  await variants.createIndex(
    { 'identifiers.gtin': 1 },
    { name: 'identifiers.gtin_1', unique: true, background: true, partialFilterExpression: { $and: [{ 'identifiers.gtin': { $type: 'string' } }, { isDeleted: false }] } }
  );

  await db.collection('productmasters').createIndex(
    { 'identifiers.gtin': 1 },
    { name: 'identifiers.gtin_1', unique: true, background: true, partialFilterExpression: { $and: [{ 'identifiers.gtin': { $type: 'string' } }, { isDeleted: false }] } }
  );
  await db.collection('tenantproducts').createIndex(
    { tenantId: 1, sellerSku: 1 },
    { name: 'tenantId_1_sellerSku_1', unique: true, background: true, partialFilterExpression: { $and: [{ sellerSku: { $type: 'string' } }, { isDeleted: false }] } }
  );

  const attributes = db.collection('productattributevalues');
  await drop(attributes, 'productMasterId_1_attributeKey_1');
  await attributes.createIndex(
    { productMasterId: 1, attributeKey: 1 },
    { name: 'productMasterId_1_attributeKey_1', unique: true, background: true, partialFilterExpression: { isDeleted: false } }
  );
  await attributes.createIndex({ attributeKey: 1, textValue: 1 }, { name: 'attributeKey_1_textValue_1', background: true });
  await attributes.createIndex({ attributeKey: 1, numberValue: 1 }, { name: 'attributeKey_1_numberValue_1', background: true });
  await attributes.createIndex({ attributeKey: 1, booleanValue: 1 }, { name: 'attributeKey_1_booleanValue_1', background: true });
}
