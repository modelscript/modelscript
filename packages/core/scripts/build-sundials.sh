#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build SUNDIALS to WebAssembly via Emscripten.
#
# Prerequisites:
#   - Emscripten SDK (emsdk) installed and activated
#   - cmake, make available on PATH
#
# This script:
#   1. Downloads SUNDIALS v7.2.0 source tarball
#   2. Compiles cvodes, idas, kinsol as static libraries using emcc
#   3. Compiles sundials-interface.c against these libraries
#   4. Emits sundials.wasm + sundials.js in wasm/ directory
#
# Usage:
#   bash scripts/build-sundials.sh

set -euo pipefail

SUNDIALS_VERSION="7.2.0"
SUNDIALS_URL="https://github.com/LLNL/sundials/releases/download/v${SUNDIALS_VERSION}/sundials-${SUNDIALS_VERSION}.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PACKAGE_DIR/src/compiler/modelica"
BUILD_DIR="$PACKAGE_DIR/.build/sundials"
WASM_DIR="$PACKAGE_DIR/wasm"

# Verify Emscripten is available
if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc not found. Please install and activate the Emscripten SDK."
  echo "  https://emscripten.org/docs/getting_started/downloads.html"
  exit 1
fi

echo "=== Building SUNDIALS ${SUNDIALS_VERSION} for WebAssembly ==="

# ── Step 1: Download source ──
mkdir -p "$BUILD_DIR"
if [ ! -f "$BUILD_DIR/sundials-${SUNDIALS_VERSION}.tar.gz" ]; then
  echo "Downloading SUNDIALS ${SUNDIALS_VERSION}..."
  curl -L -o "$BUILD_DIR/sundials-${SUNDIALS_VERSION}.tar.gz" "$SUNDIALS_URL"
fi

if [ ! -d "$BUILD_DIR/sundials-${SUNDIALS_VERSION}" ]; then
  echo "Extracting..."
  tar -xzf "$BUILD_DIR/sundials-${SUNDIALS_VERSION}.tar.gz" -C "$BUILD_DIR"
fi

SUNDIALS_SRC="$BUILD_DIR/sundials-${SUNDIALS_VERSION}"
SUNDIALS_BUILD="$BUILD_DIR/build"
SUNDIALS_INSTALL="$BUILD_DIR/install"

# ── Step 2: Configure and build with Emscripten ──
echo "Configuring SUNDIALS with Emscripten..."
mkdir -p "$SUNDIALS_BUILD"

emcmake cmake -S "$SUNDIALS_SRC" -B "$SUNDIALS_BUILD" \
  -DCMAKE_INSTALL_PREFIX="$SUNDIALS_INSTALL" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_STATIC_LIBS=ON \
  -DSUNDIALS_BUILD_WITH_MONITORING=OFF \
  -DEXAMPLES_ENABLE=OFF \
  -DBUILD_CVODES=ON \
  -DBUILD_IDAS=ON \
  -DBUILD_KINSOL=ON \
  -DBUILD_ARKODE=OFF \
  -DBUILD_CPODES=OFF \
  -DBUILD_TESTING=OFF \
  -DSUNDIALS_PRECISION=double \
  -DSUNDIALS_INDEX_SIZE=32

echo "Building SUNDIALS..."
emmake make -C "$SUNDIALS_BUILD" -j"$(nproc)" install

# ── Step 3: Compile WASM entry point ──
echo "Compiling SUNDIALS WASM module..."
mkdir -p "$WASM_DIR"

# Build a thin C wrapper that provides the WASM-callable entry points
# These call into sundials-interface.c which uses the SUNDIALS API
cat > "$BUILD_DIR/sundials_wasm_entry.c" << 'ENTRY_EOF'
/*
 * SUNDIALS WASM entry points.
 * Provides simplified C functions callable from JavaScript via Emscripten ccall().
 * These bridge the sundials-interface.c wrappers to the WASM boundary.
 */
#include <stdlib.h>
#include <string.h>

/* Include the full SUNDIALS interface implementation */
#include "sundials-interface.c"

/* Type for the WASM RHS callback */
typedef int (*wasm_rhs_fn)(double t, double* y, double* ydot, void* user_data);
typedef int (*wasm_event_fn)(double t, double* y, double* gout, void* user_data);

static wasm_rhs_fn g_wasm_rhs = NULL;
static wasm_event_fn g_wasm_event = NULL;
static int g_n_states = 0;
static double* g_states_buf = NULL;
static double* g_derivatives_buf = NULL;
static double g_time = 0.0;

static void wasm_get_derivatives(void* inst) {
    (void)inst;
    if (g_wasm_rhs) {
        g_wasm_rhs(g_time, g_states_buf, g_derivatives_buf, NULL);
    }
}

