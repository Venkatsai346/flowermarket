# MongoDB Scaling Strategy

## Sharding Keys

When the dataset exceeds a single replica set (~500GB or >10K ops/sec),
sharding distributes data across multiple shards.

### Recommended Shard Keys

| Collection | Shard Key | Rationale |
|---|---|---|
| `orders` | `{ tenantId: 1, createdAt: 1 }` | All order queries are tenant-scoped; time-range scans for analytics |
| `tenantproducts` | `{ tenantId: 1 }` | Catalog reads are always tenant-scoped |
| `inventory` | `{ tenantId: 1, tenantProductId: 1 }` | Stock lookups are tenant + product scoped |
| `payments` | `{ tenantId: 1, createdAt: 1 }` | Payment queries are tenant-scoped; reconciliation scans by time |
| `notifications` | `{ tenantId: 1, userId: 1 }` | Inbox queries are user-scoped within a tenant |
| `catalogevents` | `{ tenantId: 1, status: 1 }` | Outbox drain is tenant + status scoped |
| `auditlogs` | `{ tenantId: 1, createdAt: 1 }` | Audit queries are tenant-scoped, time-ordered |
| `ledgerentries` | `{ tenantId: 1, journalDate: 1 }` | Ledger queries are tenant-scoped, period-ordered |
| `taxdocuments` | `{ tenantId: 1, docType: 1 }` | Tax docs are always tenant-scoped |
| `payoutbatches` | `{ tenantId: 1, status: 1 }` | Payout queries are tenant-scoped |

### Shard Key Principles

1. **Always include `tenantId`** — every query is tenant-scoped (multi-tenant isolation)
2. **Second field should match query patterns** — time for analytics, status for operational
3. **Avoid monotonically increasing keys alone** — causes hot shards (all writes to one shard)
4. **Compound keys > single keys** — better cardinality and query routing

### Enabling Sharding

```javascript
// Enable sharding on the database
sh.enableSharding('flowermarket')

// Shard each collection
sh.shardCollection('flowermarket.orders', { tenantId: 1, createdAt: 1 })
sh.shardCollection('flowermarket.tenantproducts', { tenantId: 1 })
sh.shardCollection('flowermarket.inventory', { tenantId: 1, tenantProductId: 1 })
sh.shardCollection('flowermarket.payments', { tenantId: 1, createdAt: 1 })
sh.shardCollection('flowermarket.notifications', { tenantId: 1, userId: 1 })
sh.shardCollection('flowermarket.catalogevents', { tenantId: 1, status: 1 })
sh.shardCollection('flowermarket.auditlogs', { tenantId: 1, createdAt: 1 })
sh.shardCollection('flowermarket.ledgerentries', { tenantId: 1, journalDate: 1 })
sh.shardCollection('flowermarket.taxdocuments', { tenantId: 1, docType: 1 })
sh.shardCollection('flowermarket.payoutbatches', { tenantId: 1, status: 1 })
```

## Read Replicas

For read-heavy workloads (catalog browsing, search, analytics), configure
read replicas to offload reads from the primary.

### Mongoose Read Preference

```javascript
// In config/index.js — add read preference for read-heavy routes
mongoose.connect(uri, {
  readPreference: 'secondaryPreferred',  // reads go to replicas
  readConcern: { level: 'local' },       // eventual consistency OK for reads
  writeConcern: { w: 'majority' },       // writes always go to primary
});
```

### Per-Route Read Preference

```javascript
// For analytics/reporting routes that can tolerate stale data
const analyticsResults = await Order
  .find({ tenantId })
  .read('secondaryPreferred')  // Read from replica
  .lean();
```

### Replica Set Configuration (Production)

```javascript
// MongoDB Atlas: automatic replica sets
// Self-hosted: configure in mongod.conf
replication:
  replSetName: "flowermarket-rs"
  enableMajorityReadConcern: true
```

### When to Add Replicas

| Metric | Threshold | Action |
|---|---|---|
| Read ops/sec | > 5,000 | Add 1 read replica |
| Primary CPU | > 70% sustained | Add 1 read replica |
| Read latency p95 | > 100ms | Add 1 read replica |
| Connection pool | > 80% utilized | Add 1 read replica |

### Monitoring

The `ConnectionPoolPage` in the admin console shows real-time pool stats.
Use the Grafana dashboard to monitor:
- `db_connected` — primary connectivity
- `fm_connection_pool_*` — pool utilization
- Per-operation latency from OpenTelemetry traces
