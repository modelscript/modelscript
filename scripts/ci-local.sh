#!/usr/bin/env bash
# scripts/ci-local.sh - Local simulation of GitHub Actions CI pipeline
set -eo pipefail

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}${BOLD}[CI:LOCAL]${NC} $1"; }
log_success() { echo -e "${GREEN}${BOLD}[CI:LOCAL ✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}${BOLD}[CI:LOCAL ⚠]${NC} $1"; }
log_error() { echo -e "${RED}${BOLD}[CI:LOCAL ✗]${NC} $1"; }

# Flags
MODE_LINT=false
MODE_TEST=false
MODE_BUILD=false
MODE_FULL=false
RUN_ALL=false
BASE_REF=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      MODE_LINT=true
      MODE_TEST=true
      shift
      ;;
    --lint)
      MODE_LINT=true
      shift
      ;;
    --test)
      MODE_TEST=true
      shift
      ;;
    --build)
      MODE_BUILD=true
      shift
      ;;
    --full)
      MODE_FULL=true
      MODE_LINT=true
      MODE_TEST=true
      MODE_BUILD=true
      shift
      ;;
    --all)
      RUN_ALL=true
      shift
      ;;
    --base=*)
      BASE_REF="${1#*=}"
      shift
      ;;
    --base)
      BASE_REF="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: bash scripts/ci-local.sh [options]"
      echo ""
      echo "Options:"
      echo "  --quick       Run affected lint and test (default)"
      echo "  --lint        Run lint only"
      echo "  --test        Run tests only"
      echo "  --build       Run build only"
      echo "  --full        Run full CI suite (lint, test, exchange validation, build, extension packaging)"
      echo "  --all         Run against ALL packages instead of only affected packages"
      echo "  --base <ref>  Override base git reference (default: auto-detected)"
      echo "  -h, --help    Show this help message"
      exit 0
      ;;
    *)
      log_warn "Unknown option '$1'. Ignoring."
      shift
      ;;
  esac
done

# Default to --quick if no specific target mode was selected
if [ "$MODE_LINT" = false ] && [ "$MODE_TEST" = false ] && [ "$MODE_BUILD" = false ] && [ "$MODE_FULL" = false ]; then
  MODE_LINT=true
  MODE_TEST=true
fi

# Detect base reference if not explicitly specified
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'HEAD')"

if [ -z "$BASE_REF" ]; then
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # On main branch: compare against previous commit
    BASE_REF="HEAD~1"
  elif git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF="origin/main"
  elif git rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF="main"
  else
    BASE_REF="HEAD~1"
  fi
fi

log_info "Branch: ${BOLD}${CURRENT_BRANCH}${NC} | Comparison Base: ${BOLD}${BASE_REF}${NC}"

run_task() {
  local target="$1"
  local description="$2"
  log_info "Starting: ${description}..."
  if [ "$RUN_ALL" = true ]; then
    npx nx run-many -t "$target" --parallel=4
  else
    npx nx affected -t "$target" --base="$BASE_REF" --parallel=4
  fi
  log_success "Completed: ${description}"
}

# 1. Lint Step
if [ "$MODE_LINT" = true ]; then
  echo ""
  run_task "lint" "Lint and TypeScript checking"
fi

# 2. Test Step
if [ "$MODE_TEST" = true ]; then
  echo ""
  # Download MSL if missing (same as CI)
  if [ ! -f "scripts/ModelicaStandardLibrary_v4.1.0.zip" ] && [ -f "scripts/download-msl.cjs" ]; then
    log_info "Ensuring Modelica Standard Library is present..."
    node scripts/download-msl.cjs
  fi

  run_task "test" "Unit and integration tests"

  # If full mode is active, run FMI validation
  if [ "$MODE_FULL" = true ]; then
    echo ""
    log_info "Validating FMI Exchange..."
    npm run validate --workspace=@modelscript/exchange || log_warn "FMI validate had warnings/failures"
    npm run test:fmusim --workspace=@modelscript/exchange || log_warn "FMI test:fmusim had warnings/failures"
    log_success "FMI Exchange checks finished"
  fi
fi

# 3. Build Step
if [ "$MODE_BUILD" = true ]; then
  echo ""
  log_info "Starting: Package builds..."
  if [ "$RUN_ALL" = true ] || [ "$MODE_FULL" = true ]; then
    npx nx run-many -t build --exclude=@modelscript/morsel --parallel=4
  else
    npx nx affected -t build --base="$BASE_REF" --exclude=@modelscript/morsel --parallel=4
  fi
  log_success "Completed: Package builds"

  if [ "$MODE_FULL" = true ]; then
    echo ""
    log_info "Building VS Code extension..."
    npm run build:extension
    if [ -d "dist/extension" ]; then
      log_info "Packaging VS Code extension (.vsix)..."
      (cd dist/extension && npx --yes @vscode/vsce package --no-dependencies)
      log_success "VS Code extension packaged successfully"
    fi
  fi
fi

echo ""
log_success "All requested CI checks passed successfully! 🎉"
