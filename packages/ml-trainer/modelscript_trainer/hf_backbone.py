# SPDX-License-Identifier: AGPL-3.0-or-later

"""
HuggingFace `transformers` Pretrained Backbone Adapter (`Qwen2.5-Coder-0.5B/1.5B`, Llama, etc.).

Freezes all pretrained backbone weights, replaces matching linear projections (`q_proj`, `k_proj`,
`v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`) with `DynamicMLoraLinear` adapters
preserving base weights `W_0`, and attaches a trainable middle-layer `QueryProjectionHead`
(`q = Normalize(W_q h_t + b_q)`) at layer `num_layers // 2` for DiskANN latent retrieval.

Works seamlessly with real PyTorch + HuggingFace `Qwen2ForCausalLM` / `LlamaForCausalLM` models
when `torch` and `transformers` are installed, AND with lightweight offline mock backbones built
on `modelscript_trainer._backend.Module`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple
import numpy as np

from ._backend import HAS_TORCH, Parameter, to_numpy
from .zonotope_ops import DynamicMLoraLinear, QueryProjectionHead, ZonotopeTensor

if HAS_TORCH:
    import torch
    import torch.nn as _torch_nn
else:
    torch = None  # type: ignore[assignment]
    _torch_nn = None  # type: ignore[assignment]


DEFAULT_TARGET_MODULES: Tuple[str, ...] = (
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
)

RECOMMENDED_HF_BACKBONES: Tuple[str, ...] = (
    "Qwen/Qwen2.5-Coder-0.5B",
    "Qwen/Qwen2.5-Coder-1.5B",
    "Qwen/Qwen2.5-Coder-0.5B-Instruct",
    "Qwen/Qwen2.5-Coder-1.5B-Instruct",
)


@dataclass
class HFAdapterSummary:
    """Metadata summary attached to a wrapped HuggingFace CausalLM (`model.dynamic_m_adapter_info`)."""

    wrapped_modules: List[str]
    lora_rank: int
    lora_alpha: float
    projection_layer_index: int
    num_layers: int
    hidden_size: int
    retriever_dim: int
    trainable_param_count: int
    frozen_param_count: int
    total_param_count: int


class HFDynamicMLoraLinear(DynamicMLoraLinear):
    """
    `DynamicMLoraLinear` drop-in replacement for HuggingFace `nn.Linear` projections.

    - Inherits `DynamicMLoraLinear` so `isinstance(layer, DynamicMLoraLinear)` is always `True`.
    - Accepts BOTH standard concrete tensors (`torch.Tensor` / `NPTensor` from HuggingFace decoder
      blocks) AND `ZonotopeTensor` inputs for formally sound Dynamic-m set propagation.
    - Preserves frozen pretrained `weight` (and optional frozen `bias`) plus `in_features` /
      `out_features` attributes expected by HuggingFace attention and MLP modules.
    """

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        rank: int = 16,
        alpha: float = 32.0,
        bias: bool = True,
        seed: int = 101,
        zero_init_lora_b: bool = False,
        freeze_bias: bool = True,
    ) -> None:
        super().__init__(
            in_dim=in_dim,
            out_dim=out_dim,
            rank=rank,
            alpha=alpha,
            bias=bias,
            seed=seed,
        )
        self.in_features = int(in_dim)
        self.out_features = int(out_dim)
        self.base_weight.requires_grad = False
        if zero_init_lora_b:
            if HAS_TORCH and isinstance(self.lora_b, torch.Tensor):
                with torch.no_grad():
                    self.lora_b.zero_()
            else:
                self.lora_b.data.fill(0.0)
        if self.bias is not None and freeze_bias:
            self.bias.requires_grad = False

    @classmethod
    def from_linear(
        cls,
        linear_module: Any,
        rank: int = 16,
        alpha: float = 32.0,
        seed: int = 101,
        zero_init_lora_b: bool = False,
    ) -> "HFDynamicMLoraLinear":
        weight = getattr(linear_module, "weight", None)
        if weight is None or len(weight.shape) != 2:
            raise ValueError(f"Expected a linear-like module with 2D weight, got {type(linear_module).__name__}.")
        out_dim = int(getattr(linear_module, "out_features", weight.shape[0]))
        in_dim = int(getattr(linear_module, "in_features", weight.shape[1]))
        src_bias = getattr(linear_module, "bias", None)

        adapter = cls(
            in_dim=in_dim,
            out_dim=out_dim,
            rank=rank,
            alpha=alpha,
            bias=(src_bias is not None),
            seed=seed,
            zero_init_lora_b=zero_init_lora_b,
            freeze_bias=True,
        )

        if HAS_TORCH and isinstance(weight, torch.Tensor):
            target_device = weight.device
            target_dtype = weight.dtype
            with torch.no_grad():
                adapter.base_weight = Parameter(
                    weight.detach().clone().to(device=target_device, dtype=target_dtype),
                    requires_grad=False,
                )
                adapter.lora_a = Parameter(
                    adapter.lora_a.detach().to(device=target_device, dtype=target_dtype),
                    requires_grad=True,
                )
                adapter.lora_b = Parameter(
                    adapter.lora_b.detach().to(device=target_device, dtype=target_dtype),
                    requires_grad=True,
                )
                if src_bias is not None:
                    adapter.bias = Parameter(
                        src_bias.detach().clone().to(device=target_device, dtype=target_dtype),
                        requires_grad=False,
                    )
        else:
            adapter.base_weight = Parameter(np.array(to_numpy(weight), dtype=np.float64, copy=True), requires_grad=False)
            if src_bias is not None:
                adapter.bias = Parameter(np.array(to_numpy(src_bias), dtype=np.float64, copy=True), requires_grad=False)

        return adapter

    def forward(self, x: Any) -> Any:  # type: ignore[override]
        if isinstance(x, ZonotopeTensor):
            return super().forward(x)
        if HAS_TORCH and isinstance(x, torch.Tensor):
            w_eff = self.effective_weight()
            if w_eff.dtype != x.dtype or w_eff.device != x.device:
                w_eff = w_eff.to(device=x.device, dtype=x.dtype)
            out = x @ w_eff.transpose(-1, -2)
            if self.bias is not None:
                b = self.bias
                if b.dtype != x.dtype or b.device != x.device:
                    b = b.to(device=x.device, dtype=x.dtype)
                out = out + b
            return out
        return self.forward_point(x)


def _iter_named_modules(root: Any) -> Iterator[Tuple[str, Any]]:
    """Iterates `(dotted_name, module)` for both PyTorch `nn.Module` and NumPy `NPModule`."""
    if hasattr(root, "named_modules") and callable(root.named_modules):
        yield from root.named_modules()
        return

    visited: set[int] = set()

    def _walk(mod: Any, prefix: str) -> Iterator[Tuple[str, Any]]:
        mid = id(mod)
        if mid in visited:
            return
        visited.add(mid)
        yield prefix, mod
        children = getattr(mod, "_modules", None)
        if isinstance(children, dict):
            for child_name, child_mod in list(children.items()):
                if child_mod is None:
                    continue
                sub_name = f"{prefix}.{child_name}" if prefix else str(child_name)
                yield from _walk(child_mod, sub_name)

    yield from _walk(root, "")


def _iter_named_parameters(root: Any) -> Iterator[Tuple[str, Any]]:
    if hasattr(root, "named_parameters") and callable(root.named_parameters):
        yield from root.named_parameters()
        return
    for mod_name, mod in _iter_named_modules(root):
        params = getattr(mod, "_parameters", None)
        if isinstance(params, dict):
            for p_name, param in params.items():
                if param is None:
                    continue
                full = f"{mod_name}.{p_name}" if mod_name else str(p_name)
                yield full, param


def _is_linear_like(mod: Any) -> bool:
    if isinstance(mod, DynamicMLoraLinear):
        return False
    if HAS_TORCH and _torch_nn is not None and isinstance(mod, _torch_nn.Linear):
        return True
    cls_name = type(mod).__name__.lower()
    if "embedding" in cls_name or hasattr(mod, "num_embeddings"):
        return False
    weight = getattr(mod, "weight", None)
    if weight is None or not hasattr(weight, "shape") or len(weight.shape) != 2:
        return False
    return callable(mod)


def _set_submodule(root: Any, dotted_name: str, new_module: Any) -> None:
    parts = dotted_name.split(".")
    parent = root
    for part in parts[:-1]:
        if hasattr(parent, "_modules") and isinstance(parent._modules, dict) and part in parent._modules:
            parent = parent._modules[part]
        elif part.isdigit() and hasattr(parent, "__getitem__"):
            parent = parent[int(part)]
        else:
            parent = getattr(parent, part)

    leaf = parts[-1]
    if leaf.isdigit() and hasattr(parent, "_items") and isinstance(parent._items, list):
        idx = int(leaf)
        parent._items[idx] = new_module
        parent._modules[str(idx)] = new_module
    elif leaf.isdigit() and hasattr(parent, "__setitem__"):
        parent[int(leaf)] = new_module
    else:
        setattr(parent, leaf, new_module)


def _find_decoder_layers(model: Any) -> Tuple[Optional[Any], int]:
    """Discovers the ordered transformer decoder layer list across Qwen2, Llama, Mistral, GPT-2, or mocks."""
    candidates = [
        getattr(getattr(model, "model", None), "layers", None),
        getattr(model, "layers", None),
        getattr(getattr(model, "transformer", None), "h", None),
        getattr(model, "blocks", None),
    ]
    for layers in candidates:
        if layers is not None and hasattr(layers, "__len__") and len(layers) > 0:
            return layers, len(layers)

    cfg = getattr(model, "config", None)
    num_cfg_layers = getattr(cfg, "num_hidden_layers", None)
    if isinstance(num_cfg_layers, int) and num_cfg_layers >= 0:
        return None, num_cfg_layers
    return None, 0


def _infer_hidden_size(model: Any, wrapped_linear_modules: Sequence[HFDynamicMLoraLinear]) -> int:
    cfg = getattr(model, "config", None)
    for attr in ("hidden_size", "n_embd", "d_model"):
        val = getattr(cfg, attr, None)
        if isinstance(val, int) and val > 0:
            return val
    for attr in ("hidden_size", "hidden_dim"):
        val = getattr(model, attr, None)
        if isinstance(val, int) and val > 0:
            return val
    if wrapped_linear_modules:
        return int(wrapped_linear_modules[0].in_dim)
    raise ValueError("Unable to infer model hidden_size; set `model.config.hidden_size` or provide linear projections.")


def _extract_hidden_tensor(layer_output: Any) -> Any:
    h = layer_output[0] if isinstance(layer_output, tuple) else layer_output
    if isinstance(h, ZonotopeTensor):
        return h.center
    return h


def freeze_base_parameters(model: Any) -> int:
    """Freezes all parameters on `model` (`requires_grad = False`), returning the count of frozen scalar elements."""
    frozen = 0
    seen: set[int] = set()
    for _, param in _iter_named_parameters(model):
        pid = id(param)
        if pid in seen:
            continue
        seen.add(pid)
        param.requires_grad = False
        frozen += int(param.numel()) if hasattr(param, "numel") else int(np.asarray(to_numpy(param)).size)
    return frozen


def count_parameters(model: Any) -> Dict[str, int]:
    """Counts trainable, frozen, and total scalar parameters on `model`."""
    trainable = 0
    frozen = 0
    seen: set[int] = set()
    for _, param in _iter_named_parameters(model):
        pid = id(param)
        if pid in seen:
            continue
        seen.add(pid)
        n = int(param.numel()) if hasattr(param, "numel") else int(np.asarray(to_numpy(param)).size)
        if getattr(param, "requires_grad", False):
            trainable += n
        else:
            frozen += n
    return {"trainable": trainable, "frozen": frozen, "total": trainable + frozen}


def extract_lora_and_projection_state_dict(model: Any) -> Dict[str, np.ndarray]:
    """Extracts only trainable LoRA (`lora_a`, `lora_b`) and `QueryProjectionHead` tensors as NumPy arrays."""
    out: Dict[str, np.ndarray] = {}
    for name, param in _iter_named_parameters(model):
        if getattr(param, "requires_grad", False):
            out[name] = np.array(to_numpy(param), copy=True)
    return out


def wrap_hf_causal_lm_with_dynamic_m_lora(
    model: Any,
    lora_rank: int = 16,
    lora_alpha: float = 32,
    target_modules: Sequence[str] = DEFAULT_TARGET_MODULES,
    projection_layer_index: Optional[int] = None,
    retriever_dim: int = 256,
    embedder_id: str = "ansatz-embed-v1",
    zero_init_lora_b: bool = False,
    seed: int = 42,
) -> Any:
    """
    Adapts a HuggingFace CausalLM (e.g., `Qwen2.5-Coder-0.5B` / `Qwen2.5-Coder-1.5B` / Llama)
    or a structurally compatible offline mock backbone for Dynamic-m LoRA + DiskANN training:

    1. Freezes all existing base model parameters (`requires_grad = False`).
    2. Discovers every linear projection whose leaf module name is in `target_modules`
       and wraps it in `HFDynamicMLoraLinear` (subclass of `DynamicMLoraLinear`), preserving
       frozen pretrained `base_weight` / `bias` and adding trainable `lora_a` / `lora_b`.
    3. Attaches a trainable `QueryProjectionHead` (`q = Normalize(W_q h_t + b_q)`) at
       middle layer `projection_layer_index` (default `num_layers // 2`), hooking that layer's
       forward pass to capture differentiable `model._last_mid_hidden` and
       `model._last_projected_query`.
    4. Annotates `model.dynamic_m_adapter_info` with an `HFAdapterSummary` and returns `model`.
    """
    target_set = set(target_modules)
    if not target_set:
        raise ValueError("target_modules must contain at least one module suffix.")

    # 1. Freeze all pretrained backbone weights first
    freeze_base_parameters(model)

    # 2. Discover & wrap matching linear projections in DynamicMLoraLinear
    matches: List[Tuple[str, Any]] = []
    for name, mod in list(_iter_named_modules(model)):
        if not name:
            continue
        leaf = name.rsplit(".", 1)[-1]
        if leaf in target_set and _is_linear_like(mod):
            matches.append((name, mod))

    wrapped_names: List[str] = []
    wrapped_adapters: List[HFDynamicMLoraLinear] = []
    for idx, (full_name, orig_linear) in enumerate(matches):
        adapter = HFDynamicMLoraLinear.from_linear(
            orig_linear,
            rank=int(lora_rank),
            alpha=float(lora_alpha),
            seed=seed + idx * 17,
            zero_init_lora_b=zero_init_lora_b,
        )
        _set_submodule(model, full_name, adapter)
        wrapped_names.append(full_name)
        wrapped_adapters.append(adapter)

    # 3. Discover decoder layers & attach QueryProjectionHead at middle layer num_layers // 2
    layers, num_layers = _find_decoder_layers(model)
    if num_layers > 0:
        resolved_layer_idx = (num_layers // 2) if projection_layer_index is None else int(projection_layer_index)
        if resolved_layer_idx < 0:
            resolved_layer_idx += num_layers
        if not (0 <= resolved_layer_idx < num_layers):
            raise IndexError(f"projection_layer_index={projection_layer_index} out of range for {num_layers} layers.")
    else:
        resolved_layer_idx = 0 if projection_layer_index is None else int(projection_layer_index)

    hidden_size = _infer_hidden_size(model, wrapped_adapters)
    projection_head = QueryProjectionHead(
        hidden_dim=hidden_size,
        retriever_dim=int(retriever_dim),
        embedder_id=embedder_id,
        seed=seed + 1337,
    )

    # Match device/dtype when wrapping a PyTorch model
    if HAS_TORCH:
        ref_param: Optional[Any] = None
        for _, p in _iter_named_parameters(model):
            if isinstance(p, torch.Tensor) and p.is_floating_point():
                ref_param = p
                break
        if ref_param is not None:
            projection_head.to(device=ref_param.device, dtype=ref_param.dtype)

    # Register QueryProjectionHead as a single named submodule (no duplicate parameter entries)
    model.query_projection_head = projection_head
    model.projection_layer_index = resolved_layer_idx
    model._last_mid_hidden = None
    model._last_projected_query = None

    def _capture_middle_hidden(layer_output: Any) -> None:
        h = _extract_hidden_tensor(layer_output)
        model._last_mid_hidden = h
        if HAS_TORCH and isinstance(h, torch.Tensor):
            w_q = model.query_projection_head.w_q
            h_in = h.to(device=w_q.device, dtype=w_q.dtype) if (h.device != w_q.device or h.dtype != w_q.dtype) else h
            model._last_projected_query = model.query_projection_head(h_in)
        else:
            model._last_projected_query = model.query_projection_head(h)

    # Hook target middle layer
    if layers is not None and 0 <= resolved_layer_idx < len(layers):
        target_layer = layers[resolved_layer_idx]
        if hasattr(target_layer, "register_forward_hook") and callable(target_layer.register_forward_hook):
            def _torch_forward_hook(_module: Any, _inputs: Any, output: Any) -> None:
                _capture_middle_hidden(output)

            model._projection_hook_handle = target_layer.register_forward_hook(_torch_forward_hook)
        else:
            orig_forward = getattr(target_layer, "_orig_forward_before_projection_hook", target_layer.forward)
            target_layer._orig_forward_before_projection_hook = orig_forward

            def _wrapped_layer_forward(*args: Any, **kwargs: Any) -> Any:
                out = orig_forward(*args, **kwargs)
                _capture_middle_hidden(out)
                return out

            target_layer.forward = _wrapped_layer_forward
            model._projection_hook_handle = None
    else:
        model._projection_hook_handle = None

    # Attach clean accessors without creating duplicate submodules
    model.get_middle_hidden_state = lambda: model._last_mid_hidden
    model.get_projected_query = lambda: model._last_projected_query

    counts = count_parameters(model)
    model.dynamic_m_adapter_info = HFAdapterSummary(
        wrapped_modules=wrapped_names,
        lora_rank=int(lora_rank),
        lora_alpha=float(lora_alpha),
        projection_layer_index=resolved_layer_idx,
        num_layers=num_layers,
        hidden_size=hidden_size,
        retriever_dim=int(retriever_dim),
        trainable_param_count=counts["trainable"],
        frozen_param_count=counts["frozen"],
        total_param_count=counts["total"],
    )
    return model


def load_and_wrap_hf_model(
    model_name_or_path: str = "Qwen/Qwen2.5-Coder-0.5B",
    *,
    lora_rank: int = 16,
    lora_alpha: float = 32,
    target_modules: Sequence[str] = DEFAULT_TARGET_MODULES,
    projection_layer_index: Optional[int] = None,
    retriever_dim: int = 256,
    embedder_id: str = "ansatz-embed-v1",
    zero_init_lora_b: bool = False,
    seed: int = 42,
    torch_dtype: Optional[Any] = None,
    device_map: Optional[Any] = None,
    trust_remote_code: bool = False,
    load_tokenizer: bool = False,
    model_loader: Optional[Callable[..., Any]] = None,
    tokenizer_loader: Optional[Callable[..., Any]] = None,
    **from_pretrained_kwargs: Any,
) -> Any:
    """
    Loads a pretrained HuggingFace CausalLM (such as `Qwen/Qwen2.5-Coder-0.5B` or
    `Qwen/Qwen2.5-Coder-1.5B`) and wraps it with Dynamic-m LoRA + middle-layer
    `QueryProjectionHead`.

    Accepts optional `model_loader` / `tokenizer_loader` callables for offline testing
    without network downloads or `transformers` installed.
    """
    load_kwargs: Dict[str, Any] = dict(from_pretrained_kwargs)
    if torch_dtype is not None:
        load_kwargs["torch_dtype"] = torch_dtype
    if device_map is not None:
        load_kwargs["device_map"] = device_map
    if trust_remote_code:
        load_kwargs["trust_remote_code"] = True

    if model_loader is not None:
        base_model = model_loader(model_name_or_path, **load_kwargs)
    else:
        if not HAS_TORCH:
            raise ImportError(
                "Loading HuggingFace pretrained models requires PyTorch (`torch`) and `transformers`. "
                "Install with: pip install torch transformers"
            )
        try:
            from transformers import AutoModelForCausalLM
        except ImportError as exc:
            raise ImportError(
                "HuggingFace `transformers` is not installed. Install with: pip install transformers"
            ) from exc
        base_model = AutoModelForCausalLM.from_pretrained(model_name_or_path, **load_kwargs)

    wrapped = wrap_hf_causal_lm_with_dynamic_m_lora(
        base_model,
        lora_rank=lora_rank,
        lora_alpha=lora_alpha,
        target_modules=target_modules,
        projection_layer_index=projection_layer_index,
        retriever_dim=retriever_dim,
        embedder_id=embedder_id,
        zero_init_lora_b=zero_init_lora_b,
        seed=seed,
    )

    if not load_tokenizer:
        return wrapped

    if tokenizer_loader is not None:
        tokenizer = tokenizer_loader(model_name_or_path, trust_remote_code=trust_remote_code)
    else:
        try:
            from transformers import AutoTokenizer
        except ImportError as exc:
            raise ImportError(
                "Loading HuggingFace tokenizers requires `transformers`. Install with: pip install transformers"
            ) from exc
        tokenizer = AutoTokenizer.from_pretrained(model_name_or_path, trust_remote_code=trust_remote_code)

    return wrapped, tokenizer
