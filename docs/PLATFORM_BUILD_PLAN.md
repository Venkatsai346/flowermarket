# Flower Market — Complete Platform Build Plan

> **Goal:** Make the platform 100% fully end-to-end complete, world-class, solid, robust,
> stunning, and scalable.
>
> **Status:** IN PROGRESS — Phase 7.0
>
> **Last updated:** 2026-09-09

---

## Design Principles

1. **Every phase is shippable** — no phase leaves the platform broken
2. **Dependencies flow downward** — Phase N never blocks Phase N-1
3. **Parallelism is explicit** — independent tracks run concurrently
4. **Every deliverable has a verification gate** — no "done" without proof
5. **The existing architecture is sacred** — no rework, only extension

---

## Phase 7.0 — Foundation & Production Readiness (Week 1–2)

> *The platform runs but cannot be deployed. This phase makes it deployable.*

### Track A: Production Infrastructure

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.0.1 | Multi-stage Dockerfile | ✅ | `docker build -t fm-api . && docker run fm-api` starts clean |
| 7.0.2 | Production docker-compose hardening | ⬜ | `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` validates |
| 7.0.3 | `.env.production.example` | ✅ | A new developer can fill it in from the comments alone |
| 7.0.4 | Root README.md | ✅ | Clone → run → see app in < 10 minutes |
| 7.0.5 | CONTRIBUTING.md | ✅ | Merge checklist references it |
| 7.0.6 | Structured logging (JSON) | ✅ | Logs parseable by any JSON log aggregator |
| 7.0.7 | Graceful shutdown | ✅ | `kill -TERM` completes pending requests |

### Track B: Security Hardening

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.0.8 | Content-Security-Policy | ✅ | CSP violation reports received; no breakage |
| 7.0.9 | Account lockout | ⬜ | 11th failed attempt → 429; unlock after 15 min |
| 7.0.10 | Webhook IP allowlisting | ⬜ | Non-allowed IPs → 403 |
| 7.0.11 | Admin IP allowlisting | ⬜ | Non-allowed IPs → 403 in production |
| 7.0.12 | 2FA for super_admin | ⬜ | Login requires OTP + TOTP code |

### Track C: Backend Completeness

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.0.13 | PDF invoice endpoint | ⬜ | Browser downloads a valid PDF |
| 7.0.14 | Credit note PDF | ⬜ | Browser downloads a valid PDF |
| 7.0.15 | Error handling standardization | ✅ | `Object.assign(new Error` in services → 0 results |
| 7.0.16 | Request timeout middleware | ✅ | 60s query → 504, not hung |
| 7.0.17 | OpenAPI spec generation | ✅ | Swagger UI at `/api/v1/docs` |
| 7.0.18 | DB migration system | ✅ | `npm run migrate` runs pending migrations |

**Phase 7.0 Gate:** `npm run smoke:all` passes. Docker image builds. Production env example is complete.

---

## Phase 7.1 — Storefront Completion (Week 2–4)

### Track A: Core UX Fixes

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.1.1 | Razorpay Checkout.js wiring | ⬜ | End-to-end: place order → Razorpay modal → confirmed |
| 7.1.2 | Error boundaries | ⬜ | Simulated crash shows fallback, not blank |
| 7.1.3 | Loading skeletons | ⬜ | Every page has a loading state |
| 7.1.4 | Scroll-to-top on navigation | ⬜ | Back button restores scroll position |
| 7.1.5 | Infinite scroll | ⬜ | Scrolling loads next page seamlessly |
| 7.1.6 | Image optimization | ⬜ | Lighthouse "Properly size images" passes |
| 7.1.7 | Toast persistence | ⬜ | Toasts survive route changes for 4s |
| 7.1.8 | Cart item removal confirmation | ⬜ | No accidental removals |

### Track B: Missing Customer Features

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.1.9 | Invoice download | ⬜ | PDF opens in browser |
| 7.1.10 | Reorder | ⬜ | One-tap reorder works |
| 7.1.11 | Share product | ⬜ | Share sheet opens; copied link opens PDP |
| 7.1.12 | Search event beacons | ⬜ | `searchQueryLogs` show clicks/carts |
| 7.1.13 | Payment completion UI | ⬜ | Async payment flow visually complete |
| 7.1.14 | Category browse page | ⬜ | Dedicated browse experience |
| 7.1.15 | Store about page | ⬜ | Store owners describe their business |

