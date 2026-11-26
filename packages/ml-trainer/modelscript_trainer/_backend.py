# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Unified tensor + autograd backend for `modelscript_trainer`.

- Uses native PyTorch (`torch`, `torch.nn.Module`, `torch.autograd`) and optional Triton
  fused GPU kernels whenever PyTorch is installed.
- Falls back transparently to a lightweight, exact reverse-mode NumPy autograd engine when
  running in headless/CPU-only containers without PyTorch installed.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple, Union
import math
import numpy as np

try:
    import torch
    import torch.nn as _torch_nn
    import torch.nn.functional as _torch_F

    HAS_TORCH = True
except ImportError:
    torch = None  # type: ignore[assignment]
    _torch_nn = None  # type: ignore[assignment]
    _torch_F = None  # type: ignore[assignment]
    HAS_TORCH = False

try:
    import triton
    import triton.language as tl

    HAS_TRITON = HAS_TORCH
except ImportError:
    triton = None  # type: ignore[assignment]
    tl = None  # type: ignore[assignment]
    HAS_TRITON = False


# ─────────────────────────────────────────────────────────────────────────────
# Optional Triton Fused GPU Kernel (used on CUDA when torch + triton installed)
# ─────────────────────────────────────────────────────────────────────────────

if HAS_TRITON:

    @triton.jit
    def _triton_zonotope_affine_kernel(
        x_ptr,
        w_ptr,
        b_ptr,
        out_ptr,
        M_ROWS,
        N_OUT,
        K_IN,
        stride_xm,
        stride_xk,
        stride_wn,
        stride_wk,
        stride_om,
        stride_on,
        ADD_BIAS: tl.constexpr,
        BLOCK_M: tl.constexpr,
        BLOCK_N: tl.constexpr,
        BLOCK_K: tl.constexpr,
    ):
        pid_m = tl.program_id(axis=0)
        pid_n = tl.program_id(axis=1)
        offs_m = pid_m * BLOCK_M + tl.arange(0, BLOCK_M)
        offs_n = pid_n * BLOCK_N + tl.arange(0, BLOCK_N)
        offs_k = tl.arange(0, BLOCK_K)

        acc = tl.zeros((BLOCK_M, BLOCK_N), dtype=tl.float32)
        for k_start in range(0, K_IN, BLOCK_K):
            k_idx = k_start + offs_k
            x_mask = (offs_m[:, None] < M_ROWS) & (k_idx[None, :] < K_IN)
            w_mask = (offs_n[:, None] < N_OUT) & (k_idx[None, :] < K_IN)
            x_tile = tl.load(x_ptr + offs_m[:, None] * stride_xm + k_idx[None, :] * stride_xk, mask=x_mask, other=0.0)
            w_tile = tl.load(w_ptr + offs_n[:, None] * stride_wn + k_idx[None, :] * stride_wk, mask=w_mask, other=0.0)
            acc += tl.dot(x_tile, tl.trans(w_tile))

        if ADD_BIAS:
            b_vals = tl.load(b_ptr + offs_n, mask=offs_n < N_OUT, other=0.0)
            acc += b_vals[None, :]

        out_mask = (offs_m[:, None] < M_ROWS) & (offs_n[None, :] < N_OUT)
        tl.store(out_ptr + offs_m[:, None] * stride_om + offs_n[None, :] * stride_on, acc, mask=out_mask)


def triton_affine_forward(x: Any, weight: Any, bias: Optional[Any] = None) -> Optional[Any]:
    """
    Runs the optional fused Triton affine kernel on CUDA float32 tensors when no autograd graph
    is needed (e.g., inference or frozen forward), returning None to fall back to PyTorch matmul.
    """
    if not HAS_TRITON or not HAS_TORCH:
        return None
    if not (isinstance(x, torch.Tensor) and x.is_cuda and x.dtype == torch.float32):
        return None
    if x.requires_grad or weight.requires_grad or (bias is not None and bias.requires_grad):
        return None
    orig_shape = x.shape[:-1]
    k_in = x.shape[-1]
    n_out = weight.shape[0]
    x_2d = x.contiguous().view(-1, k_in)
    w_2d = weight.contiguous()
    m_rows = x_2d.shape[0]
    out = torch.empty((m_rows, n_out), device=x.device, dtype=torch.float32)
    b_ptr = bias.contiguous() if bias is not None else weight
    grid = (triton.cdiv(m_rows, 32), triton.cdiv(n_out, 32))
    _triton_zonotope_affine_kernel[grid](
        x_2d,
        w_2d,
        b_ptr,
        out,
        m_rows,
        n_out,
        k_in,
        x_2d.stride(0),
        x_2d.stride(1),
        w_2d.stride(0),
        w_2d.stride(1),
        out.stride(0),
        out.stride(1),
        ADD_BIAS=bias is not None,
        BLOCK_M=32,
        BLOCK_N=32,
        BLOCK_K=32,
    )
    return out.view(*orig_shape, n_out)


