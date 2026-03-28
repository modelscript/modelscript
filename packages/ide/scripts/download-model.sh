#!/usr/bin/env bash
# Download Qwen3-0.6B-q4f16_1-MLC model weights and WASM for WebLLM.
# Files are cached — re-running is a no-op if all files already exist.
#
# Usage: ./scripts/download-model.sh [target_dir]
# Default target_dir: packages/ide/models

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-$REPO_ROOT/models}"

MODEL_DIR="$TARGET/Qwen3-0.6B-q4f16_1-MLC"
WASM_FILE="$TARGET/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm"

HF_BASE="https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/resolve/main"
WASM_URL="https://huggingface.co/mlc-ai/binary-mlc-llm-libs/resolve/main/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm"

# Files to download from the HuggingFace model repo
MODEL_FILES=(
  mlc-chat-config.json
  ndarray-cache.json
  tokenizer.json
  tokenizer_config.json
  vocab.json
  merges.txt
  params_shard_0.bin
  params_shard_1.bin
  params_shard_2.bin
  params_shard_3.bin
  params_shard_4.bin
  params_shard_5.bin
  params_shard_6.bin
  params_shard_7.bin
  params_shard_8.bin
)

echo "==> Downloading Qwen3-0.6B-q4f16_1-MLC model to $TARGET"

mkdir -p "$MODEL_DIR"

# Download model files
for file in "${MODEL_FILES[@]}"; do
  if [ -f "$MODEL_DIR/$file" ]; then
    echo "  [cached] $file"
  else
    echo "  [downloading] $file"
    curl -fSL --retry 3 "$HF_BASE/$file" -o "$MODEL_DIR/$file"
  fi
done

# Download WASM
if [ -f "$WASM_FILE" ]; then
  echo "  [cached] $(basename "$WASM_FILE")"
else
  echo "  [downloading] $(basename "$WASM_FILE")"
  curl -fSL --retry 3 "$WASM_URL" -o "$WASM_FILE"
fi

echo "==> Model download complete"
