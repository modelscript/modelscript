#!/bin/bash
set -e

# Build script for SUNDIALS WebAssembly module (CVODE + KINSOL)
# Requires Emscripten (emcc) to be installed and in PATH.

WASM_DIR="$(pwd)/packages/compiler/src/wasm"
BUILD_DIR="/tmp/sundials-wasm-build"
SUNDIALS_VERSION="6.7.0"
SUNDIALS_TARBALL="sundials-${SUNDIALS_VERSION}.tar.gz"
SUNDIALS_URL="https://github.com/LLNL/sundials/releases/download/v${SUNDIALS_VERSION}/${SUNDIALS_TARBALL}"

mkdir -p "$WASM_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -f "$SUNDIALS_TARBALL" ]; then
    echo "Downloading SUNDIALS $SUNDIALS_VERSION..."
    curl -L -O "$SUNDIALS_URL"
fi

if [ ! -d "sundials-${SUNDIALS_VERSION}" ]; then
    echo "Extracting SUNDIALS..."
    tar -xzf "$SUNDIALS_TARBALL"
fi

mkdir -p build && cd build

echo "Configuring SUNDIALS for WebAssembly (Emscripten)..."
emcmake cmake ../sundials-${SUNDIALS_VERSION} \
    -DCMAKE_C_FLAGS="-Os -s USE_PTHREADS=0" \
    -DBUILD_STATIC_LIBS=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DEXAMPLES_ENABLE_C=OFF \
    -DENABLE_MPI=OFF \
    -DBUILD_ARKODE=OFF \
    -DBUILD_CVODE=ON \
    -DBUILD_CVODES=OFF \
    -DBUILD_IDA=OFF \
    -DBUILD_IDAS=OFF \
    -DBUILD_KINSOL=ON \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR/install"

echo "Building SUNDIALS..."
emmake make -j$(nproc)
emmake make install

echo "Compiling sundials_wasm.c to sundials.wasm..."
# We will compile the wrapper and link against CVODE, KINSOL, and NVECTOR_SERIAL
emcc "$WASM_DIR/sundials_wasm.c" \
    -I"$BUILD_DIR/install/include" \
    -L"$BUILD_DIR/install/lib" \
    -lsundials_cvode -lsundials_kinsol -lsundials_nvecserial -lsundials_sunlinsolband -lsundials_sunlinsoldense -lsundials_sunmatrixband -lsundials_sunmatrixdense -lsundials_sunnonlinsolnewton -lsundials_sunnonlinsolfixedpoint \
    -O3 -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="createSundialsModule" \
    -s EXPORTED_FUNCTIONS="['_malloc', '_free', '_cvode_init', '_cvode_step', '_cvode_reinit', '_cvode_free']" \
    -s EXPORTED_RUNTIME_METHODS="['ccall', 'addFunction', 'removeFunction', 'wasmMemory', 'HEAPF64', 'HEAP32']" \
    -s ALLOW_TABLE_GROWTH=1 \
    -o "$WASM_DIR/sundials.js"

echo "SUNDIALS WASM build complete: $WASM_DIR/sundials.js and sundials.wasm"
