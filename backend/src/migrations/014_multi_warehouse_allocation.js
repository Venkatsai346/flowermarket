/** Multi-warehouse allocation policy, query indexes and durable order snapshots. */
export async function up(db) {
  await db.collection('warehouseallocationpolicies').createIndex(
    { tenantId: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false }, name: 'warehouse_allocation_policy_tenant_uq' },
  );
  await db.collection('inventories').createIndex(
    { tenantId: 1, warehouseId: 1, tenantProductId: 1, isSellable: 1 },
    { name: 'inventory_allocation_lookup_idx' },
  );
  await db.collection('hubs').createIndex(
    { tenantId: 1, isFulfillmentEnabled: 1, fulfillmentPriority: 1 },
    { name: 'hub_allocation_priority_idx' },
  );
  await db.collection('orderitems').createIndex(
    { tenantId: 1, 'fulfillmentAllocation.warehouseId': 1, createdAt: -1 },
    { name: 'order_item_fulfillment_node_idx' },
  );
  await db.collection('orders').createIndex(
    { tenantId: 1, 'fulfillmentPlan.primaryHubId': 1, createdAt: -1 },
    { name: 'order_fulfillment_node_idx' },
  );
  await db.collection('inventorytransfers').createIndex(
    { tenantId: 1, requestKey: 1 },
    { unique: true, name: 'inventory_transfer_idempotency_uq' },
  );
  await db.collection('inventorytransfers').createIndex(
    { tenantId: 1, createdAt: -1 },
    { name: 'inventory_transfer_tenant_created_idx' },
  );

  // Existing hub rows remain operational after strict allocation is enabled.
  await db.collection('hubs').updateMany(
    { isFulfillmentEnabled: { $exists: false } },
    { $set: { isFulfillmentEnabled: true, fulfillmentPriority: 100, handlingTimeMinutes: 30, acceptsOverflow: false } },
  );
  await db.collection('inventories').updateMany(
    { isSellable: { $exists: false } },
    { $set: { isSellable: true, safetyStock: 0 } },
  );
}

export default { up };