static void wasm_get_event_indicators(void* inst, double* indicators) {
    (void)inst;
    if (g_wasm_event) {
        g_wasm_event(g_time, g_states_buf, indicators, NULL);
    }
}

int sundials_cvode_wasm(
    int n, double t0, double* y0, int rhs_fn_ptr,
    double* output_times, int n_outputs, int event_fn_ptr,
    int n_events,
    double atol, double rtol, int max_steps, double max_step, double initial_step,
    double* result_times, double* result_states, double* stats
) {
    g_n_states = n;
    g_states_buf = (double*)malloc(n * sizeof(double));
    g_derivatives_buf = (double*)malloc(n * sizeof(double));

    if (!g_states_buf || !g_derivatives_buf) {
        stats[3] = -1;
        free(g_states_buf);
        free(g_derivatives_buf);
        return -1;
    }

    memcpy(g_states_buf, y0, n * sizeof(double));
    g_wasm_rhs = (wasm_rhs_fn)(long)rhs_fn_ptr;
    g_wasm_event = event_fn_ptr ? (wasm_event_fn)(long)event_fn_ptr : NULL;
    g_time = t0;

    SundialsModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.model_instance = NULL;
    cb.n_states = n;
    cb.n_event_indicators = n_events;
    cb.get_derivatives = wasm_get_derivatives;
    cb.get_event_indicators = n_events > 0 ? wasm_get_event_indicators : NULL;
    cb.get_jacobian = NULL;
    cb.states = g_states_buf;
    cb.derivatives = g_derivatives_buf;
    cb.time_ptr = &g_time;

    SundialsOptions opts;
    sundials_options_defaults(&opts);
    opts.atol = atol;
    opts.rtol = rtol;
    opts.max_steps = max_steps;
    if (max_step > 0) opts.max_step = max_step;
    if (initial_step > 0) opts.initial_step = initial_step;

    SundialsResult result;
    sundials_cvode_run(&cb, t0, y0, output_times, n_outputs, &opts, &result);

    if (result.status >= 0) {
        for (int k = 0; k < result.n_points; k++) {
            result_times[k] = result.times[k];
            for (int i = 0; i < n; i++) {
                result_states[k * n + i] = result.states[k * n + i];
            }
        }
    }

    stats[0] = (double)result.n_feval;
    stats[1] = (double)result.n_jeval;
    stats[2] = (double)result.n_steps;
    stats[3] = (double)result.status;

    sundials_result_free(&result);
    free(g_states_buf);
    free(g_derivatives_buf);
    g_states_buf = NULL;
    g_derivatives_buf = NULL;
    g_wasm_rhs = NULL;
    g_wasm_event = NULL;

    return result.status;
}

/* KINSOL WASM entry */
typedef int (*wasm_res_fn)(double* z, double* fval, void* user_data);
static wasm_res_fn g_wasm_res = NULL;
static int g_kinsol_n = 0;

static void wasm_kinsol_residual(void* inst) {
    (void)inst;
}

int sundials_kinsol_wasm(
    int n, double* z0, int res_fn_ptr,
    double atol, double rtol, double* status_out
) {
    g_kinsol_n = n;
    g_wasm_res = (wasm_res_fn)(long)res_fn_ptr;

    SundialsModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.model_instance = NULL;
    cb.n_states = n;
    cb.states = z0;
    cb.derivatives = (double*)calloc(n, sizeof(double));
    cb.time_ptr = NULL;
    cb.get_derivatives = wasm_kinsol_residual;

    SundialsOptions opts;
    sundials_options_defaults(&opts);
    opts.atol = atol;
    opts.rtol = rtol;

    int status = sundials_kinsol_solve(&cb, z0, &opts);
    *status_out = (double)status;

    free(cb.derivatives);
    g_wasm_res = NULL;

    return status;
}
ENTRY_EOF

# Compile with Emscripten
emcc -O2 \
  -I"$SUNDIALS_INSTALL/include" \
  -I"$SRC_DIR" \
  "$BUILD_DIR/sundials_wasm_entry.c" \
  -L"$SUNDIALS_INSTALL/lib" \
  -lsundials_cvodes \
  -lsundials_idas \
  -lsundials_kinsol \
  -lsundials_nvecserial \
  -lsundials_sunmatrixdense \
  -lsundials_sunlinsoldense \
  -lm \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='["_sundials_cvode_wasm","_sundials_kinsol_wasm","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["addFunction","removeFunction","ccall","cwrap"]' \
  -s ALLOW_TABLE_GROWTH=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16777216 \
  -s STACK_SIZE=1048576 \
  -o "$WASM_DIR/sundials.js"

echo "=== SUNDIALS WASM build complete ==="
echo "  Output: $WASM_DIR/sundials.js + sundials.wasm"
ls -lh "$WASM_DIR"/sundials.*
