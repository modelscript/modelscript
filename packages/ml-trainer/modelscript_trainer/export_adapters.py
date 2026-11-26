# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Multi-Target Adapter & SLM Exporter for ModelScript / Ansatz.

Converts trained Dynamic-m SafeTensors LoRA + QueryProjectionHead (W_q) artifacts into
production serving formats:
  1. `mlc-webgpu` : Self-hosted MLC-LLM WebGPU manifest & quantized parameter shard bundle
                    (matching `packages/editor/src/internal/local-ai-runtime.ts` `/api/models/` layout)
  2. `gguf`       : GGUF v3 LoRA adapter binary header + metadata + F32 tensors (Ollama / llama.cpp)
  3. `onnx`       : QueryProjectionHead (W_q) ONNX graph (or portable JSON graph spec if `onnx` absent)
  4. `peft`       : HuggingFace PEFT / vLLM / SGLang Multi-LoRA `adapter_config.json`
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
from typing import Any, Dict, Iterable, List, Optional, Sequence
import numpy as np

GGUF_MAGIC = b"GGUF"
GGUF_VERSION = 3
GGUF_TYPE_UINT32 = 4
GGUF_TYPE_FLOAT32 = 6
GGUF_TYPE_STRING = 8
GGML_TYPE_F32 = 0


def _gguf_pack_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<Q", len(b)) + b


def _gguf_pack_kv_str(key: str, val: str) -> bytes:
    return _gguf_pack_str(key) + struct.pack("<I", GGUF_TYPE_STRING) + _gguf_pack_str(val)


def _gguf_pack_kv_u32(key: str, val: int) -> bytes:
    return _gguf_pack_str(key) + struct.pack("<I", GGUF_TYPE_UINT32) + struct.pack("<I", int(val))


def _gguf_pack_kv_f32(key: str, val: float) -> bytes:
    return _gguf_pack_str(key) + struct.pack("<I", GGUF_TYPE_FLOAT32) + struct.pack("<f", float(val))