# ─────────────────────────────────────────────────────────────────────────────
# Pure-NumPy Reverse-Mode Autograd Engine (used when PyTorch is absent)
# ─────────────────────────────────────────────────────────────────────────────

_GRAD_ENABLED = True


def _unbroadcast(grad: np.ndarray, target_shape: Tuple[int, ...]) -> np.ndarray:
    arr = np.asarray(grad, dtype=np.float64)
    if target_shape == ():
        return np.array(arr.sum(), dtype=np.float64)
    while arr.ndim > len(target_shape):
        arr = arr.sum(axis=0)
    for axis, dim in enumerate(target_shape):
        if dim == 1 and arr.shape[axis] != 1:
            arr = arr.sum(axis=axis, keepdims=True)
    return arr.reshape(target_shape)


def _normalize_axis(axis: Optional[Union[int, Tuple[int, ...]]], ndim: int) -> Optional[Tuple[int, ...]]:
    if axis is None:
        return None
    if isinstance(axis, int):
        return (axis % ndim,)
    return tuple(a % ndim for a in axis)


class NPTensor:
    """Lightweight reverse-mode autograd tensor backed by NumPy."""

    def __init__(
        self,
        data: Any,
        requires_grad: bool = False,
        _children: Tuple["NPTensor", ...] = (),
        _backward: Optional[Callable[[np.ndarray], None]] = None,
        dtype: Any = None,
    ) -> None:
        if isinstance(data, NPTensor):
            arr = np.array(data.data, dtype=dtype or data.data.dtype, copy=True)
        else:
            if dtype is None:
                arr = np.asarray(data)
                if np.issubdtype(arr.dtype, np.floating):
                    arr = arr.astype(np.float64, copy=False)
                elif not np.issubdtype(arr.dtype, np.integer) and arr.dtype != np.bool_:
                    arr = arr.astype(np.float64)
            else:
                arr = np.asarray(data, dtype=dtype)
        self.data: np.ndarray = arr
        self.requires_grad: bool = bool(requires_grad and _GRAD_ENABLED and np.issubdtype(arr.dtype, np.floating))
        self.grad: Optional[np.ndarray] = None
        self._children: Tuple[NPTensor, ...] = _children if self.requires_grad else ()
        self._backward_fn: Optional[Callable[[np.ndarray], None]] = _backward if self.requires_grad else None

    @property
    def shape(self) -> Tuple[int, ...]:
        return self.data.shape

    @property
    def ndim(self) -> int:
        return self.data.ndim

    @property
    def dtype(self) -> Any:
        return self.data.dtype

    @property
    def device(self) -> str:
        return "cpu"

    def numel(self) -> int:
        return int(self.data.size)

    def __len__(self) -> int:
        return len(self.data)

    def _acc_grad(self, g: np.ndarray) -> None:
        if not self.requires_grad:
            return
        g_cast = _unbroadcast(g, self.shape)
        if self.grad is None:
            self.grad = g_cast.copy()
        else:
            self.grad = self.grad + g_cast

    def backward(self, grad: Optional[Union["NPTensor", np.ndarray]] = None) -> None:
        if grad is None:
            if self.data.size != 1:
                raise RuntimeError("backward() requires a scalar tensor or explicit grad.")
            seed = np.ones_like(self.data, dtype=np.float64)
        elif isinstance(grad, NPTensor):
            seed = np.asarray(grad.data, dtype=np.float64)
        else:
            seed = np.asarray(grad, dtype=np.float64)

        topo: List[NPTensor] = []
        visited: set[int] = set()

        def build(node: NPTensor) -> None:
            nid = id(node)
            if nid in visited:
                return
            visited.add(nid)
            for child in node._children:
                build(child)
            topo.append(node)

        build(self)
        grads: Dict[int, np.ndarray] = {id(self): seed}

        for node in reversed(topo):
            g = grads.get(id(node))
            if g is None:
                continue
            if node._backward_fn is None:
                node._acc_grad(g)
            else:
                # Accumulate leaf/intermediate gradients
                if not node._children:
                    node._acc_grad(g)
                # Temporarily bind accumulator on children via wrapper
                old_grads = {id(c): c.grad for c in node._children}
                for c in node._children:
                    c.grad = None
                node._backward_fn(g)
                for c in node._children:
                    cid = id(c)
                    cg = c.grad
                    c.grad = old_grads[cid]
                    if cg is not None:
                        if cid in grads:
                            grads[cid] = grads[cid] + cg
                        else:
                            grads[cid] = cg

    def detach(self) -> "NPTensor":
        return NPTensor(self.data.copy(), requires_grad=False, dtype=self.data.dtype)

    def clone(self) -> "NPTensor":
        out = NPTensor(self.data.copy(), requires_grad=self.requires_grad, _children=(self,), dtype=self.data.dtype)
        if out.requires_grad:
            out._backward_fn = lambda g: self._acc_grad(g)
        return out

    def contiguous(self) -> "NPTensor":
        return self

    def numpy(self) -> np.ndarray:
        return self.data.copy()

    def item(self) -> float:
        return float(self.data.item())

    def tolist(self) -> Any:
        return self.data.tolist()

    def float(self) -> "NPTensor":
        return NPTensor(self.data.astype(np.float64), requires_grad=self.requires_grad, _children=(self,),
                        _backward=(lambda g: self._acc_grad(g)) if self.requires_grad else None)

    def reshape(self, *shape: Any) -> "NPTensor":
        if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
            target = tuple(shape[0])
        else:
            target = tuple(shape)
        orig_shape = self.shape
        out_data = self.data.reshape(target)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(
            out_data,
            requires_grad=req,
            _children=(self,),
            _backward=(lambda g: self._acc_grad(g.reshape(orig_shape))) if req else None,
            dtype=out_data.dtype,
        )

    def view(self, *shape: Any) -> "NPTensor":
        return self.reshape(*shape)

    def transpose(self, dim0: int, dim1: int) -> "NPTensor":
        axes = list(range(self.ndim))
        d0 = dim0 % self.ndim
        d1 = dim1 % self.ndim
        axes[d0], axes[d1] = axes[d1], axes[d0]
        return self.permute(*axes)

    def permute(self, *dims: Any) -> "NPTensor":
        if len(dims) == 1 and isinstance(dims[0], (tuple, list)):
            axes = tuple(dims[0])
        else:
            axes = tuple(dims)
        inv_axes = tuple(int(np.argsort(axes)[i]) for i in range(len(axes)))
        out_data = np.transpose(self.data, axes)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(
            out_data,
            requires_grad=req,
            _children=(self,),
            _backward=(lambda g: self._acc_grad(np.transpose(g, inv_axes))) if req else None,
            dtype=out_data.dtype,
        )

    def unsqueeze(self, dim: int) -> "NPTensor":
        axis = dim if dim >= 0 else self.ndim + 1 + dim
        out_data = np.expand_dims(self.data, axis=axis)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(
            out_data,
            requires_grad=req,
            _children=(self,),
            _backward=(lambda g: self._acc_grad(np.squeeze(g, axis=axis))) if req else None,
            dtype=out_data.dtype,
        )

    def squeeze(self, dim: Optional[int] = None) -> "NPTensor":
        orig_shape = self.shape
        out_data = np.squeeze(self.data, axis=dim) if dim is not None else np.squeeze(self.data)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(
            out_data,
            requires_grad=req,
            _children=(self,),
            _backward=(lambda g: self._acc_grad(g.reshape(orig_shape))) if req else None,
            dtype=out_data.dtype,
        )

    def __getitem__(self, idx: Any) -> "NPTensor":
        if isinstance(idx, NPTensor):
            np_idx = idx.data
        elif isinstance(idx, tuple):
            np_idx = tuple(i.data if isinstance(i, NPTensor) else i for i in idx)
        else:
            np_idx = idx
        out_data = self.data[np_idx]
        req = self.requires_grad and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            grad_full = np.zeros_like(self.data, dtype=np.float64)
            np.add.at(grad_full, np_idx, g)
            self._acc_grad(grad_full)

        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=_bwd if req else None, dtype=out_data.dtype)

    def _ensure(self, other: Any) -> "NPTensor":
        if isinstance(other, NPTensor):
            return other
        return NPTensor(other, requires_grad=False)

    def __neg__(self) -> "NPTensor":
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(-self.data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(-g)) if req else None)

    def __add__(self, other: Any) -> "NPTensor":
        o = self._ensure(other)
        req = (self.requires_grad or o.requires_grad) and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            if self.requires_grad:
                self._acc_grad(g)
            if o.requires_grad:
                o._acc_grad(g)

        return NPTensor(self.data + o.data, requires_grad=req, _children=(self, o), _backward=_bwd if req else None)

    def __radd__(self, other: Any) -> "NPTensor":
        return self._ensure(other).__add__(self)

    def __sub__(self, other: Any) -> "NPTensor":
        o = self._ensure(other)
        req = (self.requires_grad or o.requires_grad) and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            if self.requires_grad:
                self._acc_grad(g)
            if o.requires_grad:
                o._acc_grad(-g)

        return NPTensor(self.data - o.data, requires_grad=req, _children=(self, o), _backward=_bwd if req else None)

    def __rsub__(self, other: Any) -> "NPTensor":
        return self._ensure(other).__sub__(self)

    def __mul__(self, other: Any) -> "NPTensor":
        o = self._ensure(other)
        req = (self.requires_grad or o.requires_grad) and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            if self.requires_grad:
                self._acc_grad(g * o.data)
            if o.requires_grad:
                o._acc_grad(g * self.data)

        return NPTensor(self.data * o.data, requires_grad=req, _children=(self, o), _backward=_bwd if req else None)

    def __rmul__(self, other: Any) -> "NPTensor":
        return self._ensure(other).__mul__(self)

    def __truediv__(self, other: Any) -> "NPTensor":
        o = self._ensure(other)
        req = (self.requires_grad or o.requires_grad) and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            if self.requires_grad:
                self._acc_grad(g / o.data)
            if o.requires_grad:
                o._acc_grad(-g * self.data / (o.data * o.data))

        return NPTensor(self.data / o.data, requires_grad=req, _children=(self, o), _backward=_bwd if req else None)

    def __rtruediv__(self, other: Any) -> "NPTensor":
        return self._ensure(other).__truediv__(self)

    def __pow__(self, power: float) -> "NPTensor":
        req = self.requires_grad and _GRAD_ENABLED
        out_data = np.power(self.data, power)

        def _bwd(g: np.ndarray) -> None:
            self._acc_grad(g * power * np.power(self.data, power - 1.0))

        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=_bwd if req else None)

    def __matmul__(self, other: Any) -> "NPTensor":
        o = self._ensure(other)
        req = (self.requires_grad or o.requires_grad) and _GRAD_ENABLED
        a, b = self.data, o.data
        out_data = np.matmul(a, b)

        def _bwd(g: np.ndarray) -> None:
            if a.ndim == 1 and b.ndim == 1:
                if self.requires_grad:
                    self._acc_grad(g * b)
                if o.requires_grad:
                    o._acc_grad(g * a)
            elif b.ndim == 1:
                if self.requires_grad:
                    self._acc_grad(np.expand_dims(g, -1) * b)
                if o.requires_grad:
                    o._acc_grad(np.tensordot(g, a, axes=(list(range(g.ndim)), list(range(a.ndim - 1)))))
            elif a.ndim == 1:
                if self.requires_grad:
                    self._acc_grad(np.matmul(b, g))
                if o.requires_grad:
                    o._acc_grad(np.outer(a, g))
            else:
                if self.requires_grad:
                    self._acc_grad(np.matmul(g, np.swapaxes(b, -1, -2)))
                if o.requires_grad:
                    o._acc_grad(np.matmul(np.swapaxes(a, -1, -2), g))

        return NPTensor(out_data, requires_grad=req, _children=(self, o), _backward=_bwd if req else None)

    def sum(self, dim: Optional[Union[int, Tuple[int, ...]]] = None, keepdim: bool = False) -> "NPTensor":
        axes = _normalize_axis(dim, self.ndim)
        out_data = np.sum(self.data, axis=axes, keepdims=keepdim)
        req = self.requires_grad and _GRAD_ENABLED

        def _bwd(g: np.ndarray) -> None:
            if axes is not None and not keepdim:
                g_exp = g
                for ax in sorted(axes):
                    g_exp = np.expand_dims(g_exp, axis=ax)
            else:
                g_exp = g
            self._acc_grad(np.broadcast_to(g_exp, self.shape))

        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=_bwd if req else None)

    def mean(self, dim: Optional[Union[int, Tuple[int, ...]]] = None, keepdim: bool = False) -> "NPTensor":
        axes = _normalize_axis(dim, self.ndim)
        if axes is None:
            count = self.data.size
        else:
            count = 1
            for ax in axes:
                count *= self.shape[ax]
        return self.sum(dim=dim, keepdim=keepdim) / float(max(1, count))

    def abs(self) -> "NPTensor":
        out_data = np.abs(self.data)
        req = self.requires_grad and _GRAD_ENABLED
        sgn = np.sign(self.data)
        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(g * sgn)) if req else None)

    def sqrt(self) -> "NPTensor":
        out_data = np.sqrt(np.maximum(self.data, 0.0))
        req = self.requires_grad and _GRAD_ENABLED
        denom = 2.0 * np.maximum(out_data, 1e-12)
        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(g / denom)) if req else None)

    def exp(self) -> "NPTensor":
        out_data = np.exp(self.data)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(g * out_data)) if req else None)

    def log(self) -> "NPTensor":
        safe = np.maximum(self.data, 1e-12)
        out_data = np.log(safe)
        req = self.requires_grad and _GRAD_ENABLED
        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(g / safe)) if req else None)

    def clamp(self, min: Optional[float] = None, max: Optional[float] = None) -> "NPTensor":
        out_data = np.clip(self.data, min, max)
        req = self.requires_grad and _GRAD_ENABLED
        mask = np.ones_like(self.data, dtype=np.float64)
        if min is not None:
            mask = mask * (self.data >= min)
        if max is not None:
            mask = mask * (self.data <= max)
        return NPTensor(out_data, requires_grad=req, _children=(self,), _backward=(lambda g: self._acc_grad(g * mask)) if req else None)

    def __repr__(self) -> str:
        return f"NPTensor(shape={self.shape}, requires_grad={self.requires_grad})"


