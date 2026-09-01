// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Design of Experiments (DoE) for the Arena Simulation Pipeline.
 * Backed by the high-performance WASM DoE sampling and simulation runtime engine.
 *
 * Runs sampling plans over parameter spaces using the high-performance
 * `simulateArena` pipeline. Suitable for building ROM training datasets,
 * parameter sweeps, and response surface methodology directly from Modelica models.
 */

import { DAEBuilder } from "../compiler/index.js";
import {
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
  simulateArena,
  simulateArenaAsync,
} from "../compiler/simulator/core/simulate-arena.js";
import { SobolSequence, Xoshiro256pp } from "./wasm_monte_carlo.js";

// ─────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────

/** Range specification for a single DoE input parameter. */
export interface ArenaDoEInputRange {
  /** Minimum value. */
  min: number;
  /** Maximum value. */
  max: number;
  /** Number of levels for full-factorial (default: 5). */
  levels?: number;
}

export type DoESamplingStrategy = "full-factorial" | "latin-hypercube" | "sobol" | "central-composite";

/** Configuration for an arena DoE run. */
export interface ArenaDoEConfig {
  /** Input parameter ranges: name → { min, max, levels? }. */
  inputs: Map<string, ArenaDoEInputRange>;
  /** Output variable names to record. */
  outputs: string[];
  /** Sampling strategy. */
  strategy: DoESamplingStrategy;
  /** Number of samples (ignored for full-factorial / central-composite). */
  numSamples?: number;
  /** Simulation options passed to `simulateArena()`. */
  simulateOptions?: ArenaSimulateOptions;
  /**
   * Time points at which to snapshot outputs.
   * Default: only `stopTime` (steady-state response).
   */
  snapshotTimes?: number[];
  /** PRNG seed for reproducibility (default: Date.now()). */
  seed?: number;
  /** Progress callback: (completedSamples, totalSamples). */
  onProgress?: (done: number, total: number) => void;
}

/** Result of an arena DoE run. */
export interface ArenaDoEResult {
  /** Input sample matrix: [sampleIdx][inputIdx]. */
  inputs: number[][];
  /**
   * Output response matrix.
   * - Steady-state (no snapshotTimes): [sampleIdx][outputIdx]
   * - Transient (with snapshotTimes): [sampleIdx][timeIdx][outputIdx]
   */
  outputs: number[][] | number[][][];
  /** Input parameter names (ordered). */
  inputNames: string[];
  /** Output variable names (ordered). */
  outputNames: string[];
  /** Snapshot times (if transient mode). */
  snapshotTimes?: number[];
  /** Whether this is a transient (multi-time) dataset. */
  isTransient: boolean;
  /** Wall-clock time in ms. */
  wallClockMs: number;
  /** Number of failed samples. */
  failedSamples: number;
  /** Total samples attempted. */
  totalSamples: number;
}

// ─────────────────────────────────────────────────────────────────────
// Sampling Generators
// ─────────────────────────────────────────────────────────────────────

/** Generate full-factorial sample points: all combinations of N levels per factor. */
export function generateFullFactorial(inputNames: string[], ranges: Map<string, ArenaDoEInputRange>): number[][] {
  const nInputs = inputNames.length;
  const levels: number[][] = [];
  const levelCounts: number[] = [];

  for (const name of inputNames) {
    const range = ranges.get(name);
    if (!range) continue;
    const nLevels = range.levels ?? 5;
    levelCounts.push(nLevels);
    const vals: number[] = [];
    for (let i = 0; i < nLevels; i++) {
      vals.push(
        nLevels === 1 ? (range.min + range.max) / 2 : range.min + (i / (nLevels - 1)) * (range.max - range.min),
      );
    }
    levels.push(vals);
  }

  const totalSamples = levelCounts.reduce((a, b) => a * b, 1);
  const samples: number[][] = [];
  for (let s = 0; s < totalSamples; s++) {
    const point = new Array<number>(nInputs);
    let idx = s;
    for (let d = nInputs - 1; d >= 0; d--) {
      const nL = levelCounts[d] ?? 1;
      point[d] = levels[d]?.[idx % nL] ?? 0;
      idx = Math.floor(idx / nL);
    }
    samples.push(point);
  }

  return samples;
}

/** Generate Latin Hypercube sample points with stratified intervals. */
export function generateLatinHypercube(
  inputNames: string[],
  ranges: Map<string, ArenaDoEInputRange>,
  numSamples: number,
  rng: Xoshiro256pp,
): number[][] {
  const nInputs = inputNames.length;
  const samples: number[][] = [];

  const uniformSamples: number[][] = [];
  for (let d = 0; d < nInputs; d++) {
    const strata: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      strata.push((i + rng.random()) / numSamples);
    }
    for (let i = numSamples - 1; i > 0; i--) {
      const k = Math.floor(rng.random() * (i + 1));
      const tmp = strata[i] ?? 0;
      strata[i] = strata[k] ?? 0;
      strata[k] = tmp;
    }
    uniformSamples.push(strata);
  }

  for (let s = 0; s < numSamples; s++) {
    const point = new Array<number>(nInputs);
    for (let d = 0; d < nInputs; d++) {
      const name = inputNames[d] ?? "";
      const range = ranges.get(name);
      if (!range) {
        point[d] = 0;
        continue;
      }
      const u = uniformSamples[d]?.[s] ?? 0.5;
      point[d] = range.min + u * (range.max - range.min);
    }
    samples.push(point);
  }

  return samples;
}

