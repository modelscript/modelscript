/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Monte Carlo / Uncertainty Quantification for the Arena Simulation Pipeline.
 *
 * Bridges the arena-based simulator (ArenaDAEBuilder + ArenaSimulator) with
 * the existing Monte Carlo engine (monte-carlo.ts). Provides:
 *
 *   - `runMonteCarloArena()`: synchronous MC sweep over an arena DAE
 *   - `runMonteCarloArenaAsync()`: async variant with abort support
 *   - `runSensitivityAnalysisArena()`: one-at-a-time (OAT) sensitivity analysis
 *
 * The arena path is significantly faster than the legacy ModelicaSimulator
 * path because it operates on flat Float64Array buffers with zero-garbage
 * expression evaluation, making it ideal for large sample counts.
 */

import { ArenaDAEBuilder, StaticTapeBuilder } from "@modelscript/compiler";
import {
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
  simulateArena,
  simulateArenaAsync,
} from "../core/simulate-arena.js";

// ─────────────────────────────────────────────────────────────────────
// Arena Monte Carlo Options
// ─────────────────────────────────────────────────────────────────────

/** Extended options for arena-path Monte Carlo. */
export interface ArenaMonteCarloOptions extends MonteCarloOptions {
  /** Simulation options passed to each run (solver, tolerances, etc.). */
  simulateOptions?: ArenaSimulateOptions;
  /** If true, collect all output variable values (not just states). */
  collectAllVariables?: boolean;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────
// Sensitivity Analysis Types
// ─────────────────────────────────────────────────────────────────────

/** Result of a one-at-a-time sensitivity analysis. */
export interface SensitivityResult {
  /** Parameter name → per-output sensitivity coefficients. */
  sensitivities: Map<string, Map<string, number>>;
  /** Base simulation result (at nominal parameter values). */
  baseResult: ArenaSimulationResult;
  /** Perturbation factor used (e.g. 0.01 = 1%). */
  perturbationFactor: number;
}

// ─────────────────────────────────────────────────────────────────────
// Synchronous Arena Monte Carlo
// ─────────────────────────────────────────────────────────────────────

/**
 * Run Monte Carlo uncertainty quantification on an arena DAE.
 *
 * Delegates to the general `runMonteCarloSimulation` engine using
 * `simulateArena` as the per-sample simulation function. This provides
 * full compatibility with the existing MC statistics pipeline while
 * leveraging the fast arena execution path.
 *
 * @param arena       The arena DAE builder (will be cloned per sample)
 * @param randomVars  Random variables with probability distributions
 * @param options     Monte Carlo and simulation options
 */
export function runMonteCarloArena(
  arena: ArenaDAEBuilder,
  randomVars: RandomVariable[],
  options?: ArenaMonteCarloOptions,
): MonteCarloResult {
  const simOpts = options?.simulateOptions ?? {};

  const simulateFn = (overrides: Map<string, number>) => {
    const result = simulateArena(arena, {
      ...simOpts,
      parameterOverrides: mergeOverrides(simOpts.parameterOverrides, overrides),
    });
    return result;
  };

  return runMonteCarloSimulation(simulateFn, randomVars, options);
}

// ─────────────────────────────────────────────────────────────────────
// Async Arena Monte Carlo (with abort + yielding)
// ─────────────────────────────────────────────────────────────────────

/**
 * Async Monte Carlo with cooperative yielding and abort support.
 *
 * Runs N simulations, yielding to the event loop periodically and
 * checking the abort signal between samples. Returns the same
 * MonteCarloResult as the sync variant.
 */
export async function runMonteCarloArenaAsync(
  arena: ArenaDAEBuilder,
  randomVars: RandomVariable[],
  options?: ArenaMonteCarloOptions,
): Promise<MonteCarloResult> {
  const N = options?.numSamples ?? 1000;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);
  const storeTrajectories = options?.storeTrajectories ?? false;
  const simOpts = options?.simulateOptions ?? {};