class NPParameter(NPTensor):
    """Trainable or frozen parameter tensor in the NumPy fallback backend."""

    def __init__(self, data: Any, requires_grad: bool = True) -> None:
        arr = data.data if isinstance(data, NPTensor) else np.asarray(data, dtype=np.float64)
        super().__init__(arr.copy(), requires_grad=requires_grad, dtype=np.float64)


class NPModule:
    """Minimal torch.nn.Module-compatible base class for the NumPy fallback backend."""

    def __init__(self) -> None:
        self._parameters: Dict[str, NPParameter] = {}
        self._modules: Dict[str, NPModule] = {}
        self.training: bool = True

    def __setattr__(self, name: str, value: Any) -> None:
        if name in ("_parameters", "_modules", "training"):
            object.__setattr__(self, name, value)
            return
        params = self.__dict__.get("_parameters")
        mods = self.__dict__.get("_modules")
        if isinstance(value, NPParameter) and params is not None:
            params[name] = value
        elif isinstance(value, NPModule) and mods is not None:
            mods[name] = value
        object.__setattr__(self, name, value)

    def named_parameters(self, prefix: str = "") -> Iterator[Tuple[str, NPParameter]]:
        for name, param in self._parameters.items():
            full = f"{prefix}.{name}" if prefix else name
            yield full, param
        for name, mod in self._modules.items():
            sub_prefix = f"{prefix}.{name}" if prefix else name
            yield from mod.named_parameters(sub_prefix)

    def parameters(self) -> Iterator[NPParameter]:
        for _, p in self.named_parameters():
            yield p

    def state_dict(self) -> Dict[str, np.ndarray]:
        return {name: p.data.copy() for name, p in self.named_parameters()}

    def load_state_dict(self, state: Dict[str, Any]) -> None:
        for name, p in self.named_parameters():
            if name in state:
                val = state[name]
                p.data = np.asarray(val.data if isinstance(val, NPTensor) else val, dtype=np.float64).copy()

    def zero_grad(self) -> None:
        for p in self.parameters():
            p.grad = None

    def train(self, mode: bool = True) -> "NPModule":
        self.training = mode
        for m in self._modules.values():
            m.train(mode)
        return self

    def eval(self) -> "NPModule":
        return self.train(False)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.forward(*args, **kwargs)  # type: ignore[attr-defined]


