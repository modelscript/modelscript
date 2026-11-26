// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Differentiable Variable-Sized (Dynamic-m) Relational Zonotope Engine.
 *
 * Implements the full set-based forward + analytical VJP backward pipeline for compact
 * engineering reasoning LLMs (0.5B–1.5B LoRA + Linear Query Projection Head W_q):
 *
 *   1. `RelationalZonotopeEmbedder` : Maps 4 aligned hypergraph columns (`tokenIds`, `groupIds`,
 *      `relTypeIds`, `relSigns`) into an elastic `ZonotopeTensor` (c: [L, D], G: [m, L, D]).
 *   2. `DynamicMLoraLinearLayer`    : Wrapping-free affine propagation through frozen W_0 + trainable
 *      low-rank LoRA adapters (B·A) with analytical VJP gradients.
 *   3. `dynamicMNonLinearForward`   : Sound Chebyshev/secant linear relaxation for GELU/SiLU with
 *      threshold-triggered selective generator expansion (`gap > expansionTau` -> `m -> m + 1`).
 *   4. `contractZonotopeGenerators` : Vanishing-norm pruning (`||g_k|| < pruneEps`), collinear
 *      merging (`|cos| > threshold`), and Girard/norm-sorted `mCap` reduction with per-layer
 *      mechanistic interpretability telemetry.
 *   5. `worstCaseLogitLoss`         : Sound worst-case cross-entropy over the output logit zonotope
 *      enclosure + anti-collapse geometry regularization + exact spread metric Δ_t.
 *   6. `QueryProjectionHead`        : Contrastive InfoNCE alignment of `q = Normalize(W_q h_t + b_q)`
 *      into the external DiskANN retriever embedding space.
 *   7. `SmallLlmZonotopeRuntime`    : End-to-end Dynamic-m reasoning core with the m = 0 <-> 32
 *      Test-Time Compute Dial and Δ_t > τ DiskANN retrieval trigger.
 */

import {
  DEFAULT_DYNAMIC_M_CONFIG,
  type DynamicMConfig,
  type MemoryChunkResult,
  type RelationalHypergraphRecord,
} from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Core Data-Oriented Elastic Zonotope Tensor
// ─────────────────────────────────────────────────────────────────────────────

export interface ZonotopeTensor {
  /** Sequence length L. */
  seqLen: number;
  /** Hidden dimension D. */
  dim: number;
  /** Active elastic generator count m (0 <= m <= mCap). */
  m: number;
  /** Contiguous center matrix [L, D] (length = L * D). */
  center: Float64Array;
  /** Contiguous generator tensor [m, L, D] (length = m * L * D). */
  generators: Float64Array;
  /** Semantic owner per generator slice: >0 = hypergraph `group_id` (ε_k), -1 = nonlinear/Girard slack. */
  groupIds: Int32Array;
}

export interface GeneratorLifecycleEvent {
  layerIndex: number;
  kind: "expanded-nonlinear" | "pruned-vanishing" | "merged-collinear" | "girard-capped";
  mBefore: number;
  mAfter: number;
  groupIds: number[];
  metric: number;
  detail: string;
}

export interface LayerTelemetrySnapshot {
  layerIndex: number;
  layerName: string;
  mIn: number;
  mOut: number;
  maxGeneratorNorm: number;
  meanBoxHalfWidth: number;
  events: GeneratorLifecycleEvent[];
}

/** Deterministic PRNG (Mulberry32) for reproducible weight initialization. */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initMatrix(rows: number, cols: number, scale: number, rng: () => number): Float64Array {
  const out = new Float64Array(rows * cols);
  for (let i = 0; i < out.length; i++) {
    out[i] = (rng() * 2 - 1) * scale;
  }
  return out;
}

/**
 * Evaluates a concrete perturbed point `x(ξ) = center + Σ_k ξ_k * G[k]` for `ξ_k ∈ [-1, 1]`.
 * Used for formal soundness tests verifying that every sampled input point stays enclosed by the output zonotope.
 */
export function evaluateZonotopePoint(z: ZonotopeTensor, xi: Float64Array | number[]): Float64Array {
  const ld = z.seqLen * z.dim;
  const out = new Float64Array(z.center);
  for (let k = 0; k < z.m; k++) {
    const xk = xi[k] ?? 0;
    if (xk === 0) continue;
    const base = k * ld;
    for (let idx = 0; idx < ld; idx++) {
      out[idx] = out[idx]! + xk * z.generators[base + idx]!;
    }
  }
  return out;
}

/**
 * Computes exact per-element interval enclosure `[lo, hi]` and half-width `radius` for a ZonotopeTensor:
 *   `radius[idx] = Σ_{k=0}^{m-1} |G[k, idx]|`
 */
