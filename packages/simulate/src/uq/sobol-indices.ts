// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Global Variance-Based Sensitivity Analysis — Sobol' Indices
 * (Saltelli 2010 / Jansen 1999 estimators over Sobol' low-discrepancy sequences).
 *
 * Computes first-order (main-effect) indices S_i, total-order indices S_Ti,
 * and interaction effects (S_Ti - S_i) using N * (d + 2) model evaluations.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions } from "../core/simulate-arena.js";
import { interpolateTrajectoryAt } from "./fosm.js";
import { SobolSequence, Xoshiro256pp, inverseCDF, normalQuantile, type RandomVariable } from "./monte-carlo.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SobolOptions {
  /** Base sample size N (total evaluations = N * (d + 2)). Default: 512. */
  baseSamples?: number | undefined;
  /** Number of initial Sobol points to skip for burn-in (default: 64). */
  skip?: number | undefined;
  /** Optional bootstrap resamples for confidence intervals (0 = disabled, default: 0). */
  bootstrapResamples?: number | undefined;
  /** Confidence level for bootstrap intervals (default: 0.95). */
  confidenceLevel?: number | undefined;
  /** Deterministic PRNG seed for bootstrap resampling (default: 42). */
  seed?: number | undefined;
}

export interface SobolParameterIndex {
  name: string;
  /** First-order (main effect) Sobol' index S_i = Var(E[Y|X_i]) / Var(Y). */
  firstOrder: number;
  /** Total-order Sobol' index S_Ti = E[Var(Y|X_~i)] / Var(Y). */
  totalOrder: number;
  /** Higher-order interaction contribution: max(0, S_Ti - S_i). */
  interaction: number;
  /** Optional bootstrap confidence interval for S_i. */
  firstOrderCI?: [number, number] | undefined;
  /** Optional bootstrap confidence interval for S_Ti. */
  totalOrderCI?: [number, number] | undefined;
}

export interface SobolOutputResult {
  outputName: string;
  mean: number;
  variance: number;
  /** Sensitivity indices per input parameter, in input order. */
  indices: SobolParameterIndex[];
  /** Parameter names ranked descending by totalOrder index. */
  rankedByTotalOrder: string[];
}

export interface SobolResult {
  /** Sensitivity results keyed by output name. */
  outputs: Map<string, SobolOutputResult>;
  baseSamples: number;
  numEvaluations: number;
  rigor: "statistical";
}