class NPModuleList(NPModule):
    """Minimal torch.nn.ModuleList-compatible container."""

    def __init__(self, modules: Iterable[NPModule] = ()) -> None:
        super().__init__()
        self._items: List[NPModule] = []
        for idx, m in enumerate(modules):
            self.append(m)

    def append(self, mod: NPModule) -> None:
        idx = len(self._items)
        self._items.append(mod)
        self._modules[str(idx)] = mod

    def __iter__(self) -> Iterator[NPModule]:
        return iter(self._items)

    def __len__(self) -> int:
        return len(self._items)

    def __getitem__(self, idx: int) -> NPModule:
        return self._items[idx]


class NPAdamW:
    """Standard AdamW optimizer for the NumPy fallback backend."""

    def __init__(
        self,
        params: Iterable[NPParameter],
        lr: float = 1e-3,
        betas: Tuple[float, float] = (0.9, 0.999),
        eps: float = 1e-8,
        weight_decay: float = 0.01,
    ) -> None:
        self.params = [p for p in params if p.requires_grad]
        self.lr = lr
        self.betas = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.step_count = 0
        self.m = [np.zeros_like(p.data) for p in self.params]
        self.v = [np.zeros_like(p.data) for p in self.params]

    def zero_grad(self) -> None:
        for p in self.params:
            p.grad = None

    def step(self) -> None:
        self.step_count += 1
        b1, b2 = self.betas
        bc1 = 1.0 - (b1 ** self.step_count)
        bc2 = 1.0 - (b2 ** self.step_count)
        for i, p in enumerate(self.params):
            if p.grad is None:
                continue
            g = p.grad
            if self.weight_decay != 0.0:
                p.data = p.data * (1.0 - self.lr * self.weight_decay)
            self.m[i] = b1 * self.m[i] + (1.0 - b1) * g
            self.v[i] = b2 * self.v[i] + (1.0 - b2) * (g * g)
            m_hat = self.m[i] / bc1
            v_hat = self.v[i] / bc2
            p.data = p.data - self.lr * m_hat / (np.sqrt(v_hat) + self.eps)


