#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build COIN-OR (IPOPT + CLP + CBC) to WebAssembly via Emscripten.
#
# Prerequisites:
#   - Emscripten SDK (emsdk) installed and activated
#   - cmake, make available on PATH
#
# This script:
#   1. Downloads and builds CoinUtils, CLP, CBC, and IPOPT using coinbrew
#   2. Compiles coinor-interface.c against these libraries
#   3. Emits coinor.wasm + coinor.js in wasm/ directory
#
# Usage:
#   bash scripts/build-coinor.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PACKAGE_DIR/src/compiler/modelica"
BUILD_DIR="$PACKAGE_DIR/.build/coinor"
WASM_DIR="$PACKAGE_DIR/wasm"

# Verify Emscripten is available
if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc not found. Please install and activate the Emscripten SDK."
  echo "  https://emscripten.org/docs/getting_started/downloads.html"
  exit 1
fi

echo "=== Building COIN-OR for WebAssembly ==="

mkdir -p "$BUILD_DIR"

# ── Step 1: Build COIN-OR with coinbrew ──
COINBREW="$BUILD_DIR/coinbrew"
COIN_INSTALL="$BUILD_DIR/install"

if [ ! -f "$COINBREW" ]; then
  echo "Downloading coinbrew..."
  curl -L -o "$COINBREW" "https://raw.githubusercontent.com/coin-or/coinbrew/master/coinbrew"
  chmod +x "$COINBREW"
fi

if [ ! -d "$COIN_INSTALL/include/coin-or" ]; then
  echo "Building CoinUtils + CLP + CBC + IPOPT..."

  cd "$BUILD_DIR"

  export CC=emcc
  export CXX=em++
  export AR=emar
  export RANLIB=emranlib
  export F77="fort77"
  export FC="fort77"
  export FFLAGS="-O2 -fPIC"
  export FCFLAGS="-O2 -fPIC"
  export LDFLAGS="-L$EMSDK/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten"

  # 1. Shallow clone repositories explicitly to avoid slow complete fetches
  # and network drops from coinbrew, while remaining in batch mode.
  echo "Shallow cloning COIN-OR packages (latest master)..."
  fetch_shallow() {
    local proj=$1
    if [ ! -d "$BUILD_DIR/$proj" ]; then
      echo "--> Cloning $proj..."
      git clone --depth 1 "https://github.com/coin-or/$proj.git" "$BUILD_DIR/$proj"
    else
      echo "--> $proj already cloned."
    fi
  }

  fetch_shallow Clp
  fetch_shallow Cbc
  fetch_shallow Ipopt
  fetch_shallow Bonmin
  fetch_shallow Couenne

  # 2. Build solvers sequentially.
  # We do NOT use --reconfigure here, because it cascades and forces
  # coinbrew to redundantly rebuild all shared dependencies!
  # Pass the -L path to ALL builds uniformly so that Mumps (a transitive
  # dependency via Ipopt) can find libf2c.a in the Emscripten sysroot.
  COIN_LDFLAGS="-static -L$EMSDK/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten"

  for pkg in Clp Cbc Ipopt Bonmin Couenne; do
    echo "--- Building $pkg ---"

    # Ipopt and MINLP solvers need built-in LAPACK (no system LAPACK for WASM)
    EXTRA_FLAGS=""
    if [ "$pkg" = "Ipopt" ] || [ "$pkg" = "Bonmin" ] || [ "$pkg" = "Couenne" ]; then
      EXTRA_FLAGS="--with-lapack=BUILD"
    fi

    "$COINBREW" build "$pkg" \
      --prefix="$COIN_INSTALL" \
      --disable-shared \
      --host=wasm32-unknown-emscripten \
      --enable-static \
      --tests=none \
      --reconfigure \
      LDFLAGS="$COIN_LDFLAGS" \
      LT_LDFLAGS="-all-static" \
      --no-prompt \
      --verbosity=2 \
      $EXTRA_FLAGS
  done

  cd "$PACKAGE_DIR"
fi

# ── Step 2: Compile WASM entry point ──
echo "Compiling COIN-OR WASM module..."
mkdir -p "$WASM_DIR"

cat > "$BUILD_DIR/coinor_wasm_entry.cpp" << 'ENTRY_EOF'
/*
 * COIN-OR WASM entry points.
 * Provides simplified C/C++ functions callable from JavaScript via Emscripten ccall().
 */
#include <stdlib.h>
#include <string.h>

#define HAVE_IPOPT
#define HAVE_CLP
#define HAVE_CBC
#define HAVE_BONMIN
#define HAVE_COUENNE

#include "coinor-interface.c"
#include "coinor-minlp-interface.cpp"

