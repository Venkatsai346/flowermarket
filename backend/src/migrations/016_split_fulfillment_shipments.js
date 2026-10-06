/**
 * Durable split-fulfillment aggregates and shipment-scoped execution indexes.
 *
 * Legacy task/assignment rows intentionally retain a null shipmentId so old
 * orders remain operable. New rows use one unique identity per shipment.
 */
async function listIndexesOrEmpty(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function dropLegacyOrderUniqueIndex(collection) {
  const indexes = await listIndexesOrEmpty(collection);
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
  await shipments.createIndex(
    { tenantId: 1, 'cancellation.refundStatus': 1, cancelledAt: 1 },
    { name: 'shipment_refund_attention_idx' },
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

  // Return lines predate tenant/shipment ownership. Backfill tenant identity
  // from their parent request in-server, then enforce one line per request.
  await db.collection('returnitems').aggregate([
    { $match: { tenantId: { $exists: false } } },
    { $lookup: { from: 'returnrequests', localField: 'returnRequestId', foreignField: '_id', as: 'request' } },
    { $set: { tenantId: { $arrayElemAt: ['$request.tenantId', 0] } } },
    { $unset: 'request' },
    { $match: { tenantId: { $ne: null } } },
    { $merge: { into: 'returnitems', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
  ]).toArray();
  const returnItems = db.collection('returnitems');
  const returnIndexes = await listIndexesOrEmpty(returnItems);
  const legacyReturnIndex = returnIndexes.find((index) => index.key?.returnRequestId === 1
    && index.key?.orderItemId === 1 && !Object.prototype.hasOwnProperty.call(index.key, 'tenantId'));
  if (legacyReturnIndex) await returnItems.dropIndex(legacyReturnIndex.name);
  await returnItems.createIndex(
    { tenantId: 1, returnRequestId: 1, orderItemId: 1 },
    { unique: true, name: 'return_item_request_line_uq' },
  );
  await db.collection('returnrequests').createIndex(
    { tenantId: 1, orderId: 1, shipmentId: 1, createdAt: -1 },
    { name: 'return_request_shipment_idx' },
  );
}

export default { up };