# ─────────────────────────────────────────────────────────────────────────────
# Public Unified Backend Exports
# ─────────────────────────────────────────────────────────────────────────────

if HAS_TORCH:
    Tensor = torch.Tensor
    Parameter = _torch_nn.Parameter
    Module = _torch_nn.Module
    ModuleList = _torch_nn.ModuleList
    AdamW = torch.optim.AdamW
else:
    Tensor = NPTensor  # type: ignore[misc]
    Parameter = NPParameter  # type: ignore[misc]
    Module = NPModule  # type: ignore[misc]
    ModuleList = NPModuleList  # type: ignore[misc]
    AdamW = NPAdamW  # type: ignore[misc]


@contextmanager
def no_grad() -> Iterator[None]:
    if HAS_TORCH:
        with torch.no_grad():
            yield
    else:
        global _GRAD_ENABLED
        prev = _GRAD_ENABLED
        _GRAD_ENABLED = False
        try:
            yield
        finally:
            _GRAD_ENABLED = prev


def manual_seed(seed: int) -> None:
    np.random.seed(seed)
    if HAS_TORCH:
        torch.manual_seed(seed)


def as_tensor(x: Any, requires_grad: bool = False, dtype: Optional[str] = None) -> Any:
    if HAS_TORCH:
        if isinstance(x, torch.Tensor):
            t = x.clone().detach()
        else:
            t = torch.as_tensor(x)
        if dtype == "float":
            t = t.to(torch.float32)
        elif dtype == "long":
            t = t.to(torch.long)
        elif dtype is None and t.is_floating_point():
            t = t.to(torch.float32)
        if requires_grad:
            t.requires_grad_(True)
        return t
    np_dtype = np.float64 if dtype == "float" else (np.int64 if dtype == "long" else None)
    return NPTensor(x, requires_grad=requires_grad, dtype=np_dtype)


