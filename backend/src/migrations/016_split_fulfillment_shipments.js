/**
 * Durable split-fulfillment aggregates and shipment-scoped execution indexes.
 *
 * Legacy task/assignment rows intentionally retain a null shipmentId so old
 * orders remain operable. New rows use one unique identity per shipment.
 */
async function dropLegacyOrderUniqueIndex(collection) {
  const indexes = await collection.listIndexes().toArray();
  const legacy = indexes.find((index) => index.unique
    && index.key?.tenantId === 1
    && index.key?.orderId === 1
    && !Object.prototype.hasOwnProperty.call(index.key, 'shipmentId'));
  if (legacy) await collection.dropIndex(legacy.name);
}

export async function up(db) {
  const tasks = db.collection('fulfillmenttasks');
  const assignments = db.collection('deliveryassignments');
  await dropLegacyOrderUniqueIndex(tasks);
  await dropLegacyOrderUniqueIndex(assignments);

  await tasks.createIndex(
    { tenantId: 1, orderId: 1, shipmentId: 1 },
    { unique: true, name: 'fulfillment_task_shipment_uq' },
  );
  await assignments.createIndex(
    { tenantId: 1, orderId: 1, shipmentId: 1 },
    { unique: true, name: 'delivery_assignment_shipment_uq' },
  );

  const shipments = db.collection('shipments');
  await shipments.createIndex(
    { tenantId: 1, orderId: 1, sequence: 1 },
    { unique: true, name: 'shipment_order_sequence_uq' },
  );
  await shipments.createIndex(
    { tenantId: 1, shipmentNumber: 1 },
    { unique: true, name: 'shipment_number_uq' },
  );
  await shipments.createIndex(
    { tenantId: 1, trackingCode: 1 },
    { unique: true, name: 'shipment_tracking_uq' },
  );
  await shipments.createIndex(
    { tenantId: 1, status: 1, promiseMaxAt: 1 },
    { name: 'shipment_status_promise_idx' },
  );

  const shipmentItems = db.collection('shipmentitems');
  await shipmentItems.createIndex(
    { tenantId: 1, shipmentId: 1, orderItemId: 1 },
    { unique: true, name: 'shipment_item_line_uq' },
  );
  await shipmentItems.createIndex(
    { tenantId: 1, orderId: 1, shipmentId: 1 },
    { name: 'shipment_item_order_idx' },
  );
  await db.collection('orderitems').createIndex(
    { orderId: 1, shipmentId: 1 },
    { name: 'order_item_shipment_idx' },
  );
}

export default { up };
