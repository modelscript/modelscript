# SPDX-License-Identifier: AGPL-3.0-or-later

"""
ModelScript Tier 2 GPU Training Kernels (`modelscript_trainer`).

Provides formally sound, differentiable Dynamic-m Relational Zonotope Transformer layers
for PyTorch (+ optional Triton CUDA kernels, with seamless NumPy autograd fallback).
"""

from ._backend import HAS_TORCH, HAS_TRITON
from .zonotope_ops import (
    DiskAnnMemoryClient,
    DynamicMBucketSampler,
    DynamicMConfig,
    DynamicMLoraLinear,
    DynamicMRMSNorm,
    DynamicMReasoningModel,
    DynamicMSelfAttention,
    DynamicMSwiGLU,
    DynamicMTransformerBlock,
    GeneratorLifecycleEvent,
    QueryProjectionHead,
    RelationalHypergraphDataset,
    RelationalHypergraphExample,
    RelationalZonotopeEmbedder,
    ZonotopeTensor,
    collate_hypergraph_batch,
    contract_generators,
    parse_hypergraph_row,
    sound_zonotope_hadamard,
    sound_zonotope_silu,
    worst_case_logit_loss,
)
from .hf_backbone import (
    DEFAULT_TARGET_MODULES,
    HFAdapterSummary,
    HFDynamicMLoraLinear,
    RECOMMENDED_HF_BACKBONES,
    count_parameters,
    extract_lora_and_projection_state_dict,
    freeze_base_parameters,
    load_and_wrap_hf_model,
    wrap_hf_causal_lm_with_dynamic_m_lora,
)
from .train_dynamic_m import (
    build_arg_parser,
    load_safetensors,
    run_training,
    save_safetensors,
)

__all__ = [
    "DEFAULT_TARGET_MODULES",
    "HAS_TORCH",
    "HAS_TRITON",
    "HFAdapterSummary",
    "HFDynamicMLoraLinear",
    "RECOMMENDED_HF_BACKBONES",
    "DiskAnnMemoryClient",
    "DynamicMBucketSampler",
    "DynamicMConfig",
    "DynamicMLoraLinear",
    "DynamicMRMSNorm",
    "DynamicMReasoningModel",
    "DynamicMSelfAttention",
    "DynamicMSwiGLU",
    "DynamicMTransformerBlock",
    "GeneratorLifecycleEvent",
    "QueryProjectionHead",
    "RelationalHypergraphDataset",
    "RelationalHypergraphExample",
    "RelationalZonotopeEmbedder",
    "ZonotopeTensor",
    "build_arg_parser",
    "collate_hypergraph_batch",
    "contract_generators",
    "count_parameters",
    "extract_lora_and_projection_state_dict",
    "freeze_base_parameters",
    "load_and_wrap_hf_model",
    "load_safetensors",
    "parse_hypergraph_row",
    "run_training",
    "save_safetensors",
    "sound_zonotope_hadamard",
    "sound_zonotope_silu",
    "worst_case_logit_loss",
    "wrap_hf_causal_lm_with_dynamic_m_lora",
]
