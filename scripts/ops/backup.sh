#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ModelScript Production Database Snapshot Utility
#
# Creates an atomic, online SQLite VACUUM INTO snapshot of the production
# database, saves it with SHA-256 checksums on the host filesystem, and
# automatically prunes historical snapshots according to retention policy.

set -euo pipefail

LABEL="${1:-manual}"
TARGET_DIR="${TARGET_DIR:-/opt/modelscript}"
BACKUP_DIR="${TARGET_DIR}/backups"
RETENTION_COUNT="${RETENTION_COUNT:-14}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
SAFE_LABEL="$(printf '%s' "${LABEL}" | tr -cd 'a-zA-Z0-9_-' | cut -c 1-24)"
FILENAME="snapshot-${SAFE_LABEL}-${TIMESTAMP}.db"
HOST_BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"

echo "==> Creating production database snapshot (${FILENAME})..."

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"

# Method 1: If API container is running, perform hot atomic VACUUM INTO
if ${COMPOSE_CMD} ps --status running --services 2>/dev/null | grep -q "^api$"; then
  echo "    API container is running. Executing online SQLite checkpoint and VACUUM INTO..."
  ${COMPOSE_CMD} exec -T api node -e '
    const fs = require("node:fs");
    const Database = require("better-sqlite3");
    const backupDir = "/app/apps/api/data/backups";
    fs.mkdirSync(backupDir, { recursive: true });
    const targetPath = backupDir + "/" + process.argv[1];
    const db = new Database("/app/apps/api/data/modelscript.db");
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.prepare("VACUUM INTO ?").run(targetPath);
    } finally {
      db.close();
    }
  ' "${FILENAME}"

  # Copy snapshot from container volume to persistent host directory
  ${COMPOSE_CMD} cp "api:/app/apps/api/data/backups/${FILENAME}" "${HOST_BACKUP_PATH}"
else
  # Method 2: Cold backup via Docker volume mount
  echo "    API container is not running. Locating api-data volume mount..."
  VOLUME_NAME="$(${COMPOSE_CMD} config --volumes 2>/dev/null | grep 'api-data' || echo 'modelscript_api-data')"
  VOLUME_PATH="$(docker volume inspect "${VOLUME_NAME}" --format '{{.Mountpoint}}' 2>/dev/null || docker volume inspect api-data --format '{{.Mountpoint}}' 2>/dev/null || true)"

  if [ -n "${VOLUME_PATH}" ] && [ -f "${VOLUME_PATH}/modelscript.db" ]; then
    echo "    Creating copy from volume mountpoint: ${VOLUME_PATH}..."
    cp -p "${VOLUME_PATH}/modelscript.db" "${HOST_BACKUP_PATH}"
    if [ -f "${VOLUME_PATH}/modelscript.db-wal" ]; then
      cp -p "${VOLUME_PATH}/modelscript.db-wal" "${HOST_BACKUP_PATH}-wal"
    fi
  else
    echo "    Warning: No active database found to back up (fresh deployment)."
    exit 0
  fi
fi

# Verify snapshot file exists and is non-empty
if [ ! -s "${HOST_BACKUP_PATH}" ]; then
  echo "ERROR: Snapshot creation failed or output file is empty: ${HOST_BACKUP_PATH}"
  exit 1
fi

# Generate SHA-256 checksum sidecar
sha256sum "${HOST_BACKUP_PATH}" | awk '{print $1}' > "${HOST_BACKUP_PATH}.sha256"

FILE_SIZE="$(du -h "${HOST_BACKUP_PATH}" | cut -f1)"
echo "✓ Snapshot created successfully: ${HOST_BACKUP_PATH} (${FILE_SIZE})"

# Prune historical snapshots beyond RETENTION_COUNT
EXISTING_COUNT="$(ls -1t "${BACKUP_DIR}"/snapshot-*.db 2>/dev/null | wc -l || echo 0)"
if [ "${EXISTING_COUNT}" -gt "${RETENTION_COUNT}" ]; then
  echo "==> Pruning historical snapshots (keeping ${RETENTION_COUNT} most recent)..."
  ls -1t "${BACKUP_DIR}"/snapshot-*.db | tail -n +$((RETENTION_COUNT + 1)) | while read -r OLD_FILE; do
    echo "    Removing obsolete backup: $(basename "${OLD_FILE}")"
    rm -f "${OLD_FILE}" "${OLD_FILE}.sha256" "${OLD_FILE}-wal" "${OLD_FILE}-shm"
  done
fi

echo "BACKUP_FILE=${FILENAME}"