def export_gguf_lora(
    tensors: Dict[str, np.ndarray],
    out_path: Path,
    *,
    base_model: str,
    lora_rank: int,
    lora_alpha: float,
    m_cap: int = 32,
) -> Dict[str, Any]:
    """Writes a spec-compliant GGUF v3 LoRA adapter file readable by llama.cpp / Ollama."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sorted_items = sorted(tensors.items(), key=lambda kv: kv[0])

    kv_entries = [
        _gguf_pack_kv_str("general.type", "adapter"),
        _gguf_pack_kv_str("adapter.type", "lora"),
        _gguf_pack_kv_str("general.base_model.name", base_model),
        _gguf_pack_kv_u32("adapter.lora.rank", lora_rank),
        _gguf_pack_kv_f32("adapter.lora.alpha", lora_alpha),
        _gguf_pack_kv_u32("modelscript.dynamic_m.m_cap", m_cap),
    ]

    alignment = 32
    tensor_infos: List[bytes] = []
    tensor_blobs: List[bytes] = []
    offset = 0
    for name, arr in sorted_items:
        f32 = np.ascontiguousarray(np.asarray(arr, dtype="<f4"))
        dims = list(f32.shape)
        info = _gguf_pack_str(name) + struct.pack("<I", len(dims))
        for d in dims:
            info += struct.pack("<Q", int(d))
        info += struct.pack("<I", GGML_TYPE_F32) + struct.pack("<Q", offset)
        tensor_infos.append(info)

        raw = f32.tobytes()
        pad = (alignment - (len(raw) % alignment)) % alignment
        tensor_blobs.append(raw + (b"\x00" * pad))
        offset += len(raw) + pad

    header = (
        GGUF_MAGIC
        + struct.pack("<I", GGUF_VERSION)
        + struct.pack("<Q", len(sorted_items))
        + struct.pack("<Q", len(kv_entries))
    )
    prefix = header + b"".join(kv_entries) + b"".join(tensor_infos)
    prefix_pad = (alignment - (len(prefix) % alignment)) % alignment
    payload = prefix + (b"\x00" * prefix_pad) + b"".join(tensor_blobs)
    out_path.write_bytes(payload)

    return {
        "format": "gguf-v3-lora",
        "path": str(out_path),
        "tensorCount": len(sorted_items),
        "byteSize": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def export_mlc_webgpu_bundle(
    tensors: Dict[str, np.ndarray],
    out_dir: Path,
    *,
    model_id: str,
    base_model: str,
    lora_rank: int,
    lora_alpha: float,
    quantization: str = "q4f16_1",
) -> Dict[str, Any]:
    """
    Exports an MLC-LLM WebGPU self-hosted bundle (`mlc-chat-config.json`, `ndarray-cache.json`,
    and `params_shard_0.bin`) compatible with `@modelscript/editor`'s `/api/models/` loader.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    shard_path = out_dir / "params_shard_0.bin"
    records: List[Dict[str, Any]] = []
    chunks: List[bytes] = []
    byte_offset = 0

    for name, arr in sorted(tensors.items(), key=lambda kv: kv[0]):
        # Store compact float16 payload for WebGPU f16 adapters
        f16 = np.ascontiguousarray(np.asarray(arr, dtype="<f2"))
        raw = f16.tobytes()
        records.append(
            {
                "name": name,
                "shape": list(f16.shape),
                "dtype": "float16",
                "format": "f32-to-bf16" if quantization.endswith("bf16") else "raw-f16",
                "nbytes": len(raw),
                "byteOffset": byte_offset,
            }
        )
        chunks.append(raw)
        byte_offset += len(raw)

    shard_bytes = b"".join(chunks)
    shard_path.write_bytes(shard_bytes)
    shard_sha = hashlib.sha256(shard_bytes).hexdigest()

    ndarray_cache = {
        "metadata": {
            "ParamSize": len(records),
            "ParamBytes": len(shard_bytes),
            "BitsPerParam": 16,
            "Quantization": quantization,
        },
        "records": [
            {
                "dataPath": shard_path.name,
                "format": "raw-shard",
                "nbytes": len(shard_bytes),
                "records": records,
            }
        ],
    }
    (out_dir / "ndarray-cache.json").write_text(json.dumps(ndarray_cache, indent=2) + "\n", encoding="utf-8")

    mlc_config = {
        "model_id": model_id,
        "base_model": base_model,
        "quantization": quantization,
        "model_type": "qwen2",
        "context_window_size": 32768,
        "prefill_chunk_size": 2048,
        "lora_adapter": {
            "rank": lora_rank,
            "alpha": lora_alpha,
            "shardSha256": shard_sha,
        },
    }
    (out_dir / "mlc-chat-config.json").write_text(json.dumps(mlc_config, indent=2) + "\n", encoding="utf-8")

    return {
        "format": "mlc-webgpu",
        "dir": str(out_dir),
        "quantization": quantization,
        "shardBytes": len(shard_bytes),
        "shardSha256": shard_sha,
    }


