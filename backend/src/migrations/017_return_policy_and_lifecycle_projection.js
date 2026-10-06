/**
 * Materialize explicit catalog return governance and immutable purchase terms.
 *
 * Runtime compatibility already understands missing snapshots; this migration
 * removes ambiguity for operators and makes old records self-describing.
 */
export async function up(db) {
  const defaultPolicyExpression = {
    $cond: [
      {
        $and: [
          { $eq: ['$isPerishable', true] },
          { $not: [{ $in: ['$type', ['flower_bouquet', 'plant']] }] },
        ],
      },
      {
        mode: 'quality_claim_only', returnWindowDays: 0, instantClaimHours: 24,
        requiresQc: false, customerNote: 'Fresh-item quality claims are available within 24 hours of delivery.',
      },
      {
        mode: 'returnable', returnWindowDays: 7, instantClaimHours: 24,
        requiresQc: true, customerNote: null,
      },
    ],
  };

  await db.collection('productmasters').updateMany(
    { $or: [{ returnPolicy: { $exists: false } }, { returnPolicy: null }] },
    [{ $set: { returnPolicy: defaultPolicyExpression } }],
  );

  const purchasePolicyExpression = {
    $cond: [
      { $eq: ['$isReturnable', false] },
      {
        mode: 'quality_claim_only', returnWindowDays: 0, instantClaimHours: 24,
        requiresQc: false, customerNote: null,
      },
      {
        mode: 'returnable', returnWindowDays: 7, instantClaimHours: 24,
        requiresQc: true, customerNote: null,
      },
    ],
  };
  const missingSnapshot = { $or: [{ returnPolicySnapshot: { $exists: false } }, { returnPolicySnapshot: null }] };
  await db.collection('cartitems').updateMany(missingSnapshot, [{ $set: { returnPolicySnapshot: purchasePolicyExpression } }]);
  await db.collection('orderitems').updateMany(missingSnapshot, [{ $set: { returnPolicySnapshot: purchasePolicyExpression } }]);

  await db.collection('returnrequests').createIndex(
    { tenantId: 1, orderId: 1, updatedAt: -1 },
    { name: 'return_request_order_lifecycle_idx' },
  );
}

export default { up };
