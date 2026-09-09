# Flower Market — Operational Runbook

## Quick Reference

| Service | Health Check | Logs | Metrics |
|---|---|---|---|
| API | `GET /health/ready` | `kubectl logs -f deploy/flowermarket-api` | `/metrics` (Prometheus) |
| Worker | `GET /health` | `kubectl logs -f deploy/flowermarket-worker` | Outbox depth gauge |
| Scheduler | `GET /health` | `kubectl logs -f deploy/flowermarket-scheduler` | Job status gauges |
| MongoDB | `mongosh --eval 'db.adminCommand({ping:1})'` | Atlas UI / CloudWatch | Grafana dashboard |

## Incident Response

### P0: API Down (all requests failing)

**Symptoms:** Health check returns 503, Grafana shows 0 requests/sec

**Steps:**
1. Check pod status: `kubectl get pods -n flowermarket`
2. Check pod logs: `kubectl logs -f deploy/flowermarket-api --tail=100`
3. Check MongoDB connectivity: `kubectl exec -it deploy/flowermarket-api -- node -e "require('mongoose').connect(process.env.MONGODB_URI).then(() => console.log('OK')).catch(console.error)"`
4. Check recent deployments: `kubectl rollout history deployment/flowermarket-api`
5. Rollback if needed: `kubectl rollout undo deployment/flowermarket-api`
6. Check resource limits: `kubectl top pods -n flowermarket`

### P0: Payment Failures (Razorpay errors)

**Symptoms:** Payment success rate drops, stuck payments growing

**Steps:**
1. Check payment reconciliation: `GET /admin/phase74/pool/stats`
2. Check Razorpay status: https://status.razorpay.com/
3. Check webhook delivery: `GET /admin/notifications?status=failed`
4. Manual reconciliation trigger: `POST /admin/exports/run`
5. Check error logs for payment gateway timeouts

### P1: High Latency (p95 > 2s)

**Symptoms:** Grafana shows latency spike, customer complaints

**Steps:**
1. Check connection pool: Admin → Connection Pool page
2. Check slow ops: `GET /admin/phase74/pool/slow-ops?thresholdMs=200`
3. Check MongoDB Atlas: slow query profiler
4. Check event loop lag: Grafana → Event Loop Lag panel
5. Check memory: `kubectl top pods` — if RSS > 1GB, possible leak
6. Scale up: `kubectl scale deployment/flowermarket-api --replicas=5`

### P1: Outbox Backlog Growing

**Symptoms:** Pending outbox events > 100, notifications delayed

**Steps:**
1. Check worker status: `kubectl get pods -l app.kubernetes.io/component=worker`
2. Check worker logs: `kubectl logs -f deploy/flowermarket-worker`
3. Check DLQ: Admin → Dead Letter Queue page
4. Requeue failed events: DLQ page → Bulk Requeue
5. Restart worker: `kubectl rollout restart deployment/flowermarket-worker`

### P2: Disk Space (MongoDB)

**Symptoms:** MongoDB write errors, Atlas storage warnings

**Steps:**
1. Check collection sizes: `db.stats()` in mongosh
2. Identify large collections: `db.getCollectionNames().forEach(c => print(c, db[c].stats().size))`
3. Archive old data: export + drop old months
4. Check TTL indexes: ensure expiring documents are cleaned up
5. Upgrade Atlas tier if needed

### P2: SSL Certificate Expiring

**Steps:**
1. Check cert status: `kubectl get certificate -n flowermarket`
2. Force renewal: `kubectl delete certificate flowermarket-tls -n flowermarket`
3. Check cert-manager logs: `kubectl logs -f deploy/cert-manager -n cert-manager`

## Scaling Guide

### Horizontal Scaling (API)

```bash
# Manual scale
kubectl scale deployment/flowermarket-api --replicas=5

# Auto-scale (already configured)
# HPA: min=2, max=10, target CPU=70%
kubectl get hpa -n flowermarket
```

### Vertical Scaling (Resources)

```bash
# Edit resource limits
kubectl edit deployment/flowermarket-api -n flowermarket
# Change: resources.limits.cpu/memory
```

### Database Scaling

1. **Read replicas**: Enable in MongoDB Atlas → Additional nodes
2. **Sharding**: See `docs/architecture/MONGODB_SCALING.md`
3. **Connection pool**: Set `MONGO_MAX_POOL_SIZE` env var

## Backup & Restore

### Backup

```bash
# Automated (cron: daily at 2 AM)
MONGODB_URI="..." BACKUP_S3_BUCKET="flowermarket-backups" \
  ./infra/scripts/backup-mongodb.sh s3 30

# Manual
mongodump --uri="$MONGODB_URI" --gzip --out=/tmp/backup-$(date +%Y%m%d)
```

### Restore

```bash
# Download from S3
aws s3 cp s3://flowermarket-backups/mongodb/flowermarket_20240101.tar.gz /tmp/

# Extract and restore
tar -xzf /tmp/flowermarket_20240101.tar.gz -C /tmp/
mongorestore --uri="$MONGODB_URI" --gzip /tmp/flowermarket_20240101/
```

## Deployment

### Standard Deploy

```bash
# Build and push
docker build -t flowermarket/api:v1.2.3 backend/
docker push flowermarket/api:v1.2.3

# Deploy
./infra/scripts/blue-green-deploy.sh v1.2.3 flowermarket
```

### Emergency Rollback

```bash
kubectl rollout undo deployment/flowermarket-api -n flowermarket
```

## Monitoring Queries

### Prometheus (useful PromQL)

```promql
# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# p95 latency
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Active connections
db_connected

# Outbox depth
outbox_events{status="pending"}
```

### MongoDB (useful queries)

```javascript
// Current operations
db.currentOp({ "active": true, "secs_running": { "$gt": 5 } })

// Collection stats
db.orders.stats()

// Index usage
db.orders.aggregate([{ $indexStats: {} }])

// Slow queries (profiling level 1)
db.system.profile.find().sort({ ts: -1 }).limit(10)
```

## Contact Escalation

| Level | Who | When |
|---|---|---|
| L1 | On-call engineer | All alerts |
| L2 | Backend lead | P0/P1 incidents |
| L3 | CTO | Data loss, security breach |
| External | Razorpay support | Payment gateway issues |
| External | MongoDB Atlas | Database infrastructure |
