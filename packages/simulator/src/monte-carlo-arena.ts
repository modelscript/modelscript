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

import { ArenaDAEBuilder } from "@modelscript/compiler";
import type { MonteCarloOptions, MonteCarloResult, RandomVariable } from "./monte-carlo.js";
import {
  Xoshiro256pp,
  distributionMean,
  latinHypercubeSample,
  normalQuantile,
  runMonteCarloSimulation,
  sampleDistribution,
} from "./monte-carlo.js";
import {
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
  simulateArena,
  simulateArenaAsync,
} from "./simulate-arena.js";

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
  if (options?.latinHypercube) {
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