### Track C: SEO & PWA

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.1.16 | sitemap.xml | ⬜ | Valid XML with all products |
| 7.1.17 | robots.txt | ⬜ | Valid directives |
| 7.1.18 | Meta tags per page | ⬜ | Social share shows correct preview |
| 7.1.19 | PWA manifest | ⬜ | "Add to Home Screen" works |
| 7.1.20 | Service worker | ⬜ | Offline fallback page loads |
| 7.1.21 | Accessibility | ⬜ | axe-core 0 critical violations |

### Track D: i18n Completion

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.1.22 | Telugu translation audit | ⬜ | Missing `te` keys → 0 |
| 7.1.23 | Language toggle persistence | ⬜ | Refresh → correct language |

**Phase 7.1 Gate:** Lighthouse Performance ≥ 90, Accessibility ≥ 95.

---

## Phase 7.2 — Admin Console Completion (Week 3–5)

### Track A: Dashboard & Analytics

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.2.1 | Dashboard KPI cards | ⬜ | Real data renders |
| 7.2.2 | Analytics charts (Recharts) | ⬜ | Charts render; responsive |
| 7.2.3 | Recent activity feed | ⬜ | Polls every 30s |
| 7.2.4 | Top products table | ⬜ | Data matches API |

### Track B: Missing Admin Pages

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.2.5 | Audit log page | ⬜ | Filterable table renders |
| 7.2.6 | Tenant settings page | ⬜ | Changes persist |
| 7.2.7 | Export download center | ⬜ | CSV downloads work |
| 7.2.8 | Fiscal period management | ⬜ | Close/reopen works |
| 7.2.9 | Settlement ingestion UI | ⬜ | CSV upload works |
| 7.2.10 | Bank statement ingestion UI | ⬜ | CSV upload works |
| 7.2.11 | Statutory deposits UI | ⬜ | Deposit/revert works |
| 7.2.12 | Delivery zone management | ⬜ | Zone CRUD works |
| 7.2.13 | Location management | ⬜ | Location tree renders |

### Track C: UX Polish

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.2.14 | Dark mode | ⬜ | Toggle works; all pages readable |
| 7.2.15 | Notification bell | ⬜ | Unread count + dropdown |
| 7.2.16 | Keyboard shortcuts | ⬜ | `/`, `g+o`, `g+c`, `g+p` work |
| 7.2.17 | Command palette (Cmd+K) | ⬜ | Fuzzy search navigates |
| 7.2.18 | Bulk actions | ⬜ | Multi-select → bulk update |
| 7.2.19 | Print-optimized views | ⬜ | `Ctrl+P` → clean layout |

### Track D: Real-Time Updates

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.2.20 | Server-Sent Events | ⬜ | Live updates without polling |
| 7.2.21 | Live order feed | ⬜ | New orders appear instantly |
| 7.2.22 | Live delivery tracking | ⬜ | Status changes in real-time |

**Phase 7.2 Gate:** Every API endpoint has admin UI. Dashboard shows charts. SSE stream live.

---

## Phase 7.3 — Mobile App (Week 4–8)

### Track A: Foundation (Week 4–5)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.3.1 | Navigation setup (React Navigation) | ⬜ | Tab switching works |
| 7.3.2 | AsyncStorage integration | ⬜ | Session persists across restarts |
| 7.3.3 | API client wiring | ⬜ | API calls work on device |
| 7.3.4 | Theme system | ⬜ | Brand colours render |
| 7.3.5 | Splash screen | ⬜ | Smooth transition |
| 7.3.6 | App icons | ⬜ | Icons appear on home screen |

### Track B: Core Screens (Week 5–7)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.3.7 | Home screen | ⬜ | Products render |
| 7.3.8 | Search screen | ⬜ | Debounced search works |
| 7.3.9 | Product detail | ⬜ | Full PDP experience |
| 7.3.10 | Cart screen | ⬜ | Cart CRUD works |
| 7.3.11 | Checkout screen | ⬜ | End-to-end checkout |
| 7.3.12 | Order list | ⬜ | Pull-to-refresh works |
| 7.3.13 | Order detail | ⬜ | Full detail experience |
| 7.3.14 | Auth screens | ⬜ | OTP flow works |
| 7.3.15 | Address management | ⬜ | CRUD works |