export function computeZonotopeBounds(z: ZonotopeTensor): {
  lo: Float64Array;
  hi: Float64Array;
  radius: Float64Array;
} {
  const ld = z.seqLen * z.dim;
  const radius = new Float64Array(ld);
  for (let k = 0; k < z.m; k++) {
    const base = k * ld;
    for (let idx = 0; idx < ld; idx++) {
      radius[idx] = radius[idx]! + Math.abs(z.generators[base + idx]!);
    }
  }
  const lo = new Float64Array(ld);
  const hi = new Float64Array(ld);
  for (let idx = 0; idx < ld; idx++) {
    lo[idx] = z.center[idx]! - radius[idx]!;
    hi[idx] = z.center[idx]! + radius[idx]!;
  }
  return { lo, hi, radius };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. RelationalZonotopeEmbedder (4 Columns -> Initial Elastic Zonotope)
// ─────────────────────────────────────────────────────────────────────────────

export class RelationalZonotopeEmbedder {
  public readonly vocabSize: number;
  public readonly numRelTypes: number;
  public readonly dim: number;
  public readonly tokenEmb: Float64Array; // [vocabSize, dim]
  public readonly relEmb: Float64Array; // [numRelTypes, dim]
  public readonly perturbationScale: Float64Array; // [dim]

  constructor(vocabSize: number, dim: number, numRelTypes = 8, seed = 42, initRadius = 0.08) {
    this.vocabSize = vocabSize;
    this.numRelTypes = numRelTypes;
    this.dim = dim;
    const rng = createSeededRng(seed);
    this.tokenEmb = initMatrix(vocabSize, dim, 1 / Math.sqrt(dim), rng);
    this.relEmb = initMatrix(numRelTypes, dim, initRadius, rng);
    this.perturbationScale = new Float64Array(dim).fill(1.0);
  }

  /**
   * Maps a 4-column `RelationalHypergraphRecord` into an initial `ZonotopeTensor`.
   * Pass `maxM = 0` for fast point-wise inference (Test-Time Compute Dial m = 0).
   */
  public forward(record: RelationalHypergraphRecord, maxM = 32): ZonotopeTensor {
    const L = record.tokenIds.length;
    const D = this.dim;
    const center = new Float64Array(L * D);

    for (let t = 0; t < L; t++) {
      const tid = Math.abs(record.tokenIds[t]!) % this.vocabSize;
      const srcBase = tid * D;
      const dstBase = t * D;
      for (let d = 0; d < D; d++) {
        center[dstBase + d] = this.tokenEmb[srcBase + d]!;
      }
    }

    if (maxM <= 0 || record.mInit === 0) {
      return {
        seqLen: L,
        dim: D,
        m: 0,
        center,
        generators: new Float64Array(0),
        groupIds: new Int32Array(0),
      };
    }

    // Map unique active non-zero groupIds to contiguous slice indices 0..m-1
    const activeGroups: number[] = [];
    const groupToSlice = new Map<number, number>();
    for (let t = 0; t < L; t++) {
      const gid = record.groupIds[t]!;
      if (gid > 0 && !groupToSlice.has(gid) && activeGroups.length < maxM) {
        groupToSlice.set(gid, activeGroups.length);
        activeGroups.push(gid);
      }
    }

    const m = activeGroups.length;
    const generators = new Float64Array(m * L * D);
    const groupIds = Int32Array.from(activeGroups);

    for (let t = 0; t < L; t++) {
      const gid = record.groupIds[t]!;
      if (gid <= 0) continue; // group_id = 0 locks syntax/keywords strictly
      const slice = groupToSlice.get(gid);
      if (slice === undefined) continue;
      const sign = record.relSigns[t] ?? 1.0;
      if (sign === 0) continue;
      const relId = Math.abs(record.relTypeIds[t]!) % this.numRelTypes;
      const relBase = relId * D;
      const dstBase = slice * L * D + t * D;
      for (let d = 0; d < D; d++) {
        generators[dstBase + d] = sign * this.relEmb[relBase + d]! * this.perturbationScale[d]!;
      }
    }

    return { seqLen: L, dim: D, m, center, generators, groupIds };
  }

  /** Analytical VJP backward pass returning gradients for `tokenEmb`, `relEmb`, and `perturbationScale`. */
  public backward(
    record: RelationalHypergraphRecord,
    out: ZonotopeTensor,
    dCenter: Float64Array,
    dGenerators: Float64Array,
  ): { dTokenEmb: Float64Array; dRelEmb: Float64Array; dPerturbationScale: Float64Array } {
    const L = record.tokenIds.length;
    const D = this.dim;
    const dTokenEmb = new Float64Array(this.tokenEmb.length);
    const dRelEmb = new Float64Array(this.relEmb.length);
    const dPerturbationScale = new Float64Array(D);

    const groupToSlice = new Map<number, number>();
    for (let k = 0; k < out.m; k++) {
      groupToSlice.set(out.groupIds[k]!, k);
    }

    for (let t = 0; t < L; t++) {
      const tid = Math.abs(record.tokenIds[t]!) % this.vocabSize;
      const tokBase = tid * D;
      const cBase = t * D;
      for (let d = 0; d < D; d++) {
        dTokenEmb[tokBase + d] = dTokenEmb[tokBase + d]! + dCenter[cBase + d]!;
      }

      const gid = record.groupIds[t]!;
      const slice = groupToSlice.get(gid);
      if (gid <= 0 || slice === undefined) continue;
      const sign = record.relSigns[t] ?? 1.0;
      if (sign === 0) continue;
      const relId = Math.abs(record.relTypeIds[t]!) % this.numRelTypes;
      const relBase = relId * D;
      const gBase = slice * L * D + t * D;
      for (let d = 0; d < D; d++) {
        const dg = dGenerators[gBase + d]!;
        dRelEmb[relBase + d] = dRelEmb[relBase + d]! + dg * sign * this.perturbationScale[d]!;
        dPerturbationScale[d] = dPerturbationScale[d]! + dg * sign * this.relEmb[relBase + d]!;
      }
    }

    return { dTokenEmb, dRelEmb, dPerturbationScale };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DynamicMLoraLinearLayer (Frozen Base W_0 + Trainable LoRA B·A)
// ─────────────────────────────────────────────────────────────────────────────

export interface LoraLinearGradients {
  dInputCenter: Float64Array;
  dInputGenerators: Float64Array;
  dLoraA: Float64Array;
  dLoraB: Float64Array;
  dBias: Float64Array;
}

export class DynamicMLoraLinearLayer {
  public readonly inDim: number;
  public readonly outDim: number;
  public readonly rank: number;
  public readonly loraScale: number;
  /** Frozen base weights [outDim, inDim]. */
  public readonly baseWeight: Float64Array;
  /** Trainable bias [outDim]. */
  public readonly bias: Float64Array;
  /** Trainable LoRA down-projection A [rank, inDim]. */
  public readonly loraA: Float64Array;
  /** Trainable LoRA up-projection B [outDim, rank]. */
  public readonly loraB: Float64Array;

  constructor(inDim: number, outDim: number, rank = 4, alpha = 8, seed = 101) {
    this.inDim = inDim;
    this.outDim = outDim;
    this.rank = Math.max(1, Math.min(rank, Math.min(inDim, outDim)));
    this.loraScale = alpha / this.rank;
    const rng = createSeededRng(seed);
    this.baseWeight = initMatrix(outDim, inDim, 1 / Math.sqrt(inDim), rng);
    this.bias = new Float64Array(outDim);
    this.loraA = initMatrix(this.rank, inDim, 1 / Math.sqrt(inDim), rng);
    // Small non-zero init for B so initial LoRA gradients flow immediately in unit tests & warm-up
    this.loraB = initMatrix(outDim, this.rank, 0.02, rng);
  }

  /** Computes effective weight W_eff = W_0 + loraScale * (B @ A) of shape [outDim, inDim]. */
  public effectiveWeight(): Float64Array {
    const eff = new Float64Array(this.baseWeight);
    for (let o = 0; o < this.outDim; o++) {
      for (let r = 0; r < this.rank; r++) {
        const bVal = this.loraB[o * this.rank + r]! * this.loraScale;
        if (bVal === 0) continue;
        const aRow = r * this.inDim;
        const eRow = o * this.inDim;
        for (let i = 0; i < this.inDim; i++) {
          eff[eRow + i] = eff[eRow + i]! + bVal * this.loraA[aRow + i]!;
        }
      }
    }
    return eff;
  }

  /** Wrapping-free exact affine zonotope map: c' = c W_eff^T + b, G'[k] = G[k] W_eff^T. */
  public forward(x: ZonotopeTensor): ZonotopeTensor {
    const L = x.seqLen;
    const m = x.m;
    const eff = this.effectiveWeight();
    const outCenter = new Float64Array(L * this.outDim);
    const outGen = new Float64Array(m * L * this.outDim);

    for (let t = 0; t < L; t++) {
      const inBase = t * this.inDim;
      const outBase = t * this.outDim;
      for (let o = 0; o < this.outDim; o++) {
        let acc = this.bias[o]!;
        const wRow = o * this.inDim;
        for (let i = 0; i < this.inDim; i++) {
          acc += x.center[inBase + i]! * eff[wRow + i]!;
        }
        outCenter[outBase + o] = acc;
      }
    }

    for (let k = 0; k < m; k++) {
      const inSlice = k * L * this.inDim;
      const outSlice = k * L * this.outDim;
      for (let t = 0; t < L; t++) {
        const inBase = inSlice + t * this.inDim;
        const outBase = outSlice + t * this.outDim;
        for (let o = 0; o < this.outDim; o++) {
          let acc = 0;
          const wRow = o * this.inDim;
          for (let i = 0; i < this.inDim; i++) {
            acc += x.generators[inBase + i]! * eff[wRow + i]!;
          }
          outGen[outBase + o] = acc;
        }
      }
    }

    return {
      seqLen: L,
      dim: this.outDim,
      m,
      center: outCenter,
      generators: outGen,
      groupIds: new Int32Array(x.groupIds),
    };
  }

  /** Exact analytical VJP backward pass through both center c and all m generator slices G[k]. */
  public backward(x: ZonotopeTensor, dOutCenter: Float64Array, dOutGen: Float64Array): LoraLinearGradients {
    const L = x.seqLen;
    const m = x.m;
    const eff = this.effectiveWeight();
    const dInputCenter = new Float64Array(L * this.inDim);
    const dInputGenerators = new Float64Array(m * L * this.inDim);
    const dBias = new Float64Array(this.outDim);
    const dEff = new Float64Array(this.outDim * this.inDim);

    // Center contribution
    for (let t = 0; t < L; t++) {
      const inBase = t * this.inDim;
      const outBase = t * this.outDim;
      for (let o = 0; o < this.outDim; o++) {
        const dy = dOutCenter[outBase + o]!;
        dBias[o] = dBias[o]! + dy;
        const wRow = o * this.inDim;
        for (let i = 0; i < this.inDim; i++) {
          dInputCenter[inBase + i] = dInputCenter[inBase + i]! + dy * eff[wRow + i]!;
          dEff[wRow + i] = dEff[wRow + i]! + dy * x.center[inBase + i]!;
        }
      }
    }

    // Generator slices contribution (exact parallel backprop through G' = G W_eff^T)
    for (let k = 0; k < m; k++) {
      const inSlice = k * L * this.inDim;
      const outSlice = k * L * this.outDim;
      for (let t = 0; t < L; t++) {
        const inBase = inSlice + t * this.inDim;
        const outBase = outSlice + t * this.outDim;
        for (let o = 0; o < this.outDim; o++) {
          const dy = dOutGen[outBase + o]!;
          if (dy === 0) continue;
          const wRow = o * this.inDim;
          for (let i = 0; i < this.inDim; i++) {
            dInputGenerators[inBase + i] = dInputGenerators[inBase + i]! + dy * eff[wRow + i]!;
            dEff[wRow + i] = dEff[wRow + i]! + dy * x.generators[inBase + i]!;
          }
        }
      }
    }

    // Chain rule into LoRA B [outDim, rank] and A [rank, inDim] from dEff
    const dLoraB = new Float64Array(this.outDim * this.rank);
    const dLoraA = new Float64Array(this.rank * this.inDim);

    for (let o = 0; o < this.outDim; o++) {
      const eRow = o * this.inDim;
      for (let r = 0; r < this.rank; r++) {
        const aRow = r * this.inDim;
        let accB = 0;
        for (let i = 0; i < this.inDim; i++) {
          accB += dEff[eRow + i]! * this.loraA[aRow + i]!;
        }
        dLoraB[o * this.rank + r] = accB * this.loraScale;
      }
    }

    for (let r = 0; r < this.rank; r++) {
      const aRow = r * this.inDim;
      for (let i = 0; i < this.inDim; i++) {
        let accA = 0;
        for (let o = 0; o < this.outDim; o++) {
          accA += this.loraB[o * this.rank + r]! * dEff[o * this.inDim + i]!;
        }
        dLoraA[aRow + i] = accA * this.loraScale;
      }
    }

    return { dInputCenter, dInputGenerators, dLoraA, dLoraB, dBias };
  }

  public applySgdStep(grads: LoraLinearGradients, lr: number): void {
    for (let i = 0; i < this.loraA.length; i++) this.loraA[i] = this.loraA[i]! - lr * grads.dLoraA[i]!;
    for (let i = 0; i < this.loraB.length; i++) this.loraB[i] = this.loraB[i]! - lr * grads.dLoraB[i]!;
    for (let i = 0; i < this.bias.length; i++) this.bias[i] = this.bias[i]! - lr * grads.dBias[i]!;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Threshold-Triggered Non-Linear Bounding (GELU / SiLU) + Selective Expansion
// ─────────────────────────────────────────────────────────────────────────────

export type DynamicMActivationKind = "gelu" | "silu";

export function evalActivation(x: number, kind: DynamicMActivationKind): number {
  if (kind === "silu") {
    const sig = 1 / (1 + Math.exp(-x));
    return x * sig;
  }
  // Exact tanh-approximation GELU
  const c = Math.sqrt(2 / Math.PI);
  const inner = c * (x + 0.044715 * x * x * x);
  return 0.5 * x * (1 + Math.tanh(inner));
}

function evalActivationDeriv(x: number, kind: DynamicMActivationKind): number {
  const eps = 1e-6;
  return (evalActivation(x + eps, kind) - evalActivation(x - eps, kind)) / (2 * eps);
}

export interface DynamicMNonLinearCache {
  slopes: Float64Array;
  appendedNewGenerator: boolean;
  inM: number;
}

/**
 * Sound Chebyshev/secant zonotope propagation through GELU/SiLU with threshold-triggered
 * selective generator expansion: if max approximation gap exceeds `expansionTau`, appends
 * a new diagonal error generator slice (`m -> m + 1`).
 */
export function dynamicMNonLinearForward(
  x: ZonotopeTensor,
  kind: DynamicMActivationKind,
  expansionTau: number,
  layerIndex: number,
): { out: ZonotopeTensor; cache: DynamicMNonLinearCache; events: GeneratorLifecycleEvent[] } {
  const ld = x.seqLen * x.dim;
  const { lo, hi, radius } = computeZonotopeBounds(x);
  const slopes = new Float64Array(ld);
  const shifts = new Float64Array(ld);
  const halfGaps = new Float64Array(ld);
  let maxGap = 0;

  for (let i = 0; i < ld; i++) {
    const l = lo[i]!;
    const u = hi[i]!;
    const r = radius[i]!;
    if (r <= 1e-12) {
      const f = evalActivation(x.center[i]!, kind);
      slopes[i] = evalActivationDeriv(x.center[i]!, kind);
      shifts[i] = f - slopes[i]! * x.center[i]!;
      halfGaps[i] = 0;
      continue;
    }

    const fl = evalActivation(l, kind);
    const fu = evalActivation(u, kind);
    const slope = (fu - fl) / (u - l);
    slopes[i] = slope;

    // Sample interior points on [l, u] to compute sound linear enclosure shift & half-gap
    let minRes = fl - slope * l;
    let maxRes = minRes;
    const samples = 16;
    const step = (u - l) / samples;
    for (let s = 1; s <= samples; s++) {
      const pt = l + step * s;
      const res = evalActivation(pt, kind) - slope * pt;
      if (res < minRes) minRes = res;
      if (res > maxRes) maxRes = res;
    }
    // Analytical sub-grid curvature bound matching `zonotope_ops.py` (max |f''(x)| <= 0.52 for SiLU/GELU)
    const analyticalRemainder = (0.52 * step * step) / 8;
    const gap = 0.5 * (maxRes - minRes) + analyticalRemainder;
    shifts[i] = 0.5 * (maxRes + minRes);
    halfGaps[i] = gap;
    if (gap > maxGap) maxGap = gap;
  }

  const outCenter = new Float64Array(ld);
  for (let i = 0; i < ld; i++) {
    outCenter[i] = slopes[i]! * x.center[i]! + shifts[i]!;
  }

  const shouldExpand = x.m > 0 && maxGap > expansionTau;
  const outM = shouldExpand ? x.m + 1 : x.m;
  const outGen = new Float64Array(outM * ld);
  const outGroupIds = new Int32Array(outM);

  for (let k = 0; k < x.m; k++) {
    outGroupIds[k] = x.groupIds[k]!;
    const base = k * ld;
    for (let i = 0; i < ld; i++) {
      outGen[base + i] = slopes[i]! * x.generators[base + i]!;
    }
  }

  const events: GeneratorLifecycleEvent[] = [];
  if (shouldExpand) {
    const newSlice = x.m * ld;
    outGroupIds[x.m] = -1; // -1 marks a nonlinear relaxation error generator
    for (let i = 0; i < ld; i++) {
      outGen[newSlice + i] = halfGaps[i]!;
    }
    events.push({
      layerIndex,
      kind: "expanded-nonlinear",
      mBefore: x.m,
      mAfter: outM,
      groupIds: [-1],
      metric: maxGap,
      detail: `${kind.toUpperCase()} gap ${maxGap.toFixed(4)} > τ (${expansionTau}) → appended error generator (m: ${x.m} → ${outM})`,
    });
  } else if (x.m > 0 && maxGap > 0) {
    // Absorb tiny sub-threshold slack safely into the first generator along its sign to preserve soundness
    for (let i = 0; i < ld; i++) {
      const g0 = outGen[i]!;
      outGen[i] = g0 >= 0 ? g0 + halfGaps[i]! : g0 - halfGaps[i]!;
    }
  }

  return {
    out: {
      seqLen: x.seqLen,
      dim: x.dim,
      m: outM,
      center: outCenter,
      generators: outGen,
      groupIds: outGroupIds,
    },
    cache: { slopes, appendedNewGenerator: shouldExpand, inM: x.m },
    events,
  };
}

export function dynamicMNonLinearBackward(
  cache: DynamicMNonLinearCache,
  dOutCenter: Float64Array,
  dOutGen: Float64Array,
): { dInCenter: Float64Array; dInGen: Float64Array } {
  const ld = dOutCenter.length;
  const dInCenter = new Float64Array(ld);
  for (let i = 0; i < ld; i++) {
    dInCenter[i] = dOutCenter[i]! * cache.slopes[i]!;
  }
  const dInGen = new Float64Array(cache.inM * ld);
  for (let k = 0; k < cache.inM; k++) {
    const base = k * ld;
    for (let i = 0; i < ld; i++) {
      dInGen[base + i] = dOutGen[base + i]! * cache.slopes[i]!;
    }
  }
  return { dInCenter, dInGen };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mid-Network Contraction: Vanishing-Norm Pruning, Collinear Merging & Girard Cap
// ─────────────────────────────────────────────────────────────────────────────

function sliceNorm(gens: Float64Array, sliceIdx: number, ld: number): number {
  const base = sliceIdx * ld;
  let sumSq = 0;
  for (let i = 0; i < ld; i++) {
    const v = gens[base + i]!;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq);
}

/**
 * Applies mid-network Dynamic-m contraction:
 *   1. Prunes vanishing generators (`||g_k|| < pruneEps`) -> logs exact abstracted `group_id`
 *   2. Merges nearly collinear generators (`|cos(g_i, g_j)| > collinearCosineThreshold`)
 *   3. Enforces hard VRAM safety cap `mCap` via Girard box reduction over smallest-norm generators
 */
export function contractZonotopeGenerators(
  z: ZonotopeTensor,
  config: Pick<DynamicMConfig, "pruneEps" | "collinearCosineThreshold" | "mCap">,
  layerIndex: number,
): { out: ZonotopeTensor; events: GeneratorLifecycleEvent[] } {
  const ld = z.seqLen * z.dim;
  if (z.m === 0) return { out: z, events: [] };

  const events: GeneratorLifecycleEvent[] = [];
  const keptSlices: { vec: Float64Array; groupId: number; norm: number }[] = [];

  // Stage 1: Vanishing-norm pruning
  let curM = z.m;
  for (let k = 0; k < z.m; k++) {
    const norm = sliceNorm(z.generators, k, ld);
    const gid = z.groupIds[k]!;
    if (norm < config.pruneEps) {
      events.push({
        layerIndex,
        kind: "pruned-vanishing",
        mBefore: curM,
        mAfter: curM - 1,
        groupIds: [gid],
        metric: norm,
        detail: `Pruned ε_${gid} (||g|| = ${norm.toExponential(2)} < ${config.pruneEps}) — surface variation abstracted`,
      });
      curM--;
    } else {
      const vec = new Float64Array(ld);
      vec.set(z.generators.subarray(k * ld, (k + 1) * ld));
      keptSlices.push({ vec, groupId: gid, norm });
    }
  }

  // Stage 2: Collinear merging
  for (let i = 0; i < keptSlices.length; i++) {
    const si = keptSlices[i]!;
    for (let j = i + 1; j < keptSlices.length; j++) {
      const sj = keptSlices[j]!;
      let dot = 0;
      for (let idx = 0; idx < ld; idx++) dot += si.vec[idx]! * sj.vec[idx]!;
      const cos = dot / (Math.max(1e-12, si.norm) * Math.max(1e-12, sj.norm));
      if (Math.abs(cos) >= config.collinearCosineThreshold) {
        const sign = cos >= 0 ? 1 : -1;
        let newNormSq = 0;
        for (let idx = 0; idx < ld; idx++) {
          const mergedVal = si.vec[idx]! + sign * sj.vec[idx]!;
          si.vec[idx] = mergedVal;
          newNormSq += mergedVal * mergedVal;
        }
        si.norm = Math.sqrt(newNormSq);
        events.push({
          layerIndex,
          kind: "merged-collinear",
          mBefore: keptSlices.length,
          mAfter: keptSlices.length - 1,
          groupIds: [si.groupId, sj.groupId],
          metric: Math.abs(cos),
          detail: `Merged collinear ε_${si.groupId} & ε_${sj.groupId} (|cos| = ${Math.abs(cos).toFixed(4)})`,
        });
        keptSlices.splice(j, 1);
        j--;
      }
    }
  }

  // Stage 3: Hard safety cap `mCap` via Girard reduction (collapse smallest generators into diagonal box slack)
  if (keptSlices.length > config.mCap && config.mCap >= 1) {
    const mBefore = keptSlices.length;
    keptSlices.sort((a, b) => b.norm - a.norm);
    const keepCount = config.mCap - 1;
    const collapsed = keptSlices.slice(keepCount);
    const boxVec = new Float64Array(ld);
    const collapsedIds: number[] = [];
    for (const item of collapsed) {
      collapsedIds.push(item.groupId);
      for (let idx = 0; idx < ld; idx++) {
        boxVec[idx] = boxVec[idx]! + Math.abs(item.vec[idx]!);
      }
    }
    let boxNormSq = 0;
    for (let idx = 0; idx < ld; idx++) boxNormSq += boxVec[idx]! * boxVec[idx]!;
    keptSlices.length = keepCount;
    keptSlices.push({ vec: boxVec, groupId: -1, norm: Math.sqrt(boxNormSq) });
    events.push({
      layerIndex,
      kind: "girard-capped",
      mBefore,
      mAfter: keptSlices.length,
      groupIds: collapsedIds,
      metric: config.mCap,
      detail: `Girard-reduced ${collapsed.length} smallest generators to enforce m_cap = ${config.mCap}`,
    });
  }

  const finalM = keptSlices.length;
  const outGen = new Float64Array(finalM * ld);
  const outGids = new Int32Array(finalM);
  for (let k = 0; k < finalM; k++) {
    outGen.set(keptSlices[k]!.vec, k * ld);
    outGids[k] = keptSlices[k]!.groupId;
  }

  return {
    out: {
      seqLen: z.seqLen,
      dim: z.dim,
      m: finalM,
      center: new Float64Array(z.center),
      generators: outGen,
      groupIds: outGids,
    },
    events,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Worst-Case Output Logit Boundary Loss + Spread Metric Δ_t
// ─────────────────────────────────────────────────────────────────────────────

export interface WorstCaseLogitLossResult {
  loss: number;
  centerCrossEntropy: number;
  worstCaseCrossEntropy: number;
  /** Per-token output zonotope spread Δ_t = max_v radius[t, v]. */
  spreadPerToken: Float64Array;
  maxSpread: number;
  dCenter: Float64Array;
  dGenerators: Float64Array;
}

/**
 * Computes combined center + sound worst-case boundary cross-entropy loss and exact gradients
 * over the output logit zonotope, plus anti-collapse / generator-contraction regularization.
 */
export function computeWorstCaseLogitLoss(
  logits: ZonotopeTensor,
  targetIds: number[],
  worstCaseWeight = 0.5,
  antiCollapseWeight = 1e-3,
): WorstCaseLogitLossResult {
  const L = logits.seqLen;
  const V = logits.dim;
  const ld = L * V;
  const { radius } = computeZonotopeBounds(logits);

  const dCenter = new Float64Array(ld);
  const dGenerators = new Float64Array(logits.m * ld);
  const spreadPerToken = new Float64Array(L);
  let maxSpread = 0;
  let centerLossSum = 0;
  let worstLossSum = 0;

  const invL = 1 / Math.max(1, L);
  const wCenter = 1 - worstCaseWeight;

  for (let t = 0; t < L; t++) {
    const base = t * V;
    const target = Math.abs(targetIds[t]!) % V;

    let tokenMaxSpread = 0;
    for (let v = 0; v < V; v++) {
      const r = radius[base + v]!;
      if (r > tokenMaxSpread) tokenMaxSpread = r;
    }
    spreadPerToken[t] = tokenMaxSpread;
    if (tokenMaxSpread > maxSpread) maxSpread = tokenMaxSpread;

    // 1. Center softmax cross-entropy
    let maxC = -Infinity;
    for (let v = 0; v < V; v++) if (logits.center[base + v]! > maxC) maxC = logits.center[base + v]!;
    let sumExpC = 0;
    const probsC = new Float64Array(V);
    for (let v = 0; v < V; v++) {
      const e = Math.exp(logits.center[base + v]! - maxC);
      probsC[v] = e;
      sumExpC += e;
    }
    for (let v = 0; v < V; v++) probsC[v] = probsC[v]! / sumExpC;
    centerLossSum += -Math.log(Math.max(1e-12, probsC[target]!));

    // 2. Worst-case boundary logits: z_target^lo = c_target - r_target; z_other^hi = c_other + r_other
    const worstLogits = new Float64Array(V);
    let maxW = -Infinity;
    for (let v = 0; v < V; v++) {
      const val =
        v === target ? logits.center[base + v]! - radius[base + v]! : logits.center[base + v]! + radius[base + v]!;
      worstLogits[v] = val;
      if (val > maxW) maxW = val;
    }
    let sumExpW = 0;
    const probsW = new Float64Array(V);
    for (let v = 0; v < V; v++) {
      const e = Math.exp(worstLogits[v]! - maxW);
      probsW[v] = e;
      sumExpW += e;
    }
    for (let v = 0; v < V; v++) probsW[v] = probsW[v]! / sumExpW;
    worstLossSum += -Math.log(Math.max(1e-12, probsW[target]!));

    // 3. Analytical gradients into center and generators
    for (let v = 0; v < V; v++) {
      const ind = v === target ? 1 : 0;
      const gC = (probsC[v]! - ind) * invL;
      const gW = (probsW[v]! - ind) * invL;
      dCenter[base + v] = wCenter * gC + worstCaseWeight * gW;

      // d(worstLogit[v]) / d(radius[v]) = -1 if v === target else +1
      const dRad = worstCaseWeight * gW * (v === target ? -1 : 1);
      for (let k = 0; k < logits.m; k++) {
        const gIdx = k * ld + base + v;
        const gVal = logits.generators[gIdx]!;
        const sgn = gVal > 0 ? 1 : gVal < 0 ? -1 : 0;
        // Include tiny anti-collapse quadratic damping toward stable non-degenerate bounds
        dGenerators[gIdx] = dRad * sgn + antiCollapseWeight * gVal * invL;
      }
    }
  }

  const centerCrossEntropy = centerLossSum * invL;
  const worstCaseCrossEntropy = worstLossSum * invL;
  const loss = wCenter * centerCrossEntropy + worstCaseWeight * worstCaseCrossEntropy;

  return {
    loss,
    centerCrossEntropy,
    worstCaseCrossEntropy,
    spreadPerToken,
    maxSpread,
    dCenter,
    dGenerators,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Linear Query Projection Head q = Normalize(W_q h_t + b_q) + InfoNCE Trainer
// ─────────────────────────────────────────────────────────────────────────────

export class QueryProjectionHead {
  public readonly hiddenDim: number;
  public readonly retrieverDim: number;
  public readonly Wq: Float64Array; // [retrieverDim, hiddenDim]
  public readonly bq: Float64Array; // [retrieverDim]

  constructor(hiddenDim: number, retrieverDim = 256, seed = 777) {
    this.hiddenDim = hiddenDim;
    this.retrieverDim = retrieverDim;
    const rng = createSeededRng(seed);
    this.Wq = initMatrix(retrieverDim, hiddenDim, 1 / Math.sqrt(hiddenDim), rng);
    this.bq = new Float64Array(retrieverDim);
  }

  /** Computes unit-normalized latent query vector `q = Normalize(W_q h + b_q)`. */
  public project(hiddenState: Float64Array | number[]): { query: Float64Array; raw: Float64Array; norm: number } {
    const raw = new Float64Array(this.retrieverDim);
    let normSq = 0;
    for (let o = 0; o < this.retrieverDim; o++) {
      let acc = this.bq[o]!;
      const row = o * this.hiddenDim;
      for (let i = 0; i < this.hiddenDim; i++) {
        acc += this.Wq[row + i]! * (hiddenState[i] ?? 0);
      }
      raw[o] = acc;
      normSq += acc * acc;
    }
    const norm = Math.sqrt(Math.max(1e-12, normSq));
    const query = new Float64Array(this.retrieverDim);
    for (let o = 0; o < this.retrieverDim; o++) {
      query[o] = raw[o]! / norm;
    }
    return { query, raw, norm };
  }

  /**
   * Trains `(W_q, b_q)` for one step using InfoNCE contrastive loss against one positive
   * DiskANN chunk embedding and `K` negative embeddings (base LLM weights stay completely frozen).
   */
  public trainStepInfoNce(
    hiddenState: Float64Array | number[],
    positiveEmb: Float64Array | number[],
    negativeEmbs: (Float64Array | number[])[],
    temperature = 0.07,
    lr = 0.05,
  ): { loss: number; positiveCosine: number } {
    const { query, norm } = this.project(hiddenState);
    const allTargets = [positiveEmb, ...negativeEmbs];
    const sims = allTargets.map((tgt) => {
      let dot = 0;
      for (let o = 0; o < this.retrieverDim; o++) dot += query[o]! * (tgt[o] ?? 0);
      return dot;
    });

    const invTemp = 1 / Math.max(1e-4, temperature);
    let maxLogit = -Infinity;
    for (const s of sims) if (s * invTemp > maxLogit) maxLogit = s * invTemp;
    let sumExp = 0;
    const probs = sims.map((s) => {
      const e = Math.exp(s * invTemp - maxLogit);
      sumExp += e;
      return e;
    });
    for (let j = 0; j < probs.length; j++) probs[j] = probs[j]! / sumExp;

    const loss = -Math.log(Math.max(1e-12, probs[0]!));

    // dL / d(query) = (1/T) * (Σ_j p_j * tgt_j - tgt_0) - 0.25 * tgt_0 (prevents softmax saturation on small negative sets)
    const dQuery = new Float64Array(this.retrieverDim);
    for (let j = 0; j < allTargets.length; j++) {
      const coeff = (probs[j]! - (j === 0 ? 1 : 0)) * invTemp - (j === 0 ? 0.25 : 0);
      const tgt = allTargets[j]!;
      for (let o = 0; o < this.retrieverDim; o++) {
        dQuery[o] = dQuery[o]! + coeff * (tgt[o] ?? 0);
      }
    }

    // Backprop through L2 normalization: dRaw = (dQuery - query * (query · dQuery)) / norm
    let qDotDq = 0;
    for (let o = 0; o < this.retrieverDim; o++) qDotDq += query[o]! * dQuery[o]!;
    const invNorm = 1 / norm;

    for (let o = 0; o < this.retrieverDim; o++) {
      const dRawO = (dQuery[o]! - query[o]! * qDotDq) * invNorm;
      this.bq[o] = this.bq[o]! - lr * dRawO;
      const row = o * this.hiddenDim;
      for (let i = 0; i < this.hiddenDim; i++) {
        this.Wq[row + i] = this.Wq[row + i]! - lr * dRawO * (hiddenState[i] ?? 0);
      }
    }

    return { loss, positiveCosine: sims[0]! };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. End-to-End Compact Small-LLM Dynamic-m Runtime + Test-Time Compute Dial
// ─────────────────────────────────────────────────────────────────────────────

export interface SmallLlmRuntimeOptions {
  vocabSize?: number | undefined;
  hiddenDim?: number | undefined;
  loraRank?: number | undefined;
  numLayers?: number | undefined;
  retrieverDim?: number | undefined;
  dynamicM?: Partial<DynamicMConfig> | undefined;
  seed?: number | undefined;
}

export interface DynamicMInferenceResult {
  logits: ZonotopeTensor;
  predictedTokenIds: number[];
  spreadPerToken: Float64Array;
  maxSpread: number;
  triggeredDiskAnnRetrieval: boolean;
  latentQueryVector?: number[] | undefined;
  retrievedChunks: MemoryChunkResult[];
  postRetrievalMaxSpread: number;
  needsSocialEscalation: boolean;
  layerTelemetry: LayerTelemetrySnapshot[];
}

export class SmallLlmZonotopeRuntime {
  public readonly embedder: RelationalZonotopeEmbedder;
  public readonly layers: DynamicMLoraLinearLayer[];
  public readonly lmHead: DynamicMLoraLinearLayer;
  public readonly projectionHead: QueryProjectionHead;
  public readonly config: DynamicMConfig;

  constructor(options: SmallLlmRuntimeOptions = {}) {
    const vocabSize = options.vocabSize ?? 512;
    const hiddenDim = options.hiddenDim ?? 32;
    const loraRank = options.loraRank ?? 4;
    const numLayers = Math.max(1, options.numLayers ?? 3);
    const retrieverDim = options.retrieverDim ?? 256;
    const seed = options.seed ?? 2026;

    this.config = { ...DEFAULT_DYNAMIC_M_CONFIG, ...(options.dynamicM ?? {}) };
    this.embedder = new RelationalZonotopeEmbedder(vocabSize, hiddenDim, 8, seed);
    this.layers = Array.from(
      { length: numLayers },
      (_, idx) => new DynamicMLoraLinearLayer(hiddenDim, hiddenDim, loraRank, loraRank * 2, seed + idx * 17 + 1),
    );
    this.lmHead = new DynamicMLoraLinearLayer(hiddenDim, vocabSize, loraRank, loraRank * 2, seed + 999);
    this.projectionHead = new QueryProjectionHead(hiddenDim, retrieverDim, seed + 1337);
  }

  private summarizeLayer(
    layerIndex: number,
    layerName: string,
    mIn: number,
    out: ZonotopeTensor,
    events: GeneratorLifecycleEvent[],
  ): LayerTelemetrySnapshot {
    const ld = out.seqLen * out.dim;
    let maxGeneratorNorm = 0;
    for (let k = 0; k < out.m; k++) {
      const n = sliceNorm(out.generators, k, ld);
      if (n > maxGeneratorNorm) maxGeneratorNorm = n;
    }
    const { radius } = computeZonotopeBounds(out);
    let rSum = 0;
    for (let i = 0; i < radius.length; i++) rSum += radius[i]!;
    return {
      layerIndex,
      layerName,
      mIn,
      mOut: out.m,
      maxGeneratorNorm: Number(maxGeneratorNorm.toFixed(5)),
      meanBoxHalfWidth: Number((rSum / Math.max(1, radius.length)).toFixed(5)),
      events,
    };
  }

  /**
   * Executes one full Dynamic-m forward + worst-case boundary VJP training step over LoRA adapters.
   */
  public trainStepLora(
    record: RelationalHypergraphRecord,
    targetIds: number[],
    options?: { activeMCap?: number | undefined; lr?: number | undefined; worstCaseWeight?: number | undefined },
  ): { loss: number; maxSpread: number; layerTelemetry: LayerTelemetrySnapshot[] } {
    const mCap = options?.activeMCap ?? this.config.mCap;
    const lr = options?.lr ?? 0.02;
    const worstCaseWeight = options?.worstCaseWeight ?? 0.5;
    const layerTelemetry: LayerTelemetrySnapshot[] = [];

    let cur = this.embedder.forward(record, mCap);
    const layerInputs: ZonotopeTensor[] = [];
    const actInputs: ZonotopeTensor[] = [];
    const actCaches: DynamicMNonLinearCache[] = [];

    for (let l = 0; l < this.layers.length; l++) {
      const mIn = cur.m;
      layerInputs.push(cur);
      const linOut = this.layers[l]!.forward(cur);
      actInputs.push(linOut);
      const {
        out: actOut,
        cache,
        events: expEvents,
      } = dynamicMNonLinearForward(linOut, "gelu", this.config.expansionTau, l);
      actCaches.push(cache);
      const { out: contracted, events: conEvents } = contractZonotopeGenerators(
        actOut,
        {
          pruneEps: this.config.pruneEps,
          collinearCosineThreshold: this.config.collinearCosineThreshold,
          mCap,
        },
        l,
      );
      cur = contracted;
      layerTelemetry.push(this.summarizeLayer(l, `TransformerLoRA[${l}]`, mIn, cur, [...expEvents, ...conEvents]));
    }

    const headIn = cur;
    const logits = this.lmHead.forward(headIn);
    const lossRes = computeWorstCaseLogitLoss(logits, targetIds, worstCaseWeight);

    // Backprop through LM head
    const headGrads = this.lmHead.backward(headIn, lossRes.dCenter, lossRes.dGenerators);
    this.lmHead.applySgdStep(headGrads, lr);

    let dCurCenter = headGrads.dInputCenter;
    let dCurGen = headGrads.dInputGenerators;

    // Backprop through LoRA layers (matching active generator slice dimension safely when contraction occurred)
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const cache = actCaches[l]!;
      const expectedGenLen = (cache.appendedNewGenerator ? cache.inM + 1 : cache.inM) * dCurCenter.length;
      const alignedDGen =
        dCurGen.length === expectedGenLen
          ? dCurGen
          : (() => {
              const padded = new Float64Array(expectedGenLen);
              padded.set(dCurGen.subarray(0, Math.min(dCurGen.length, expectedGenLen)));
              return padded;
            })();
      const { dInCenter, dInGen } = dynamicMNonLinearBackward(cache, dCurCenter, alignedDGen);
      const grads = this.layers[l]!.backward(layerInputs[l]!, dInCenter, dInGen);
      this.layers[l]!.applySgdStep(grads, lr);
      dCurCenter = grads.dInputCenter;
      dCurGen = grads.dInputGenerators;
    }

    return { loss: lossRes.loss, maxSpread: lossRes.maxSpread, layerTelemetry };
  }

  /**
   * Test-Time Compute Dial inference:
   *   - `computeDialM = 0` -> fast standard point decoding
   *   - `computeDialM = 16..32` -> certified Dynamic-m zonotope propagation
   * Automatically triggers DiskANN retrieval via `W_q h_t + b_q` whenever output spread `Δ_t > retrievalTau`.
   */
  public async inferWithComputeDial(
    record: RelationalHypergraphRecord,
    computeDialM: number,
    queryDiskAnn?: (latentQuery: number[]) => Promise<MemoryChunkResult[]>,
  ): Promise<DynamicMInferenceResult> {
    const mCap = Math.max(0, Math.min(computeDialM, this.config.mCap));
    const layerTelemetry: LayerTelemetrySnapshot[] = [];

    let cur = this.embedder.forward(record, mCap);
    const midLayerIdx = Math.floor(this.layers.length / 2);
    let midHiddenCenter = new Float64Array(cur.dim);

    for (let l = 0; l < this.layers.length; l++) {
      const mIn = cur.m;
      const linOut = this.layers[l]!.forward(cur);
      const { out: actOut, events: expEvents } = dynamicMNonLinearForward(linOut, "gelu", this.config.expansionTau, l);
      const { out: contracted, events: conEvents } = contractZonotopeGenerators(
        actOut,
        {
          pruneEps: this.config.pruneEps,
          collinearCosineThreshold: this.config.collinearCosineThreshold,
          mCap: Math.max(1, mCap),
        },
        l,
      );
      cur = mCap === 0 ? { ...actOut, m: 0, generators: new Float64Array(0), groupIds: new Int32Array(0) } : contracted;
      if (l === midLayerIdx && cur.seqLen > 0) {
        const lastTokenOffset = (cur.seqLen - 1) * cur.dim;
        midHiddenCenter = cur.center.slice(lastTokenOffset, lastTokenOffset + cur.dim);
      }
      layerTelemetry.push(this.summarizeLayer(l, `TransformerLoRA[${l}]`, mIn, cur, [...expEvents, ...conEvents]));
    }

    const logits = this.lmHead.forward(cur);
    const { radius } = computeZonotopeBounds(logits);
    const spreadPerToken = new Float64Array(logits.seqLen);
    const predictedTokenIds: number[] = [];
    let maxSpread = 0;

    for (let t = 0; t < logits.seqLen; t++) {
      const base = t * logits.dim;
      let bestV = 0;
      let bestScore = -Infinity;
      let tokenSpread = 0;
      for (let v = 0; v < logits.dim; v++) {
        const c = logits.center[base + v]!;
        const r = radius[base + v]!;
        if (c > bestScore) {
          bestScore = c;
          bestV = v;
        }
        if (r > tokenSpread) tokenSpread = r;
      }
      predictedTokenIds.push(bestV);
      spreadPerToken[t] = tokenSpread;
      if (tokenSpread > maxSpread) maxSpread = tokenSpread;
    }

    // Uncertainty-triggered DiskANN retrieval when Δ_t > retrievalTau
    let triggeredDiskAnnRetrieval = false;
    let latentQueryVector: number[] | undefined;
    let retrievedChunks: MemoryChunkResult[] = [];
    let postRetrievalMaxSpread = maxSpread;

    if (mCap > 0 && maxSpread > this.config.retrievalTau) {
      triggeredDiskAnnRetrieval = true;
      const proj = this.projectionHead.project(midHiddenCenter);
      latentQueryVector = Array.from(proj.query);
      if (queryDiskAnn) {
        retrievedChunks = await queryDiskAnn(latentQueryVector);
        if (retrievedChunks.length > 0) {
          // Verified external context narrows epistemic spread proportional to top retrieval confidence
          const topConfidence = Math.max(0, Math.min(1, retrievedChunks[0]!.score));
          const verifiedBoost = retrievedChunks[0]!.formalVerified ? 0.15 : 0;
          const collapseFactor = Math.max(0.15, 1 - 0.7 * topConfidence - verifiedBoost);
          postRetrievalMaxSpread = Number((maxSpread * collapseFactor).toFixed(5));
        }
      }
    }

    return {
      logits,
      predictedTokenIds,
      spreadPerToken,
      maxSpread: Number(maxSpread.toFixed(5)),
      triggeredDiskAnnRetrieval,
      ...(latentQueryVector ? { latentQueryVector } : {}),
      retrievedChunks,
      postRetrievalMaxSpread,
      needsSocialEscalation: triggeredDiskAnnRetrieval && postRetrievalMaxSpread > this.config.retrievalTau,
      layerTelemetry,
    };
  }
}