def zeros(shape: Tuple[int, ...], requires_grad: bool = False, like: Optional[Any] = None) -> Any:
    if HAS_TORCH:
        device = like.device if isinstance(like, torch.Tensor) else None
        dtype = like.dtype if isinstance(like, torch.Tensor) and like.is_floating_point() else torch.float32
        return torch.zeros(shape, dtype=dtype, device=device, requires_grad=requires_grad)
    return NPTensor(np.zeros(shape, dtype=np.float64), requires_grad=requires_grad, dtype=np.float64)


def ones(shape: Tuple[int, ...], requires_grad: bool = False, like: Optional[Any] = None) -> Any:
    if HAS_TORCH:
        device = like.device if isinstance(like, torch.Tensor) else None
        dtype = like.dtype if isinstance(like, torch.Tensor) and like.is_floating_point() else torch.float32
        return torch.ones(shape, dtype=dtype, device=device, requires_grad=requires_grad)
    return NPTensor(np.ones(shape, dtype=np.float64), requires_grad=requires_grad, dtype=np.float64)


def randn_init(shape: Tuple[int, ...], scale: float, rng: np.random.Generator) -> Any:
    arr = rng.normal(0.0, scale, size=shape).astype(np.float64)
    if HAS_TORCH:
        return torch.tensor(arr, dtype=torch.float32)
    return NPTensor(arr, requires_grad=False, dtype=np.float64)


def to_numpy(x: Any) -> np.ndarray:
    if HAS_TORCH and isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    if isinstance(x, NPTensor):
        return x.data.copy()
    return np.asarray(x)


