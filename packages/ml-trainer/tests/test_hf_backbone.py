# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Unit tests for `modelscript_trainer.hf_backbone` (HuggingFace Qwen2.5-Coder / Llama Dynamic-m LoRA adapter).

Run from repo root:
    python3 -m unittest discover -s packages/ml-trainer/tests -v
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
import sys
import unittest
from typing import Any, Optional, Tuple
import numpy as np

# Allow discovery directly from repo root without requiring editable pip install
_PKG_ROOT = Path(__file__).resolve().parents[1]
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from modelscript_trainer._backend import (
    AdamW,
    Module,
    ModuleList,
    Parameter,
    as_tensor,
    gather_embedding,
    log_softmax_t,
    ones,
    randn_init,
    silu_t,
    softmax_t,
    sqrt_t,
    to_numpy,
    zeros,
)
from modelscript_trainer.hf_backbone import (
    DEFAULT_TARGET_MODULES,
    HFDynamicMLoraLinear,
    count_parameters,
    extract_lora_and_projection_state_dict,
    load_and_wrap_hf_model,
    wrap_hf_causal_lm_with_dynamic_m_lora,
)
from modelscript_trainer.zonotope_ops import (
    DynamicMLoraLinear,
    QueryProjectionHead,
    ZonotopeTensor,
)


# ─────────────────────────────────────────────────────────────────────────────
# Offline Mock Qwen2.5-Coder CausalLM (mirrors HuggingFace Qwen2ForCausalLM)
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class _MockQwen2Config:
    vocab_size: int = 128
    hidden_size: int = 32
    intermediate_size: int = 64
    num_hidden_layers: int = 4
    num_attention_heads: int = 4
    num_key_value_heads: int = 2
    rms_norm_eps: float = 1e-6


class _MockLinear(Module):
    """Minimal nn.Linear-compatible linear projection for offline testing."""

    def __init__(self, in_features: int, out_features: int, bias: bool = False, seed: int = 0) -> None:
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        rng = np.random.default_rng(seed)
        self.weight = Parameter(randn_init((out_features, in_features), 1.0 / math.sqrt(in_features), rng))
        if bias:
            self.bias: Optional[Any] = Parameter(randn_init((out_features,), 0.02, rng))
        else:
            self.bias = None

    def forward(self, x: Any) -> Any:
        out = x @ self.weight.transpose(-1, -2)
        if self.bias is not None:
            out = out + self.bias
        return out


class _MockEmbedding(Module):
    def __init__(self, num_embeddings: int, embedding_dim: int, seed: int = 0) -> None:
        super().__init__()
        self.num_embeddings = num_embeddings
        self.embedding_dim = embedding_dim
        rng = np.random.default_rng(seed)
        self.weight = Parameter(randn_init((num_embeddings, embedding_dim), 1.0 / math.sqrt(embedding_dim), rng))

    def forward(self, input_ids: Any) -> Any:
        idx_np = np.abs(np.asarray(to_numpy(input_ids), dtype=np.int64)) % self.num_embeddings
        return gather_embedding(self.weight, idx_np)


