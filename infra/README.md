# Flower Market — Infrastructure & DevOps

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CloudFront CDN                        │
│                    (static assets, images)                    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                         AWS ALB                              │
│              (TLS termination, routing)                      │
└──────────┬─────────────────────────────┬────────────────────┘
           │                             │
┌──────────▼──────────┐    ┌─────────────▼──────────────────┐
│   EKS Cluster       │    │   S3 Bucket                    │
│  ┌──────────────┐   │    │   (media uploads, invoices)    │
│  │ API (3 pods) │   │    └────────────────────────────────┘
│  ├──────────────┤   │
│  │ Worker (1)   │   │    ┌────────────────────────────────┐
│  ├──────────────┤   │    │   MongoDB Atlas                │
│  │ Scheduler(1) │   │    │   (managed, replicated)        │
│  └──────────────┘   │    └────────────────────────────────┘
│                     │
│  ┌──────────────┐   │    ┌────────────────────────────────┐
│  │ Prometheus   │   │    │   AWS Secrets Manager          │
│  │ Grafana      │   │    │   (secrets, API keys)          │
│  │ Loki/Promtail│   │    └────────────────────────────────┘
│  └──────────────┘   │
└─────────────────────┘
```

## Directory Structure

```
infra/
├── terraform/              # Infrastructure as Code (AWS)
│   ├── modules/
│   │   ├── vpc/            # VPC, subnets, NAT, flow logs
│   │   ├── eks/            # EKS cluster, node groups, IRSA
│   │   └── storage/        # S3 buckets, CloudFront CDN
│   └── environments/
│       ├── staging/        # Staging environment
│       └── production/     # Production environment
├── k8s/                    # Kubernetes manifests
│   ├── base/               # Base resources (Kustomize)
│   └── overlays/
│       ├── staging/        # Staging overrides
│       └── production/     # Production overrides (3 replicas)
├── helm/                   # Helm chart
│   └── flowermarket/
├── monitoring/             # Observability configs
│   ├── grafana/            # Dashboard JSON
│   ├── prometheus/         # Alerting rules
│   └── loki/               # Log aggregation (Promtail)
└── scripts/                # Operational scripts
    ├── backup-mongodb.sh   # Automated backup + S3 upload
    └── blue-green-deploy.sh # Zero-downtime deployment
```

## Quick Start

### 1. Provision Infrastructure (Terraform)
```bash
cd infra/terraform/environments/staging
terraform init
terraform plan
terraform apply
```

### 2. Configure kubectl
```bash
aws eks update-kubeconfig --name flowermarket-staging-eks --region ap-south-1
```

### 3. Deploy with Kustomize
```bash
kubectl apply -k infra/k8s/overlays/staging/
```

### 4. Deploy with Helm
```bash
helm install flowermarket infra/helm/flowermarket/ \
  -f infra/helm/flowermarket/values-staging.yaml
```

### 5. Zero-Downtime Deploy
```bash
./infra/scripts/blue-green-deploy.sh v1.2.3 flowermarket
```

### 6. Backup Database
```bash
MONGODB_URI="..." ./infra/scripts/backup-mongodb.sh s3 30
```

## Monitoring

- **Grafana Dashboard**: Import `infra/monitoring/grafana/flowermarket-dashboard.json`
- **Alert Rules**: Apply `infra/monitoring/prometheus/alerts.yaml` to Prometheus
- **Log Aggregation**: Deploy Promtail with `infra/monitoring/loki/promtail-config.yaml`
- **Tracing**: Set `OTEL_ENABLED=true` for OpenTelemetry traces

## Security

- **TLS**: Automatic via cert-manager + Let's Encrypt
- **Secrets**: External Secrets Operator syncs from AWS Secrets Manager
- **Network**: VPC with private subnets, security groups, flow logs
- **Container**: Non-root user, read-only filesystem, no privilege escalation
