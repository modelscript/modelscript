#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# scripts/run-act.sh - Run GitHub Actions locally using act
set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RAW_ARGS=("$@")
ARGS=()

# 1. Check if a known event name is specified.
# If only options (like -j lint or -j test) are provided, default the event to 'pull_request'.
KNOWN_EVENTS=("pull_request" "pull_request_target" "push" "workflow_dispatch" "schedule" "release" "issues" "create" "delete")
HAS_EVENT=false
for arg in "${RAW_ARGS[@]}"; do
  for evt in "${KNOWN_EVENTS[@]}"; do
    if [ "$arg" = "$evt" ]; then
      HAS_EVENT=true
      break 2
    fi
  done
done

if [ "$HAS_EVENT" = false ]; then
  ARGS+=("pull_request")
fi
ARGS+=("${RAW_ARGS[@]}")

# Ensure act artifact cache directory exists for upload-artifact@v4
ACT_ARTIFACTS_DIR="${REPO_ROOT}/.cache/act-artifacts"
mkdir -p "$ACT_ARTIFACTS_DIR"

ACT_DEFAULT_OPTS=()

# 2. Enable local artifact server if not specified so actions/upload-artifact@v4 works
HAS_ARTIFACT_SERVER=false
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == *"--artifact-server-path"* ]]; then
    HAS_ARTIFACT_SERVER=true
    break
  fi
done
if [ "$HAS_ARTIFACT_SERVER" = false ]; then
  ACT_DEFAULT_OPTS+=("--artifact-server-path" "$ACT_ARTIFACTS_DIR")
fi

# 3. Provide a mock pull_request event payload if event file is not explicitly provided
HAS_EVENT_FILE=false
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "-e" ]] || [[ "$arg" == *"--eventpath"* ]]; then
    HAS_EVENT_FILE=true
    break
  fi
done
if [ "$HAS_EVENT_FILE" = false ]; then
  EVENT_FILE="${REPO_ROOT}/.github/act-event.json"
  ACT_DEFAULT_OPTS+=("-e" "$EVENT_FILE")
fi

# 4. Default to .github/workflows/ci.yml if no workflow file is explicitly specified
HAS_WORKFLOW=false
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "-W" ]] || [[ "$arg" == *"--workflows"* ]]; then
    HAS_WORKFLOW=true
    break
  fi
done
if [ "$HAS_WORKFLOW" = false ]; then
  ACT_DEFAULT_OPTS+=("-W" "${REPO_ROOT}/.github/workflows/ci.yml")
fi

FINAL_ARGS=("${ACT_DEFAULT_OPTS[@]}" "${ARGS[@]}")

# Execute via available runner
if command -v act >/dev/null 2>&1; then
  echo -e "${BLUE}${BOLD}[ACT]${NC} Running host binary 'act'..."
  exec act "${FINAL_ARGS[@]}"
elif command -v gh >/dev/null 2>&1 && gh extension list 2>/dev/null | grep -q "nektos/gh-act"; then
  echo -e "${BLUE}${BOLD}[ACT]${NC} Running via 'gh act' extension..."
  exec gh act "${FINAL_ARGS[@]}"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo -e "${YELLOW}${BOLD}[ACT]${NC} 'act' host binary not detected. Attempting to run via Docker..."
  echo -e "${YELLOW}${BOLD}[TIP]${NC} To run natively without Docker: ${BOLD}gh extension install nektos/gh-act${NC}\n"

  DOCKER_FLAGS=("--rm")
  if [ -t 0 ] && [ -t 1 ]; then
    DOCKER_FLAGS+=("-it")
  fi

  if docker run "${DOCKER_FLAGS[@]}" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$PWD:$PWD" \
    -w "$PWD" \
    nektos/act:latest "${FINAL_ARGS[@]}"; then
    exit 0
  fi
fi

echo -e "\n${RED}${BOLD}[ERROR]${NC} Could not execute 'act'."
echo -e "Please install 'act' using one of the following methods:"
echo -e "  1) ${BOLD}gh extension install nektos/gh-act${NC} (Recommended)"
echo -e "  2) ${BOLD}curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash -s -- -b /usr/local/bin${NC}"
echo -e "  3) Use the native local runner instead: ${BOLD}npm run ci:local${NC}"
exit 1
