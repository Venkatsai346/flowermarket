/**
 * Migration 002: Performance indexes for common query patterns.
 *
 * These compound indexes cover the hottest query paths identified from
 * the API routes and service layer analysis. Each index is created with
 * `background: true` so it never blocks the primary.
 *
 * Safe to run multiple times (createIndex is a no-op if the index exists).
 */

export const id = '002_performance_indexes';
export const description = 'Compound indexes for hot query paths';

export async function up(db) {
  const orders = db.collection('orders');
  const payments = db.collection('payments');
  const listings = db.collection('tenantproducts');
  const events = db.collection('domainevents');
  const journals = db.collection('ledgerjournals');
  const users = db.collection('users');

  // Orders: tenant + status + date (dashboard, fulfillment queue, order list)
  await orders.createIndex(
    { tenantId: 1, status: 1, createdAt: -1 },
    { background: true, name: 'tenant_status_date' }
  );

  // Orders: tenant + customer (my orders page)
  await orders.createIndex(
    { tenantId: 1, 'customer.userId': 1, createdAt: -1 },
    { background: true, name: 'tenant_customer_date' }
  );

  // Payments: tenant + status + date (payment reconciliation)
  await payments.createIndex(
    { tenantId: 1, status: 1, createdAt: -1 },
    { background: true, name: 'tenant_payment_status_date' }
  );

  // Payments: gateway payment id (webhook lookup — critical path)
  await payments.createIndex(
    { gatewayPaymentId: 1 },
    { background: true, name: 'gateway_payment_id' }
  );

  // Listings: tenant + active + category (product catalog)
  await listings.createIndex(
    { tenantId: 1, status: 1, 'category.categoryId': 1 },
    { background: true, name: 'tenant_active_category' }
  );

  // Domain events: tenant + kind + date (audit queries)
  await events.createIndex(
    { tenantId: 1, kind: 1, occurredAt: -1 },
    { background: true, name: 'tenant_event_kind_date' }
  );

  // Ledger journals: tenant + kind + date (financial reports)
  await journals.createIndex(
    { tenantId: 1, kind: 1, postedAt: -1 },
    { background: true, name: 'tenant_journal_kind_date' }
  );

  // Users: tenant + role + status (user management)
  await users.createIndex(
    { tenantId: 1, role: 1, status: 1 },
    { background: true, name: 'tenant_role_status' }
  );

  return { indexesCreated: 8 };
}

export async function down(db) {
  const indexes = [
    { col: 'orders', name: 'tenant_status_date' },
    { col: 'orders', name: 'tenant_customer_date' },
    { col: 'payments', name: 'tenant_payment_status_date' },
    { col: 'payments', name: 'gateway_payment_id' },
    { col: 'tenantproducts', name: 'tenant_active_category' },
    { col: 'domainevents', name: 'tenant_event_kind_date' },
    { col: 'ledgerjournals', name: 'tenant_journal_kind_date' },
    { col: 'users', name: 'tenant_role_status' },
  ];

  for (const { col, name } of indexes) {
    try {
      // sequential migration steps required
      // eslint-disable-next-line no-await-in-loop
      await db.collection(col).dropIndex(name);
    } catch { /* index may not exist */ }
  }
  return { indexesDropped: indexes.length };
}
