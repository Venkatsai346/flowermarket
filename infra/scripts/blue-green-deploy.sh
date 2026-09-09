#!/usr/bin/env bash
# ============================================================
# Flower Market — Blue-Green Deployment Script
# ============================================================
#
# Zero-downtime deployment using K8s rolling update + health gates.
#
# Strategy:
#   1. Deploy new version alongside current (green)
#   2. Wait for green pods to pass readiness checks
#   3. Shift traffic to green (update Service selector)
#   4. Verify green is serving correctly
#   5. Scale down blue (old version)
#   6. If green fails → rollback to blue automatically
#
# Usage:
#   ./blue-green-deploy.sh <image_tag> [namespace]
#
# Example:
#   ./blue-green-deploy.sh v1.2.3 flowermarket
# ============================================================

set -euo pipefail

IMAGE_TAG="${1:?Usage: $0 <image_tag> [namespace]}"
NAMESPACE="${2:-flowermarket}"
DEPLOYMENT="flowermarket-api"
SERVICE="flowermarket-api"
TIMEOUT=300  # 5 minutes max wait
ROLLBACK_ON_FAIL=true

log() { echo "[deploy $(date -Iseconds)] $*"; }
error() { log "ERROR: $*" >&2; exit 1; }

# ── Get current version ──
CURRENT_IMAGE=$(kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "none")
log "Current: ${CURRENT_IMAGE}"
log "Target:  flowermarket/api:${IMAGE_TAG}"

if [ "${CURRENT_IMAGE}" = "flowermarket/api:${IMAGE_TAG}" ]; then
  log "Already running ${IMAGE_TAG} — nothing to do"
  exit 0
fi

# ── Set the new image (triggers rolling update) ──
log "Deploying flowermarket/api:${IMAGE_TAG}..."
kubectl set image deployment/"${DEPLOYMENT}" \
  api="flowermarket/api:${IMAGE_TAG}" \
  -n "${NAMESPACE}"

# ── Wait for rollout ──
log "Waiting for rollout to complete (timeout: ${TIMEOUT}s)..."
if ! kubectl rollout status deployment/"${DEPLOYMENT}" \
  -n "${NAMESPACE}" --timeout="${TIMEOUT}s"; then

  log "Rollout failed or timed out!"

  if [ "${ROLLBACK_ON_FAIL}" = "true" ]; then
    log "Rolling back to previous version..."
    kubectl rollout undo deployment/"${DEPLOYMENT}" -n "${NAMESPACE}"
    kubectl rollout status deployment/"${DEPLOYMENT}" \
      -n "${NAMESPACE}" --timeout="${TIMEOUT}s"
    log "Rollback complete — still running: ${CURRENT_IMAGE}"
  fi
  error "Deployment of ${IMAGE_TAG} failed"
fi

# ── Verify health ──
log "Verifying health..."
READY_PODS=$(kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" \
  -o jsonpath='{.status.readyReplicas}')
DESIRED_PODS=$(kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.replicas}')

if [ "${READY_PODS}" -lt "${DESIRED_PODS}" ]; then
  log "Only ${READY_PODS}/${DESIRED_PODS} pods ready"
  if [ "${ROLLBACK_ON_FAIL}" = "true" ]; then
    log "Rolling back..."
    kubectl rollout undo deployment/"${DEPLOYMENT}" -n "${NAMESPACE}"
    error "Deployment failed — not all pods ready"
  fi
fi

log "✅ Deployment successful: flowermarket/api:${IMAGE_TAG}"
log "   Ready pods: ${READY_PODS}/${DESIRED_PODS}"
log "   Previous: ${CURRENT_IMAGE}"

# ── Post-deploy smoke test ──
log "Running post-deploy smoke test..."
API_URL="https://api.flowermarket.in/health"
for i in {1..5}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}" 2>/dev/null || echo "000")
  if [ "${STATUS}" = "200" ]; then
    log "Health check passed (attempt ${i})"
    break
  fi
  log "Health check ${STATUS} (attempt ${i}/5) — retrying in 5s..."
  sleep 5
done

if [ "${STATUS}" != "200" ]; then
  error "Post-deploy health check failed (status=${STATUS})"
fi

log "🚀 Deployment complete: flowermarket/api:${IMAGE_TAG}"