def cat(tensors: Sequence[Any], dim: int = 0) -> Any:
    if HAS_TORCH:
        return torch.cat(list(tensors), dim=dim)
    arrs = [t.data for t in tensors]
    out_data = np.concatenate(arrs, axis=dim)
    req = any(t.requires_grad for t in tensors) and _GRAD_ENABLED
    sizes = [t.shape[dim] for t in tensors]
    axis = dim % out_data.ndim

    def _bwd(g: np.ndarray) -> None:
        splits = np.cumsum(sizes[:-1])
        parts = np.split(g, splits, axis=axis)
        for t, part in zip(tensors, parts):
            if t.requires_grad:
                t._acc_grad(part)

    return NPTensor(out_data, requires_grad=req, _children=tuple(tensors), _backward=_bwd if req else None)


def stack(tensors: Sequence[Any], dim: int = 0) -> Any:
    if HAS_TORCH:
        return torch.stack(list(tensors), dim=dim)
    return cat([t.unsqueeze(dim) for t in tensors], dim=dim)


def maximum(a: Any, b: Any) -> Any:
    if HAS_TORCH:
        if not isinstance(b, torch.Tensor):
            b = torch.as_tensor(b, dtype=a.dtype, device=a.device)
        return torch.maximum(a, b)
    ta = a if isinstance(a, NPTensor) else NPTensor(a)
    tb = b if isinstance(b, NPTensor) else NPTensor(b)
    out_data = np.maximum(ta.data, tb.data)
    req = (ta.requires_grad or tb.requires_grad) and _GRAD_ENABLED
    a_ge = (ta.data >= tb.data).astype(np.float64)

    def _bwd(g: np.ndarray) -> None:
        if ta.requires_grad:
            ta._acc_grad(g * a_ge)
        if tb.requires_grad:
            tb._acc_grad(g * (1.0 - a_ge))

    return NPTensor(out_data, requires_grad=req, _children=(ta, tb), _backward=_bwd if req else None)


def minimum(a: Any, b: Any) -> Any:
    if HAS_TORCH:
        if not isinstance(b, torch.Tensor):
            b = torch.as_tensor(b, dtype=a.dtype, device=a.device)
        return torch.minimum(a, b)
    ta = a if isinstance(a, NPTensor) else NPTensor(a)
    tb = b if isinstance(b, NPTensor) else NPTensor(b)
    out_data = np.minimum(ta.data, tb.data)
    req = (ta.requires_grad or tb.requires_grad) and _GRAD_ENABLED
    a_le = (ta.data <= tb.data).astype(np.float64)

    def _bwd(g: np.ndarray) -> None:
        if ta.requires_grad:
            ta._acc_grad(g * a_le)
        if tb.requires_grad:
            tb._acc_grad(g * (1.0 - a_le))

    return NPTensor(out_data, requires_grad=req, _children=(ta, tb), _backward=_bwd if req else None)


def where(cond: Any, a: Any, b: Any) -> Any:
    if HAS_TORCH:
        if not isinstance(cond, torch.Tensor):
            cond = torch.as_tensor(cond, dtype=torch.bool, device=a.device)
        if not isinstance(b, torch.Tensor):
            b = torch.as_tensor(b, dtype=a.dtype, device=a.device)
        return torch.where(cond, a, b)
    c_arr = cond.data.astype(bool) if isinstance(cond, NPTensor) else np.asarray(cond, dtype=bool)
    ta = a if isinstance(a, NPTensor) else NPTensor(a)
    tb = b if isinstance(b, NPTensor) else NPTensor(b)
    out_data = np.where(c_arr, ta.data, tb.data)
    req = (ta.requires_grad or tb.requires_grad) and _GRAD_ENABLED
    mask = c_arr.astype(np.float64)

    def _bwd(g: np.ndarray) -> None:
        if ta.requires_grad:
            ta._acc_grad(g * mask)
        if tb.requires_grad:
            tb._acc_grad(g * (1.0 - mask))

    return NPTensor(out_data, requires_grad=req, _children=(ta, tb), _backward=_bwd if req else None)


def abs_t(x: Any) -> Any:
    return torch.abs(x) if HAS_TORCH else x.abs()


def sqrt_t(x: Any) -> Any:
    return torch.sqrt(x.clamp(min=0.0)) if HAS_TORCH else x.sqrt()


def exp_t(x: Any) -> Any:
    return torch.exp(x) if HAS_TORCH else x.exp()


def log_t(x: Any) -> Any:
    return torch.log(x.clamp(min=1e-12)) if HAS_TORCH else x.log()