def export_peft_multi_lora_config(
    out_dir: Path,
    *,
    base_model: str,
    lora_rank: int,
    lora_alpha: float,
    target_modules: Sequence[str] = ("q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"),
) -> Dict[str, Any]:
    """Exports HuggingFace PEFT / vLLM / SGLang compatible `adapter_config.json`."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = {
        "peft_type": "LORA",
        "task_type": "CAUSAL_LM",
        "base_model_name_or_path": base_model,
        "r": int(lora_rank),
        "lora_alpha": float(lora_alpha),
        "lora_dropout": 0.0,
        "bias": "none",
        "target_modules": list(target_modules),
        "inference_mode": True,
    }
    cfg_path = out_dir / "adapter_config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return {
        "format": "peft-multi-lora",
        "path": str(cfg_path),
    }


def export_projection_head_onnx_spec(
    tensors: Dict[str, np.ndarray],
    out_dir: Path,
    *,
    retriever_dim: int,
) -> Dict[str, Any]:
    """
    Exports `QueryProjectionHead` (W_q, b_q) as a browser-loadable ONNX graph when `onnx` is
    installed, plus a portable JSON weight specification for zero-dep WebGPU / JS runtimes.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    w_q = None
    b_q = None
    for name, arr in tensors.items():
        if "projection_head" in name and name.endswith("weight"):
            w_q = np.asarray(arr, dtype=np.float32)
        elif "projection_head" in name and name.endswith("bias"):
            b_q = np.asarray(arr, dtype=np.float32)

    spec_path = out_dir / "query_projection_head.onnx.json"
    spec_payload: Dict[str, Any] = {
        "schema": "modelscript.query-projection-head.onnx-spec.v1",
        "opset": 17,
        "retrieverDim": int(retriever_dim),
        "hasWeights": w_q is not None,
        "nodes": [
            {"op": "MatMul", "inputs": ["hidden_state", "W_q_T"], "outputs": ["proj_raw"]},
            {"op": "Add", "inputs": ["proj_raw", "b_q"], "outputs": ["proj_biased"]},
            {"op": "LpNormalization", "attrs": {"axis": -1, "p": 2}, "inputs": ["proj_biased"], "outputs": ["query_vec"]},
        ],
        "weights": {
            **({"W_q": {"shape": list(w_q.shape), "values": np.round(w_q.astype(np.float64), 6).tolist()}} if w_q is not None else {}),
            **({"b_q": {"shape": list(b_q.shape), "values": np.round(b_q.astype(np.float64), 6).tolist()}} if b_q is not None else {}),
        },
    }
    spec_path.write_text(json.dumps(spec_payload, indent=2) + "\n", encoding="utf-8")

    result: Dict[str, Any] = {
        "format": "onnx-projection-head",
        "specPath": str(spec_path),
        "hasWeights": w_q is not None,
    }

    if w_q is not None:
        try:
            import onnx  # type: ignore[import-not-found]
            from onnx import TensorProto, helper, numpy_helper  # type: ignore[import-not-found]

            in_dim = int(w_q.shape[1]) if w_q.ndim == 2 else int(retriever_dim)
            out_dim = int(w_q.shape[0]) if w_q.ndim == 2 else int(retriever_dim)
            b_vec = b_q if b_q is not None else np.zeros((out_dim,), dtype=np.float32)

            w_init = numpy_helper.from_array(w_q.T.astype(np.float32), name="W_q_T")
            b_init = numpy_helper.from_array(b_vec.astype(np.float32), name="b_q")
            graph = helper.make_graph(
                [
                    helper.make_node("MatMul", ["hidden_state", "W_q_T"], ["proj_raw"]),
                    helper.make_node("Add", ["proj_raw", "b_q"], ["proj_biased"]),
                    helper.make_node("LpNormalization", ["proj_biased"], ["query_vec"], axis=-1, p=2),
                ],
                "QueryProjectionHead",
                [helper.make_tensor_value_info("hidden_state", TensorProto.FLOAT, ["batch", in_dim])],
                [helper.make_tensor_value_info("query_vec", TensorProto.FLOAT, ["batch", out_dim])],
                initializer=[w_init, b_init],
            )
            model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
            onnx_path = out_dir / "query_projection_head.onnx"
            onnx.save(model, str(onnx_path))
            result["onnxPath"] = str(onnx_path)
        except ImportError:
            pass

    return result


def export_all_targets(
    tensors: Dict[str, np.ndarray],
    out_dir: Path,
    *,
    targets: Iterable[str],
    model_id: str,
    base_model: str,
    lora_rank: int,
    lora_alpha: float,
    retriever_dim: int,
    m_cap: int = 32,
) -> Dict[str, Any]:
    """Exports trained tensors to all requested serving targets and returns a manifest map."""
    exports: Dict[str, Any] = {}
    normalized = {t.strip().lower() for t in targets if t.strip()}
    if "mlc-webgpu" in normalized or "mlc" in normalized:
        exports["mlcWebgpu"] = export_mlc_webgpu_bundle(
            tensors,
            out_dir / "mlc_webgpu",
            model_id=model_id,
            base_model=base_model,
            lora_rank=lora_rank,
            lora_alpha=lora_alpha,
        )
    if "gguf" in normalized:
        exports["gguf"] = export_gguf_lora(
            tensors,
            out_dir / "gguf" / "adapter.gguf",
            base_model=base_model,
            lora_rank=lora_rank,
            lora_alpha=lora_alpha,
            m_cap=m_cap,
        )
    if "onnx" in normalized:
        exports["onnx"] = export_projection_head_onnx_spec(
            tensors,
            out_dir / "onnx",
            retriever_dim=retriever_dim,
        )
    if "peft" in normalized:
        exports["peft"] = export_peft_multi_lora_config(
            out_dir / "peft",
            base_model=base_model,
            lora_rank=lora_rank,
            lora_alpha=lora_alpha,
        )
    return exports