class _MockRMSNorm(Module):
    def __init__(self, hidden_size: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.eps = eps
        self.weight = Parameter(ones((hidden_size,)))

    def forward(self, x: Any) -> Any:
        mean_sq = (x * x).mean(dim=-1, keepdim=True)
        return x * (1.0 / sqrt_t(mean_sq + self.eps)) * self.weight


class _MockQwen2Attention(Module):
    """Mirrors Qwen2Attention (GQA with bias=True on Q/K/V and bias=False on O)."""

    def __init__(self, cfg: _MockQwen2Config, layer_idx: int) -> None:
        super().__init__()
        self.hidden_size = cfg.hidden_size
        self.num_heads = cfg.num_attention_heads
        self.num_kv_heads = cfg.num_key_value_heads
        self.head_dim = cfg.hidden_size // cfg.num_attention_heads
        self.kv_dim = self.num_kv_heads * self.head_dim
        base_seed = 1000 + layer_idx * 50

        self.q_proj = _MockLinear(self.hidden_size, self.hidden_size, bias=True, seed=base_seed + 1)
        self.k_proj = _MockLinear(self.hidden_size, self.kv_dim, bias=True, seed=base_seed + 2)
        self.v_proj = _MockLinear(self.hidden_size, self.kv_dim, bias=True, seed=base_seed + 3)
        self.o_proj = _MockLinear(self.hidden_size, self.hidden_size, bias=False, seed=base_seed + 4)

    def forward(self, hidden_states: Any) -> Any:
        B, L, _ = hidden_states.shape
        q = self.q_proj(hidden_states).reshape(B, L, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(hidden_states).reshape(B, L, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(hidden_states).reshape(B, L, self.num_kv_heads, self.head_dim).transpose(1, 2)

        # Repeat KV heads for GQA (num_heads // num_kv_heads == 2)
        repeats = self.num_heads // self.num_kv_heads
        if repeats > 1:
            k_list = []
            v_list = []
            for h in range(self.num_kv_heads):
                for _ in range(repeats):
                    k_list.append(k[:, h : h + 1, :, :])
                    v_list.append(v[:, h : h + 1, :, :])
            from modelscript_trainer._backend import cat

            k = cat(k_list, dim=1)
            v = cat(v_list, dim=1)

        scores = (q @ k.transpose(-1, -2)) * (1.0 / math.sqrt(self.head_dim))
        probs = softmax_t(scores, dim=-1)
        ctx = (probs @ v).transpose(1, 2).reshape(B, L, self.hidden_size)
        return self.o_proj(ctx)


class _MockQwen2MLP(Module):
    """Mirrors Qwen2MLP SwiGLU (gate_proj, up_proj, down_proj)."""

    def __init__(self, cfg: _MockQwen2Config, layer_idx: int) -> None:
        super().__init__()
        base_seed = 2000 + layer_idx * 50
        self.gate_proj = _MockLinear(cfg.hidden_size, cfg.intermediate_size, bias=False, seed=base_seed + 1)
        self.up_proj = _MockLinear(cfg.hidden_size, cfg.intermediate_size, bias=False, seed=base_seed + 2)
        self.down_proj = _MockLinear(cfg.intermediate_size, cfg.hidden_size, bias=False, seed=base_seed + 3)

    def forward(self, x: Any) -> Any:
        return self.down_proj(silu_t(self.gate_proj(x)) * self.up_proj(x))


class _MockQwen2DecoderLayer(Module):
    def __init__(self, cfg: _MockQwen2Config, layer_idx: int) -> None:
        super().__init__()
        self.input_layernorm = _MockRMSNorm(cfg.hidden_size, eps=cfg.rms_norm_eps)
        self.self_attn = _MockQwen2Attention(cfg, layer_idx)
        self.post_attention_layernorm = _MockRMSNorm(cfg.hidden_size, eps=cfg.rms_norm_eps)
        self.mlp = _MockQwen2MLP(cfg, layer_idx)

    def forward(self, hidden_states: Any) -> Tuple[Any]:
        h = hidden_states + self.self_attn(self.input_layernorm(hidden_states))
        out = h + self.mlp(self.post_attention_layernorm(h))
        # Mirror HuggingFace decoder layers returning a 1-tuple (hidden_states,)
        return (out,)


class _MockQwen2Model(Module):
    def __init__(self, cfg: _MockQwen2Config) -> None:
        super().__init__()
        self.embed_tokens = _MockEmbedding(cfg.vocab_size, cfg.hidden_size, seed=7)
        self.layers = ModuleList([_MockQwen2DecoderLayer(cfg, i) for i in range(cfg.num_hidden_layers)])
        self.norm = _MockRMSNorm(cfg.hidden_size, eps=cfg.rms_norm_eps)

    def forward(self, input_ids: Any) -> Any:
        h = self.embed_tokens(input_ids)
        for layer in self.layers:
            layer_out = layer(h)
            h = layer_out[0] if isinstance(layer_out, tuple) else layer_out
        return self.norm(h)


class _MockQwen2ForCausalLM(Module):
    def __init__(self, cfg: Optional[_MockQwen2Config] = None) -> None:
        super().__init__()
        self.config = cfg or _MockQwen2Config()
        self.model = _MockQwen2Model(self.config)
        self.lm_head = _MockLinear(self.config.hidden_size, self.config.vocab_size, bias=False, seed=999)

    def forward(self, input_ids: Any) -> Any:
        hidden = self.model(input_ids)
        return self.lm_head(hidden)


# ─────────────────────────────────────────────────────────────────────────────
# Test Suite
# ─────────────────────────────────────────────────────────────────────────────


class TestHFBackboneAdapter(unittest.TestCase):
    def test_target_discovery_freezing_lora_wrapping_and_middle_projection(self) -> None:
        cfg = _MockQwen2Config(vocab_size=96, hidden_size=32, intermediate_size=64, num_hidden_layers=4)
        model = _MockQwen2ForCausalLM(cfg)

        # Snapshot original pretrained weights for layer 0 q_proj and layer 2 down_proj
        orig_q_weight = to_numpy(model.model.layers[0].self_attn.q_proj.weight).copy()
        orig_q_bias = to_numpy(model.model.layers[0].self_attn.q_proj.bias).copy()
        orig_down_weight = to_numpy(model.model.layers[2].mlp.down_proj.weight).copy()

        wrapped = wrap_hf_causal_lm_with_dynamic_m_lora(
            model,
            lora_rank=8,
            lora_alpha=16,
            target_modules=DEFAULT_TARGET_MODULES,
            projection_layer_index=None,
            retriever_dim=48,
        )
        self.assertIs(wrapped, model)

        # 1. Target module discovery: 4 layers * 7 target projections = 28 wrapped modules
        info = wrapped.dynamic_m_adapter_info
        self.assertEqual(len(info.wrapped_modules), 4 * 7)
        self.assertEqual(info.num_layers, 4)
        self.assertEqual(info.hidden_size, 32)
        self.assertEqual(info.retriever_dim, 48)
        self.assertEqual(info.projection_layer_index, 2)  # num_layers // 2 == 4 // 2 == 2

        # Every target projection is a DynamicMLoraLinear (specifically HFDynamicMLoraLinear)
        for layer_idx, layer in enumerate(wrapped.model.layers):
            for attn_proj in ("q_proj", "k_proj", "v_proj", "o_proj"):
                sub = getattr(layer.self_attn, attn_proj)
                self.assertIsInstance(sub, DynamicMLoraLinear, f"layer {layer_idx}.self_attn.{attn_proj}")
                self.assertIsInstance(sub, HFDynamicMLoraLinear)
            for mlp_proj in ("gate_proj", "up_proj", "down_proj"):
                sub = getattr(layer.mlp, mlp_proj)
                self.assertIsInstance(sub, DynamicMLoraLinear, f"layer {layer_idx}.mlp.{mlp_proj}")

        # Non-target modules (embed_tokens, lm_head, norms) must remain untouched and frozen
        self.assertNotIsInstance(wrapped.model.embed_tokens, DynamicMLoraLinear)
        self.assertNotIsInstance(wrapped.lm_head, DynamicMLoraLinear)
        self.assertFalse(wrapped.model.embed_tokens.weight.requires_grad)
        self.assertFalse(wrapped.lm_head.weight.requires_grad)
        self.assertFalse(wrapped.model.norm.weight.requires_grad)

        # 2. Pretrained weights & biases are preserved identically inside frozen base_weight / bias
        q0 = wrapped.model.layers[0].self_attn.q_proj
        np.testing.assert_allclose(to_numpy(q0.base_weight), orig_q_weight, atol=1e-12)
        self.assertIsNotNone(q0.bias)
        np.testing.assert_allclose(to_numpy(q0.bias), orig_q_bias, atol=1e-12)
        self.assertFalse(q0.base_weight.requires_grad)
        self.assertFalse(q0.bias.requires_grad)
        self.assertTrue(q0.lora_a.requires_grad)
        self.assertTrue(q0.lora_b.requires_grad)

        down2 = wrapped.model.layers[2].mlp.down_proj
        np.testing.assert_allclose(to_numpy(down2.base_weight), orig_down_weight, atol=1e-12)
        self.assertIsNone(down2.bias)
        self.assertFalse(down2.base_weight.requires_grad)

        # 3. Middle-layer QueryProjectionHead attachment
        self.assertIsInstance(wrapped.query_projection_head, QueryProjectionHead)
        self.assertEqual(wrapped.projection_layer_index, 2)
        self.assertEqual(wrapped.query_projection_head.hidden_dim, 32)
        self.assertEqual(wrapped.query_projection_head.retriever_dim, 48)
        self.assertTrue(wrapped.query_projection_head.w_q.requires_grad)
        self.assertTrue(wrapped.query_projection_head.b_q.requires_grad)

        # 4. Strict parameter freeze accounting: ONLY lora_a, lora_b, and query_projection_head are trainable
        trainable_names = [name for name, p in wrapped.named_parameters() if p.requires_grad]
        frozen_names = [name for name, p in wrapped.named_parameters() if not p.requires_grad]
        self.assertGreater(len(trainable_names), 0)
        self.assertGreater(len(frozen_names), 0)
        for name in trainable_names:
            self.assertTrue(
                name.endswith(".lora_a")
                or name.endswith(".lora_b")
                or name.startswith("query_projection_head."),
                f"Unexpected trainable parameter: {name}",
            )
        counts = count_parameters(wrapped)
        self.assertEqual(counts["trainable"], info.trainable_param_count)
        self.assertEqual(counts["frozen"], info.frozen_param_count)
        self.assertEqual(counts["total"], counts["trainable"] + counts["frozen"])

        adapter_state = extract_lora_and_projection_state_dict(wrapped)
        self.assertEqual(set(adapter_state.keys()), set(trainable_names))

    def test_zero_init_lora_b_preserves_exact_pretrained_logits(self) -> None:
        cfg = _MockQwen2Config(vocab_size=64, hidden_size=24, intermediate_size=48, num_hidden_layers=2)
        model = _MockQwen2ForCausalLM(cfg)
        input_ids = np.array([[1, 5, 12, 23]], dtype=np.int64)

        logits_before = to_numpy(model(input_ids))
        wrap_hf_causal_lm_with_dynamic_m_lora(
            model,
            lora_rank=4,
            lora_alpha=8,
            retriever_dim=16,
            zero_init_lora_b=True,
        )
        logits_after = to_numpy(model(input_ids))
        np.testing.assert_allclose(logits_after, logits_before, atol=1e-6)

    def test_forward_backward_and_optimizer_step_only_update_lora_and_projection(self) -> None:
        cfg = _MockQwen2Config(vocab_size=64, hidden_size=32, intermediate_size=64, num_hidden_layers=4)
        model = _MockQwen2ForCausalLM(cfg)
        wrapped = wrap_hf_causal_lm_with_dynamic_m_lora(
            model,
            lora_rank=8,
            lora_alpha=16,
            projection_layer_index=None,  # attaches at layer 2
            retriever_dim=24,
        )

        # Snapshot frozen weights before training step
        frozen_before = {
            name: to_numpy(p).copy()
            for name, p in wrapped.named_parameters()
            if not p.requires_grad
        }
        trainable_before = {
            name: to_numpy(p).copy()
            for name, p in wrapped.named_parameters()
            if p.requires_grad
        }

        input_ids = np.array([[3, 7, 15, 22, 31], [4, 9, 18, 27, 42]], dtype=np.int64)
        target_ids = np.array([[7, 15, 22, 31, 5], [9, 18, 27, 42, 6]], dtype=np.int64)

        logits = wrapped(input_ids)  # [2, 5, 64]
        self.assertEqual(tuple(logits.shape), (2, 5, 64))

        # Middle-layer hidden state & projected DiskANN query must be captured automatically
        mid_hidden = wrapped.get_middle_hidden_state()
        proj_query = wrapped.get_projected_query()
        self.assertIsNotNone(mid_hidden)
        self.assertIsNotNone(proj_query)
        self.assertEqual(tuple(mid_hidden.shape), (2, 5, 32))
        self.assertEqual(tuple(proj_query.shape), (2, 5, 24))

        # Projected queries must be L2-normalized
        q_norms = np.linalg.norm(to_numpy(proj_query), axis=-1)
        np.testing.assert_allclose(q_norms, np.ones_like(q_norms), atol=1e-5)

        # Compute combined LM cross-entropy + middle-layer InfoNCE loss
        log_probs = log_softmax_t(logits, dim=-1)
        one_hot_np = np.zeros((2, 5, 64), dtype=np.float64)
        for b in range(2):
            for t in range(5):
                one_hot_np[b, t, target_ids[b, t]] = 1.0
        lm_loss = -(as_tensor(one_hot_np, dtype="float") * log_probs).sum(dim=-1).mean()

        rng = np.random.default_rng(123)
        pos_embs = as_tensor(rng.normal(0.0, 1.0, size=(2, 24)), dtype="float")
        last_token_mid = mid_hidden[:, -1, :]  # [2, 32]
        infonce = wrapped.query_projection_head.infonce_loss(last_token_mid, pos_embs)
        total_loss = lm_loss + 0.25 * infonce["loss"]

        optimizer = AdamW([p for p in wrapped.parameters() if p.requires_grad], lr=5e-3)
        optimizer.zero_grad()
        total_loss.backward()

        # Verify gradients on trainable parameters & zero/None gradients on frozen parameters
        grad_nonzero_count = 0
        for name, p in wrapped.named_parameters():
            if p.requires_grad:
                self.assertIsNotNone(p.grad, f"Missing gradient for trainable parameter {name}")
                g_np = to_numpy(p.grad)
                self.assertTrue(np.all(np.isfinite(g_np)), f"Non-finite gradient in {name}")
                if float(np.max(np.abs(g_np))) > 0.0:
                    grad_nonzero_count += 1
            else:
                self.assertIsNone(p.grad, f"Frozen parameter {name} unexpectedly accumulated a gradient")

        self.assertEqual(grad_nonzero_count, len(trainable_before))

        optimizer.step()

        # Verify frozen parameters did NOT move, while LoRA + QueryProjectionHead weights DID move
        for name, p in wrapped.named_parameters():
            if not p.requires_grad:
                np.testing.assert_array_equal(to_numpy(p), frozen_before[name])
            else:
                diff = float(np.max(np.abs(to_numpy(p) - trainable_before[name])))
                self.assertGreater(diff, 0.0, f"Trainable parameter {name} did not update after AdamW.step()")

    def test_custom_projection_layer_index_and_zonotope_propagation(self) -> None:
        cfg = _MockQwen2Config(vocab_size=64, hidden_size=16, intermediate_size=32, num_hidden_layers=3)
        model = _MockQwen2ForCausalLM(cfg)
        wrapped = wrap_hf_causal_lm_with_dynamic_m_lora(
            model,
            lora_rank=4,
            lora_alpha=8,
            projection_layer_index=-1,  # attaches to last layer (index 2)
            retriever_dim=12,
        )
        self.assertEqual(wrapped.projection_layer_index, 2)

        # Verify wrapped HFDynamicMLoraLinear seamlessly supports ZonotopeTensor forward passes
        rng = np.random.default_rng(77)
        c = as_tensor(rng.normal(0.0, 0.5, size=(1, 4, 16)), dtype="float")
        g = as_tensor(rng.normal(0.0, 0.1, size=(1, 3, 4, 16)), dtype="float")
        z = ZonotopeTensor(center=c, generators=g, group_ids=[[1, 2, 3]])
        q_proj = wrapped.model.layers[0].self_attn.q_proj
        z_out = q_proj(z)
        self.assertIsInstance(z_out, ZonotopeTensor)
        self.assertEqual(z_out.center.shape, (1, 4, 16))
        self.assertEqual(z_out.generators.shape, (1, 3, 4, 16))

        # Verify soundness for an extreme corner xi = [1, -1, 1]
        xi = np.array([[1.0, -1.0, 1.0]])
        y_concrete = to_numpy(q_proj(z.evaluate(xi)))
        lo, hi, _ = z_out.bounds()
        self.assertLessEqual(float(np.max(to_numpy(lo) - y_concrete)), 1e-5)
        self.assertLessEqual(float(np.max(y_concrete - to_numpy(hi))), 1e-5)

    def test_load_and_wrap_hf_model_with_injected_loader(self) -> None:
        seen_calls: list[tuple[str, dict[str, Any]]] = []

        def fake_loader(model_name_or_path: str, **kwargs: Any) -> _MockQwen2ForCausalLM:
            seen_calls.append((model_name_or_path, kwargs))
            return _MockQwen2ForCausalLM(_MockQwen2Config(vocab_size=64, hidden_size=16, intermediate_size=32, num_hidden_layers=2))

        def fake_tokenizer_loader(model_name_or_path: str, **kwargs: Any) -> dict[str, Any]:
            return {"name": model_name_or_path, "kwargs": kwargs}

        wrapped, tok = load_and_wrap_hf_model(
            "Qwen/Qwen2.5-Coder-0.5B",
            lora_rank=4,
            lora_alpha=8,
            retriever_dim=16,
            load_tokenizer=True,
            model_loader=fake_loader,
            tokenizer_loader=fake_tokenizer_loader,
        )
        self.assertEqual(len(seen_calls), 1)
        self.assertEqual(seen_calls[0][0], "Qwen/Qwen2.5-Coder-0.5B")
        self.assertEqual(tok["name"], "Qwen/Qwen2.5-Coder-0.5B")
        self.assertEqual(wrapped.projection_layer_index, 1)  # 2 // 2 == 1
        self.assertEqual(len(wrapped.dynamic_m_adapter_info.wrapped_modules), 2 * 7)


if __name__ == "__main__":
    unittest.main()