def sigmoid_t(x: Any) -> Any:
    if HAS_TORCH:
        return torch.sigmoid(x)
    # Numerically stable sigmoid
    z = np.clip(x.data, -60.0, 60.0)
    sig = 1.0 / (1.0 + np.exp(-z))
    req = x.requires_grad and _GRAD_ENABLED
    return NPTensor(sig, requires_grad=req, _children=(x,), _backward=(lambda g: x._acc_grad(g * sig * (1.0 - sig))) if req else None)


def silu_t(x: Any) -> Any:
    if HAS_TORCH:
        return _torch_F.silu(x)
    return x * sigmoid_t(x)


def softmax_t(x: Any, dim: int = -1) -> Any:
    if HAS_TORCH:
        return _torch_F.softmax(x, dim=dim)
    axis = dim % x.ndim
    m = np.max(x.data, axis=axis, keepdims=True)
    # Handle all -inf masked rows safely
    m_safe = np.where(np.isfinite(m), m, 0.0)
    shifted = x.data - m_safe
    ex = np.where(np.isfinite(x.data), np.exp(np.clip(shifted, -80.0, 80.0)), 0.0)
    denom = np.maximum(np.sum(ex, axis=axis, keepdims=True), 1e-12)
    probs = ex / denom
    req = x.requires_grad and _GRAD_ENABLED

    def _bwd(g: np.ndarray) -> None:
        dot = np.sum(g * probs, axis=axis, keepdims=True)
        x._acc_grad(probs * (g - dot))

    return NPTensor(probs, requires_grad=req, _children=(x,), _backward=_bwd if req else None)


def log_softmax_t(x: Any, dim: int = -1) -> Any:
    if HAS_TORCH:
        return _torch_F.log_softmax(x, dim=dim)
    axis = dim % x.ndim
    m = np.max(x.data, axis=axis, keepdims=True)
    shifted = x.data - m
    ex = np.exp(np.clip(shifted, -80.0, 80.0))
    sum_ex = np.sum(ex, axis=axis, keepdims=True)
    lse = np.log(np.maximum(sum_ex, 1e-12))
    out = shifted - lse
    probs = ex / np.maximum(sum_ex, 1e-12)
    req = x.requires_grad and _GRAD_ENABLED

    def _bwd(g: np.ndarray) -> None:
        g_sum = np.sum(g, axis=axis, keepdims=True)
        x._acc_grad(g - probs * g_sum)

    return NPTensor(out, requires_grad=req, _children=(x,), _backward=_bwd if req else None)


def l2_normalize(x: Any, dim: int = -1, eps: float = 1e-12) -> Any:
    if HAS_TORCH:
        return _torch_F.normalize(x, p=2, dim=dim, eps=eps)
    t = x if isinstance(x, NPTensor) else as_tensor(x)
    norm = sqrt_t((t * t).sum(dim=dim, keepdim=True) + eps)
    return t / norm


def gather_embedding(weight: Any, indices: Any) -> Any:
    """Differentiable embedding lookup weight[indices] supporting PyTorch and NumPy autograd."""
    if HAS_TORCH:
        idx_t = indices if isinstance(indices, torch.Tensor) else torch.as_tensor(indices, dtype=torch.long, device=weight.device)
        return _torch_F.embedding(idx_t, weight)
    idx_arr = np.asarray(indices.data if isinstance(indices, NPTensor) else indices, dtype=np.int64)
    out_data = weight.data[idx_arr]
    req = weight.requires_grad and _GRAD_ENABLED

    def _bwd(g: np.ndarray) -> None:
        grad_w = np.zeros_like(weight.data, dtype=np.float64)
        np.add.at(grad_w, idx_arr, g)
        weight._acc_grad(grad_w)

    return NPTensor(out_data, requires_grad=req, _children=(weight,), _backward=_bwd if req else None)


def max_val(x: Any, dim: int, keepdim: bool = False) -> Any:
    if HAS_TORCH:
        return torch.max(x, dim=dim, keepdim=keepdim).values
    axis = dim % x.ndim
    out_data = np.max(x.data, axis=axis, keepdims=keepdim)
    req = x.requires_grad and _GRAD_ENABLED
    mask = (x.data == np.max(x.data, axis=axis, keepdims=True)).astype(np.float64)
    mask = mask / np.maximum(np.sum(mask, axis=axis, keepdims=True), 1.0)

    def _bwd(g: np.ndarray) -> None:
        g_exp = g if keepdim else np.expand_dims(g, axis=axis)
        x._acc_grad(g_exp * mask)

    return NPTensor(out_data, requires_grad=req, _children=(x,), _backward=_bwd if req else None)


def scalar_max(x: Any) -> float:
    arr = to_numpy(x)
    return float(np.max(arr)) if arr.size > 0 else 0.0
