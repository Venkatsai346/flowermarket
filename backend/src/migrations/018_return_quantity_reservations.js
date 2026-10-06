/**
 * Backfill durable per-line return quantity reservations.
 *
 * Before this migration, approved requests did not reserve quantity until the
 * refund completed, so the same unit could be submitted repeatedly. Existing
 * request lines become self-describing and OrderItem counters are rebuilt from
 * source-of-truth ReturnRequest/ReturnItem records.
 */
export async function up(db) {
  const active = ['requested', 'approved', 'picked_up', 'qc_passed', 'refund_initiated'];
  const rejected = ['rejected', 'qc_failed', 'refund_rejected'];

  await db.collection('returnitems').aggregate([
    { $lookup: { from: 'returnrequests', localField: 'returnRequestId', foreignField: '_id', as: 'request' } },
    { $set: { requestStatus: { $arrayElemAt: ['$request.status', 0] } } },
    {
      $set: {
        quantityDisposition: {
          $switch: {
            branches: [
              { case: { $eq: ['$requestStatus', 'refunded'] }, then: 'returned' },
              { case: { $in: ['$requestStatus', rejected] }, then: 'rejected' },
            ],
            default: 'reserved',
          },
        },
      },
    },
    { $unset: ['request', 'requestStatus'] },
    { $merge: { into: 'returnitems', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
  ]).toArray();

  await db.collection('returnitems').aggregate([
    { $lookup: { from: 'returnrequests', localField: 'returnRequestId', foreignField: '_id', as: 'request' } },
    { $set: { requestStatus: { $arrayElemAt: ['$request.status', 0] } } },
    {
      $group: {
        _id: '$orderItemId',
        requested: { $sum: { $cond: [{ $in: ['$requestStatus', active] }, '$qty', 0] } },
        rejected: { $sum: { $cond: [{ $in: ['$requestStatus', rejected] }, '$qty', 0] } },
        returned: { $sum: { $cond: [{ $eq: ['$requestStatus', 'refunded'] }, '$qty', 0] } },
      },
    },
    {
      $merge: {
        into: 'orderitems', on: '_id', whenNotMatched: 'discard',
        whenMatched: [{
          $set: {
            returnedQty: { $max: [{ $ifNull: ['$returnedQty', 0] }, '$$new.returned'] },
            returnRejectedQty: {
              $min: [
                '$$new.rejected',
                { $max: [0, { $subtract: ['$qty', { $add: [{ $ifNull: ['$cancelledQty', 0] }, { $max: [{ $ifNull: ['$returnedQty', 0] }, '$$new.returned'] }] }] }] },
              ],
            },
            returnRequestedQty: {
              $min: [
                '$$new.requested',
                { $max: [0, { $subtract: ['$qty', { $add: [{ $ifNull: ['$cancelledQty', 0] }, { $max: [{ $ifNull: ['$returnedQty', 0] }, '$$new.returned'] }, { $ifNull: ['$$new.rejected', 0] }] }] }] },
              ],
            },
          },
        }],
      },
    },
  ]).toArray();

  // Quarantine historical overbookings deterministically: the oldest valid
  // request keeps the unit, while a later request that cannot be fully
  // satisfied is rejected as a duplicate without consuming physical quantity.
  const remainingByItem = new Map();
  const activeRequests = db.collection('returnrequests').aggregate([
    { $match: { status: { $in: active } } },
    { $lookup: { from: 'returnitems', localField: '_id', foreignField: 'returnRequestId', as: 'lines' } },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $project: {
        _id: 1, tenantId: 1,
        lines: {
          $map: {
            input: '$lines', as: 'line',
            in: { orderItemId: '$$line.orderItemId', qty: '$$line.qty' },
          },
        },
      },
    },
  ]);
  for await (const request of activeRequests) {
    const missingIds = request.lines
      .map((line) => line.orderItemId)
      .filter((id) => !remainingByItem.has(String(id)));
    if (missingIds.length) {
      // Sequential by design: request age defines which historical claimant
      // owns a scarce unit and keeps the migration deterministic.
      // eslint-disable-next-line no-await-in-loop
      const sourceItems = await db.collection('orderitems').find(
        { _id: { $in: missingIds } },
        { projection: { qty: 1, cancelledQty: 1, returnedQty: 1, returnRejectedQty: 1 } },
      ).toArray();
      for (const item of sourceItems) {
        remainingByItem.set(String(item._id), Math.max(0,
          (item.qty || 0) - (item.cancelledQty || 0) - (item.returnedQty || 0) - (item.returnRejectedQty || 0)));
      }
    }
    const invalid = !request.lines.length || request.lines.some((line) => {
      const remaining = remainingByItem.get(String(line.orderItemId));
      return remaining == null || !Number.isFinite(line.qty) || line.qty <= 0 || line.qty > remaining;
    });
    if (invalid) {
      // Sequential by design: reject this request before advancing the age-ordered cursor.
      // eslint-disable-next-line no-await-in-loop
      await db.collection('returnrequests').updateOne(
        { _id: request._id, status: { $in: active } },
        { $set: { status: 'rejected', 'review.note': 'Duplicate quantity quarantined during reservation backfill', 'review.reviewedAt': new Date() } },
      );
      // Sequential by design: void its lines before evaluating the next claimant.
      // eslint-disable-next-line no-await-in-loop
      await db.collection('returnitems').updateMany(
        { returnRequestId: request._id },
        { $set: { quantityDisposition: 'voided_duplicate', qcNote: 'Historical duplicate quantity' } },
      );
      continue;
    }
    for (const line of request.lines) {
      const key = String(line.orderItemId);
      remainingByItem.set(key, remainingByItem.get(key) - line.qty);
    }
  }

  await db.collection('orderitems').updateMany({}, [
    { $set: { returnRequestedQty: 0, returnRejectedQty: { $ifNull: ['$returnRejectedQty', 0] } } },
  ]);
  await db.collection('returnitems').aggregate([
    { $match: { quantityDisposition: 'reserved' } },
    { $group: { _id: '$orderItemId', requested: { $sum: '$qty' } } },
    {
      $merge: {
        into: 'orderitems', on: '_id', whenNotMatched: 'discard',
        whenMatched: [{ $set: { returnRequestedQty: '$$new.requested' } }],
      },
    },
  ]).toArray();
  await db.collection('returnrequests').createIndex(
    { tenantId: 1, userId: 1, idempotencyKey: 1 },
    {
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      name: 'return_request_idempotency_uq',
    },
  );
  await db.collection('returnitems').createIndex(
    { tenantId: 1, returnRequestId: 1, quantityDisposition: 1 },
    { name: 'return_item_disposition_idx' },
  );
}

export default { up };
