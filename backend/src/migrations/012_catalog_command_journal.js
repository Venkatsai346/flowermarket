/** Durable idempotency/command journal indexes for transactional catalog writes. */
export async function up(db) {
  const commands = db.collection('catalogcommands');
  await commands.createIndex(
    { scopeId: 1, idempotencyKey: 1 },
    { unique: true, name: 'catalog_command_scope_key_uq' },
  );
  await commands.createIndex(
    { status: 1, leaseExpiresAt: 1 },
    { name: 'catalog_command_claim_idx' },
  );
  await commands.createIndex(
    { completedAt: 1 },
    {
      expireAfterSeconds: 60 * 60 * 24 * 90,
      partialFilterExpression: { completedAt: { $type: 'date' } },
      name: 'catalog_command_retention_ttl',
    },
  );
}

export default { up };