extern "C" {

/* IPOPT callback types from addFunction() */
typedef int (*wasm_eval_f)(int n, double* x, int new_x, double* obj, void* ud);
typedef int (*wasm_eval_grad_f)(int n, double* x, int new_x, double* grad, void* ud);
typedef int (*wasm_eval_g)(int n, double* x, int new_x, int m, double* g, void* ud);
typedef int (*wasm_eval_jac_g)(int n, double* x, int new_x, int m, int nele,
                                int* iRow, int* jCol, double* values, void* ud);

int coinor_ipopt_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_mul, double* result_obj, double* result_status
) {
    CoinorModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.n_vars = n_vars;
    cb.n_constraints = n_constraints;
    cb.nnz_jacobian = nnz_jacobian;
    cb.nnz_hessian = 0;
    cb.var_lb = var_lb;
    cb.var_ub = var_ub;
    cb.con_lb = con_lb;
    cb.con_ub = con_ub;

    cb.eval_objective = (void (*)(void*, const double*, double*))(long)eval_f_ptr;
    cb.eval_gradient = (void (*)(void*, const double*, double*))(long)eval_grad_f_ptr;
    cb.eval_constraints = (void (*)(void*, const double*, double*))(long)eval_g_ptr;
    cb.eval_jacobian = (void (*)(void*, const double*, double*))(long)eval_jac_g_ptr;

    CoinorOptions opts;
    coinor_options_defaults(&opts);
    opts.tolerance = tolerance;
    opts.max_iterations = max_iterations;
    opts.print_level = print_level;
    opts.use_exact_hessian = 0;

    CoinorResult result;
    coinor_ipopt_solve(&cb, x0, &opts, &result);

    if (result.solution) memcpy(result_x, result.solution, n_vars * sizeof(double));
    if (result.multipliers) memcpy(result_mul, result.multipliers, n_constraints * sizeof(double));
    *result_obj = result.objective_value;
    *result_status = (double)result.status;

    coinor_result_free(&result);
    return result.status;
}

int coinor_clp_wasm(
    int n_vars, int n_constraints,
    double* obj_coeffs, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    double* a_values, int* a_row_idx, int* a_col_ptr,
    int nnz, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status, int* result_iter
) {
    CoinorModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.n_vars = n_vars;
    cb.n_constraints = n_constraints;
    cb.nnz_jacobian = nnz;
    cb.obj_coeffs = obj_coeffs;
    cb.var_lb = var_lb;
    cb.var_ub = var_ub;
    cb.con_lb = con_lb;
    cb.con_ub = con_ub;
    cb.A_values = a_values;
    cb.A_row_idx = a_row_idx;
    cb.A_col_ptr = a_col_ptr;

    CoinorOptions opts;
    coinor_options_defaults(&opts);
    opts.tolerance = tolerance;
    opts.max_iterations = max_iterations;
    opts.print_level = print_level;

    CoinorResult result;
    coinor_clp_solve(&cb, &opts, &result);

    if (result.solution) memcpy(result_x, result.solution, n_vars * sizeof(double));
    *result_obj = result.objective_value;
    *result_status = (double)result.status;
    *result_iter = result.iterations;

    coinor_result_free(&result);
    return result.status;
}

int coinor_cbc_wasm(
    int n_vars, int n_constraints,
    double* obj_coeffs, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    double* a_values, int* a_row_idx, int* a_col_ptr,
    int nnz, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status, int* result_iter
) {
    CoinorModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.n_vars = n_vars;
    cb.n_constraints = n_constraints;
    cb.nnz_jacobian = nnz;
    cb.obj_coeffs = obj_coeffs;
    cb.var_lb = var_lb;
    cb.var_ub = var_ub;
    cb.con_lb = con_lb;
    cb.con_ub = con_ub;
    cb.A_values = a_values;
    cb.A_row_idx = a_row_idx;
    cb.A_col_ptr = a_col_ptr;
    cb.is_integer = int_flags_ptr ? (int*)(long)int_flags_ptr : NULL;

    CoinorOptions opts;
    coinor_options_defaults(&opts);
    opts.tolerance = tolerance;
    opts.max_iterations = max_iterations;
    opts.print_level = print_level;

    CoinorResult result;
    coinor_cbc_solve(&cb, &opts, &result);

    if (result.solution) memcpy(result_x, result.solution, n_vars * sizeof(double));
    *result_obj = result.objective_value;
    *result_status = (double)result.status;
    *result_iter = result.iterations;

    coinor_result_free(&result);
    return result.status;
}
} // extern "C"
ENTRY_EOF

em++ -O2 \
  -std=c++14 \
  -I"$COIN_INSTALL/include/coin-or" \
  -I"$SRC_DIR" \
  "$BUILD_DIR/coinor_wasm_entry.cpp" \
  -L"$COIN_INSTALL/lib" \
  -lcouenne \
  -lbonmin \
  -lipopt \
  -lClp \
  -lCbc \
  -lCgl \
  -lOsi \
  -lOsiClp \
  -lCoinUtils \
  -lm \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='["_coinor_ipopt_wasm","_coinor_clp_wasm","_coinor_cbc_wasm","_coinor_bonmin_wasm","_coinor_couenne_wasm","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["addFunction","removeFunction","ccall","cwrap"]' \
  -s ALLOW_TABLE_GROWTH=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s STACK_SIZE=2097152 \
  -o "$WASM_DIR/coinor.js"

echo "=== COIN-OR WASM build complete ==="
echo "  Output: $WASM_DIR/coinor.js + coinor.wasm"
ls -lh "$WASM_DIR"/coinor.*
