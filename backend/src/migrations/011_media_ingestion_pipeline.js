/** Durable media inspection jobs, duplicate evidence and responsive renditions. */
export async function up(db) {
  const jobs = db.collection('mediaprocessingjobs');
  await jobs.createIndex({ assetId: 1 }, { unique: true, name: 'media_asset_processing_unique', background: true });
  await jobs.createIndex({ status: 1, lastHeartbeatAt: 1, createdAt: 1 }, { name: 'media_processing_fair_claim_idx', background: true });
  await jobs.createIndex({ tenantId: 1, createdAt: -1 }, { name: 'tenant_media_processing_history_idx', background: true });
  await jobs.createIndex({ expiresAt: 1 }, { name: 'media_processing_jobs_ttl', expireAfterSeconds: 0, background: true });

  await db.collection('mediaassets').createIndex(
    { status: 1, 'health.checkedAt': 1 },
    { name: 'media_health_probe_idx', background: true },
  );
  await db.collection('mediaassets').createIndex(
    { tenantId: 1, checksumSha256: 1, status: 1 },
    { name: 'tenant_media_checksum_idx', partialFilterExpression: { checksumSha256: { $type: 'string' } }, background: true },
  );
  await db.collection('productimages').createIndex(
    { mediaAssetId: 1, status: 1, isDeleted: 1 },
    { name: 'product_image_media_asset_idx', background: true },
  );
  await db.collection('productimages').createIndex(
    { healthStatus: 1, status: 1, isDeleted: 1 },
    { name: 'product_image_health_idx', background: true },
  );
}

export default { up };
