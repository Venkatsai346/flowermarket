# Production Deployment Checklist

## Pre-deploy (automated by CI)

- [ ] All tests pass (`npm test`)
- [ ] No critical vulnerabilities (`npm audit`)
- [ ] Docker image builds successfully
- [ ] Lint passes with no errors

## Environment Variables

### Required (app won't start without these)
- [ ] `NODE_ENV=production`
- [ ] `MONGODB_URI` — MongoDB Atlas connection string
- [ ] `JWT_ACCESS_SECRET` — 64+ char random string
- [ ] `JWT_REFRESH_SECRET` — 64+ char random string (different from access)
- [ ] `RAZORPAY_KEY_ID` — Razorpay live key
- [ ] `RAZORPAY_KEY_SECRET` — Razorpay live secret
- [ ] `RAZORPAY_WEBHOOK_SECRET` — Razorpay webhook secret

### Recommended
- [ ] `REDIS_URL` — Redis for distributed rate limiting + caching
- [ ] `OTP_PROVIDER=msg91` or `twilio` — real OTP delivery
- [ ] `NOTIFICATION_PROVIDER` — push/email/SMS notifications
- [ ] `STORAGE_PROVIDER=s3` — S3 for media uploads
- [ ] `PLATFORM_ROOT_DOMAIN` — your domain (e.g., flowermarket.in)
- [ ] `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` — transactional email

### Security
- [ ] `TRUST_FORWARDED_HOST=true` — only behind your own proxy
- [ ] `ALLOW_TENANT_HEADER_OVERRIDE=false` — header override disabled in prod
- [ ] `LEDGER_STRICT=true` — strict ledger posting
- [ ] `COD_ENABLED` — set based on business decision

## Infrastructure

### MongoDB
- [ ] M0+ cluster (not shared/free for production)
- [ ] IP allowlist configured (or VPC peering)
- [ ] Database user with least-privilege role
- [ ] Automated backups enabled (daily minimum)
- [ ] Point-in-time recovery enabled
- [ ] Connection string uses `retryWrites=true&w=majority`

### Redis (optional but recommended)
- [ ] Redis 7+ instance
- [ ] `maxmemory-policy: allkeys-lru`
- [ ] AOF persistence enabled
- [ ] Password protected

### CDN / Static Assets
- [ ] Storefront built and deployed to CDN
- [ ] Admin console built and deployed to CDN
- [ ] CORS_ORIGINS includes CDN domain
- [ ] Cache headers set (1 year for hashed assets, 1 hour for HTML)

### SSL/TLS
- [ ] HTTPS enforced on all domains
- [ ] HSTS header enabled
- [ ] Certificate auto-renewal configured

## Post-deploy Verification

### Smoke Tests
- [ ] `GET /health` returns 200
- [ ] `GET /health/ready` returns 200 (MongoDB connected)
- [ ] `GET /api/v1/docs` loads Swagger UI
- [ ] Store frontend loads on custom domain
- [ ] Admin console loads and login works
- [ ] OTP send works (real SMS/email)
- [ ] Razorpay payment flow works end-to-end
- [ ] Webhook receives and processes events

### Monitoring
- [ ] `/health/deep` endpoint accessible to monitoring
- [ ] Log aggregation configured (CloudWatch/ELK/Datadog)
- [ ] Error alerting configured (5xx rate, latency p99)
- [ ] Uptime monitoring configured
- [ ] Database connection monitoring

### Performance
- [ ] Load test completed (target: 100 RPS minimum)
- [ ] p99 latency < 500ms for catalog endpoints
- [ ] p99 latency < 1s for checkout endpoints
- [ ] Image optimization working (WebP/AVIF)

## Rollback Plan

1. Keep previous Docker image tagged
2. Database migrations are backward-compatible
3. Feature flags for new functionality
4. Blue-green deployment preferred

## Emergency Contacts

- **Razorpay Support**: dashboard.razorpay.com/support
- **MongoDB Atlas**: cloud.mongodb.com/support
- **DNS Provider**: (your registrar)
