#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# ==============================================================================
# ModelScript Consumer Upgrade & Automatic Rollback Script
# Works with both Federated Nodes (docker-compose.federated.yml) and
# Hardened Enterprise Appliances (ee/deploy/docker-compose.yml).
#
# Usage:
#   ./scripts/ops/upgrade-consumer.sh <target-tag> [compose-file] [service-name]
#
# Examples:
#   ./scripts/ops/upgrade-consumer.sh 0.2.0
#   ./scripts/ops/upgrade-consumer.sh 0.2.0 docker-compose.federated.yml api
#   ./scripts/ops/upgrade-consumer.sh 0.2.0 ee/deploy/docker-compose.yml modelscript-appliance
# ==============================================================================
set -euo pipefail

TARGET_TAG="${1:?Usage: $0 <target-tag> [compose-file] [service-name]}"
COMPOSE_FILE="${2:-docker-compose.federated.yml}"
PRIMARY_SERVICE="${3:-}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "ERROR: Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

if [ -z "${PRIMARY_SERVICE}" ]; then
  if grep -q "modelscript-appliance:" "${COMPOSE_FILE}"; then
    PRIMARY_SERVICE="modelscript-appliance"
  else
    PRIMARY_SERVICE="api"
  fi
fi

COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"
BACKUP_DIR="./backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/modelscript-${TIMESTAMP}.db"

echo "================================================================================"
echo " ModelScript Consumer Upgrade"
echo "   Compose File : ${COMPOSE_FILE}"
echo "   Service      : ${PRIMARY_SERVICE}"
echo "   Target Tag   : ${TARGET_TAG}"
echo "================================================================================"

# 1. Capture currently running image tag for rollback
PREV_IMAGE="$(${COMPOSE_CMD} ps --format '{{.Image}}' "${PRIMARY_SERVICE}" 2>/dev/null | head -n 1 || true)"
PREV_TAG="${PREV_IMAGE##*:}"
echo "==> Previous image: ${PREV_IMAGE:-none (fresh install)}"

# 2. Atomic SQLite pre-upgrade backup (if container is running)
mkdir -p "${BACKUP_DIR}"
if ${COMPOSE_CMD} ps --status running --services 2>/dev/null | grep -q "^${PRIMARY_SERVICE}$"; then
  echo "==> Creating atomic SQLite backup: ${BACKUP_FILE}"
  ${COMPOSE_CMD} exec -T "${PRIMARY_SERVICE}" node -e '
    const fs = require("node:fs");
    const Database = require("better-sqlite3");
    fs.mkdirSync("/app/apps/api/data/backups", { recursive: true });
    const db = new Database("/app/apps/api/data/modelscript.db");
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.prepare("VACUUM INTO ?").run("/app/apps/api/data/backups/" + process.argv[1]);
    } finally {
      db.close();
    }
  ' "upgrade-${TIMESTAMP}.db"
  ${COMPOSE_CMD} cp "${PRIMARY_SERVICE}:/app/apps/api/data/backups/upgrade-${TIMESTAMP}.db" "${BACKUP_FILE}"
  ${COMPOSE_CMD} exec -T "${PRIMARY_SERVICE}" rm -f "/app/apps/api/data/backups/upgrade-${TIMESTAMP}.db" >/dev/null 2>&1 || true
  echo "✓ Backup saved to ${BACKUP_FILE}"
fi

# 3. Pull pinned target version
echo "==> Pulling IMAGE_TAG=${TARGET_TAG}..."
IMAGE_TAG="${TARGET_TAG}" ${COMPOSE_CMD} pull

# 4. Roll out and wait for healthchecks
echo "==> Rolling out IMAGE_TAG=${TARGET_TAG}..."
if IMAGE_TAG="${TARGET_TAG}" ${COMPOSE_CMD} up -d --wait --remove-orphans; then
  echo "================================================================================"
  echo "✓ Upgrade to ${TARGET_TAG} succeeded!"
  echo "================================================================================"
  exit 0
fi

# 5. Automatic rollback on failure using cached local image
echo "🚨 Upgrade to ${TARGET_TAG} failed healthcheck! Initiating automatic rollback..."
${COMPOSE_CMD} logs --tail=80 "${PRIMARY_SERVICE}" || true

if [ -n "${PREV_TAG}" ] && [ "${PREV_TAG}" != "${TARGET_TAG}" ]; then
  echo "==> Rolling back to cached IMAGE_TAG=${PREV_TAG}..."
  IMAGE_TAG="${PREV_TAG}" ${COMPOSE_CMD} up -d --pull never --wait --remove-orphans || true
fi

echo "Upgrade aborted. Pre-upgrade backup preserved at: ${BACKUP_FILE}" >&2
exit 1
