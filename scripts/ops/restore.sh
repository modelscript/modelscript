#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ModelScript Production Disaster Recovery & Restore Utility
#
# Provides an automated, fail-safe mechanism to restore the production
# database from any historical snapshot with automated pre-restore safety copies
# and health verification.

set -euo pipefail

TARGET_DIR="${TARGET_DIR:-/opt/modelscript}"
BACKUP_DIR="${TARGET_DIR}/backups"
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"

ACTION="${1:-list}"

cd "${TARGET_DIR}"

if [ "${ACTION}" = "list" ] || [ "${ACTION}" = "--list" ] || [ "${ACTION}" = "-l" ]; then
  echo "================================================================================"
  echo " ModelScript Production Database Snapshots (${BACKUP_DIR})"
  echo "================================================================================"
  if [ ! -d "${BACKUP_DIR}" ] || [ -z "$(ls -A "${BACKUP_DIR}"/snapshot-*.db 2>/dev/null)" ]; then
    echo "  (No snapshots found)"
    exit 0
  fi

  printf "%-40s  %-10s  %-25s  %s\n" "FILE" "SIZE" "DATE" "CHECKSUM"
  echo "--------------------------------------------------------------------------------"
  ls -1t "${BACKUP_DIR}"/snapshot-*.db | while read -r F; do
    FNAME="$(basename "${F}")"
    FSIZE="$(du -h "${F}" | cut -f1)"
    FDATE="$(date -u -r "${F}" '+%Y-%m-%d %H:%M:%S UTC')"
    FSHA=""
    if [ -f "${F}.sha256" ]; then
      FSHA="$(cut -c1-12 "${F}.sha256")..."
    fi
    printf "%-40s  %-10s  %-25s  %s\n" "${FNAME}" "${FSIZE}" "${FDATE}" "${FSHA}"
  done
  echo "================================================================================"
  echo "To restore a snapshot: $0 <filename> (or '$0 latest')"
  exit 0
fi

TARGET_FILE=""
if [ "${ACTION}" = "latest" ]; then
  TARGET_FILE="$(ls -1t "${BACKUP_DIR}"/snapshot-*.db 2>/dev/null | head -n1 || true)"
  if [ -z "${TARGET_FILE}" ]; then
    echo "ERROR: No snapshots found in ${BACKUP_DIR}"
    exit 1
  fi
  echo "==> Selected latest snapshot: $(basename "${TARGET_FILE}")"
else
  if [ -f "${BACKUP_DIR}/${ACTION}" ]; then
    TARGET_FILE="${BACKUP_DIR}/${ACTION}"
  elif [ -f "${ACTION}" ]; then
    TARGET_FILE="${ACTION}"
  else
    echo "ERROR: Snapshot file not found: ${ACTION}"
    echo "Run '$0 list' to inspect available snapshots."
    exit 1
  fi
fi

echo "==> Initiating database restore from $(basename "${TARGET_FILE}")..."

# Step 1: Pre-restore safety snapshot of the currently live data
echo "    [1/5] Creating pre-restore emergency safety backup of live state..."
if [ -f "${TARGET_DIR}/scripts/backup.sh" ]; then
  "${TARGET_DIR}/scripts/backup.sh" "pre-restore" || echo "    (Warning: live backup could not be captured, proceeding with volume swap)"
fi

# Step 2: Stop API service gracefully to ensure no concurrent writes
echo "    [2/5] Pausing API service for atomic database replacement..."
${COMPOSE_CMD} stop api || true

# Step 3: Locate active volume mount
echo "    [3/5] Locating api-data volume mount..."
VOLUME_NAME="$(${COMPOSE_CMD} config --volumes 2>/dev/null | grep 'api-data' || echo 'modelscript_api-data')"
VOLUME_PATH="$(docker volume inspect "${VOLUME_NAME}" --format '{{.Mountpoint}}' 2>/dev/null || docker volume inspect api-data --format '{{.Mountpoint}}' 2>/dev/null || true)"

if [ -z "${VOLUME_PATH}" ] || [ ! -d "${VOLUME_PATH}" ]; then
  echo "ERROR: Could not locate api-data volume mountpoint on host."
  exit 1
fi

# Step 4: Atomically restore database file and clear stale WAL/SHM locks
echo "    [4/5] Restoring database to ${VOLUME_PATH}/modelscript.db..."
cp -p "${TARGET_FILE}" "${VOLUME_PATH}/modelscript.db"
# Remove stale write-ahead log & shared memory files so SQLite re-opens cleanly
rm -f "${VOLUME_PATH}/modelscript.db-wal" "${VOLUME_PATH}/modelscript.db-shm"
chmod 644 "${VOLUME_PATH}/modelscript.db"
chown 1000:1000 "${VOLUME_PATH}/modelscript.db" 2>/dev/null || true

# Step 5: Restart API service and verify health
echo "    [5/5] Restarting API service and checking health..."
${COMPOSE_CMD} up -d --wait api

HEALTHY=false
for i in $(seq 1 15); do
  if curl --fail --silent --show-error http://127.0.0.1:3000/health >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if [ "${HEALTHY}" = "true" ]; then
  echo "================================================================================"
  echo "✓ SUCCESS: Production database restored and verified healthy!"
  echo "  Active snapshot: $(basename "${TARGET_FILE}")"
  echo "================================================================================"
else
  echo "🚨 CRITICAL: API service failed to pass healthcheck after database restore!"
  echo "Dumping container logs:"
  ${COMPOSE_CMD} logs --tail=50 api
  exit 1
fi
