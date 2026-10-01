export async function up(db) {
  const interactions = db.collection('searchinteractions');
  await interactions.createIndex({ tenantId: 1, eventId: 1 }, { unique: true, name: 'search_interaction_event_uq' });
  await interactions.createIndex({ tenantId: 1, occurredAt: -1, type: 1 }, { name: 'search_interaction_analytics_idx' });
  await interactions.createIndex({ tenantId: 1, listingId: 1, occurredAt: -1 }, { name: 'search_interaction_listing_window_idx' });
  await interactions.createIndex({ occurredAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600, name: 'search_interaction_retention_ttl' });

  const rules = db.collection('searchmerchandisingrules');
  await rules.createIndex({ tenantId: 1, status: 1, startsAt: 1, endsAt: 1, priority: -1 }, { name: 'search_rule_active_window_idx' });
  await rules.createIndex(
    { tenantId: 1, type: 1, code: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false }, name: 'search_rule_code_uq' },
  );

  await db.collection('orderitems').createIndex(
    { tenantId: 1, searchQueryId: 1, createdAt: -1 },
    { sparse: true, name: 'order_item_search_attribution_idx' },
  );
}

export default { up };
