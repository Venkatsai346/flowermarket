/** Durable exact-node checkout reservations and checkout idempotency. */
export async function up(db) {
  await db.collection('inventoryreservations').createIndex(
    { tenantId: 1, orderId: 1, tenantProductId: 1, warehouseId: 1 },
    { unique: true, name: 'inventory_reservation_order_line_uq' },
  );
  await db.collection('inventoryreservations').createIndex(
    { tenantId: 1, idempotencyKey: 1, tenantProductId: 1, warehouseId: 1 },
    { unique: true, name: 'inventory_reservation_idempotency_uq' },
  );
  await db.collection('inventoryreservations').createIndex(
    { status: 1, expiresAt: 1 },
    { name: 'inventory_reservation_expiry_idx' },
  );
  await db.collection('inventoryreservations').createIndex(
    { tenantId: 1, warehouseId: 1, status: 1 },
    { name: 'inventory_reservation_node_status_idx' },
  );
  await db.collection('orders').createIndex(
    { tenantId: 1, userId: 1, checkoutIdempotencyKey: 1 },
    {
      unique: true, name: 'order_checkout_idempotency_uq',
      partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } },
    },
  );
}

export default { up };
