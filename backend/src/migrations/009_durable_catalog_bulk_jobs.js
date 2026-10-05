/** Durable, tenant-isolated catalog bulk-import jobs and row checkpoints. */
export async function up(db) {
  const jobs = db.collection('catalogbulkjobs');
  await jobs.createIndex({ tenantId: 1, createdAt: -1 }, { name: 'tenant_bulk_jobs_idx', background: true });
  await jobs.createIndex({ status: 1, leaseExpiresAt: 1, createdAt: 1 }, { name: 'bulk_job_claim_idx', background: true });
  await jobs.createIndex({ status: 1, lastHeartbeatAt: 1, createdAt: 1 }, { name: 'bulk_job_fair_queue_idx', background: true });
  await jobs.createIndex({ expiresAt: 1 }, { name: 'bulk_jobs_ttl', expireAfterSeconds: 0, background: true });

  const rows = db.collection('catalogbulkjobrows');
  await rows.createIndex({ jobId: 1, rowNumber: 1 }, { name: 'bulk_job_row_unique', unique: true, background: true });
  await rows.createIndex({ jobId: 1, status: 1, rowNumber: 1 }, { name: 'bulk_job_pending_rows_idx', background: true });
  await rows.createIndex({ status: 1, leaseExpiresAt: 1 }, { name: 'bulk_row_lease_idx', background: true });
  await rows.createIndex({ tenantId: 1, createdAt: -1 }, { name: 'tenant_bulk_rows_retention_idx', background: true });
  await rows.createIndex({ expiresAt: 1 }, { name: 'bulk_job_rows_ttl', expireAfterSeconds: 0, background: true });
}

export default { up };