  // Generate sample sets
  let allSamples: Map<string, number>[];
  if (options?.sobol) {
    allSamples = sobolSample(randomVars, N);
  } else if (options?.latinHypercube) {
    allSamples = latinHypercubeSample(randomVars, N, rng);
  } else {
    allSamples = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      allSamples.push(sample);
    }
  }

  // Add antithetic variates if requested
  if (options?.antithetic) {
    const antiSamples: Map<string, number>[] = [];
    for (const sample of allSamples) {
      const anti = new Map<string, number>();
      for (const rv of randomVars) {
        const val = sample.get(rv.name) ?? 0;
        const mu = distributionMean(rv.distribution);
        anti.set(rv.name, 2 * mu - val);
      }
      antiSamples.push(anti);
    }
    allSamples = allSamples.concat(antiSamples);
  }

  // Run simulations with async yielding
  const allResults: ArenaSimulationResult[] = [];
  for (let i = 0; i < allSamples.length; i++) {
    if (options?.signal?.aborted) {
      throw new Error("Monte Carlo simulation aborted");
    }

    // Yield every 10 samples
    if (i % 10 === 0 && i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const sample = allSamples[i];
    if (!sample) continue;

    try {
      const result = await simulateArenaAsync(arena, {
        ...simOpts,
        parameterOverrides: mergeOverrides(simOpts.parameterOverrides, sample),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      allResults.push(result);
    } catch {
      // Skip failed simulations
      continue;
    }
  }

  // Aggregate statistics using the same logic as the core MC engine
  return aggregateResults(allResults, z, storeTrajectories);
}

// ─────────────────────────────────────────────────────────────────────
// Sensitivity Analysis (One-At-a-Time)
// ─────────────────────────────────────────────────────────────────────

/**
 * Run a one-at-a-time (OAT) sensitivity analysis on an arena DAE.
 *
 * For each parameter, perturbs it by ±perturbationFactor and measures
 * the relative change in each output variable at the final time point.
 * Returns normalized sensitivity coefficients (∂y/∂p * p/y).
 *
 * @param arena              The arena DAE builder
 * @param parameterNames     Parameters to analyze
 * @param nominalValues      Nominal parameter values (name → value)
 * @param perturbationFactor Relative perturbation size (default: 0.01 = 1%)
 * @param simOpts            Simulation options
 */
export function runSensitivityAnalysisArena(
  arena: ArenaDAEBuilder,
  parameterNames: string[],
  nominalValues: Map<string, number>,
  perturbationFactor = 0.01,
  simOpts?: ArenaSimulateOptions,
): SensitivityResult {
  // Run base simulation with nominal values
  const baseResult = simulateArena(arena, {
    ...simOpts,
    parameterOverrides: nominalValues,
  });

  const nT = baseResult.t.length;
  const lastIdx = nT - 1;
  const sensitivities = new Map<string, Map<string, number>>();

  for (const paramName of parameterNames) {
    const p0 = nominalValues.get(paramName) ?? 0;
    const dp = Math.abs(p0) * perturbationFactor || perturbationFactor;

    // Perturbed simulation (p + dp)
    const overridesPlus = new Map(nominalValues);
    overridesPlus.set(paramName, p0 + dp);
    let resultPlus: ArenaSimulationResult;
    try {
      resultPlus = simulateArena(arena, {
        ...simOpts,
        parameterOverrides: overridesPlus,
      });
    } catch {
      continue; // Skip if simulation fails with perturbed parameter
    }

    // Compute normalized sensitivity for each output
    const paramSensitivities = new Map<string, number>();
    for (let s = 0; s < baseResult.states.length; s++) {
      const name = baseResult.states[s] ?? "";
      const y0 = baseResult.y[lastIdx]?.[s] ?? 0;
      const yPlus = resultPlus.y[lastIdx]?.[s] ?? 0;

      // Normalized sensitivity: (∂y/∂p) * (p/y)
      const dyDp = (yPlus - y0) / dp;
      const normalized = y0 !== 0 ? dyDp * (p0 / y0) : dyDp * p0;
      paramSensitivities.set(name, normalized);
    }

    sensitivities.set(paramName, paramSensitivities);
  }

  return { sensitivities, baseResult, perturbationFactor };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** Merge base parameter overrides with MC sample overrides. */
function mergeOverrides(base: Map<string, number> | undefined, sample: Map<string, number>): Map<string, number> {
  if (!base) return sample;
  const merged = new Map(base);
  for (const [k, v] of sample) {
    merged.set(k, v);
  }
  return merged;
}

/** Aggregate simulation results into MonteCarloResult statistics. */
function aggregateResults(
  allResults: ArenaSimulationResult[],
  z: number,
  storeTrajectories: boolean,
): MonteCarloResult {
  const effectiveN = allResults.length;
  if (effectiveN === 0) {
    return {
      statistics: new Map(),
      convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
      numSamples: 0,
    };
  }

  const refResult = allResults[0];
  if (!refResult) {
    return {
      statistics: new Map(),
      convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
      numSamples: 0,
    };
  }

  const nT = refResult.t.length;
  const stateNames = refResult.states;
  const nStates = stateNames.length;

  const statistics = new Map<
    string,
    {
      mean: number[];
      variance: number[];
      stddev: number[];
      ciLo: number[];
      ciHi: number[];
      percentiles: Map<number, number[]>;
    }
  >();
  const sampleTrajectories = storeTrajectories ? new Map<string, number[][]>() : undefined;

  for (let s = 0; s < nStates; s++) {
    const name = stateNames[s] ?? "";
    const meanArr = new Float64Array(nT);
    const varianceArr = new Float64Array(nT);
    const ciLoArr = new Float64Array(nT);
    const ciHiArr = new Float64Array(nT);

    const trajectories: number[][] | undefined = storeTrajectories ? [] : undefined;

    for (let k = 0; k < nT; k++) {
      let sum = 0;
      let count = 0;
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        const row = allResults[i]?.y[k];
        if (!row) continue;
        const v = row[s] ?? 0;
        vals.push(v);
        sum += v;
        count++;
      }

      if (count === 0) continue;
      const mean = sum / count;
      let m2 = 0;
      for (const v of vals) m2 += (v - mean) * (v - mean);
      const variance = count > 1 ? m2 / (count - 1) : 0;
      const stddev = Math.sqrt(variance);
      const se = stddev / Math.sqrt(count);

      meanArr[k] = mean;
      varianceArr[k] = variance;
      ciLoArr[k] = mean - z * se;
      ciHiArr[k] = mean + z * se;
    }

    if (trajectories) {
      for (let i = 0; i < effectiveN; i++) {
        const traj: number[] = [];
        for (let k = 0; k < nT; k++) {
          traj.push(allResults[i]?.y[k]?.[s] ?? 0);
        }
        trajectories.push(traj);
      }
      sampleTrajectories?.set(name, trajectories);
    }

    // Percentiles
    const percentileKeys = [0.05, 0.25, 0.5, 0.75, 0.95];
    const percentileMap = new Map<number, number[]>();
    for (const p of percentileKeys) {
      percentileMap.set(p, new Array(nT).fill(0) as number[]);
    }
    for (let k = 0; k < nT; k++) {
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        vals.push(allResults[i]?.y[k]?.[s] ?? 0);
      }
      vals.sort((a, b) => a - b);
      for (const p of percentileKeys) {
        const idx = Math.min(Math.floor(p * vals.length), vals.length - 1);
        const arr = percentileMap.get(p);
        if (arr) arr[k] = vals[idx] ?? 0;
      }
    }

    statistics.set(name, {
      mean: Array.from(meanArr),
      variance: Array.from(varianceArr),
      stddev: Array.from(varianceArr).map(Math.sqrt),
      ciLo: Array.from(ciLoArr),
      ciHi: Array.from(ciHiArr),
      percentiles: percentileMap,
    });
  }

  // Convergence diagnostic
  const firstState = stateNames[0];
  const firstStats = firstState ? statistics.get(firstState) : undefined;
  let cov = 0;
  if (firstStats && firstStats.mean.length > 0) {
    const lastIdx = firstStats.mean.length - 1;
    const m = firstStats.mean[lastIdx] ?? 0;
    const s = firstStats.stddev[lastIdx] ?? 0;
    cov = m !== 0 ? s / Math.abs(m) : Infinity;
  }

  return {
    statistics,
    sampleTrajectories,
    convergence: {
      coeffOfVariation: cov,
      effectiveSampleSize: effectiveN,
    },
    numSamples: effectiveN,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Monte Carlo Engine Definitions & Implementations (moved from legacy monte-carlo.ts)
// ─────────────────────────────────────────────────────────────────────

export type Distribution =
  | { type: "gaussian"; mean: number; stddev: number }
  | { type: "uniform"; lo: number; hi: number }
  | { type: "lognormal"; mu: number; sigma: number }
  | { type: "beta"; alpha: number; beta: number }
  | { type: "triangular"; lo: number; mode: number; hi: number }
  | { type: "empirical"; samples: number[] };

export interface RandomVariable {
  name: string;
  distribution: Distribution;
}

export interface MonteCarloOptions {
  numSamples?: number;
  seed?: number;
  confidenceLevel?: number;
  antithetic?: boolean;
  latinHypercube?: boolean;
  sobol?: boolean;
  storeTrajectories?: boolean;
}

export interface VariableStatistics {
  mean: number[];
  variance: number[];
  stddev: number[];
  ciLo: number[];
  ciHi: number[];
  percentiles: Map<number, number[]>;
}

export interface MonteCarloResult {
  statistics: Map<string, VariableStatistics>;
  sampleTrajectories?: Map<string, number[][]> | undefined;
  convergence: {
    coeffOfVariation: number;
    effectiveSampleSize: number;
  };
  numSamples: number;
}

export interface ScalarMCResult {
  mean: number;
  variance: number;
  stddev: number;
  ciLo: number;
  ciHi: number;
  percentiles: Map<number, number>;
  samples: number[];
}

export class Xoshiro256pp {
  private s: BigInt64Array;

  constructor(seed: number) {
    this.s = new BigInt64Array(4);
    let z = BigInt(seed) & 0xffffffffffffffffn;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let t = z;
      t = ((t ^ (t >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      t = ((t ^ (t >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      t = (t ^ (t >> 31n)) & 0xffffffffffffffffn;
      this.s[i] = t;
    }
  }

  nextInt64(): bigint {
    const s = this.s;
    const result = (s[0]! + ((s[0]! + s[3]!) & 0xffffffffffffffffn)) & 0xffffffffffffffffn;

    const t = (s[1]! << 17n) & 0xffffffffffffffffn;
    s[2] = (s[2]! ^ s[0]!) & 0xffffffffffffffffn;
    s[3] = (s[3]! ^ s[1]!) & 0xffffffffffffffffn;
    s[1] = (s[1]! ^ s[2]!) & 0xffffffffffffffffn;
    s[0] = (s[0]! ^ s[3]!) & 0xffffffffffffffffn;
    s[2] = (s[2]! ^ t) & 0xffffffffffffffffn;

    const s3 = s[3]!;
    s[3] = ((s3 << 45n) | ((s3 >> 19n) & 0x1ffffffffffffn)) & 0xffffffffffffffffn;

    return result;
  }

  random(): number {
    const bits = this.nextInt64() & 0x7fffffffffffffffn;
    return Number(bits) / Number(0x7fffffffffffffffn);
  }

  randn(): number {
    let u1 = this.random();
    while (u1 === 0) u1 = this.random();
    const u2 = this.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

export function sampleDistribution(dist: Distribution, rng: Xoshiro256pp): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean + dist.stddev * rng.randn();
    case "uniform":
      return dist.lo + (dist.hi - dist.lo) * rng.random();
    case "lognormal": {
      const z = rng.randn();
      return Math.exp(dist.mu + dist.sigma * z);
    }
    case "beta": {
      const a = dist.alpha;
      const b = dist.beta;
      const ga = sampleGamma(a, rng);
      const gb = sampleGamma(b, rng);
      return ga / (ga + gb);
    }
    case "triangular": {
      const u = rng.random();
      const { lo, mode, hi } = dist;
      const fc = (mode - lo) / (hi - lo);
      if (u < fc) {
        return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
      }
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    }
    case "empirical": {
      const idx = Math.floor(rng.random() * dist.samples.length);
      return dist.samples[idx] ?? 0;
    }
  }
}

function sampleGamma(shape: number, rng: Xoshiro256pp): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, rng) * Math.pow(rng.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function distributionMean(dist: Distribution): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean;
    case "uniform":
      return (dist.lo + dist.hi) / 2;
    case "lognormal":
      return Math.exp(dist.mu + (dist.sigma * dist.sigma) / 2);
    case "beta":
      return dist.alpha / (dist.alpha + dist.beta);
    case "triangular":
      return (dist.lo + dist.mode + dist.hi) / 3;
    case "empirical": {
      let sum = 0;
      for (const s of dist.samples) sum += s;
      return sum / (dist.samples.length || 1);
    }
  }
}

export function distributionVariance(dist: Distribution): number {
  switch (dist.type) {
    case "gaussian":
      return dist.stddev * dist.stddev;
    case "uniform":
      return (dist.hi - dist.lo) ** 2 / 12;
    case "lognormal":
      return (Math.exp(dist.sigma * dist.sigma) - 1) * Math.exp(2 * dist.mu + dist.sigma * dist.sigma);
    case "beta": {
      const { alpha, beta } = dist;
      return (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    }
    case "triangular": {
      const { lo, mode, hi } = dist;
      return (lo * lo + mode * mode + hi * hi - lo * mode - lo * hi - mode * hi) / 18;
    }
    case "empirical": {
      const mu = distributionMean(dist);
      let sum = 0;
      for (const s of dist.samples) sum += (s - mu) ** 2;
      return sum / (dist.samples.length || 1);
    }
  }
}

export function isGaussian(dist: Distribution): boolean {
  return dist.type === "gaussian";
}

export function latinHypercubeSample(vars: RandomVariable[], N: number, rng: Xoshiro256pp): Map<string, number>[] {
  const nVars = vars.length;
  const samples: Map<string, number>[] = [];
  const uniformSamples: number[][] = [];
  for (let j = 0; j < nVars; j++) {
    const strata: number[] = [];
    for (let i = 0; i < N; i++) {
      strata.push((i + rng.random()) / N);
    }
    for (let i = N - 1; i > 0; i--) {
      const k = Math.floor(rng.random() * (i + 1));
      const tmp = strata[i]!;
      strata[i] = strata[k]!;
      strata[k] = tmp;
    }
    uniformSamples.push(strata);
  }
  for (let i = 0; i < N; i++) {
    const sample = new Map<string, number>();
    for (let j = 0; j < nVars; j++) {
      const v = vars[j]!;
      const u = uniformSamples[j]![i]!;
      sample.set(v.name, inverseCDF(v.distribution, u));
    }
    samples.push(sample);
  }
  return samples;
}

export class SobolSequence {
  private readonly d: number;
  private x: Uint32Array;
  private index: number;

  private static readonly DIRECTION_NUMBERS: readonly (readonly number[])[] = [
    [1, 0, 1],
    [2, 1, 1, 1],
    [3, 1, 1, 1, 1],
    [3, 2, 1, 3, 1],
    [4, 1, 1, 1, 1, 1],
    [4, 4, 1, 3, 5, 13],
    [5, 2, 1, 1, 5, 5, 17],
    [5, 4, 1, 1, 5, 5, 5],
    [5, 7, 1, 1, 7, 11, 19],
    [5, 11, 1, 1, 5, 1, 1],
    [5, 13, 1, 1, 1, 3, 11],
    [5, 14, 1, 3, 5, 5, 31],
    [6, 1, 1, 3, 3, 9, 7, 49],
    [6, 13, 1, 1, 1, 15, 21, 21],
    [6, 16, 1, 3, 1, 13, 27, 49],
    [7, 19, 1, 1, 1, 15, 7, 5, 127],
    [7, 22, 1, 3, 7, 7, 21, 61, 127],
    [7, 25, 1, 1, 5, 11, 27, 53, 69],
    [7, 37, 1, 3, 1, 7, 11, 29, 17],
  ];

  private V: Uint32Array[];

  constructor(d: number) {
    this.d = d;
    this.x = new Uint32Array(d);
    this.index = 0;
    this.V = this.initDirectionNumbers();
  }

  private initDirectionNumbers(): Uint32Array[] {
    const BITS = 32;
    const V: Uint32Array[] = [];
    const v0 = new Uint32Array(BITS);
    for (let i = 0; i < BITS; i++) {
      v0[i] = 1 << (BITS - 1 - i);
    }
    V.push(v0);
    for (let dim = 1; dim < this.d; dim++) {
      const vd = new Uint32Array(BITS);
      const dnRow = SobolSequence.DIRECTION_NUMBERS[dim - 1];
      if (!dnRow || dnRow.length < 3) {
        for (let i = 0; i < BITS; i++) {
          vd[i] = 1 << (BITS - 1 - i);
        }
        V.push(vd);
        continue;
      }
      const s = dnRow[0] ?? 1;
      const a = dnRow[1] ?? 0;
      for (let i = 0; i < s && i < BITS; i++) {
        const m = dnRow[i + 2] ?? 1;
        vd[i] = m << (BITS - 1 - i);
      }
      for (let i = s; i < BITS; i++) {
        let val = vd[i - s] ?? 0;
        val ^= (vd[i - s] ?? 0) >>> s;
        for (let k = 1; k < s; k++) {
          if (a & (1 << (s - 1 - k))) {
            val ^= vd[i - k] ?? 0;
          }
        }
        vd[i] = val;
      }
      V.push(vd);
    }
    return V;
  }

  next(): number[] {
    this.index++;
    const c = trailingZeros(this.index);
    const point = new Array<number>(this.d);
    for (let dim = 0; dim < this.d; dim++) {
      const vd = this.V[dim];
      if (vd) {
        const prev = this.x[dim] ?? 0;
        this.x[dim] = prev ^ (vd[c] ?? 0);
      }
      point[dim] = (this.x[dim] ?? 0) / 4294967296;
    }
    return point;
  }

  skip(n: number): void {
    for (let i = 0; i < n; i++) this.next();
  }

  reset(): void {
    this.x.fill(0);
    this.index = 0;
  }
}

function trailingZeros(n: number): number {
  if (n === 0) return 32;
  let count = 0;
  let v = n;
  while ((v & 1) === 0) {
    count++;
    v >>>= 1;
  }
  return count;
}

export function sobolSample(vars: RandomVariable[], N: number): Map<string, number>[] {
  const nVars = vars.length;
  const sobol = new SobolSequence(nVars);
  const samples: Map<string, number>[] = [];
  sobol.skip(1);
  for (let i = 0; i < N; i++) {
    const point = sobol.next();
    const sample = new Map<string, number>();
    for (let j = 0; j < nVars; j++) {
      const v = vars[j]!;
      const u = point[j] ?? 0.5;
      sample.set(v.name, inverseCDF(v.distribution, u));
    }
    samples.push(sample);
  }
  return samples;
}

function inverseCDF(dist: Distribution, u: number): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean + dist.stddev * normalQuantile(u);
    case "uniform":
      return dist.lo + (dist.hi - dist.lo) * u;
    case "lognormal":
      return Math.exp(dist.mu + dist.sigma * normalQuantile(u));
    case "beta":
      return betaQuantile(u, dist.alpha, dist.beta);
    case "triangular": {
      const { lo, mode, hi } = dist;
      const fc = (mode - lo) / (hi - lo);
      if (u < fc) {
        return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
      }
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    }
    case "empirical": {
      const sorted = [...dist.samples].sort((a, b) => a - b);
      const idx = u * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, sorted.length - 1);
      const frac = idx - lo;
      return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
    }
  }
}

export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const lim = 0.5;
  if (p > lim) return -normalQuantile(1 - p);
  const r = Math.sqrt(-2 * Math.log(p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.61585836858041e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const num = ((((a[0]! / r + a[1]!) / r + a[2]!) / r + a[3]!) / r + a[4]!) / r + a[5]!;
  const den = ((((b[0]! / r + b[1]!) / r + b[2]!) / r + b[3]!) / r + b[4]!) / r + 1;
  return num / den;
}

function betaQuantile(p: number, alpha: number, beta: number): number {
  let lo = 0,
    hi = 1;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const cdf = regularizedBeta(mid, alpha, beta);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;
  let f = 1,
    c = 1,
    d = 0;
  for (let m = 0; m <= 200; m++) {
    let num: number;
    if (m === 0) {
      num = 1;
    } else if (m % 2 === 0) {
      const k = m / 2;
      num = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
    } else {
      const k = (m - 1) / 2;
      num = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
    }
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-10) break;
  }
  return front * (f - 1);
}

function lgamma(x: number): number {
  if (x <= 0) return Infinity;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i]! / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function runMonteCarloTape(
  ops: StaticTapeBuilder,
  randomVars: RandomVariable[],
  outputIndex: number,
  options?: MonteCarloOptions,
): ScalarMCResult {
  const N = options?.numSamples ?? 1000;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);

  let allSamples: Map<string, number>[];
  if (options?.sobol) {
    allSamples = sobolSample(randomVars, N);
  } else if (options?.latinHypercube) {
    allSamples = latinHypercubeSample(randomVars, N, rng);
  } else {
    allSamples = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      allSamples.push(sample);
    }
  }

  if (options?.antithetic) {
    const antiSamples: Map<string, number>[] = [];
    for (const sample of allSamples) {
      const anti = new Map<string, number>();
      for (const rv of randomVars) {
        const val = sample.get(rv.name) ?? 0;
        const mu = distributionMean(rv.distribution);
        anti.set(rv.name, 2 * mu - val);
      }
      antiSamples.push(anti);
    }
    allSamples = allSamples.concat(antiSamples);
  }

  const results: number[] = [];
  const t = new Array<number>(ops.length);

  for (const sample of allSamples) {
    evaluateTapeFloat(ops, sample, t);
    results.push(t[outputIndex] ?? 0);
  }

  return computeScalarStatistics(results, z);
}

function evaluateTapeFloat(builder: StaticTapeBuilder, values: Map<string, number>, t: number[]): void {
  const n = builder.length;
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = 0; i < n; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case 1:
        t[i] = valData[i]!;
        break;
      case 2:
        t[i] = values.get(interner.resolve(a) || "") ?? 0;
        break;
      case 3:
        t[i] = t[a]! + t[b]!;
        break;
      case 4:
        t[i] = t[a]! - t[b]!;
        break;
      case 5:
        t[i] = t[a]! * t[b]!;
        break;
      case 6:
        t[i] = t[a]! / t[b]!;
        break;
      case 7:
        t[i] = Math.pow(t[a]!, t[b]!);
        break;
      case 8:
        t[i] = -t[a]!;
        break;
      case 9:
        t[i] = Math.sin(t[a]!);
        break;
      case 10:
        t[i] = Math.cos(t[a]!);
        break;
      case 11:
        t[i] = Math.tan(t[a]!);
        break;
      case 12:
        t[i] = Math.exp(t[a]!);
        break;
      case 13:
        t[i] = Math.log(t[a]!);
        break;
      case 14:
        t[i] = Math.sqrt(t[a]!);
        break;
      case 15: {
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          t[i + k] = values.get(`${baseName}[${k + 1}]`) ?? 0;
        }
        break;
      }
      case 16:
        for (let k = 0; k < b; k++) {
          t[i + k] = valData[i + k] ?? 0;
        }
        break;
      case 17:
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! + t[c + k]!;
        break;
      case 18:
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! - t[c + k]!;
        break;
      case 19:
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! * t[c + k]!;
        break;
      case 20:
        for (let k = 0; k < b; k++) t[i + k] = -t[a + k]!;
        break;
      case 21:
        t[i] = t[a + c] ?? 0;
        break;
      case 0:
        break;
    }
  }
}

