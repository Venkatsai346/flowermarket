/**
 * Fail closed when a database still enforces superseded catalog identities.
 * Schema declarations cannot alter an existing MongoDB index's uniqueness;
 * migration 004 must replace the legacy variant triple explicitly.
 */
export async function assertUniversalVariantIndexContract(connection) {
  let indexes;
  try {
    indexes = await connection.collection('productvariants').indexes();
  } catch (error) {
    // A pristine database may not have this collection yet. Mongoose creates
    // current indexes when the first variant documents are inserted.
    if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return;
    throw error;
  }
  const legacyTriple = indexes.find((index) => (
    index.key?.productMasterId === 1
    && index.key?.variantType === 1
    && index.key?.value === 1
    && Object.keys(index.key).length === 3
  ));
  if (legacyTriple?.unique) {
    throw new Error(
      `Database schema is stale: productvariants index ${legacyTriple.name} is still UNIQUE. `
      + 'Universal variants use combinationKey identity and may legitimately share the legacy value projection. '
      + 'Run `npm run db:migrate:status`, then `npm run db:migrate`, and rerun this command. '
      + 'No product documents were changed.'
    );
  }
}
