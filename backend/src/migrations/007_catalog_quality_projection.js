/**
 * Durable tenant catalog-quality projection indexes.
 *
 * Production disables Mongoose auto-indexing. These indexes keep evaluation
 * upserts idempotent and support the readiness, score and issue drill-down
 * paths used by catalog operations.
 */

export async function up(db) {
  const collection = db.collection('catalogqualityassessments');
  await collection.createIndex(
    { tenantId: 1, productMasterId: 1 },
    { name: 'tenant_master_quality_unique', unique: true, background: true },
  );
  await collection.createIndex(
    { tenantId: 1, launchReady: 1, score: 1 },
    { name: 'tenant_quality_readiness_score_idx', background: true },
  );
  await collection.createIndex(
    { tenantId: 1, 'issues.code': 1 },
    { name: 'tenant_quality_issue_idx', background: true },
  );
  await collection.createIndex(
    { tenantId: 1, blockerCount: -1, score: 1, productMasterId: 1 },
    { name: 'tenant_quality_priority_idx', background: true },
  );
}

export default { up };