function computeScalarStatistics(samples: number[], z: number): ScalarMCResult {
  const N = samples.length;
  if (N === 0) {
    return {
      mean: 0,
      variance: 0,
      stddev: 0,
      ciLo: 0,
      ciHi: 0,
      percentiles: new Map(),
      samples: [],
    };
  }

  let sum = 0;
  for (let i = 0; i < N; i++) sum += samples[i]!;
  const mean = sum / N;

  let m2 = 0;
  for (let i = 0; i < N; i++) {
    const d = samples[i]! - mean;
    m2 += d * d;
  }
  const variance = m2 / (N - 1);
  const stddev = Math.sqrt(variance);

  const seMean = stddev / Math.sqrt(N);
  const ciLo = mean - z * seMean;
  const ciHi = mean + z * seMean;

  const sorted = [...samples].sort((a, b) => a - b);
  const percentiles = new Map<number, number>();
  for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
    const idx = Math.min(Math.floor(p * N), N - 1);
    percentiles.set(p, sorted[idx]!);
  }

  return { mean, variance, stddev, ciLo, ciHi, percentiles, samples };
}

export function runMonteCarloSimulation(
  simulateFn: (overrides: Map<string, number>) => { t: number[]; y: number[][]; states: string[] },
  randomVars: RandomVariable[],
  options?: MonteCarloOptions,
): MonteCarloResult {
  const N = options?.numSamples ?? 1000;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);
  const storeTrajectories = options?.storeTrajectories ?? false;

  let allSamples: Map<string, number>[];
  if (options?.sobol) {
    allSamples = sobolSample(randomVars, N);
  } else if (options?.latinHypercube) {
    allSamples = latinHypercubeSample(randomVars, N, rng);
  } else {
    allSamples = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      allSamples.push(sample);
    }
  }

  const allResults: { t: number[]; y: number[][]; states: string[] }[] = [];
  for (const sample of allSamples) {
    try {
      allResults.push(simulateFn(sample));
    } catch {
      continue;
    }
  }

  const effectiveN = allResults.length;
  if (effectiveN === 0) {
    return {
      statistics: new Map(),
      convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
      numSamples: 0,
    };
  }

  const refResult = allResults[0]!;
  const nT = refResult.t.length;
  const stateNames = refResult.states;
  const nStates = stateNames.length;

  const statistics = new Map<string, VariableStatistics>();
  const sampleTrajectories = storeTrajectories ? new Map<string, number[][]>() : undefined;

  for (let s = 0; s < nStates; s++) {
    const name = stateNames[s]!;
    const meanArr = new Float64Array(nT);
    const varianceArr = new Float64Array(nT);
    const ciLoArr = new Float64Array(nT);
    const ciHiArr = new Float64Array(nT);

    const trajectories: number[][] | undefined = storeTrajectories ? [] : undefined;

    for (let k = 0; k < nT; k++) {
      let sum = 0;
      let count = 0;
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        const row = allResults[i]!.y[k];
        if (!row) continue;
        const v = row[s] ?? 0;
        vals.push(v);
        sum += v;
        count++;
      }

      if (count === 0) continue;
      const mean = sum / count;
      let m2 = 0;
      for (const v of vals) m2 += (v - mean) * (v - mean);
      const variance = count > 1 ? m2 / (count - 1) : 0;
      const stddev = Math.sqrt(variance);
      const se = stddev / Math.sqrt(count);

      meanArr[k] = mean;
      varianceArr[k] = variance;
      ciLoArr[k] = mean - z * se;
      ciHiArr[k] = mean + z * se;
    }

    if (trajectories) {
      for (let i = 0; i < effectiveN; i++) {
        const traj: number[] = [];
        for (let k = 0; k < nT; k++) {
          traj.push(allResults[i]!.y[k]?.[s] ?? 0);
        }
        trajectories.push(traj);
      }
      sampleTrajectories!.set(name, trajectories);
    }

    const percentileKeys = [0.05, 0.25, 0.5, 0.75, 0.95];
    const percentileMap = new Map<number, number[]>();
    for (const p of percentileKeys) {
      percentileMap.set(p, new Array(nT).fill(0));
    }
    for (let k = 0; k < nT; k++) {
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        vals.push(allResults[i]!.y[k]?.[s] ?? 0);
      }
      vals.sort((a, b) => a - b);
      for (const p of percentileKeys) {
        const idx = Math.min(Math.floor(p * vals.length), vals.length - 1);
        percentileMap.get(p)![k] = vals[idx]!;
      }
    }

    statistics.set(name, {
      mean: Array.from(meanArr),
      variance: Array.from(varianceArr),
      stddev: Array.from(varianceArr).map(Math.sqrt),
      ciLo: Array.from(ciLoArr),
      ciHi: Array.from(ciHiArr),
      percentiles: percentileMap,
    });
  }

  const firstState = stateNames[0];
  const firstStats = firstState ? statistics.get(firstState) : undefined;
  let cov = 0;
  if (firstStats && firstStats.mean.length > 0) {
    const lastIdx = firstStats.mean.length - 1;
    const m = firstStats.mean[lastIdx]!;
    const s = firstStats.stddev[lastIdx]!;
    cov = m !== 0 ? s / Math.abs(m) : Infinity;
  }

  return {
    statistics,
    sampleTrajectories,
    convergence: {
      coeffOfVariation: cov,
      effectiveSampleSize: effectiveN,
    },
    numSamples: effectiveN,
  };
}
