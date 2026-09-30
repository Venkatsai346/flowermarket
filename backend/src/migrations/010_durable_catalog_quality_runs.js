/** Durable, resumable tenant catalog-quality sweeps and projection provenance. */
export async function up(db) {
  const runs = db.collection('catalogqualityruns');
  await runs.createIndex(
    { tenantId: 1, active: 1 },
    { name: 'tenant_active_quality_run_unique', unique: true, partialFilterExpression: { active: true }, background: true },
  );
  await runs.createIndex(
    { status: 1, lastHeartbeatAt: 1, createdAt: 1 },
    { name: 'quality_run_fair_claim_idx', background: true },
  );
  await runs.createIndex({ tenantId: 1, createdAt: -1 }, { name: 'tenant_quality_run_history_idx', background: true });
  await runs.createIndex({ expiresAt: 1 }, { name: 'quality_runs_ttl', expireAfterSeconds: 0, background: true });

  const assessments = db.collection('catalogqualityassessments');
  await assessments.createIndex(
    { tenantId: 1, qualityRunId: 1, productMasterId: 1 },
    { name: 'tenant_quality_run_projection_idx', background: true },
  );

  // Drives stable, cutoff-bound family pagination without loading a tenant's
  // full listing catalog into API or worker memory.
  await db.collection('tenantproducts').createIndex(
    { tenantId: 1, productMasterId: 1, _id: 1, createdAt: 1 },
    { name: 'tenant_quality_family_scan_idx', background: true },
  );
}

export default { up };
