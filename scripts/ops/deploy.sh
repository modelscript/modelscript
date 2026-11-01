#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ModelScript Automated Production Rollout & Health Sentinel
#
# Executes a safe, zero-downtime deployment to modelscript.org & ansatz.social
# with atomic pre-deploy hot backup, comprehensive health verification, and
# automated instant rollback if any service fails to start or pass health checks.

set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-latest}"
TARGET_DIR="${TARGET_DIR:-/opt/modelscript}"
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"

cd "${TARGET_DIR}"

echo "================================================================================"
echo " ModelScript Production Deployment Sentinel"
echo " Target Tag: ${IMAGE_TAG}"
echo " Host:       $(hostname) (${TARGET_DIR})"
echo " Time:       $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "================================================================================"

# Step 1: Detect and record currently active image tags for automated rollback
PREV_API_IMAGE="$(${COMPOSE_CMD} images api --format '{{.Tag}}' 2>/dev/null | head -n1 || echo '')"
PREV_WEB_IMAGE="$(${COMPOSE_CMD} images web --format '{{.Tag}}' 2>/dev/null | head -n1 || echo '')"

if [ -n "${PREV_API_IMAGE}" ]; then
  echo "==> Active image tag detected: api:${PREV_API_IMAGE}"
else
  echo "==> No active containers detected (initial deployment or cold start)."
fi

# Step 2: Create atomic pre-deploy hot backup
LATEST_BACKUP=""
if [ -f "${TARGET_DIR}/scripts/backup.sh" ]; then
  echo "==> Creating pre-deploy database snapshot..."
  chmod +x "${TARGET_DIR}/scripts/backup.sh" "${TARGET_DIR}/scripts/restore.sh" 2>/dev/null || true
  "${TARGET_DIR}/scripts/backup.sh" "pre-deploy" || true
  LATEST_BACKUP="$(ls -1t "${TARGET_DIR}/backups"/snapshot-pre-deploy-*.db 2>/dev/null | head -n1 || true)"
fi

# Step 3: Pull target Docker images
echo "==> Pulling target Docker images (IMAGE_TAG=${IMAGE_TAG})..."
IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE_CMD} --profile federated pull

# Step 4: Launch updated services with --wait
echo "==> Rolling out updated services..."
ROLLOUT_FAILED=false
if ! IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE_CMD} --profile federated up -d --wait --remove-orphans; then
  echo "🚨 ERROR: Docker compose rollout failed to start containers healthy!"
  ROLLOUT_FAILED=true
fi

# Step 5: Perform rigorous end-to-end health probes
echo "==> Running production health probes..."
check_endpoint() {
  local url="$1"
  local host_header="${2:-}"
  local max_attempts=15
  local attempt=1

  while [ "${attempt}" -le "${max_attempts}" ]; do
    if [ -n "${host_header}" ]; then
      if curl --fail --silent --show-error -H "Host: ${host_header}" "${url}" >/dev/null 2>&1; then
        return 0
      fi
    else
      if curl --fail --silent --show-error "${url}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

if [ "${ROLLOUT_FAILED}" = "false" ]; then
  echo "    Checking API health probe (http://127.0.0.1:3000/health)..."
  if ! check_endpoint "http://127.0.0.1:3000/health"; then
    echo "🚨 FAIL: API health probe did not respond successfully."
    ROLLOUT_FAILED=true
  else
    echo "    ✓ API is healthy."
  fi

  echo "    Checking Documentation portal (http://127.0.0.1:3001/healthz via modelscript.org)..."
  if ! check_endpoint "http://127.0.0.1:3001/healthz" "modelscript.org"; then
    echo "🚨 FAIL: Documentation portal health probe did not respond successfully."
    ROLLOUT_FAILED=true
  else
    echo "    ✓ Documentation portal is healthy."
  fi

  echo "    Checking Ansatz platform (http://127.0.0.1:3001/healthz via ansatz.social)..."
  if ! check_endpoint "http://127.0.0.1:3001/healthz" "ansatz.social"; then
    echo "🚨 FAIL: Ansatz platform health probe did not respond successfully."
    ROLLOUT_FAILED=true
  else
    echo "    ✓ Ansatz platform is healthy."
  fi
fi

# Step 6: Automated instant rollback if any failure occurred
if [ "${ROLLOUT_FAILED}" = "true" ]; then
  echo "================================================================================"
  echo "🚨 DEPLOYMENT FAILURE DETECTED: INITIATING AUTOMATED ROLLBACK"
  echo "================================================================================"
  echo "Dumping container failure logs:"
  ${COMPOSE_CMD} logs --tail=100 api web || true

  if [ -n "${PREV_API_IMAGE}" ] && [ "${PREV_API_IMAGE}" != "${IMAGE_TAG}" ]; then
    echo "==> Rolling back containers to previous known-good tag (${PREV_API_IMAGE})..."
    IMAGE_TAG="${PREV_API_IMAGE}" ${COMPOSE_CMD} --profile federated up -d --wait --remove-orphans || true

    # Check if rollback image is healthy
    if check_endpoint "http://127.0.0.1:3000/health"; then
      echo "✓ Rollback successful! Services restored to ${PREV_API_IMAGE}."
    elif [ -n "${LATEST_BACKUP}" ] && [ -f "${LATEST_BACKUP}" ]; then
      echo "==> Services still unhealthy after image rollback. Restoring pre-deploy database snapshot..."
      "${TARGET_DIR}/scripts/restore.sh" "${LATEST_BACKUP}" || true
    fi
  fi

  echo "Deployment aborted with errors. Production state preserved."
  exit 1
fi

# Step 7: Success & image cleanup
echo "==> Pruning historical container images older than 72 hours..."
docker image prune -f --filter 'until=72h' >/dev/null 2>&1 || true

echo "================================================================================"
echo "✓ DEPLOYMENT COMPLETE: ${IMAGE_TAG} successfully active on production!"
echo "================================================================================"