/**
 * Generate Sobol quasi-random sequence sample points using
 * Joe & Kuo direction numbers for low-discrepancy exploration.
 */
export function generateSobolPoints(
  inputNames: string[],
  ranges: Map<string, ArenaDoEInputRange>,
  numSamples: number,
): number[][] {
  const nInputs = inputNames.length;
  const sobol = new SobolSequence(nInputs);
  const samples: number[][] = [];

  // Skip origin point
  sobol.skip(1);

  for (let s = 0; s < numSamples; s++) {
    const raw = sobol.next();
    const point = new Array<number>(nInputs);
    for (let d = 0; d < nInputs; d++) {
      const name = inputNames[d] ?? "";
      const range = ranges.get(name);
      if (!range) {
        point[d] = 0;
        continue;
      }
      const u = raw[d] ?? 0.5;
      point[d] = range.min + u * (range.max - range.min);
    }
    samples.push(point);
  }

  return samples;
}

/**
 * Generate Central Composite Design (CCD) sample points.
 * Combines: 2^k factorial corners + 2k axial (star) points (±alpha) + 1 center point.
 */
export function generateCentralComposite(inputNames: string[], ranges: Map<string, ArenaDoEInputRange>): number[][] {
  const k = inputNames.length;
  const alpha = Math.pow(2, k / 4);
  const samples: number[][] = [];

  const centers: number[] = [];
  const halfRanges: number[] = [];
  for (const name of inputNames) {
    const range = ranges.get(name);
    if (!range) {
      centers.push(0);
      halfRanges.push(1);
      continue;
    }
    centers.push((range.min + range.max) / 2);
    halfRanges.push((range.max - range.min) / 2);
  }

  // Factorial corners (2^k)
  const nFactorial = 1 << k;
  for (let i = 0; i < nFactorial; i++) {
    const point = new Array<number>(k);
    for (let d = 0; d < k; d++) {
      const coded = (i >> d) & 1 ? 1 : -1;
      point[d] = (centers[d] ?? 0) + coded * (halfRanges[d] ?? 1);
    }
    samples.push(point);
  }

  // Axial (star) points at ±alpha
  for (let d = 0; d < k; d++) {
    const pointPlus = centers.slice();
    const pointMinus = centers.slice();
    pointPlus[d] = (centers[d] ?? 0) + alpha * (halfRanges[d] ?? 1);
    pointMinus[d] = (centers[d] ?? 0) - alpha * (halfRanges[d] ?? 1);
    const range = ranges.get(inputNames[d] ?? "");
    if (range) {
      pointPlus[d] = Math.min(range.max, pointPlus[d] ?? 0);
      pointMinus[d] = Math.max(range.min, pointMinus[d] ?? 0);
    }
    samples.push(pointPlus);
    samples.push(pointMinus);
  }

  // Center point
  samples.push(centers.slice());

  return samples;
}

/**
 * Generate sampling points for any supported strategy.
 */