export interface ArenaSobolOptions extends SobolOptions {
  /** Base simulation options forwarded to simulateArena(). */
  simulateOptions?: ArenaSimulateOptions | undefined;
  /**
   * Time at which to evaluate state outputs for sensitivity analysis.
   * Defaults to the final simulation time (stopTime).
   */
  snapshotTime?: number | undefined;
  /** Restrict analysis to a subset of state names (default: all states). */
  outputStates?: string[] | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Core Saltelli / Jansen Estimator
// ─────────────────────────────────────────────────────────────────────

function computeJansenSingleOutput(
  fA: Float64Array,
  fB: Float64Array,
  fAB: Float64Array[],
  paramNames: string[],
  bootstrapResamples: number,
  confLevel: number,
  rng: Xoshiro256pp,
): Omit<SobolOutputResult, "outputName"> {
  const N = fA.length;
  const d = paramNames.length;

  // Pool fA and fB for unbiased mean and total variance estimate
  let sum = 0;
  for (let k = 0; k < N; k++) {
    sum += fA[k]! + fB[k]!;
  }
  const mean = sum / (2 * N);

  let varSum = 0;
  for (let k = 0; k < N; k++) {
    const da = fA[k]! - mean;
    const db = fB[k]! - mean;
    varSum += da * da + db * db;
  }
  const variance = varSum / Math.max(1, 2 * N - 1);

  const estimateFromIndices = (idxMap: Int32Array | null): { s1: number[]; sT: number[] } => {
    let mLocal = mean;
    let vLocal = variance;
    if (idxMap) {
      let s = 0;
      for (let k = 0; k < N; k++) {
        const idx = idxMap[k]!;
        s += fA[idx]! + fB[idx]!;
      }
      mLocal = s / (2 * N);
      let vs = 0;
      for (let k = 0; k < N; k++) {
        const idx = idxMap[k]!;
        const da = fA[idx]! - mLocal;
        const db = fB[idx]! - mLocal;
        vs += da * da + db * db;
      }
      vLocal = vs / Math.max(1, 2 * N - 1);
    }

    const s1 = new Array<number>(d).fill(0);
    const sT = new Array<number>(d).fill(0);
    if (vLocal <= 1e-30) {
      return { s1, sT };
    }

    const denom = 2 * N * vLocal;
    for (let i = 0; i < d; i++) {
      const fABi = fAB[i]!;
      let sumS1 = 0;
      let sumST = 0;
      for (let k = 0; k < N; k++) {
        const idx = idxMap ? idxMap[k]! : k;
        const diffB = fB[idx]! - fABi[idx]!;
        const diffA = fA[idx]! - fABi[idx]!;
        sumS1 += diffB * diffB;
        sumST += diffA * diffA;
      }
      // Jansen (1999) estimators:
      //   S_i  = 1 - (1 / 2N) * sum((fB - fAB_i)^2) / Var(Y)
      //   S_Ti =     (1 / 2N) * sum((fA - fAB_i)^2) / Var(Y)
      s1[i] = 1 - sumS1 / denom;
      sT[i] = sumST / denom;
    }

    return { s1, sT };
  };

  const base = estimateFromIndices(null);

  // Optional bootstrap confidence intervals
  let s1Boot: number[][] | undefined;
  let sTBoot: number[][] | undefined;
  if (bootstrapResamples > 0) {
    s1Boot = Array.from({ length: d }, () => new Array<number>(bootstrapResamples));
    sTBoot = Array.from({ length: d }, () => new Array<number>(bootstrapResamples));
    const idxBuf = new Int32Array(N);
    for (let b = 0; b < bootstrapResamples; b++) {
      for (let k = 0; k < N; k++) {
        idxBuf[k] = Math.floor(rng.random() * N);
      }
      const est = estimateFromIndices(idxBuf);
      for (let i = 0; i < d; i++) {
        s1Boot[i]![b] = est.s1[i]!;
        sTBoot[i]![b] = est.sT[i]!;
      }
    }
  }

  const z = normalQuantile((1 + confLevel) / 2);
  const computeCI = (samples: number[]): [number, number] => {
    const B = samples.length;
    let mB = 0;
    for (let b = 0; b < B; b++) mB += samples[b]!;
    mB /= B;
    let vB = 0;
    for (let b = 0; b < B; b++) {
      const diff = samples[b]! - mB;
      vB += diff * diff;
    }
    const se = Math.sqrt(vB / Math.max(1, B - 1));
    return [mB - z * se, mB + z * se];
  };

  const indices: SobolParameterIndex[] = [];
  for (let i = 0; i < d; i++) {
    const firstOrder = base.s1[i]!;
    const totalOrder = base.sT[i]!;
    const entry: SobolParameterIndex = {
      name: paramNames[i]!,
      firstOrder,
      totalOrder,
      interaction: Math.max(0, totalOrder - firstOrder),
    };
    if (s1Boot && sTBoot) {
      entry.firstOrderCI = computeCI(s1Boot[i]!);
      entry.totalOrderCI = computeCI(sTBoot[i]!);
    }
    indices.push(entry);
  }

  const rankedByTotalOrder = [...indices].sort((a, b) => b.totalOrder - a.totalOrder).map((entry) => entry.name);

  return { mean, variance, indices, rankedByTotalOrder };
}

/**
 * Compute global Sobol' sensitivity indices (first-order S_i and total-order S_Ti)
 * for an arbitrary scalar or multi-output model using Saltelli's quasi-Monte Carlo
 * sampling design (N * (d + 2) evaluations) and Jansen's estimators.
 */
export function computeSobolIndices(
  fn: (sample: Map<string, number>) => number | Record<string, number>,
  randomVars: RandomVariable[],
  options?: SobolOptions,
): SobolResult {
  const d = randomVars.length;
  const N = Math.max(8, options?.baseSamples ?? 512);
  const skip = options?.skip ?? 64;
  const bootstrapResamples = options?.bootstrapResamples ?? 0;
  const confLevel = options?.confidenceLevel ?? 0.95;
  const rng = new Xoshiro256pp(options?.seed ?? 42);

  // Draw a 2d-dimensional Sobol sequence and split into A (cols 0..d-1) and B (cols d..2d-1)
  const sobol = new SobolSequence(2 * d);
  sobol.skip(skip);

  const matA: number[][] = new Array(N);
  const matB: number[][] = new Array(N);
  for (let k = 0; k < N; k++) {
    const pt = sobol.next();
    const rowA = new Array<number>(d);
    const rowB = new Array<number>(d);
    for (let j = 0; j < d; j++) {
      const dist = randomVars[j]!.distribution;
      const uA = Math.min(1 - 1e-12, Math.max(1e-12, pt[j] ?? 0.5));
      const uB = Math.min(1 - 1e-12, Math.max(1e-12, pt[d + j] ?? 0.5));
      rowA[j] = inverseCDF(dist, uA);
      rowB[j] = inverseCDF(dist, uB);
    }
    matA[k] = rowA;
    matB[k] = rowB;
  }

  const paramNames = randomVars.map((rv) => rv.name);
  const toSampleMap = (row: number[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (let j = 0; j < d; j++) m.set(paramNames[j]!, row[j]!);
    return m;
  };

  const normalizeOutput = (raw: number | Record<string, number>): Record<string, number> =>
    typeof raw === "number" ? { y: raw } : raw;

  // Evaluate first sample to discover output names
  const firstOut = normalizeOutput(fn(toSampleMap(matA[0]!)));
  const outputNames = Object.keys(firstOut);

  const fAMap = new Map<string, Float64Array>();
  const fBMap = new Map<string, Float64Array>();
  const fABMap = new Map<string, Float64Array[]>();

  for (const name of outputNames) {
    const arrA = new Float64Array(N);
    arrA[0] = firstOut[name] ?? 0;
    fAMap.set(name, arrA);
    fBMap.set(name, new Float64Array(N));
    fABMap.set(
      name,
      Array.from({ length: d }, () => new Float64Array(N)),
    );
  }

  let numEvaluations = 1;

  // Remaining A rows
  for (let k = 1; k < N; k++) {
    const out = normalizeOutput(fn(toSampleMap(matA[k]!)));
    numEvaluations++;
    for (const name of outputNames) {
      fAMap.get(name)![k] = out[name] ?? 0;
    }
  }

  // All B rows
  for (let k = 0; k < N; k++) {
    const out = normalizeOutput(fn(toSampleMap(matB[k]!)));
    numEvaluations++;
    for (const name of outputNames) {
      fBMap.get(name)![k] = out[name] ?? 0;
    }
  }

  // Hybrid matrices A_B^(i): row from A except column i taken from B
  for (let i = 0; i < d; i++) {
    for (let k = 0; k < N; k++) {
      const hybrid = matA[k]!.slice();
      hybrid[i] = matB[k]![i]!;
      const out = normalizeOutput(fn(toSampleMap(hybrid)));
      numEvaluations++;
      for (const name of outputNames) {
        fABMap.get(name)![i]![k] = out[name] ?? 0;
      }
    }
  }

  const outputs = new Map<string, SobolOutputResult>();
  for (const name of outputNames) {
    const res = computeJansenSingleOutput(
      fAMap.get(name)!,
      fBMap.get(name)!,
      fABMap.get(name)!,
      paramNames,
      bootstrapResamples,
      confLevel,
      rng,
    );
    outputs.set(name, { outputName: name, ...res });
  }

  return {
    outputs,
    baseSamples: N,
    numEvaluations,
    rigor: "statistical",
  };
}

/**
 * Compute global Sobol' sensitivity indices for a DAE arena model by running
 * Saltelli/Jansen sampling over `simulateArena`.
 */
export function computeSobolIndicesArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  options?: ArenaSobolOptions,
): SobolResult {
  const baseOverrides = options?.simulateOptions?.parameterOverrides;
  const outputFilter = options?.outputStates ? new Set(options.outputStates) : null;

  const evalArena = (sample: Map<string, number>): Record<string, number> => {
    const merged = new Map<string, number>();
    if (baseOverrides) {
      for (const [k, v] of baseOverrides) merged.set(k, v);
    }
    for (const [k, v] of sample) merged.set(k, v);

    const sim = simulateArena(arena, {
      ...options?.simulateOptions,
      parameterOverrides: merged,
    });

    const nS = sim.states.length;
    const values =
      options?.snapshotTime !== undefined
        ? interpolateTrajectoryAt(sim, options.snapshotTime, nS)
        : (sim.y[sim.y.length - 1] ?? new Array<number>(nS).fill(0));

    const record: Record<string, number> = {};
    for (let si = 0; si < nS; si++) {
      const name = sim.states[si] ?? `x${si}`;
      if (!outputFilter || outputFilter.has(name)) {
        record[name] = values[si] ?? 0;
      }
    }
    return record;
  };

  return computeSobolIndices(evalArena, randomVars, options);
}