### Track C: After-Sales & Wallet (Week 7–8)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.3.16 | Returns screen | ⬜ | Return flow works |
| 7.3.17 | Wallet screen | ⬜ | Wallet CRUD works |
| 7.3.18 | Push notifications | ⬜ | Push received → deep link |
| 7.3.19 | Biometric auth | ⬜ | Biometric → session restored |
| 7.3.20 | Camera integration | ⬜ | Photo captured → uploaded |
| 7.3.21 | Image caching | ⬜ | Instant on revisit |
| 7.3.22 | Offline cart | ⬜ | Syncs on reconnect |

### Track D: Polish & Release (Week 8)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.3.23 | App Store metadata | ⬜ | Ready for submission |
| 7.3.24 | Performance profiling | ⬜ | 60fps on mid-range Android |
| 7.3.25 | Crash reporting (Sentry) | ⬜ | Crashes reported |
| 7.3.26 | Analytics | ⬜ | Events appear in dashboard |

**Phase 7.3 Gate:** App runs on iOS + Android. E2E checkout. Push notifications. Store-ready.

---

## Phase 7.4 — Backend Features & Hardening (Week 5–7)

### Track A: Customer Features

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.4.1 | Product reviews | ⬜ | Submit → appears → admin moderates |
| 7.4.2 | Wishlist | ⬜ | Heart tap → saved → wishlist page |
| 7.4.3 | Email notifications | ⬜ | Email received |
| 7.4.4 | SMS notifications | ⬜ | SMS received |
| 7.4.5 | Notification preferences | ⬜ | Opt-out respected |

### Track B: Operational Features

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.4.6 | Scheduled job persistence | ⬜ | Jobs survive restart |
| 7.4.7 | Dead letter queue UI | ⬜ | Requeue works |
| 7.4.8 | Inventory demand forecasting | ⬜ | Recommendations shown |
| 7.4.9 | Multi-warehouse management | ⬜ | Warehouse CRUD works |
| 7.4.10 | Delivery zone editor | ⬜ | Zone CRUD works |

### Track C: Compliance

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.4.11 | E-way bill data | ⬜ | Threshold flagged |
| 7.4.12 | HSN summary table | ⬜ | Invoice shows HSN summary |
| 7.4.13 | GSTR-2B placeholder | ⬜ | CSV export works |

### Track D: Performance

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.4.14 | Search cache LRU | ⬜ | Memory flat under load |
| 7.4.15 | Query performance audit | ⬜ | No collection scans |
| 7.4.16 | Connection pool monitoring | ⬜ | Exhaustion visible |
| 7.4.17 | Request deduplication | ⬜ | 10 concurrent → 1 query |

**Phase 7.4 Gate:** Reviews + wishlist work. Email/SMS received. Jobs persist.

---

## Phase 7.5 — Testing & Quality (Week 7–9)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.5.1 | Load testing (k6) | ⬜ | p95 < 200ms search, < 500ms checkout |
| 7.5.2 | Contract testing (Pact) | ⬜ | Contracts verified in CI |
| 7.5.3 | Visual regression (Percy) | ⬜ | Diffs reviewed on PR |
| 7.5.4 | Accessibility CI (axe-core) | ⬜ | 0 critical violations |
| 7.5.5 | Security scanning (Snyk) | ⬜ | No high/critical vulns |
| 7.5.6 | Mutation testing (Stryker) | ⬜ | Score > 80% |
| 7.5.7 | E2E coverage expansion | ⬜ | All critical paths covered |
| 7.5.8 | Chaos testing | ⬜ | Graceful degradation |

**Phase 7.5 Gate:** Load targets met. No critical vulns. Mutation > 80%.

---

