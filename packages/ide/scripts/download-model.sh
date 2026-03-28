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

HF_BASE="https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/resolve/main"
WASM_NAME="Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm"

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

# The WASM file is committed to git (not available from a public URL).
# In CI / Docker, it comes from the git checkout or COPY step.
if [ ! -f "$TARGET/$WASM_NAME" ]; then
  # Try to find it in the repo checkout (for CI/Docker contexts)
  REPO_WASM="$REPO_ROOT/models/$WASM_NAME"
  if [ -f "$REPO_WASM" ]; then
    echo "  [copy] $WASM_NAME (from repo)"
    cp "$REPO_WASM" "$TARGET/$WASM_NAME"
  else
    echo "  [ERROR] $WASM_NAME not found. Ensure the repo checkout includes it."
    exit 1
  fi
else
  echo "  [cached] $WASM_NAME"
fi

echo "==> Model download complete"
