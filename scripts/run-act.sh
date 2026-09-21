#!/usr/bin/env bash
# scripts/run-act.sh - Run GitHub Actions locally using act
set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Default to pull_request if no args given
ARGS=("$@")
if [ ${#ARGS[@]} -eq 0 ]; then
  ARGS=("pull_request")
fi

# 1. Check if 'act' is directly installed on PATH
if command -v act >/dev/null 2>&1; then
  echo -e "${BLUE}${BOLD}[ACT]${NC} Running host binary 'act'..."
  exec act "${ARGS[@]}"
fi

# 2. Check if GitHub CLI has 'act' extension installed
if command -v gh >/dev/null 2>&1 && gh extension list 2>/dev/null | grep -q "nektos/gh-act"; then
  echo -e "${BLUE}${BOLD}[ACT]${NC} Running via 'gh act' extension..."
  exec gh act "${ARGS[@]}"
fi

# 3. Fallback: Run act inside Docker
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
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
    nektos/act:latest "${ARGS[@]}"; then
    exit 0
  fi
fi

# 4. Error: Neither act nor Docker container succeeded
echo -e "\n${RED}${BOLD}[ERROR]${NC} Could not execute 'act'."
echo -e "Please install 'act' using one of the following methods:"
echo -e "  1) ${BOLD}gh extension install nektos/gh-act${NC} (Recommended)"
echo -e "  2) ${BOLD}curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash -s -- -b /usr/local/bin${NC}"
echo -e "  3) Use the native local runner instead: ${BOLD}npm run ci:local${NC}"
exit 1