## Phase 7.6 — DevOps & Monitoring (Week 8–10)

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.6.1 | Terraform IaC | ⬜ | `terraform apply` creates resources |
| 7.6.2 | Kubernetes manifests | ⬜ | `kubectl apply` deploys |
| 7.6.3 | Helm chart | ⬜ | `helm install` deploys everything |
| 7.6.4 | CI/CD pipeline | ⬜ | Push → staging auto-deploys |
| 7.6.5 | Monitoring dashboards (Grafana) | ⬜ | Real-time data renders |
| 7.6.6 | Alerting rules | ⬜ | Alerts fire on breach |
| 7.6.7 | Log aggregation (Loki) | ⬜ | Searchable by traceId |
| 7.6.8 | Distributed tracing (OTel) | ⬜ | Traces visible |
| 7.6.9 | CDN for static assets | ⬜ | Lighthouse cache policy passes |
| 7.6.10 | Backup automation | ⬜ | Restore tested |
| 7.6.11 | Secrets management | ⬜ | No `.env` in production |
| 7.6.12 | SSL/TLS | ⬜ | `https://` works; HSTS |
| 7.6.13 | Blue-green deployment | ⬜ | 0 dropped requests during deploy |

**Phase 7.6 Gate:** Full stack deploys via CI/CD. Dashboards live. Alerts configured.

---

## Phase 7.7 — Polish & Scale (Week 10–12)

### Track A: Frontend Polish

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.7.1 | Micro-interactions | ⬜ | Interactions feel premium |
| 7.7.2 | Haptic feedback (mobile) | ⬜ | Haptics fire on device |
| 7.7.3 | Image blur-up loading | ⬜ | No layout shift |
| 7.7.4 | Share-to-WhatsApp | ⬜ | Opens WhatsApp with link |
| 7.7.5 | Pull-to-refresh (mobile) | ⬜ | Gesture works |
| 7.7.6 | Empty state illustrations | ⬜ | Beautiful empty states |

### Track B: Scale Preparation

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.7.7 | MongoDB sharding key | ⬜ | Config documented |
| 7.7.8 | Read replicas | ⬜ | Analytics on secondary |
| 7.7.9 | Redis caching | ⬜ | Hit rate > 90% |
| 7.7.10 | Queue system (BullMQ) | ⬜ | Jobs survive restart |
| 7.7.11 | API response caching | ⬜ | CDN hits |
| 7.7.12 | Connection pool tuning | ⬜ | Utilization < 80% |

### Track C: Documentation

| # | Deliverable | Status | Verification |
|---|---|---|---|
| 7.7.13 | Architecture diagrams | ⬜ | Diagrams in `docs/diagrams/` |
| 7.7.14 | Deployment guide | ⬜ | Ops can deploy from guide |
| 7.7.15 | Runbook | ⬜ | Each incident has 1-2-3 fix |
| 7.7.16 | API changelog | ⬜ | Every release documented |
| 7.7.17 | Frontend architecture docs | ⬜ | New dev understands codebase |

**Phase 7.7 Gate:** Lighthouse ≥ 95. Redis active. Queue replaces in-memory. Docs complete.

---

## Phase 7.8 — Advanced Features (Week 12–16)

| # | Feature | Status | Business Value |
|---|---|---|---|
| 7.8.1 | Subscription orders | ⬜ | Recurring revenue |
| 7.8.2 | Loyalty program | ⬜ | Customer LTV increase |
| 7.8.3 | Referral system | ⬜ | Organic growth |
| 7.8.4 | Feature flags | ⬜ | Safe rollout |
| 7.8.5 | Multi-currency | ⬜ | International expansion |
| 7.8.6 | Customer support | ⬜ | Customer satisfaction |
| 7.8.7 | Advanced analytics | ⬜ | Data-driven decisions |
| 7.8.8 | Learning-to-rank | ⬜ | Search relevance |
| 7.8.9 | Real-time inventory sync | ⬜ | Instant stock feedback |
| 7.8.10 | Voice ordering | ⬜ | New ordering channel |

---

## Critical Path & Timeline

```
Week  1─2:  ██████████  Phase 7.0 (Foundation)
Week  2─4:  ████████████████  Phase 7.1 (Storefront)
Week  3─5:    ████████████████  Phase 7.2 (Admin Console)
Week  4─8:      ████████████████████████████  Phase 7.3 (Mobile App)
Week  5─7:        ████████████████  Phase 7.4 (Backend Features)
Week  7─9:            ████████████████  Phase 7.5 (Testing)
Week  8─10:              ████████████████  Phase 7.6 (DevOps)
Week 10─12:                  ████████████████  Phase 7.7 (Polish)
Week 12─16:                      ████████████████████████  Phase 7.8 (Advanced)
```

**Total: ~16 weeks to world-class, production-ready, fully complete platform.**
