#!/usr/bin/env bash
# ============================================================
# Flower Market — MongoDB Backup Automation
# ============================================================
#
# Creates encrypted, compressed backups of the MongoDB database.
# Supports:
#   - Local backup (for development)
#   - S3 upload (for production)
#   - Retention policy (keep N days)
#   - Restore verification
#
# Usage:
#   ./backup-mongodb.sh [local|s3] [retention_days]
#
# Cron (daily at 2 AM):
#   0 2 * * * /opt/flowermarket/scripts/backup-mongodb.sh s3 30
#
# Environment:
#   MONGODB_URI        — MongoDB connection string
#   BACKUP_S3_BUCKET   — S3 bucket for backups (s3 mode)
#   BACKUP_ENCRYPT_KEY — GPG key for encryption (optional)
# ============================================================

set -euo pipefail

MODE="${1:-local}"
RETENTION_DAYS="${2:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/tmp/flowermarket-backups}"
BACKUP_NAME="flowermarket_${TIMESTAMP}"
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/flowermarket}"
S3_BUCKET="${BACKUP_S3_BUCKET:-flowermarket-backups}"

log() { echo "[backup $(date -Iseconds)] $*"; }
error() { log "ERROR: $*" >&2; exit 1; }

# ── Create backup ──
log "Starting backup: ${BACKUP_NAME} (mode=${MODE})"
mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"

# Dump all collections
mongodump \
  --uri="${MONGODB_URI}" \
  --out="${BACKUP_DIR}/${BACKUP_NAME}" \
  --gzip \
  --numParallelCollections=4 \
  2>&1 | while read -r line; do log "  mongodump: ${line}"; done

# Verify dump
COLLECTIONS=$(find "${BACKUP_DIR}/${BACKUP_NAME}" -name "*.bson.gz" | wc -l)
if [ "${COLLECTIONS}" -eq 0 ]; then
  error "Backup failed — no collections dumped"
fi
log "Dumped ${COLLECTIONS} collections"

# ── Compress ──
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
tar -czf "${BACKUP_FILE}" -C "${BACKUP_DIR}" "${BACKUP_NAME}"
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Compressed: ${BACKUP_FILE} (${BACKUP_SIZE})"

# ── Encrypt (optional) ──
if [ -n "${BACKUP_ENCRYPT_KEY:-}" ]; then
  gpg --batch --yes --passphrase "${BACKUP_ENCRYPT_KEY}" \
    --symmetric --cipher-algo AES256 \
    -o "${BACKUP_FILE}.gpg" "${BACKUP_FILE}"
  rm -f "${BACKUP_FILE}"
  BACKUP_FILE="${BACKUP_FILE}.gpg"
  log "Encrypted: ${BACKUP_FILE}"
fi

# ── Upload to S3 ──
if [ "${MODE}" = "s3" ]; then
  if ! command -v aws &>/dev/null; then
    error "AWS CLI not found — install for S3 backups"
  fi

  S3_KEY="mongodb/${BACKUP_NAME}.tar.gz$([ -n "${BACKUP_ENCRYPT_KEY:-}" ] && echo ".gpg")"
  aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/${S3_KEY}" \
    --storage-class STANDARD_IA \
    --sse aws:kms
  log "Uploaded: s3://${S3_BUCKET}/${S3_KEY}"

  # ── Retention: delete old backups ──
  CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y%m%d)
  aws s3 ls "s3://${S3_BUCKET}/mongodb/" | while read -r line; do
    FILE_DATE=$(echo "${line}" | grep -oP 'flowermarket_\K\d{8}' || true)
    if [ -n "${FILE_DATE}" ] && [ "${FILE_DATE}" -lt "${CUTOFF}" ]; then
      FILE_NAME=$(echo "${line}" | awk '{print $4}')
      aws s3 rm "s3://${S3_BUCKET}/mongodb/${FILE_NAME}"
      log "Pruned old backup: ${FILE_NAME}"
    fi
  done
fi

# ── Cleanup local ──
rm -rf "${BACKUP_DIR}/${BACKUP_NAME}"
log "Backup complete: ${BACKUP_FILE}"

# ── Restore verification (optional) ──
if [ "${MODE}" = "local" ] && [ "${VERIFY_RESTORE:-false}" = "true" ]; then
  log "Verifying restore..."
  VERIFY_DIR=$(mktemp -d)
  tar -xzf "${BACKUP_FILE}" -C "${VERIFY_DIR}"
  RESTORE_COUNT=$(find "${VERIFY_DIR}" -name "*.bson.gz" | wc -l)
  if [ "${RESTORE_COUNT}" -eq "${COLLECTIONS}" ]; then
    log "Restore verification passed (${RESTORE_COUNT} collections)"
  else
    error "Restore verification failed: expected ${COLLECTIONS}, got ${RESTORE_COUNT}"
  fi
  rm -rf "${VERIFY_DIR}"
fi

log "Done."
