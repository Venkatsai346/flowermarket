# Flower Market — System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CloudFront CDN                           │
│              (static assets, product images, invoices)            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                        AWS ALB / Nginx                            │
│                 (TLS termination, routing)                        │
└───────┬─────────────────────────────────────────────┬───────────┘
        │                                             │
┌───────▼──────────┐                    ┌─────────────▼───────────┐
│  Storefront SPA  │                    │    Admin Console SPA     │
│  (React + Vite)  │                    │    (React + Vite)        │
│  Customer-facing │                    │    Merchant/Platform     │
└───────┬──────────┘                    └─────────────┬───────────┘
        │ REST API                                    │ REST API
┌───────▼─────────────────────────────────────────────▼───────────┐
│                      EKS / Docker                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    API Server (Express)                    │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐  │   │
│  │  │Auth  │ │Orders│ │Pay   │ │Search│ │ Catalog      │  │   │
│  │  │JWT+  │ │Saga  │ │Gateway│ │Elastic│ │Multi-tenant │  │   │
│  │  │OTP   │ │FSM   │ │Razor │ │MongoDB│ │Product mgmt │  │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────────────┘  │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐  │   │
│  │  │Ledger│ │Tax   │ │Payout│ │Notif │ │ Media        │  │   │
│  │  │Double│ │GST   │ │RazorX│ │FCM   │ │ S3/Local     │  │   │
│  │  │Entry │ │E-inv │ │Cashf │ │SMTP  │ │ Upload       │  │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Worker       │  │ Scheduler    │  │ Metrics (Prometheus) │  │
│  │ Outbox drain │  │ Cron jobs    │  │ /metrics endpoint    │  │
│  │ Notification │  │ Nightly      │  │ Grafana dashboards   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │                │                │
┌───────▼────────────────▼────────────────▼───────────────────────┐
│                        Data Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ MongoDB      │  │ Redis        │  │ S3                   │  │
│  │ Primary DB   │  │ Cache/Queue  │  │ Media storage        │  │
│  │ Replica Set  │  │ Rate limits  │  │ Invoice PDFs         │  │
│  │ 100+ indexes │  │ Session cache│  │ Backups              │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Order Lifecycle State Machine

```
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│ CREATED │───▶│CONFIRMED │───▶│PROCESSING │───▶│ PACKED   │
└─────────┘    └──────────┘    └───────────┘    └──────────┘
     │              │                                │
     │              ▼                                ▼
     │         ┌──────────┐                   ┌───────────┐
     │         │ CANCELLED│                   │OUT_FOR_   │
     │         └──────────┘                   │DELIVERY   │
     │              ▲                          └───────────┘
     │              │                                │
     │              │                                ▼
     │              │                          ┌──────────┐
     └──────────────│──────────────────────────│ DELIVERED│
                    │                          └──────────┘
                    │                                │
              ┌─────┴─────┐                          ▼
              │ RETURN_   │                    ┌──────────┐
              │ REQUESTED │◀───────────────────│COMPLETED │
              └───────────┘                    └──────────┘
```

## Multi-Tenant Isolation

```
┌─────────────────────────────────────────────────┐
│                   Tenant A                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │Products │ │ Orders  │ │ Payments│  tenantId  │
│  │filter   │ │ filter  │ │ filter  │  on every  │
│  │{tenantId}│{tenantId}│{tenantId}│  query     │
│  └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────┤
│                   Tenant B                       │
│  (same schema, different data, fully isolated)   │
└─────────────────────────────────────────────────┘
```

## Payment Flow

```
Customer ──▶ Checkout ──▶ Create Order ──▶ Reserve Stock + Slot
                                              │
                                              ▼
                                     Create Payment (PENDING)
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │ Razorpay       │
                                     │ Checkout       │
                                     │ (UPI/Card/COD) │
                                     └───────┬────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                         SUCCESS        FAILED        AWAITING
                              │              │         COLLECTION
                              ▼              ▼              │
                         Confirm          Cancel           ▼
                         Order            Order        Rider
                              │              │         collects
                              ▼              ▼         cash
                         Deliver         Restore            │
                         Order           Stock              ▼
                                                    COD collected
                                                    → confirm order
```

## Data Flow: Catalog → Search

```
Product Update (Admin)
       │
       ▼
TenantProduct.save()
       │
       ▼
CatalogEvent.publish() ──▶ Outbox ──▶ Worker drain()
       │                                      │
       │                                      ▼
       │                              SearchIndexer
       │                              (MongoDB text
       │                               or OpenSearch)
       │                                      │
       ▼                                      ▼
Cache invalidation                    Search results
(BoundedCache)                        (ranked by profile)
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│                AWS EKS Cluster                   │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐               │
│  │ API Pod 1   │  │ API Pod 2   │  HPA: 2-10   │
│  │ (512Mi,CPU1)│  │ (512Mi,CPU1)│               │
│  └──────┬──────┘  └──────┬──────┘               │
│         │                │                       │
│  ┌──────▼────────────────▼──────┐               │
│  │      Worker Pod (1 replica)  │               │
│  │      Outbox + Notifications  │               │
│  └──────────────────────────────┘               │
│                                                  │
│  ┌──────────────────────────────┐               │
│  │   Scheduler Pod (1 replica)  │               │
│  │   Cron: nightly, reconcile   │               │
│  └──────────────────────────────┘               │
│                                                  │
│  ┌──────────────────────────────┐               │
│  │   Monitoring Stack           │               │
│  │   Prometheus + Grafana       │               │
│  │   Loki + Promtail            │               │
│  │   OpenTelemetry Collector    │               │
│  └──────────────────────────────┘               │
└─────────────────────────────────────────────────┘
```