export function generateDoESamplePoints(
  strategy: DoESamplingStrategy,
  inputNames: string[],
  ranges: Map<string, ArenaDoEInputRange>,
  numSamples: number = 50,
  seed: number = Date.now(),
): number[][] {
  const rng = new Xoshiro256pp(seed);
  switch (strategy) {
    case "full-factorial":
      return generateFullFactorial(inputNames, ranges);
    case "latin-hypercube":
      return generateLatinHypercube(inputNames, ranges, numSamples, rng);
    case "sobol":
      return generateSobolPoints(inputNames, ranges, numSamples);
    case "central-composite":
      return generateCentralComposite(inputNames, ranges);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Arena DoE Orchestrators
// ─────────────────────────────────────────────────────────────────────

/**
 * Run a Design of Experiments directly on an `DAEBuilder` model
 * using the high-performance `simulateArena` pipeline.
 *
 * Each sample point sets parameter overrides, runs a full simulation,
 * and extracts output variables at the requested snapshot times.
 *
 * @param arena  The compiled arena DAE.
 * @param config DoE configuration.
 * @returns      The collected input-output dataset.
 */
export function runArenaDoE(arena: DAEBuilder, config: ArenaDoEConfig): ArenaDoEResult {
  const wallStart = performance.now();
  const inputNames = Array.from(config.inputs.keys());
  const outputNames = config.outputs;
  const stopTime = config.simulateOptions?.stopTime ?? arena.experiment.stopTime ?? 10;
  const isTransient = (config.snapshotTimes?.length ?? 0) > 0;
  const snapshotTimes = config.snapshotTimes ?? [stopTime];

  const samplePoints = generateDoESamplePoints(
    config.strategy,
    inputNames,
    config.inputs,
    config.numSamples ?? 50,
    config.seed ?? Date.now(),
  );

  const totalSamples = samplePoints.length;
  let failedSamples = 0;

  const inputMatrix: number[][] = [];
  const outputMatrix: number[][] | number[][][] = [];

  for (let s = 0; s < totalSamples; s++) {
    const point = samplePoints[s];
    if (!point) continue;

    try {
      const parameterOverrides = new Map<string, number>();
      for (let d = 0; d < inputNames.length; d++) {
        parameterOverrides.set(inputNames[d] ?? "", point[d] ?? 0);
      }

      const simResult: ArenaSimulationResult = simulateArena(arena, {
        ...config.simulateOptions,
        parameterOverrides,
      });

      const timeOutputs = extractOutputsAtTimes(simResult, outputNames, snapshotTimes);

      inputMatrix.push(point);
      if (isTransient) {
        (outputMatrix as number[][][]).push(timeOutputs);
      } else {
        (outputMatrix as number[][]).push(timeOutputs[timeOutputs.length - 1] ?? []);
      }
    } catch {
      failedSamples++;
    }

    config.onProgress?.(s + 1, totalSamples);
  }

  const wallClockMs = performance.now() - wallStart;

  const result: ArenaDoEResult = {
    inputs: inputMatrix,
    outputs: outputMatrix,
    inputNames,
    outputNames,
    isTransient,
    wallClockMs,
    failedSamples,
    totalSamples,
  };
  if (isTransient) {
    result.snapshotTimes = snapshotTimes;
  }
  return result;
}

/**
 * Async variant with cooperative yielding and abort support.
 */
export async function runArenaDoEAsync(
  arena: DAEBuilder,
  config: ArenaDoEConfig & { signal?: AbortSignal },
): Promise<ArenaDoEResult> {
  const wallStart = performance.now();
  const inputNames = Array.from(config.inputs.keys());
  const outputNames = config.outputs;
  const stopTime = config.simulateOptions?.stopTime ?? arena.experiment.stopTime ?? 10;
  const isTransient = (config.snapshotTimes?.length ?? 0) > 0;
  const snapshotTimes = config.snapshotTimes ?? [stopTime];

  const samplePoints = generateDoESamplePoints(
    config.strategy,
    inputNames,
    config.inputs,
    config.numSamples ?? 50,
    config.seed ?? Date.now(),
  );

  const totalSamples = samplePoints.length;
  let failedSamples = 0;

  const inputMatrix: number[][] = [];
  const outputMatrix: number[][] | number[][][] = [];

  for (let s = 0; s < totalSamples; s++) {
    if (config.signal?.aborted) {
      break;
    }

    const point = samplePoints[s];
    if (!point) continue;

    try {
      const parameterOverrides = new Map<string, number>();
      for (let d = 0; d < inputNames.length; d++) {
        parameterOverrides.set(inputNames[d] ?? "", point[d] ?? 0);
      }

      const simResult: ArenaSimulationResult = await simulateArenaAsync(arena, {
        ...config.simulateOptions,
        parameterOverrides,
      });

      const timeOutputs = extractOutputsAtTimes(simResult, outputNames, snapshotTimes);

      inputMatrix.push(point);
      if (isTransient) {
        (outputMatrix as number[][][]).push(timeOutputs);
      } else {
        (outputMatrix as number[][]).push(timeOutputs[timeOutputs.length - 1] ?? []);
      }
    } catch {
      failedSamples++;
    }

    config.onProgress?.(s + 1, totalSamples);

    // Yield every 5 samples for responsiveness
    if (s % 5 === 4) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  const wallClockMs = performance.now() - wallStart;

  const result: ArenaDoEResult = {
    inputs: inputMatrix,
    outputs: outputMatrix,
    inputNames,
    outputNames,
    isTransient,
    wallClockMs,
    failedSamples,
    totalSamples,
  };
  if (isTransient) {
    result.snapshotTimes = snapshotTimes;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Output Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract output variable values from a simulation result at specific times.
 * Uses nearest-neighbor lookup on the simulation time grid.
 */
export function extractOutputsAtTimes(
  result: ArenaSimulationResult,
  outputNames: string[],
  snapshotTimes: number[],
): number[][] {
  const timeOutputs: number[][] = [];

  const stateIdx = new Map<string, number>();
  for (let i = 0; i < result.states.length; i++) {
    stateIdx.set(result.states[i] ?? "", i);
  }

  for (const snapTime of snapshotTimes) {
    let bestIdx = 0;
    let bestDist = Math.abs((result.t[0] ?? 0) - snapTime);
    for (let i = 1; i < result.t.length; i++) {
      const dist = Math.abs((result.t[i] ?? 0) - snapTime);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const row: number[] = [];
    const yRow = result.y[bestIdx];
    for (const name of outputNames) {
      const idx = stateIdx.get(name);
      row.push(idx !== undefined && yRow ? (yRow[idx] ?? 0) : 0);
    }
    timeOutputs.push(row);
  }

  return timeOutputs;
}
