#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# scripts/codeql-scan.sh - Run GitHub CodeQL security analysis locally or via Docker
set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.cache"
DEFAULT_DB="${CACHE_DIR}/codeql-db"
DEFAULT_OUTPUT="${CACHE_DIR}/codeql-results.sarif"
DEFAULT_SUITE="javascript-security-extended.qls"
DEFAULT_LANG="javascript-typescript"

USE_DOCKER=false
AUTO_INSTALL=false
DB_PATH="$DEFAULT_DB"
OUTPUT_FILE="$DEFAULT_OUTPUT"
SUITE="$DEFAULT_SUITE"
LANGUAGE="$DEFAULT_LANG"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)
      USE_DOCKER=true
      shift
      ;;
    --install)
      AUTO_INSTALL=true
      shift
      ;;
    --db)
      DB_PATH="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --suite)
      SUITE="$2"
      shift 2
      ;;
    --language)
      LANGUAGE="$2"
      shift 2
      ;;
    --help|-h)
      echo -e "${BOLD}Usage:${NC} $0 [options]"
      echo ""
      echo "Options:"
      echo "  --docker          Run CodeQL inside Docker container (no host installation required)"
      echo "  --install         Automatically download & extract the official CodeQL CLI bundle to .cache/codeql"
      echo "  --db <path>       CodeQL database output path (default: .cache/codeql-db)"
      echo "  --output <file>   SARIF output file (default: .cache/codeql-results.sarif)"
      echo "  --suite <suite>   CodeQL query suite (default: javascript-security-extended.qls)"
      echo "  --language <lang> Target language (default: javascript-typescript)"
      echo "  --help, -h        Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$CACHE_DIR"

CONFIG_FLAG=()
CONFIG_DOCKER_ARG=""
if [ -f "${REPO_ROOT}/.github/codeql/codeql-config.yml" ]; then
  CONFIG_FLAG=("--codescanning-config=${REPO_ROOT}/.github/codeql/codeql-config.yml")
  CONFIG_DOCKER_ARG="--codescanning-config=/workspace/.github/codeql/codeql-config.yml"
fi

if [ "$USE_DOCKER" = true ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not installed or not in PATH.${NC}" >&2
    exit 1
  fi

  echo -e "${BLUE}==>${NC} ${BOLD}Running CodeQL analysis via Docker container...${NC}"
  echo -e "    Image:    mcr.microsoft.com/cstsectools/codeql-container:latest"
  echo -e "    Language: ${LANGUAGE}"
  echo -e "    Suite:    ${SUITE}"
  echo -e "    Output:   ${OUTPUT_FILE}"

  docker run --rm \
    -v "${REPO_ROOT}:/workspace" \
    -w /workspace \
    mcr.microsoft.com/cstsectools/codeql-container:latest \
    bash -c "rm -rf /tmp/codeql-db && \
             codeql database create /tmp/codeql-db --language='${LANGUAGE}' ${CONFIG_DOCKER_ARG} --source-root=/workspace && \
             codeql database analyze /tmp/codeql-db '${SUITE}' --format=sarif-latest --output='/workspace/.cache/codeql-results.sarif'"

  echo -e "${BLUE}==>${NC} ${BOLD}Results summary:${NC}"
  node "${REPO_ROOT}/scripts/summarize-sarif.cjs" "${OUTPUT_FILE}"
  exit $?
fi

# Local CLI discovery
find_codeql() {
  if command -v codeql >/dev/null 2>&1; then
    command -v codeql
    return 0
  fi
  for candidate in \
    "${CACHE_DIR}/codeql/codeql" \
    "${HOME}/.local/codeql/codeql" \
    "${HOME}/codeql/codeql" \
    "/usr/local/bin/codeql"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

CODEQL_BIN="$(find_codeql || true)"

if [ -z "$CODEQL_BIN" ] && [ "$AUTO_INSTALL" = true ]; then
  echo -e "${BLUE}==>${NC} ${BOLD}Downloading official CodeQL CLI bundle...${NC}"
  BUNDLE_URL="https://github.com/github/codeql-action/releases/latest/download/codeql-bundle-linux64.tar.gz"
  ARCHIVE_PATH="${CACHE_DIR}/codeql-bundle-linux64.tar.gz"
  
  curl -L -f --progress-bar "$BUNDLE_URL" -o "$ARCHIVE_PATH"
  echo -e "${BLUE}==>${NC} ${BOLD}Extracting to ${CACHE_DIR}/codeql...${NC}"
  mkdir -p "${CACHE_DIR}/codeql"
  tar -xzf "$ARCHIVE_PATH" -C "${CACHE_DIR}"
  rm -f "$ARCHIVE_PATH"
  echo '{"type": "commonjs"}' > "${CACHE_DIR}/codeql/package.json"
  CODEQL_BIN="$(find_codeql || true)"
fi

if [ -d "${CACHE_DIR}/codeql" ] && [ ! -f "${CACHE_DIR}/codeql/package.json" ]; then
  echo '{"type": "commonjs"}' > "${CACHE_DIR}/codeql/package.json"
fi

if [ -z "$CODEQL_BIN" ]; then
  echo -e "${YELLOW}CodeQL CLI not found in PATH or standard locations.${NC}"
  echo ""
  echo -e "You can run CodeQL checks locally using any of the following methods:"
  echo ""
  echo -e "  1. ${BOLD}Docker Container (Method 2 - zero installation):${NC}"
  echo -e "     ${GREEN}npm run codeql:docker${NC}"
  echo ""
  echo -e "  2. ${BOLD}Auto-install CodeQL bundle locally to .cache/codeql:${NC}"
  echo -e "     ${GREEN}npm run codeql:install${NC}"
  echo ""
  echo -e "  3. ${BOLD}Manual installation (Method 1):${NC}"
  echo -e "     curl -L https://github.com/github/codeql-action/releases/latest/download/codeql-bundle-linux64.tar.gz | tar -xz -C ~/.local/"
  echo -e "     export PATH=\"\$HOME/.local/codeql:\$PATH\""
  echo -e "     ${GREEN}npm run codeql${NC}"
  exit 1
fi

echo -e "${BLUE}==>${NC} ${BOLD}Using CodeQL CLI:${NC} ${CODEQL_BIN}"
"$CODEQL_BIN" --version

echo -e "${BLUE}==>${NC} ${BOLD}Creating CodeQL database at ${DB_PATH}...${NC}"
rm -rf "$DB_PATH"
"$CODEQL_BIN" database create "$DB_PATH" --language="$LANGUAGE" "${CONFIG_FLAG[@]}" --source-root="$REPO_ROOT"

echo -e "${BLUE}==>${NC} ${BOLD}Analyzing with query suite '${SUITE}'...${NC}"
"$CODEQL_BIN" database analyze "$DB_PATH" "$SUITE" --format=sarif-latest --output="$OUTPUT_FILE"

echo -e "${BLUE}==>${NC} ${BOLD}Results summary:${NC}"
node "${REPO_ROOT}/scripts/summarize-sarif.cjs" "${OUTPUT_FILE}"

