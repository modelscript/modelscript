# SPDX-License-Identifier: AGPL-3.0-or-later

"""
ModelScript Tier 2 GPU Training Kernels — Differentiable Dynamic-m Relational Zonotope Ops.

Implements formally sound, differentiable Dynamic-m Relational Zonotope Transformer primitives
in PyTorch (+ optional Triton CUDA acceleration, with automatic NumPy autograd fallback):

  - `ZonotopeTensor`              : Elastic set representation <c, G, e> (center [B,L,D],
                                    generators [B,m,L,D], group_ids, diagonal box_error [B,L,D])
  - `RelationalZonotopeEmbedder`  : Maps 4-column JSONL hypergraph shards into ZonotopeTensors
  - `DynamicMLoraLinear`          : Frozen W_0 + trainable LoRA B·A exact affine propagation
  - `DynamicMRMSNorm`             : Sound interval-certified zonotope RMSNorm
  - `DynamicMSwiGLU`              : Sound SiLU + McCormick bilinear gate * up with threshold-triggered
                                    (error > expansion_tau) selective generator expansion (m -> m + 1)
  - `DynamicMSelfAttention`       : Sound McCormick QK^T + certified Taylor/Interval Softmax + PV
                                    with DiskANN KV-cache prefix injection support
  - `contract_generators`         : Vanishing-norm pruning, sound collinear merging, and Girard m_cap
                                    reduction emitting mechanistic interpretability events
  - `worst_case_logit_loss`       : Sound worst-case boundary cross-entropy + spread metric Δ_t
  - `QueryProjectionHead`         : q = Normalize(W_q h_t + b_q) + InfoNCE contrastive loss
  - `DiskAnnMemoryClient`         : HTTP client for POST /api/v1/memory/query
  - `RelationalHypergraphDataset` & `DynamicMBucketSampler`: m_init-bucketed JSONL shard DataLoader
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union
import urllib.error
import urllib.request
import numpy as np

from ._backend import (
    HAS_TORCH,
    HAS_TRITON,
    Module,
    ModuleList,
    Parameter,
    Tensor,
    abs_t,
    as_tensor,
    cat,
    exp_t,
    gather_embedding,
    l2_normalize,
    log_softmax_t,
    log_t,
    max_val,
    maximum,
    minimum,
    ones,
    randn_init,
    scalar_max,
    sigmoid_t,
    silu_t,
    softmax_t,
    sqrt_t,
    stack,
    to_numpy,
    triton_affine_forward,
    where,
    zeros,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Core Data Structures: ZonotopeTensor, Config & Interpretability Events
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class DynamicMConfig:
    """Elastic Dynamic-m Zonotope propagation & curriculum configuration."""

    m_start: int = 1
    m_max: int = 24
    m_cap: int = 32
    expansion_tau: float = 0.05
    prune_eps: float = 1e-4
    collinear_cosine_threshold: float = 0.98
    girard_reduce_every: int = 4
    retrieval_tau: float = 0.35


@dataclass
class GeneratorLifecycleEvent:
    """Mechanistic interpretability telemetry emitted during expansion/contraction."""

    layer_index: int
    kind: str  # "expanded-nonlinear" | "pruned-vanishing" | "merged-collinear" | "girard-capped"
    m_before: int
    m_after: int
    group_ids: List[int]
    metric: float
    detail: str


@dataclass
class ZonotopeTensor:
    """
    Elastic relational zonotope tensor representing the continuous set:
        x(xi, eta) = center + sum_{k=0}^{m-1} xi_k * generators[:, k] + eta * box_error
    for xi in [-1, 1]^m and independent per-coordinate slack eta in [-1, 1]^{L x D}.

    Shapes:
      - `center`:     [B, L, D]
      - `generators`: [B, m, L, D]
      - `group_ids`:  List[List[int]] of shape [B][m] (>0 = hypergraph group_id, -1 = nonlinear/slack)
      - `box_error`:  Optional [B, L, D] non-negative independent per-element slack (sound across deep layers)
    """

    center: Any
    generators: Any
    group_ids: List[List[int]]
    box_error: Optional[Any] = None

    @property
    def batch_size(self) -> int:
        return int(self.center.shape[0])

    @property
    def seq_len(self) -> int:
        return int(self.center.shape[1])

    @property
    def dim(self) -> int:
        return int(self.center.shape[2])

    @property
    def m(self) -> int:
        return int(self.generators.shape[1])

    def effective_box_error(self) -> Any:
        if self.box_error is not None:
            return self.box_error
        return zeros(self.center.shape, like=self.center)

    def bounds(self) -> Tuple[Any, Any, Any]:
        """Returns exact sound per-element interval bounds (lo, hi, radius) of shape [B, L, D]."""
        if self.m > 0:
            gen_radius = abs_t(self.generators).sum(dim=1)
        else:
            gen_radius = zeros(self.center.shape, like=self.center)
        radius = gen_radius + self.effective_box_error() if self.box_error is not None else gen_radius
        return self.center - radius, self.center + radius, radius

    def evaluate(self, xi: Any) -> Any:
        """
        Evaluates a concrete point x(xi) = center + sum_k xi[:, k] * generators[:, k]
        for noise vector xi of shape [B, m] (or [m]) with entries in [-1, 1].
        """
        if self.m == 0:
            return self.center
        xi_t = as_tensor(xi, dtype="float")
        if xi_t.ndim == 1:
            xi_t = xi_t.unsqueeze(0)
        # [B, m, 1, 1] * [B, m, L, D] -> sum over m
        delta = (xi_t.unsqueeze(-1).unsqueeze(-1) * self.generators).sum(dim=1)
        return self.center + delta

    def add(self, other: "ZonotopeTensor") -> "ZonotopeTensor":
        """
        Wrapping-free residual addition `self + other`.
        Preserves exact noise-symbol alignment for shared prefix generators `0..min(m1, m2)-1`
        and appends any newly expanded nonlinear generators from the longer side.
        """
        out_center = self.center + other.center
        m1, m2 = self.m, other.m
        if m1 == 0 and m2 == 0:
            out_gen = self.generators
            out_gids = [list(g) for g in self.group_ids]
        elif m1 == m2:
            out_gen = self.generators + other.generators
            out_gids = [list(g) for g in self.group_ids]
        elif m1 < m2:
            shared = self.generators + other.generators[:, :m1] if m1 > 0 else other.generators[:, :0]
            tail = other.generators[:, m1:]
            out_gen = cat([shared, tail], dim=1) if m1 > 0 else tail
            out_gids = [list(g) for g in other.group_ids]
        else:
            shared = self.generators[:, :m2] + other.generators if m2 > 0 else self.generators[:, :0]
            tail = self.generators[:, m2:]
            out_gen = cat([shared, tail], dim=1) if m2 > 0 else tail
            out_gids = [list(g) for g in self.group_ids]

        if self.box_error is None and other.box_error is None:
            out_box = None
        else:
            out_box = self.effective_box_error() + other.effective_box_error()

        return ZonotopeTensor(center=out_center, generators=out_gen, group_ids=out_gids, box_error=out_box)


# ─────────────────────────────────────────────────────────────────────────────
# 2. RelationalZonotopeEmbedder (4-Column JSONL Shard -> Initial Zonotope)
# ─────────────────────────────────────────────────────────────────────────────


class RelationalZonotopeEmbedder(Module):
    """
    Maps 4 aligned relational hypergraph columns (`token_ids`, `group_ids`, `rel_type_ids`, `rel_signs`)
    from ModelScript compiled JSONL shards into an initial elastic `ZonotopeTensor`.
    """

    def __init__(
        self,
        vocab_size: int,
        dim: int,
        num_rel_types: int = 8,
        init_radius: float = 0.08,
        seed: int = 42,
    ) -> None:
        super().__init__()
        self.vocab_size = vocab_size
        self.dim = dim
        self.num_rel_types = num_rel_types
        rng = np.random.default_rng(seed)
        self.token_emb = Parameter(randn_init((vocab_size, dim), 1.0 / math.sqrt(dim), rng))
        self.rel_emb = Parameter(randn_init((num_rel_types, dim), init_radius, rng))
        self.perturbation_scale = Parameter(ones((dim,)))

    def forward(
        self,
        token_ids: Any,
        group_ids: Any,
        rel_type_ids: Any,
        rel_signs: Any,
        max_m: int = 32,
    ) -> ZonotopeTensor:
        tok_np = np.asarray(to_numpy(token_ids), dtype=np.int64)
        grp_np = np.asarray(to_numpy(group_ids), dtype=np.int64)
        rel_np = np.asarray(to_numpy(rel_type_ids), dtype=np.int64)
        sgn_np = np.asarray(to_numpy(rel_signs), dtype=np.float64)

        if tok_np.ndim == 1:
            tok_np = tok_np[None, :]
            grp_np = grp_np[None, :]
            rel_np = rel_np[None, :]
            sgn_np = sgn_np[None, :]

        B, L = tok_np.shape
        tok_mod = np.abs(tok_np) % self.vocab_size
        rel_mod = np.abs(rel_np) % self.num_rel_types

        center = gather_embedding(self.token_emb, tok_mod)  # [B, L, D]

        if max_m <= 0:
            empty_gen = zeros((B, 0, L, self.dim), like=center)
            return ZonotopeTensor(center=center, generators=empty_gen, group_ids=[[] for _ in range(B)])

        # Identify unique active positive group_ids per batch element up to max_m
        per_batch_groups: List[List[int]] = []
        m_batch = 0
        for b in range(B):
            seen: List[int] = []
            seen_set: set[int] = set()
            for t in range(L):
                gid = int(grp_np[b, t])
                if gid > 0 and gid not in seen_set and len(seen) < max_m:
                    seen_set.add(gid)
                    seen.append(gid)
            per_batch_groups.append(seen)
            if len(seen) > m_batch:
                m_batch = len(seen)

        if m_batch == 0:
            empty_gen = zeros((B, 0, L, self.dim), like=center)
            return ZonotopeTensor(center=center, generators=empty_gen, group_ids=[[] for _ in range(B)])

        # Build indicator mask [B, m_batch, L] assigning each token to its group's generator slice
        mask_np = np.zeros((B, m_batch, L), dtype=np.float64)
        padded_group_ids: List[List[int]] = []
        for b in range(B):
            g_list = per_batch_groups[b]
            g_to_slice = {g: idx for idx, g in enumerate(g_list)}
            for t in range(L):
                gid = int(grp_np[b, t])
                s = g_to_slice.get(gid)
                if s is not None and sgn_np[b, t] != 0.0:
                    mask_np[b, s, t] = sgn_np[b, t]
            padded_group_ids.append(g_list + [0] * (m_batch - len(g_list)))

        # Differentiable relational perturbation vectors [B, L, D]
        rel_vecs = gather_embedding(self.rel_emb, rel_mod) * self.perturbation_scale.unsqueeze(0).unsqueeze(0)
        mask_t = as_tensor(mask_np, dtype="float")
        if HAS_TORCH:
            mask_t = mask_t.to(device=center.device, dtype=center.dtype)
        # [B, m_batch, L, 1] * [B, 1, L, D] -> [B, m_batch, L, D]
        generators = mask_t.unsqueeze(-1) * rel_vecs.unsqueeze(1)
        return ZonotopeTensor(center=center, generators=generators, group_ids=padded_group_ids)


# ─────────────────────────────────────────────────────────────────────────────
# 3. DynamicMLoraLinear (Frozen W_0 + Trainable LoRA B · A)
# ─────────────────────────────────────────────────────────────────────────────


class DynamicMLoraLinear(Module):
    """
    Wrapping-free exact affine zonotope projection through frozen base weight `W_0`
    and trainable low-rank LoRA adapters `B @ A`:
        c' = c W_eff^T + b,   G'[k] = G[k] W_eff^T,   e' = e |W_eff|^T
    where W_eff = W_0 + (alpha / rank) * (B @ A).
    """

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        rank: int = 8,
        alpha: float = 16.0,
        bias: bool = True,
        seed: int = 101,
    ) -> None:
        super().__init__()
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.rank = max(1, min(rank, min(in_dim, out_dim)))
        self.lora_scale = float(alpha) / float(self.rank)
        self.has_bias = bias

        rng = np.random.default_rng(seed)
        self.base_weight = Parameter(randn_init((out_dim, in_dim), 1.0 / math.sqrt(in_dim), rng), requires_grad=False)
        self.lora_a = Parameter(randn_init((self.rank, in_dim), 1.0 / math.sqrt(in_dim), rng), requires_grad=True)
        # Small non-zero init for B enables immediate LoRA gradient flow through A on step 0
        self.lora_b = Parameter(randn_init((out_dim, self.rank), 0.02, rng), requires_grad=True)
        if bias:
            self.bias: Optional[Any] = Parameter(zeros((out_dim,)), requires_grad=True)
        else:
            self.bias = None

    def effective_weight(self) -> Any:
        return self.base_weight + self.lora_scale * (self.lora_b @ self.lora_a)

    def forward_point(self, x: Any) -> Any:
        """Exact concrete point evaluation matching the zonotope affine map."""
        w_eff = self.effective_weight()
        triton_out = triton_affine_forward(x, w_eff, self.bias)
        if triton_out is not None:
            return triton_out
        out = x @ w_eff.transpose(-1, -2)
        if self.bias is not None:
            out = out + self.bias
        return out

    def forward(self, x: ZonotopeTensor) -> ZonotopeTensor:
        w_eff = self.effective_weight()
        w_t = w_eff.transpose(-1, -2)

        triton_c = triton_affine_forward(x.center, w_eff, self.bias)
        if triton_c is not None:
            out_center = triton_c
        else:
            out_center = x.center @ w_t
            if self.bias is not None:
                out_center = out_center + self.bias

        if x.m > 0:
            triton_g = triton_affine_forward(x.generators, w_eff, None)
            out_gen = triton_g if triton_g is not None else (x.generators @ w_t)
        else:
            out_gen = zeros((x.batch_size, 0, x.seq_len, self.out_dim), like=out_center)

        out_box = None
        if x.box_error is not None:
            out_box = x.box_error @ abs_t(w_t)

        return ZonotopeTensor(
            center=out_center,
            generators=out_gen,
            group_ids=[list(g) for g in x.group_ids],
            box_error=out_box,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. DynamicMRMSNorm (Formally Sound Interval-Certified Zonotope RMSNorm)
# ─────────────────────────────────────────────────────────────────────────────


class DynamicMRMSNorm(Module):
    """
    Formally sound zonotope RMSNorm:
        RMSNorm(x)_d = weight_d * x_d / sqrt(mean(x^2) + eps)

    Computes exact interval bounds on mean(x^2) + eps -> [v_min, v_max], derives
    the centered inverse-RMS scale s_mid = 0.5 * (s_min + s_max) with half-width
    delta_s = 0.5 * (s_max - s_min), scales center & generators by weight * s_mid,
    and bounds the exact nonlinear remainder |weight_d| * (s_mid * e_d + delta_s * (|c_d| + r_d))
    in `box_error`. Provably sound for every xi in [-1, 1]^m and every dimension D.
    """

    def __init__(self, dim: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.dim = dim
        self.eps = eps
        self.weight = Parameter(ones((dim,)), requires_grad=True)

    def forward_point(self, x: Any) -> Any:
        mean_sq = (x * x).mean(dim=-1, keepdim=True)
        inv_rms = 1.0 / sqrt_t(mean_sq + self.eps)
        return x * inv_rms * self.weight

    def forward(self, x: ZonotopeTensor) -> ZonotopeTensor:
        if x.m == 0 and x.box_error is None:
            return ZonotopeTensor(
                center=self.forward_point(x.center),
                generators=x.generators,
                group_ids=[list(g) for g in x.group_ids],
                box_error=None,
            )

        lo, hi, radius = x.bounds()  # [B, L, D]
        sq_lo = lo * lo
        sq_hi = hi * hi
        q_max = maximum(sq_lo, sq_hi)
        crosses_zero = (to_numpy(lo) <= 0.0) & (to_numpy(hi) >= 0.0)
        q_min = where(crosses_zero, zeros(lo.shape, like=lo), minimum(sq_lo, sq_hi))

        # Tight sound lower bound on ||x||_2^2 via coordinate-wise sum AND reverse triangle inequality:
        # ||c + Delta||_2 >= max(0, ||c||_2 - min(sum_k ||G_k||_2 + ||e||_2, ||r||_2))
        c_norm = sqrt_t((x.center * x.center).sum(dim=-1, keepdim=True) + 1e-24)
        r_norm = sqrt_t((radius * radius).sum(dim=-1, keepdim=True) + 1e-24)
        in_box = x.effective_box_error()
        if x.m > 0:
            g_norms = sqrt_t((x.generators * x.generators).sum(dim=-1, keepdim=True) + 1e-24).sum(dim=1)
            e_norm = sqrt_t((in_box * in_box).sum(dim=-1, keepdim=True) + 1e-24)
            delta_ub = minimum(g_norms + e_norm, r_norm)
        else:
            delta_ub = r_norm
        tri_norm_lb = maximum(c_norm - delta_ub, 0.0)
        v_min_tri = (tri_norm_lb * tri_norm_lb) / float(self.dim)
        v_min_box = q_min.mean(dim=-1, keepdim=True)
        v_min = maximum(v_min_box, v_min_tri) + self.eps  # [B, L, 1]
        v_max = q_max.mean(dim=-1, keepdim=True) + self.eps  # [B, L, 1]

        # Center linearization at s_0 = rms(c)^{-1} (always O(1), exact at m=0)
        v_0 = (x.center * x.center).mean(dim=-1, keepdim=True) + self.eps
        s_0 = 1.0 / sqrt_t(v_0)
        s_min = 1.0 / sqrt_t(v_max)
        s_max = 1.0 / sqrt_t(v_min)
        delta_s = maximum(s_max - s_0, s_0 - s_min)

        # Linearized normalized signal L_d(xi) = s_0 * c_d + sum_k xi_k (s_0 * G_{k,d})
        n_center = x.center * s_0
        n_gen = x.generators * s_0.unsqueeze(1) if x.m > 0 else x.generators
        r_lin = abs_t(n_gen).sum(dim=1) if x.m > 0 else zeros(n_center.shape, like=n_center)

        # Error bound 1: centered-scale perturbation bound
        err_scale = s_0 * in_box + delta_s * (abs_t(x.center) + radius)

        # Error bound 2: exact global monotonic bounds on n_d(x) = x_d / rms(x) in [-sqrt(D), +sqrt(D)]
        sum_qmin_other = maximum(q_min.sum(dim=-1, keepdim=True) - q_min, 0.0)
        sum_qmax_other = maximum(q_max.sum(dim=-1, keepdim=True) - q_max, 0.0)
        inv_d = 1.0 / float(self.dim)

        hi_pos = to_numpy(hi) >= 0.0
        lo_pos = to_numpy(lo) >= 0.0
        y_max = hi / sqrt_t((sq_hi + where(hi_pos, sum_qmin_other, sum_qmax_other)) * inv_d + self.eps)
        y_min = lo / sqrt_t((sq_lo + where(lo_pos, sum_qmax_other, sum_qmin_other)) * inv_d + self.eps)

        err_env = maximum(y_max - (n_center - r_lin), (n_center + r_lin) - y_min)
        n_err = minimum(err_scale, maximum(err_env, 0.0))

        w = self.weight  # [D]
        out_center = n_center * w
        out_gen = n_gen * w.unsqueeze(0).unsqueeze(0).unsqueeze(0) if x.m > 0 else n_gen
        out_box = abs_t(w) * n_err

        return ZonotopeTensor(
            center=out_center,
            generators=out_gen,
            group_ids=[list(g) for g in x.group_ids],
            box_error=out_box,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. Sound Elementwise SiLU + Bilinear Product & DynamicMSwiGLU
# ─────────────────────────────────────────────────────────────────────────────


def _silu_np(x: np.ndarray) -> np.ndarray:
    z = np.clip(x, -60.0, 60.0)
    return x / (1.0 + np.exp(-z))


def _silu_deriv_np(x: np.ndarray) -> np.ndarray:
    z = np.clip(x, -60.0, 60.0)
    s = 1.0 / (1.0 + np.exp(-z))
    return s * (1.0 + x * (1.0 - s))


def sound_zonotope_silu(
    x: ZonotopeTensor,
    expansion_tau: float = 0.05,
    layer_index: int = 0,
    grid_points: int = 16,
) -> Tuple[ZonotopeTensor, List[GeneratorLifecycleEvent]]:
    """
    Formally sound secant/Chebyshev zonotope relaxation of SiLU(x) = x * sigmoid(x)
    with threshold-triggered selective generator expansion (`max_gap > expansion_tau` -> `m -> m + 1`).

    Uses a `grid_points`-segment scan over [lo, hi] PLUS the analytical global bound
    |SiLU''(x)| <= 0.52 -> discretization slack (h^2 / 8) * 0.52 so the linear enclosure
    is 100% provably sound for all x in [lo, hi].
    """
    if x.m == 0 and x.box_error is None:
        return (
            ZonotopeTensor(
                center=silu_t(x.center),
                generators=x.generators,
                group_ids=[list(g) for g in x.group_ids],
                box_error=None,
            ),
            [],
        )

    lo, hi, radius = x.bounds()
    lo_np = to_numpy(lo).astype(np.float64)
    hi_np = to_numpy(hi).astype(np.float64)
    c_np = to_numpy(x.center).astype(np.float64)
    width = hi_np - lo_np
    non_deg = width > 1e-12

    # Secant slope on [lo, hi] (or exact derivative at center when degenerate)
    f_lo = _silu_np(lo_np)
    f_hi = _silu_np(hi_np)
    safe_w = np.where(non_deg, width, 1.0)
    slope_np = np.where(non_deg, (f_hi - f_lo) / safe_w, _silu_deriv_np(c_np))

    # Evaluate residual r(t) = silu(t) - slope * t across uniform grid on [lo, hi]
    ts = np.linspace(0.0, 1.0, grid_points + 1, dtype=np.float64)
    min_res = f_lo - slope_np * lo_np
    max_res = min_res.copy()
    for alpha in ts[1:]:
        pt = lo_np + alpha * width
        res = _silu_np(pt) - slope_np * pt
        min_res = np.minimum(min_res, res)
        max_res = np.maximum(max_res, res)

    # Analytical interpolation remainder bound: max |f''(x)| <= 0.52 => err <= (step^2 / 8) * 0.52
    step = width / float(grid_points)
    analytic_slack = np.where(non_deg, 0.52 * (step * step) / 8.0 + 1e-12, 0.0)
    shift_np = 0.5 * (min_res + max_res)
    half_gap_np = np.where(non_deg, 0.5 * (max_res - min_res) + analytic_slack, 0.0)

    slope_t = as_tensor(slope_np, dtype="float")
    shift_t = as_tensor(shift_np, dtype="float")
    half_gap_t = as_tensor(half_gap_np, dtype="float")
    if HAS_TORCH:
        slope_t = slope_t.to(device=x.center.device, dtype=x.center.dtype)
        shift_t = shift_t.to(device=x.center.device, dtype=x.center.dtype)
        half_gap_t = half_gap_t.to(device=x.center.device, dtype=x.center.dtype)

    out_center = slope_t * x.center + shift_t
    out_gen = slope_t.unsqueeze(1) * x.generators if x.m > 0 else x.generators
    out_gids = [list(g) for g in x.group_ids]

    in_box = x.effective_box_error()
    out_box = abs_t(slope_t) * in_box + half_gap_t

    events: List[GeneratorLifecycleEvent] = []
    max_gap = float(np.max(half_gap_np)) if half_gap_np.size > 0 else 0.0
    if x.m > 0 and max_gap > expansion_tau:
        # Selective Dynamic-m generator expansion (m -> m + 1): append nonlinear curvature slice
        # while retaining half_gap_t in box_error so multi-layer linear soundness stays provable.
        new_slice = half_gap_t.unsqueeze(1)  # [B, 1, L, D]
        out_gen = cat([out_gen, new_slice], dim=1)
        for b in range(len(out_gids)):
            out_gids[b].append(-1)
        events.append(
            GeneratorLifecycleEvent(
                layer_index=layer_index,
                kind="expanded-nonlinear",
                m_before=x.m,
                m_after=x.m + 1,
                group_ids=[-1],
                metric=max_gap,
                detail=f"SiLU gap {max_gap:.5f} > tau ({expansion_tau}) -> appended error generator (m: {x.m} -> {x.m + 1})",
            )
        )

    return ZonotopeTensor(center=out_center, generators=out_gen, group_ids=out_gids, box_error=out_box), events


def sound_zonotope_hadamard(a: ZonotopeTensor, b: ZonotopeTensor) -> ZonotopeTensor:
    """
    Formally sound centered-Taylor / McCormick zonotope elementwise product `a * b`
    for two zonotopes sharing correlated noise symbols xi_0 .. xi_{m-1}.

    Exact identity:
        a * b = (c_a c_b + 0.5 sum_k G_{a,k} G_{b,k})
              + sum_k xi_k (c_a G_{b,k} + c_b G_{a,k})
              + bounded_remainder
    where |bounded_remainder| <= |c_a| e_b + |c_b| e_a + r_a r_b - 0.5 sum_k |G_{a,k} G_{b,k}|.
    """
    # Align generator counts if one side expanded (e.g. SiLU(gate) expanded m -> m + 1 while up has m)
    m_a, m_b = a.m, b.m
    m_max = max(m_a, m_b)
    if m_a < m_max:
        pad = zeros((a.batch_size, m_max - m_a, a.seq_len, a.dim), like=a.center)
        ga = cat([a.generators, pad], dim=1) if m_a > 0 else pad
        gids = [list(g) for g in b.group_ids]
    else:
        ga = a.generators
        gids = [list(g) for g in a.group_ids]

    if m_b < m_max:
        pad = zeros((b.batch_size, m_max - m_b, b.seq_len, b.dim), like=b.center)
        gb = cat([b.generators, pad], dim=1) if m_b > 0 else pad
    else:
        gb = b.generators

    _, _, ra = a.bounds()
    _, _, rb = b.bounds()
    ea = a.effective_box_error()
    eb = b.effective_box_error()

    if m_max > 0:
        gg = ga * gb  # [B, m_max, L, D]
        quad_shift = 0.5 * gg.sum(dim=1)
        quad_abs_diag = 0.5 * abs_t(gg).sum(dim=1)
        out_center = a.center * b.center + quad_shift
        out_gen = a.center.unsqueeze(1) * gb + b.center.unsqueeze(1) * ga
        quad_err = maximum(ra * rb - quad_abs_diag, 0.0)
    else:
        out_center = a.center * b.center
        out_gen = ga
        quad_err = ra * rb

    out_box = abs_t(a.center) * eb + abs_t(b.center) * ea + quad_err
    return ZonotopeTensor(center=out_center, generators=out_gen, group_ids=gids, box_error=out_box)


class DynamicMSwiGLU(Module):
    """
    Formally sound Dynamic-m SwiGLU FFN:
        y = W_down(SiLU(W_gate(x)) * W_up(x))
    with threshold-triggered selective generator expansion (`gap > expansion_tau` -> `m -> m + 1`).
    """

    def __init__(
        self,
        hidden_dim: int,
        intermediate_dim: int,
        lora_rank: int = 8,
        lora_alpha: float = 16.0,
        expansion_tau: float = 0.05,
        seed: int = 303,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim
        self.intermediate_dim = intermediate_dim
        self.expansion_tau = expansion_tau
        self.gate_proj = DynamicMLoraLinear(hidden_dim, intermediate_dim, lora_rank, lora_alpha, bias=False, seed=seed)
        self.up_proj = DynamicMLoraLinear(hidden_dim, intermediate_dim, lora_rank, lora_alpha, bias=False, seed=seed + 11)
        self.down_proj = DynamicMLoraLinear(intermediate_dim, hidden_dim, lora_rank, lora_alpha, bias=False, seed=seed + 23)

    def forward_point(self, x: Any) -> Any:
        gate = silu_t(self.gate_proj.forward_point(x))
        up = self.up_proj.forward_point(x)
        return self.down_proj.forward_point(gate * up)

    def forward(
        self,
        x: ZonotopeTensor,
        layer_index: int = 0,
        expansion_tau: Optional[float] = None,
    ) -> Tuple[ZonotopeTensor, List[GeneratorLifecycleEvent]]:
        tau = self.expansion_tau if expansion_tau is None else expansion_tau
        gate_lin = self.gate_proj(x)
        up_lin = self.up_proj(x)
        gate_act, events = sound_zonotope_silu(gate_lin, expansion_tau=tau, layer_index=layer_index)
        fused = sound_zonotope_hadamard(gate_act, up_lin)
        out = self.down_proj(fused)
        return out, events


# ─────────────────────────────────────────────────────────────────────────────
# 6. DynamicMSelfAttention (Sound Bilinear QK^T + Softmax + PV + DiskANN KV Cache)
# ─────────────────────────────────────────────────────────────────────────────


def _sound_head_matmul(
    ca: Any,
    ga: Any,
    ea: Any,
    cb: Any,
    gb: Any,
    eb: Any,
    transpose_b: bool = False,
) -> Tuple[Any, Any, Any]:
    """
    Formally sound bilinear matrix product A @ B (or A @ B^T when `transpose_b=True`) over
    multi-head zonotope tensors:
      - ca: [B, H, M, K], ga: [B, m, H, M, K], ea: [B, H, M, K]
      - cb: [B, H, K, N] (or [B, H, N, K] if transpose_b)
    Returns (c_out [B, H, M, N], g_out [B, m, H, M, N], e_out [B, H, M, N]).
    """
    m = int(ga.shape[1])
    if transpose_b:
        cb_op = cb.transpose(-1, -2)
        gb_op = gb.transpose(-1, -2) if m > 0 else gb
        eb_op = eb.transpose(-1, -2)
    else:
        cb_op, gb_op, eb_op = cb, gb, eb

    ra = abs_t(ga).sum(dim=1) + ea if m > 0 else ea
    rb = abs_t(gb_op).sum(dim=1) + eb_op if m > 0 else eb_op

    c_lin = ca @ cb_op  # [B, H, M, N]
    if m > 0:
        # Exact first-order generators: ca @ gb_k + ga_k @ cb
        g_out = (ca.unsqueeze(1) @ gb_op) + (ga @ cb_op.unsqueeze(1))
        # Exact diagonal quadratic shift: 0.5 * sum_k (ga_k @ gb_k)
        quad_shift = 0.5 * (ga @ gb_op).sum(dim=1)
        quad_abs_diag = 0.5 * (abs_t(ga) @ abs_t(gb_op)).sum(dim=1)
        c_out = c_lin + quad_shift
        quad_err = maximum((ra @ rb) - quad_abs_diag, 0.0)
    else:
        c_out = c_lin
        g_out = zeros((int(ca.shape[0]), 0, int(ca.shape[1]), int(ca.shape[2]), int(cb_op.shape[-1])), like=c_lin)
        quad_err = ra @ rb

    e_out = (abs_t(ca) @ eb_op) + (ea @ abs_t(cb_op)) + quad_err
    return c_out, g_out, e_out


def _sound_zonotope_softmax(
    c_s: Any,
    g_s: Any,
    e_s: Any,
    valid_mask_np: np.ndarray,
) -> Tuple[Any, Any, Any]:
    """
    Formally sound certified Taylor + exact interval Softmax relaxation over attention scores:
      - c_s: [B, H, L_q, L_k]
      - g_s: [B, m, H, L_q, L_k]
      - e_s: [B, H, L_q, L_k]
      - valid_mask_np: bool array broadcastable to [B, H, L_q, L_k] (True = attendable)

    Proves for every xi in [-1, 1]^m, eta in [-1, 1]:
      1. Exact monotonic bounds p_min <= softmax(s) <= p_max
      2. First-order Jacobian linearization around center p_0 = softmax(c_s):
         L_j(xi) = p_0,j + sum_k xi_k (J_{p_0} G_k)_j
      3. Sound error bound min(err_taylor, err_interval_envelope) placed in e_p.
    """
    m = int(g_s.shape[1])
    mask_f = as_tensor(valid_mask_np.astype(np.float64), dtype="float")
    if HAS_TORCH:
        mask_f = mask_f.to(device=c_s.device, dtype=c_s.dtype)

    neg_large = as_tensor(np.where(valid_mask_np, 0.0, -1e9), dtype="float")
    if HAS_TORCH:
        neg_large = neg_large.to(device=c_s.device, dtype=c_s.dtype)

    # 1. Center softmax p_0
    p0 = softmax_t(c_s + neg_large, dim=-1) * mask_f

    # 2. Exact interval bounds on logits [lo, hi]
    r_gen = abs_t(g_s).sum(dim=1) if m > 0 else zeros(c_s.shape, like=c_s)
    r_tot = (r_gen + e_s) * mask_f
    lo = c_s - r_tot
    hi = c_s + r_tot

    # Exact monotonic softmax bounds [p_min, p_max]
    hi_masked = hi + neg_large
    shift = max_val(hi_masked, dim=-1, keepdim=True)
    eu = exp_t((hi - shift).clamp(min=-80.0, max=0.0)) * mask_f
    el = exp_t((lo - shift).clamp(min=-80.0, max=0.0)) * mask_f

    sum_el = el.sum(dim=-1, keepdim=True)
    sum_eu = eu.sum(dim=-1, keepdim=True)
    p_max = (eu / (sum_el - el + eu).clamp(min=1e-30)) * mask_f
    p_min = (el / (sum_eu - eu + el).clamp(min=1e-30)) * mask_f

    # 3. Exact first-order Jacobian applied to generators: (J_{p_0} G_k)_j = p0_j * (G_k,j - sum_r p0_r G_k,r)
    if m > 0:
        g_masked = g_s * mask_f.unsqueeze(1)
        dot_pg = (p0.unsqueeze(1) * g_masked).sum(dim=-1, keepdim=True)
        g_p = p0.unsqueeze(1) * (g_masked - dot_pg)
        r_lin = abs_t(g_p).sum(dim=1)
    else:
        g_p = g_s
        r_lin = zeros(c_s.shape, like=c_s)

    # Linearized propagation of box error e_s through |J_{p_0}|:
    # |J_{j, r}| = p0_j (1 - p0_j) if r == j else p0_j p0_r
    e_masked = e_s * mask_f
    pe_sum = (p0 * e_masked).sum(dim=-1, keepdim=True)
    lin_box_err = p0 * ((1.0 - 2.0 * p0) * e_masked + pe_sum)

    # Certified Lagrange remainder: |(1/2) delta^T H_j delta| <= 2 * p_max_j * R_max^2
    r_max = max_val(r_tot, dim=-1, keepdim=True)
    err_taylor = lin_box_err + 2.0 * p_max * (r_max * r_max)

    # Exact interval envelope discrepancy around L_j(xi) in [p0 - r_lin, p0 + r_lin]
    err_env = maximum(p_max - (p0 - r_lin), (p0 + r_lin) - p_min)
    e_p = minimum(err_taylor, maximum(err_env, 0.0)) * mask_f

    return p0, g_p, e_p


class DynamicMSelfAttention(Module):
    """
    Formally sound multi-head Dynamic-m Self-Attention with LoRA Q/K/V/O projections,
    McCormick bilinear QK^T and PV products, certified Taylor+Interval Softmax linear relaxation,
    and KV-cache prefix injection for retrieved DiskANN engineering memory chunks.
    """

    def __init__(
        self,
        hidden_dim: int,
        num_heads: int = 4,
        lora_rank: int = 8,
        lora_alpha: float = 16.0,
        seed: int = 202,
    ) -> None:
        super().__init__()
        if hidden_dim % num_heads != 0:
            raise ValueError(f"hidden_dim ({hidden_dim}) must be divisible by num_heads ({num_heads})")
        self.hidden_dim = hidden_dim
        self.num_heads = num_heads
        self.head_dim = hidden_dim // num_heads
        self.scale = 1.0 / math.sqrt(self.head_dim)

        self.q_proj = DynamicMLoraLinear(hidden_dim, hidden_dim, lora_rank, lora_alpha, bias=False, seed=seed)
        self.k_proj = DynamicMLoraLinear(hidden_dim, hidden_dim, lora_rank, lora_alpha, bias=False, seed=seed + 7)
        self.v_proj = DynamicMLoraLinear(hidden_dim, hidden_dim, lora_rank, lora_alpha, bias=False, seed=seed + 13)
        self.o_proj = DynamicMLoraLinear(hidden_dim, hidden_dim, lora_rank, lora_alpha, bias=False, seed=seed + 19)

    def _split_heads_point(self, x: Any) -> Any:
        B, L, _ = x.shape
        return x.reshape(B, L, self.num_heads, self.head_dim).transpose(1, 2)  # [B, H, L, d_h]

    def _split_heads_zonotope(self, z: ZonotopeTensor) -> Tuple[Any, Any, Any]:
        B, L, m = z.batch_size, z.seq_len, z.m
        c = z.center.reshape(B, L, self.num_heads, self.head_dim).transpose(1, 2)  # [B, H, L, d_h]
        if m > 0:
            g = z.generators.reshape(B, m, L, self.num_heads, self.head_dim).transpose(2, 3)  # [B, m, H, L, d_h]
        else:
            g = zeros((B, 0, self.num_heads, L, self.head_dim), like=c)
        e = z.effective_box_error().reshape(B, L, self.num_heads, self.head_dim).transpose(1, 2)  # [B, H, L, d_h]
        return c, g, e

    def _prepare_kv_cache(
        self,
        kv_cache: Tuple[Any, Any],
        batch_size: int,
    ) -> Tuple[Any, Any]:
        """
        Accepts retrieved DiskANN KV-cache prefix either as already-projected `[B, H, L_mem, d_h]`
        tensors OR as raw hidden states `[B, L_mem, D]` (projected through K/V projections).
        """
        k_in, v_in = kv_cache
        if k_in.ndim == 3:
            k_proj = self._split_heads_point(self.k_proj.forward_point(k_in))
            v_proj = self._split_heads_point(self.v_proj.forward_point(v_in))
            return k_proj, v_proj
        if k_in.ndim == 4 and int(k_in.shape[0]) == batch_size:
            return k_in, v_in
        raise ValueError(f"Unsupported kv_cache tensor shape: {k_in.shape}")

    def _build_mask(self, L_q: int, L_mem: int, causal: bool) -> np.ndarray:
        L_k = L_mem + L_q
        if not causal:
            return np.ones((1, 1, L_q, L_k), dtype=bool)
        q_idx = np.arange(L_q)[:, None]
        k_idx = np.arange(L_k)[None, :]
        # Every query can attend to all L_mem DiskANN prefix tokens plus causal tokens j <= L_mem + i
        mask = k_idx <= (L_mem + q_idx)
        return mask[None, None, :, :]

    def forward_point(
        self,
        x: Any,
        kv_cache: Optional[Tuple[Any, Any]] = None,
        causal: bool = True,
    ) -> Any:
        B, L, _ = x.shape
        q = self._split_heads_point(self.q_proj.forward_point(x))
        k = self._split_heads_point(self.k_proj.forward_point(x))
        v = self._split_heads_point(self.v_proj.forward_point(x))

        L_mem = 0
        if kv_cache is not None:
            k_mem, v_mem = self._prepare_kv_cache(kv_cache, B)
            L_mem = int(k_mem.shape[2])
            k = cat([k_mem, k], dim=2)
            v = cat([v_mem, v], dim=2)

        scores = (q @ k.transpose(-1, -2)) * self.scale
        valid_mask = self._build_mask(L, L_mem, causal)
        neg_large = as_tensor(np.where(valid_mask, 0.0, -1e9), dtype="float")
        if HAS_TORCH:
            neg_large = neg_large.to(device=scores.device, dtype=scores.dtype)
        probs = softmax_t(scores + neg_large, dim=-1)
        ctx = probs @ v  # [B, H, L, d_h]
        merged = ctx.transpose(1, 2).reshape(B, L, self.hidden_dim)
        return self.o_proj.forward_point(merged)

    def forward(
        self,
        x: ZonotopeTensor,
        kv_cache: Optional[Tuple[Any, Any]] = None,
        causal: bool = True,
    ) -> ZonotopeTensor:
        B, L, m = x.batch_size, x.seq_len, x.m
        zq = self.q_proj(x)
        zk = self.k_proj(x)
        zv = self.v_proj(x)

        cq, gq, eq = self._split_heads_zonotope(zq)
        ck, gk, ek = self._split_heads_zonotope(zk)
        cv, gv, ev = self._split_heads_zonotope(zv)

        L_mem = 0
        if kv_cache is not None:
            k_mem, v_mem = self._prepare_kv_cache(kv_cache, B)
            L_mem = int(k_mem.shape[2])
            zero_g_mem = zeros((B, m, self.num_heads, L_mem, self.head_dim), like=ck)
            zero_e_mem = zeros((B, self.num_heads, L_mem, self.head_dim), like=ck)
            ck = cat([k_mem, ck], dim=2)
            cv = cat([v_mem, cv], dim=2)
            gk = cat([zero_g_mem, gk], dim=3)
            gv = cat([zero_g_mem, gv], dim=3)
            ek = cat([zero_e_mem, ek], dim=2)
            ev = cat([zero_e_mem, ev], dim=2)

        # 1. Sound bilinear Q @ K^T * scale
        cs, gs, es = _sound_head_matmul(cq, gq, eq, ck, gk, ek, transpose_b=True)
        cs = cs * self.scale
        gs = gs * self.scale
        es = es * self.scale

        # 2. Sound certified Softmax linear relaxation
        valid_mask = self._build_mask(L, L_mem, causal)
        cp, gp, ep = _sound_zonotope_softmax(cs, gs, es, valid_mask)

        # 3. Sound bilinear P @ V
        co, go, eo = _sound_head_matmul(cp, gp, ep, cv, gv, ev, transpose_b=False)

        # Merge heads back to [B, L, D]
        out_c = co.transpose(1, 2).reshape(B, L, self.hidden_dim)
        if m > 0:
            out_g = go.transpose(2, 3).reshape(B, m, L, self.hidden_dim)
        else:
            out_g = zeros((B, 0, L, self.hidden_dim), like=out_c)
        out_e = eo.transpose(1, 2).reshape(B, L, self.hidden_dim)

        attn_z = ZonotopeTensor(
            center=out_c,
            generators=out_g,
            group_ids=[list(g) for g in x.group_ids],
            box_error=out_e,
        )
        return self.o_proj(attn_z)


# ─────────────────────────────────────────────────────────────────────────────
# 7. Mid-Network Contraction: Prune, Sound Collinear Merge & Girard m_cap Cap
# ─────────────────────────────────────────────────────────────────────────────


def contract_generators(
    z: ZonotopeTensor,
    prune_eps: float = 1e-4,
    collinear_cosine_threshold: float = 0.98,
    m_cap: int = 32,
    layer_index: int = 0,
) -> Tuple[ZonotopeTensor, List[GeneratorLifecycleEvent]]:
    """
    Formally sound Dynamic-m generator contraction with mechanistic interpretability telemetry:
      1. Vanishing-norm pruning: removes generator slices with max_b ||G_{b,k}||_2 < prune_eps,
         safely folding |G_k| into `box_error` so formal soundness is never broken.
      2. Collinear merging: merges pairs (i, j) with |cos(G_i, G_j)| >= collinear_cosine_threshold
         using exact orthogonal decomposition v = alpha * u + r_perp -> u' = (1 + |alpha|) u,
         box_error += |r_perp| (100% formally sound!).
      3. Girard `m_cap` reduction: sorts remaining generators by descending L2 norm, keeps the top
         `m_cap` slices, and folds excess slices into `box_error += sum |G_k|`.
    """
    if z.m == 0:
        return z, []

    events: List[GeneratorLifecycleEvent] = []
    box_err = z.effective_box_error()

    # Work with slice tensors [B, L, D] so autograd flows seamlessly through all kept/merged slices
    slices: List[Dict[str, Any]] = []
    for k in range(z.m):
        g_k = z.generators[:, k]  # [B, L, D]
        g_np = to_numpy(g_k)
        # Max L2 norm across batch elements
        norms_b = np.sqrt(np.sum(g_np * g_np, axis=(1, 2)))
        max_norm = float(np.max(norms_b)) if norms_b.size > 0 else 0.0
        gids_k = [z.group_ids[b][k] if k < len(z.group_ids[b]) else -1 for b in range(z.batch_size)]
        slices.append({"tensor": g_k, "norm": max_norm, "gids": gids_k})

    # Stage 1: Vanishing-norm pruning
    kept: List[Dict[str, Any]] = []
    cur_m = len(slices)
    for item in slices:
        if item["norm"] < prune_eps:
            box_err = box_err + abs_t(item["tensor"])
            primary_gid = item["gids"][0] if item["gids"] else -1
            events.append(
                GeneratorLifecycleEvent(
                    layer_index=layer_index,
                    kind="pruned-vanishing",
                    m_before=cur_m,
                    m_after=cur_m - 1,
                    group_ids=[primary_gid],
                    metric=item["norm"],
                    detail=f"Pruned eps_{primary_gid} (||g||={item['norm']:.2e} < {prune_eps})",
                )
            )
            cur_m -= 1
        else:
            kept.append(item)

    # Stage 2: Sound collinear merging
    i = 0
    while i < len(kept):
        ui = kept[i]
        u_np = to_numpy(ui["tensor"])
        u_norm_sq = float(np.sum(u_np * u_np))
        u_norm = math.sqrt(max(1e-24, u_norm_sq))
        j = i + 1
        while j < len(kept):
            vj = kept[j]
            v_np = to_numpy(vj["tensor"])
            v_norm = math.sqrt(max(1e-24, float(np.sum(v_np * v_np))))
            dot = float(np.sum(u_np * v_np))
            cos_val = dot / (u_norm * v_norm)
            if abs(cos_val) >= collinear_cosine_threshold:
                # Exact sound orthogonal decomposition per batch element:
                # v_b = alpha_b * u_b + r_perp_b  =>  xi_1 u_b + xi_2 v_b enclosed by (1 + |alpha_b|) u_b + |r_perp_b|
                u_t = ui["tensor"]
                v_t = vj["tensor"]
                u_sq_b = (u_t * u_t).sum(dim=(1, 2), keepdim=True).clamp(min=1e-18)
                alpha_b = (u_t * v_t).sum(dim=(1, 2), keepdim=True) / u_sq_b
                r_perp = v_t - alpha_b * u_t
                merged_u = (1.0 + abs_t(alpha_b)) * u_t
                box_err = box_err + abs_t(r_perp)

                m_before = len(kept)
                ui["tensor"] = merged_u
                u_np = to_numpy(merged_u)
                u_norm_sq = float(np.sum(u_np * u_np))
                u_norm = math.sqrt(max(1e-24, u_norm_sq))
                ui["norm"] = float(np.max(np.sqrt(np.sum(u_np * u_np, axis=(1, 2)))))

                gid_i = ui["gids"][0] if ui["gids"] else -1
                gid_j = vj["gids"][0] if vj["gids"] else -1
                events.append(
                    GeneratorLifecycleEvent(
                        layer_index=layer_index,
                        kind="merged-collinear",
                        m_before=m_before,
                        m_after=m_before - 1,
                        group_ids=[gid_i, gid_j],
                        metric=abs(cos_val),
                        detail=f"Merged collinear eps_{gid_i} & eps_{gid_j} (|cos|={abs(cos_val):.4f})",
                    )
                )
                kept.pop(j)
            else:
                j += 1
        i += 1

    # Stage 3: Girard m_cap hard VRAM ceiling reduction
    safe_cap = max(0, int(m_cap))
    if len(kept) > safe_cap:
        m_before = len(kept)
        kept.sort(key=lambda item: item["norm"], reverse=True)
        collapsed = kept[safe_cap:]
        kept = kept[:safe_cap]
        collapsed_gids: List[int] = []
        for item in collapsed:
            box_err = box_err + abs_t(item["tensor"])
            collapsed_gids.append(item["gids"][0] if item["gids"] else -1)
        events.append(
            GeneratorLifecycleEvent(
                layer_index=layer_index,
                kind="girard-capped",
                m_before=m_before,
                m_after=len(kept),
                group_ids=collapsed_gids,
                metric=float(safe_cap),
                detail=f"Girard-reduced {len(collapsed)} smallest generators into box slack to enforce m_cap={safe_cap}",
            )
        )

    if len(kept) > 0:
        out_gen = stack([item["tensor"] for item in kept], dim=1)  # [B, m_out, L, D]
        out_gids = [[item["gids"][b] for item in kept] for b in range(z.batch_size)]
    else:
        out_gen = zeros((z.batch_size, 0, z.seq_len, z.dim), like=z.center)
        out_gids = [[] for _ in range(z.batch_size)]

    return ZonotopeTensor(center=z.center, generators=out_gen, group_ids=out_gids, box_error=box_err), events


# ─────────────────────────────────────────────────────────────────────────────
# 8. Worst-Case Output Logit Boundary Loss + Spread Metric Δ_t
# ─────────────────────────────────────────────────────────────────────────────


def worst_case_logit_loss(
    logits: ZonotopeTensor,
    target_ids: Any,
    worst_case_weight: float = 0.5,
    anti_collapse_weight: float = 1e-4,
) -> Dict[str, Any]:
    """
    Sound worst-case cross-entropy loss over the output logit zonotope enclosure:
      - Lowers target token logit to `c_target - radius_target`
      - Raises all non-target logits to `c_other + radius_other`
    Also returns per-token spread metric Δ_t = max_v radius[b, t, v].
    """
    B, L, V = logits.batch_size, logits.seq_len, logits.dim
    _, _, radius = logits.bounds()  # [B, L, V]

    tgt_np = np.abs(np.asarray(to_numpy(target_ids), dtype=np.int64)) % V
    if tgt_np.ndim == 1:
        tgt_np = tgt_np[None, :]

    one_hot_np = np.zeros((B, L, V), dtype=np.float64)
    b_idx = np.arange(B)[:, None]
    l_idx = np.arange(L)[None, :]
    one_hot_np[b_idx, l_idx, tgt_np] = 1.0
    one_hot = as_tensor(one_hot_np, dtype="float")
    if HAS_TORCH:
        one_hot = one_hot.to(device=logits.center.device, dtype=logits.center.dtype)

    # Center cross-entropy
    log_p_center = log_softmax_t(logits.center, dim=-1)
    ce_center = -(one_hot * log_p_center).sum(dim=-1).mean()

    # Sound worst-case boundary logits: c - r for target, c + r for non-target
    worst_logits = logits.center + (1.0 - 2.0 * one_hot) * radius
    log_p_worst = log_softmax_t(worst_logits, dim=-1)
    ce_worst = -(one_hot * log_p_worst).sum(dim=-1).mean()

    w_c = 1.0 - worst_case_weight
    total_loss = w_c * ce_center + worst_case_weight * ce_worst
    if anti_collapse_weight > 0.0 and logits.m > 0:
        total_loss = total_loss + anti_collapse_weight * (logits.generators * logits.generators).mean()

    spread_per_token = max_val(radius, dim=-1)  # [B, L]
    return {
        "loss": total_loss,
        "center_ce": ce_center,
        "worst_case_ce": ce_worst,
        "spread_per_token": spread_per_token,
        "max_spread": scalar_max(spread_per_token),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 9. QueryProjectionHead (q = Normalize(W_q h_t + b_q), InfoNCE) & DiskANN Client
# ─────────────────────────────────────────────────────────────────────────────


class QueryProjectionHead(Module):
    """
    Linear Query Projection Head `q = Normalize(W_q h_t + b_q)` mapping middle-layer
    LLM hidden states into the canonical DiskANN external retriever embedding space.
    """

    def __init__(
        self,
        hidden_dim: int,
        retriever_dim: int = 256,
        embedder_id: str = "ansatz-embed-v1",
        seed: int = 777,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim
        self.retriever_dim = retriever_dim
        self.embedder_id = embedder_id
        rng = np.random.default_rng(seed)
        self.w_q = Parameter(randn_init((retriever_dim, hidden_dim), 1.0 / math.sqrt(hidden_dim), rng), requires_grad=True)
        self.b_q = Parameter(zeros((retriever_dim,)), requires_grad=True)

    def forward(self, hidden_state: Any) -> Any:
        raw = hidden_state @ self.w_q.transpose(-1, -2) + self.b_q
        return l2_normalize(raw, dim=-1, eps=1e-12)

    def project(self, hidden_state: Any) -> Any:
        return self.forward(hidden_state)

    def infonce_loss(
        self,
        hidden_states: Any,
        positive_embs: Any,
        negative_embs: Optional[Any] = None,
        temperature: float = 0.07,
    ) -> Dict[str, Any]:
        """
        Computes InfoNCE contrastive loss aligning `q = Normalize(W_q h_t + b_q)` with positive
        DiskANN chunk embeddings:
          - If `negative_embs` is None: uses in-batch negatives (`positive_embs` shape `[B, D_ret]`).
          - If `negative_embs` is provided (`[B, K, D_ret]` or `[K, D_ret]`): contrasts each query
            against its positive + explicit negative embeddings.
        """
        h_t = hidden_states if hasattr(hidden_states, "shape") else as_tensor(hidden_states, dtype="float")
        pos_t = positive_embs if hasattr(positive_embs, "shape") else as_tensor(positive_embs, dtype="float")
        if h_t.ndim == 1:
            h_t = h_t.unsqueeze(0)
        if pos_t.ndim == 1:
            pos_t = pos_t.unsqueeze(0)

        q = self.forward(h_t)  # [B, D_ret]
        pos_n = l2_normalize(pos_t, dim=-1, eps=1e-12)
        inv_t = 1.0 / max(1e-4, float(temperature))

        if negative_embs is None:
            # In-batch InfoNCE: logits [B, B]
            logits = (q @ pos_n.transpose(-1, -2)) * inv_t
            log_probs = log_softmax_t(logits, dim=-1)
            B = int(q.shape[0])
            eye_np = np.eye(B, dtype=np.float64)
            eye = as_tensor(eye_np, dtype="float")
            if HAS_TORCH:
                eye = eye.to(device=q.device, dtype=q.dtype)
            loss = -(eye * log_probs).sum(dim=-1).mean()
            pos_cos = (q * pos_n).sum(dim=-1).mean()
            return {"loss": loss, "positive_cosine": pos_cos, "query": q}

        neg_t = negative_embs if hasattr(negative_embs, "shape") else as_tensor(negative_embs, dtype="float")
        if neg_t.ndim == 2:
            # Broadcast shared negatives [K, D_ret] -> [B, K, D_ret]
            B = int(q.shape[0])
            neg_t = stack([neg_t for _ in range(B)], dim=0)
        neg_n = l2_normalize(neg_t, dim=-1, eps=1e-12)  # [B, K, D_ret]

        pos_sim = (q * pos_n).sum(dim=-1, keepdim=True)  # [B, 1]
        neg_sim = (q.unsqueeze(1) * neg_n).sum(dim=-1)  # [B, K]
        logits = cat([pos_sim, neg_sim], dim=-1) * inv_t  # [B, 1 + K]
        log_probs = log_softmax_t(logits, dim=-1)
        loss = -log_probs[:, 0].mean()
        return {"loss": loss, "positive_cosine": pos_sim.mean(), "query": q}


class DiskAnnMemoryClient:
    """
    Lightweight HTTP client for the ModelScript DiskANN Memory API (`POST /api/v1/memory/query`).
    Uses Python stdlib `urllib.request` so it works identically in Slurm clusters and minimal containers.
    """

    def __init__(
        self,
        base_url: str,
        embedder_id: str = "ansatz-embed-v1",
        embedder_hash: Optional[str] = None,
        timeout: float = 5.0,
    ) -> None:
        cleaned = base_url.rstrip("/")
        if cleaned.endswith("/api/v1/memory/query"):
            self.endpoint = cleaned
        elif cleaned.endswith("/api/v1/memory"):
            self.endpoint = f"{cleaned}/query"
        else:
            self.endpoint = f"{cleaned}/api/v1/memory/query"
        self.embedder_id = embedder_id
        self.embedder_hash = embedder_hash
        self.timeout = timeout

    def _post_json(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)

    def query_latent(
        self,
        latent_vector: Union[Sequence[float], Any],
        top_k: int = 5,
        package_pins: Optional[Dict[str, str]] = None,
        dialects: Optional[List[str]] = None,
        include_social_posts: bool = True,
        tenant_scope: str = "public",
    ) -> Dict[str, Any]:
        vec = to_numpy(latent_vector).reshape(-1).astype(float).tolist()
        payload: Dict[str, Any] = {
            "mode": "latent",
            "latentVector": vec,
            "embedderId": self.embedder_id,
            "topK": int(top_k),
            "includeSocialPosts": bool(include_social_posts),
            "tenantScope": tenant_scope,
        }
        if self.embedder_hash:
            payload["embedderHash"] = self.embedder_hash
        if package_pins:
            payload["packagePins"] = package_pins
        if dialects:
            payload["dialects"] = dialects
        return self._post_json(payload)

    def query_hybrid(
        self,
        text_query: str,
        top_k: int = 5,
        package_pins: Optional[Dict[str, str]] = None,
        dialects: Optional[List[str]] = None,
        include_social_posts: bool = True,
        tenant_scope: str = "public",
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "mode": "hybrid",
            "textQuery": text_query,
            "topK": int(top_k),
            "includeSocialPosts": bool(include_social_posts),
            "tenantScope": tenant_scope,
        }
        if package_pins:
            payload["packagePins"] = package_pins
        if dialects:
            payload["dialects"] = dialects
        return self._post_json(payload)


# ─────────────────────────────────────────────────────────────────────────────
# 10. Compiled JSONL Shard Dataset & DynamicMBucketSampler
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class RelationalHypergraphExample:
    example_id: str
    uri: str
    dialect: str
    m_init: int
    token_ids: List[int]
    group_ids: List[int]
    rel_type_ids: List[int]
    rel_signs: List[float]


def parse_hypergraph_row(row: Dict[str, Any]) -> RelationalHypergraphExample:
    """Parses both snake_case JSONL rows from `msx dataset compile` and camelCase TS records."""
    token_ids = [int(v) for v in (row.get("token_ids") or row.get("tokenIds") or [])]
    group_ids = [int(v) for v in (row.get("group_ids") or row.get("groupIds") or [0] * len(token_ids))]
    rel_type_ids = [int(v) for v in (row.get("rel_type_ids") or row.get("relTypeIds") or [0] * len(token_ids))]
    rel_signs = [float(v) for v in (row.get("rel_signs") or row.get("relSigns") or [0.0] * len(token_ids))]
    if "m_init" in row:
        m_init = int(row["m_init"])
    elif "mInit" in row:
        m_init = int(row["mInit"])
    else:
        m_init = len({g for g in group_ids if g > 0})
    return RelationalHypergraphExample(
        example_id=str(row.get("example_id") or row.get("exampleId") or "unknown"),
        uri=str(row.get("uri") or ""),
        dialect=str(row.get("dialect") or "modelica"),
        m_init=m_init,
        token_ids=token_ids,
        group_ids=group_ids,
        rel_type_ids=rel_type_ids,
        rel_signs=rel_signs,
    )


class RelationalHypergraphDataset:
    """Loads 4-column Relational Hypergraph examples from one or more compiled `.jsonl` shards."""

    def __init__(self, shard_paths: Sequence[Union[str, Path]]) -> None:
        self.examples: List[RelationalHypergraphExample] = []
        for raw_path in shard_paths:
            p = Path(raw_path)
            if not p.exists():
                continue
            with p.open("r", encoding="utf-8") as fh:
                for line in fh:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    self.examples.append(parse_hypergraph_row(json.loads(stripped)))

    @classmethod
    def from_examples(cls, examples: Sequence[RelationalHypergraphExample]) -> "RelationalHypergraphDataset":
        ds = cls([])
        ds.examples = list(examples)
        return ds

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, idx: int) -> RelationalHypergraphExample:
        return self.examples[idx]


def collate_hypergraph_batch(
    examples: Sequence[RelationalHypergraphExample],
    pad_token_id: int = 0,
    m_cap: int = 32,
) -> Dict[str, Any]:
    """Pads a bucketed mini-batch of hypergraph examples to its local max sequence length & m_batch_max."""
    B = len(examples)
    max_len = max((len(ex.token_ids) for ex in examples), default=1)
    max_len = max(1, max_len)

    tok = np.full((B, max_len), pad_token_id, dtype=np.int64)
    grp = np.zeros((B, max_len), dtype=np.int64)
    rel = np.zeros((B, max_len), dtype=np.int64)
    sgn = np.zeros((B, max_len), dtype=np.float64)
    attn_mask = np.zeros((B, max_len), dtype=np.int64)
    m_batch_max = 0

    for b, ex in enumerate(examples):
        n = len(ex.token_ids)
        if n > 0:
            tok[b, :n] = ex.token_ids
            grp[b, :n] = ex.group_ids
            rel[b, :n] = ex.rel_type_ids
            sgn[b, :n] = ex.rel_signs
            attn_mask[b, :n] = 1
        m_eff = min(ex.m_init, m_cap)
        if m_eff > m_batch_max:
            m_batch_max = m_eff

    # Next-token language modeling targets (shifted left by 1, repeating last token for tail)
    targets = np.roll(tok, -1, axis=1)
    targets[:, -1] = tok[:, -1]

    return {
        "example_ids": [ex.example_id for ex in examples],
        "dialects": [ex.dialect for ex in examples],
        "m_batch_max": m_batch_max,
        "token_ids": tok,
        "group_ids": grp,
        "rel_type_ids": rel,
        "rel_signs": sgn,
        "attention_mask": attn_mask,
        "target_ids": targets,
    }


class DynamicMBucketSampler:
    """
    `m_init`-bucketed sampler/loader minimizing generator-dimension padding across GPU mini-batches.
    Sorts examples by `min(m_init, m_cap)` into contiguous mini-batches and optionally shuffles
    batch order per epoch for stochastic optimization.
    """

    def __init__(
        self,
        dataset: RelationalHypergraphDataset,
        batch_size: int = 8,
        m_cap: int = 32,
        shuffle_buckets: bool = True,
        seed: int = 42,
    ) -> None:
        self.dataset = dataset
        self.batch_size = max(1, int(batch_size))
        self.m_cap = max(0, int(m_cap))
        self.shuffle_buckets = shuffle_buckets
        self.seed = seed
        self._epoch = 0

    def set_epoch(self, epoch: int) -> None:
        self._epoch = epoch

    def build_index_batches(self) -> List[List[int]]:
        n = len(self.dataset)
        if n == 0:
            return []
        order = sorted(
            range(n),
            key=lambda idx: (min(self.dataset[idx].m_init, self.m_cap), self.dataset[idx].m_init, len(self.dataset[idx].token_ids)),
        )
        batches = [order[i : i + self.batch_size] for i in range(0, n, self.batch_size)]
        if self.shuffle_buckets and len(batches) > 1:
            rng = np.random.default_rng(self.seed + self._epoch)
            perm = rng.permutation(len(batches))
            batches = [batches[int(i)] for i in perm]
        return batches

    def __len__(self) -> int:
        return math.ceil(len(self.dataset) / self.batch_size) if len(self.dataset) > 0 else 0

    def __iter__(self) -> Iterator[List[int]]:
        yield from self.build_index_batches()

    def iter_batches(self, pad_token_id: int = 0) -> Iterator[Dict[str, Any]]:
        """Convenience DataLoader iterator yielding collated `m_init`-bucketed batches directly."""
        for idxs in self.build_index_batches():
            yield collate_hypergraph_batch([self.dataset[i] for i in idxs], pad_token_id=pad_token_id, m_cap=self.m_cap)


# ─────────────────────────────────────────────────────────────────────────────
# 11. Full Dynamic-m Transformer Block & Compact Reasoning Core
# ─────────────────────────────────────────────────────────────────────────────


class DynamicMTransformerBlock(Module):
    """Pre-RMSNorm Dynamic-m Transformer block: RMSNorm -> SelfAttention -> RMSNorm -> SwiGLU -> Contraction."""

    def __init__(
        self,
        hidden_dim: int,
        num_heads: int = 4,
        intermediate_dim: Optional[int] = None,
        lora_rank: int = 8,
        lora_alpha: float = 16.0,
        expansion_tau: float = 0.05,
        seed: int = 404,
    ) -> None:
        super().__init__()
        inter = intermediate_dim if intermediate_dim is not None else hidden_dim * 2
        self.norm1 = DynamicMRMSNorm(hidden_dim)
        self.attn = DynamicMSelfAttention(hidden_dim, num_heads=num_heads, lora_rank=lora_rank, lora_alpha=lora_alpha, seed=seed)
        self.norm2 = DynamicMRMSNorm(hidden_dim)
        self.ffn = DynamicMSwiGLU(
            hidden_dim,
            intermediate_dim=inter,
            lora_rank=lora_rank,
            lora_alpha=lora_alpha,
            expansion_tau=expansion_tau,
            seed=seed + 50,
        )

    def forward_point(self, x: Any, kv_cache: Optional[Tuple[Any, Any]] = None, causal: bool = True) -> Any:
        h = x + self.attn.forward_point(self.norm1.forward_point(x), kv_cache=kv_cache, causal=causal)
        return h + self.ffn.forward_point(self.norm2.forward_point(h))

    def forward(
        self,
        x: ZonotopeTensor,
        config: DynamicMConfig,
        layer_index: int = 0,
        kv_cache: Optional[Tuple[Any, Any]] = None,
        causal: bool = True,
        active_m_cap: Optional[int] = None,
    ) -> Tuple[ZonotopeTensor, List[GeneratorLifecycleEvent]]:
        cap = config.m_cap if active_m_cap is None else min(active_m_cap, config.m_cap)
        attn_out = self.attn(self.norm1(x), kv_cache=kv_cache, causal=causal)
        h = x.add(attn_out)
        ffn_out, exp_events = self.ffn(self.norm2(h), layer_index=layer_index, expansion_tau=config.expansion_tau)
        y = h.add(ffn_out)
        contracted, con_events = contract_generators(
            y,
            prune_eps=config.prune_eps,
            collinear_cosine_threshold=config.collinear_cosine_threshold,
            m_cap=cap,
            layer_index=layer_index,
        )
        return contracted, exp_events + con_events


class DynamicMReasoningModel(Module):
    """End-to-end compact Dynamic-m Relational Zonotope Small LLM + Query Projection Head W_q."""

    def __init__(
        self,
        vocab_size: int = 512,
        hidden_dim: int = 64,
        num_layers: int = 2,
        num_heads: int = 4,
        lora_rank: int = 8,
        lora_alpha: float = 16.0,
        retriever_dim: int = 64,
        config: Optional[DynamicMConfig] = None,
        seed: int = 2026,
    ) -> None:
        super().__init__()
        self.vocab_size = vocab_size
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.num_heads = num_heads
        self.lora_rank = lora_rank
        self.lora_alpha = lora_alpha
        self.retriever_dim = retriever_dim
        self.config = config or DynamicMConfig()

        self.embedder = RelationalZonotopeEmbedder(vocab_size, hidden_dim, num_rel_types=8, seed=seed)
        self.blocks = ModuleList(
            [
                DynamicMTransformerBlock(
                    hidden_dim=hidden_dim,
                    num_heads=num_heads,
                    intermediate_dim=hidden_dim * 2,
                    lora_rank=lora_rank,
                    lora_alpha=lora_alpha,
                    expansion_tau=self.config.expansion_tau,
                    seed=seed + (idx + 1) * 100,
                )
                for idx in range(num_layers)
            ]
        )
        self.final_norm = DynamicMRMSNorm(hidden_dim)
        self.lm_head = DynamicMLoraLinear(hidden_dim, vocab_size, rank=lora_rank, alpha=lora_alpha, bias=True, seed=seed + 999)
        self.projection_layer_index = num_layers // 2
        self.projection_head = QueryProjectionHead(hidden_dim, retriever_dim=retriever_dim, seed=seed + 1337)

    def forward(
        self,
        token_ids: Any,
        group_ids: Any,
        rel_type_ids: Any,
        rel_signs: Any,
        active_m_cap: Optional[int] = None,
        kv_cache: Optional[Tuple[Any, Any]] = None,
        causal: bool = True,
    ) -> Dict[str, Any]:
        cap = self.config.m_cap if active_m_cap is None else min(active_m_cap, self.config.m_cap)
        z = self.embedder(token_ids, group_ids, rel_type_ids, rel_signs, max_m=cap)
        all_events: List[GeneratorLifecycleEvent] = []
        mid_hidden = z.center

        for idx, block in enumerate(self.blocks):
            layer_kv = kv_cache if idx == 0 else None
            z, evs = block(z, self.config, layer_index=idx, kv_cache=layer_kv, causal=causal, active_m_cap=cap)
            all_events.extend(evs)
            if idx == self.projection_layer_index:
                mid_hidden = z.center

        z_norm = self.final_norm(z)
        logits = self.lm_head(z_norm)
        return {
            "logits": logits,
            "mid_hidden": mid_hidden,
            "events": all_events,
        }
