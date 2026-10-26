#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds blink.wasm (jart/blink x86_64 Linux user-space emulator) using Emscripten.
# Requirements: emcc, make, git

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXCHANGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${EXCHANGE_DIR}/src/fmu/pe-emulator/wasm-engine"

mkdir -p "${OUT_DIR}"

if ! command -v emcc &> /dev/null; then
  echo "Error: emcc (Emscripten) is required to build blink.wasm." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Cloning jart/blink..."
git clone --depth 1 https://github.com/jart/blink.git "${TMP_DIR}/blink"
cd "${TMP_DIR}/blink"

echo "Configuring blink with Emscripten..."
./configure --disable-jit

echo "Compiling blink.wasm..."
make -j"$(nproc)" o//blink/blink.wasm

echo "Copying blink.wasm to ${OUT_DIR}..."
cp o//blink/blink.wasm "${OUT_DIR}/blink.wasm"

echo "blink.wasm build complete ($(stat -c%s "${OUT_DIR}/blink.wasm") bytes)."
