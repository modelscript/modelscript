#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Download Qwen3-1.7B-q4f16_1-MLC (primary) and Qwen3-0.6B-q4f16_1-MLC (fallback)
# model weights and WebGPU WASM runtimes for WebLLM.
# Files are cached — re-running is a no-op if all files already exist.
#
# Usage: ./scripts/download-model.sh [target_dir]
# Default target_dir: apps/ide/models
# Environment variables:
#   WEBLLM_MODELS="Qwen3-1.7B-q4f16_1-MLC Qwen3-0.6B-q4f16_1-MLC"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-$REPO_ROOT/models}"
MODELS_TO_DOWNLOAD="${WEBLLM_MODELS:-Qwen3-1.7B-q4f16_1-MLC Qwen3-0.6B-q4f16_1-MLC}"

META_FILES=(
  mlc-chat-config.json
  ndarray-cache.json
  tensor-cache.json
  tokenizer.json
  tokenizer_config.json
  vocab.json
  merges.txt
)

download_model_repo() {
  local model_id="$1"
  local model_dir="$TARGET/$model_id"
  local hf_base="https://huggingface.co/mlc-ai/$model_id/resolve/main"

  echo "==> Downloading $model_id model to $model_dir"
  mkdir -p "$model_dir"

  for file in "${META_FILES[@]}"; do
    if [ -f "$model_dir/$file" ]; then
      echo "  [cached] $model_id/$file"
    else
      echo "  [downloading] $model_id/$file"
      curl -fSL --retry 3 "$hf_base/$file" -o "$model_dir/$file"
    fi
  done

  # Parse shard filenames dynamically from ndarray-cache.json
  local shards
  shards=$(grep -o '"dataPath": *"[^"]*"' "$model_dir/ndarray-cache.json" | cut -d'"' -f4 | sort -u)
  for shard in $shards; do
    if [ -f "$model_dir/$shard" ]; then
      echo "  [cached] $model_id/$shard"
    else
      echo "  [downloading] $model_id/$shard"
      curl -fSL --retry 3 "$hf_base/$shard" -o "$model_dir/$shard"
    fi
  done
}

download_wasm_runtime() {
  local wasm_name="$1"
  local wasm_url="$2"

  if [ ! -f "$TARGET/$wasm_name" ]; then
    local repo_wasm="$REPO_ROOT/models/$wasm_name"
    if [ -f "$repo_wasm" ]; then
      echo "  [copy] $wasm_name (from repo)"
      cp "$repo_wasm" "$TARGET/$wasm_name"
    else
      echo "  [downloading] $wasm_name"
      if ! curl -fSL --retry 3 "$wasm_url" -o "$TARGET/$wasm_name"; then
        echo "  [WARNING] $wasm_name download failed. WebGPU AI assistant will fall back if runtime is unavailable."
      fi
    fi
  else
    echo "  [cached] $wasm_name"
  fi
}

for model_id in $MODELS_TO_DOWNLOAD; do
  download_model_repo "$model_id"
done

# Download WebGPU WASM runtimes for Qwen3-1.7B and Qwen3-0.6B
WASM_BASE="https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models"
download_wasm_runtime \
  "Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm" \
  "$WASM_BASE/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm"

download_wasm_runtime \
  "Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm" \
  "$WASM_BASE/v0_2_80/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm"

download_wasm_runtime \
  "Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm" \
  "$WASM_BASE/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm"

echo "==> Model download complete"

