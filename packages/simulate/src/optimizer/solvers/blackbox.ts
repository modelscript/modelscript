// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal Black-Box & Metaheuristic Optimization Interfaces.
 *
 * Provides domain-agnostic single- and multi-objective optimization problem
 * contracts, supporting batch evaluations, vectorization, and deterministic seeding.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";

export interface BlackBoxBounds {
  min: Float64Array;
  max: Float64Array;
}

export interface BlackBoxProblem {
  dimension: number;
  bounds: BlackBoxBounds;
  fitness: (x: Float64Array) => Promise<number> | number;
  batchFitness?: ((X: Float64Array[]) => Promise<number[]> | number[]) | undefined;
  initialGuess?: Float64Array | undefined;
  initialSigma?: number | undefined;
}

export interface MultiObjectiveProblem {
  dimension: number;
  numObjectives: number;
  bounds: BlackBoxBounds;
  fitness: (x: Float64Array) => Promise<Float64Array> | Float64Array;
  batchFitness?: ((X: Float64Array[]) => Promise<Float64Array[]> | Float64Array[]) | undefined;
  initialGuess?: Float64Array | undefined;
}

export interface SingleObjectiveOptions {
  maxGenerations?: number | undefined;
  populationSize?: number | undefined;
  tolerance?: number | undefined;
  seed?: number | undefined;
  onGeneration?: ((gen: number, bestFitness: number, bestSolution: Float64Array) => void) | undefined;
}

export interface SingleObjectiveResult {
  bestSolution: Float64Array;
  bestFitness: number;
  history: number[];
  evaluations: number;
  iterations: number;
  converged: boolean;
  message: string;
}

export interface MultiObjectiveCandidate {
  point: Float64Array;
  objectives: Float64Array;
  rank: number;
  crowdingDistance: number;
}

export interface MultiObjectiveOptions {
  maxGenerations?: number | undefined;
  populationSize?: number | undefined;
  crossoverProb?: number | undefined;
  mutationProb?: number | undefined;
  crossoverDistIndex?: number | undefined;
  mutationDistIndex?: number | undefined;
  seed?: number | undefined;
  onGeneration?: ((gen: number, paretoCount: number) => void) | undefined;
}

export interface MultiObjectiveResult {
  paretoFront: MultiObjectiveCandidate[];
  allCandidates?: MultiObjectiveCandidate[] | undefined;
  evaluations: number;
  iterations: number;
  message: string;
}

/**
 * Creates a deterministic pseudo-random number generator function using Mulberry32.
 */
export function createRng(seed?: number): () => number {
  if (seed === undefined) {
    return Math.random;
  }
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Evaluates candidate solutions using problem.batchFitness if available, or concurrent Promise.all.
 */
export async function evaluateBatchOrSingle(problem: BlackBoxProblem, candidates: Float64Array[]): Promise<number[]> {
  if (candidates.length === 0) return [];
  if (problem.batchFitness) {
    const res = await problem.batchFitness(candidates);
    return Array.from(res);
  }
  const promises = candidates.map((c) => Promise.resolve(problem.fitness(c)));
  return Promise.all(promises);
}

/**
 * Evaluates multi-objective candidate solutions using batchFitness or concurrent Promise.all.
 */
export async function evaluateMultiObjectiveBatchOrSingle(
  problem: MultiObjectiveProblem,
  candidates: Float64Array[],
): Promise<Float64Array[]> {
  if (candidates.length === 0) return [];
  if (problem.batchFitness) {
    const res = await problem.batchFitness(candidates);
    return res;
  }
  const promises = candidates.map((c) => Promise.resolve(problem.fitness(c)));
  return Promise.all(promises);
}

interface NdsWasmExports {
  memory: WebAssembly.Memory;
  __new(bytes: number, id: number): number;
  __pin?(ptr: number): void;
  nsga3FastNonDominatedSortWasm(n: number, m: number, objsPtr: number, ranksPtr: number): number;
}

interface NdsWasmScratch {
  wasm: NdsWasmExports;
  capN: number;
  capM: number;
  objsPtr: number;
  ranksPtr: number;
}

let ndsScratch: NdsWasmScratch | null = null;

function ensureNdsScratch(wasm: NdsWasmExports, n: number, m: number): NdsWasmScratch | null {
  if (!wasm || typeof wasm.__new !== "function") return null;
  if (ndsScratch && ndsScratch.wasm === wasm && ndsScratch.capN >= n && ndsScratch.capM >= m) {
    return ndsScratch;
  }
  const capN = Math.max(n, 128);
  const capM = Math.max(m, 8);
  const alloc = (bytes: number): number => {
    const ptr = wasm.__new(bytes, 0);
    if (typeof wasm.__pin === "function") wasm.__pin(ptr);
    return ptr;
  };
  ndsScratch = {
    wasm,
    capN,
    capM,
    objsPtr: alloc(capN * capM * 8),
    ranksPtr: alloc(capN * 4),
  };
  return ndsScratch;
}

/**
 * Shared WASM fast non-dominated sort helper for NSGA-II and NSGA-III (`n >= 16`).
 * Returns `null` if WASM is unavailable or `n < 16`.
 */
export function fastNonDominatedSortWasm<
  T extends { objectives: Float64Array; rank: number; dominationCount: number; dominatedIndices: number[] },
>(pop: T[]): T[][] | null {
  const n = pop.length;
  if (n < 16) return null;
  const m = pop[0]?.objectives.length ?? 0;
  if (m === 0) return null;
  const wasm = getDefaultWasmExports() as NdsWasmExports | null;
  if (!wasm || typeof wasm.nsga3FastNonDominatedSortWasm !== "function") return null;
  const s = ensureNdsScratch(wasm, n, m);
  if (!s) return null;

  const buf = wasm.memory.buffer;
  const objsView = new Float64Array(buf, s.objsPtr, n * m);
  for (let i = 0; i < n; i++) {
    objsView.set(pop[i]!.objectives.subarray(0, m), i * m);
  }
  const numFronts: number = wasm.nsga3FastNonDominatedSortWasm(n, m, s.objsPtr, s.ranksPtr);
  const ranksView = new Int32Array(wasm.memory.buffer, s.ranksPtr, n);
  const fronts: T[][] = Array.from({ length: Math.max(1, numFronts) }, () => []);
  for (let i = 0; i < n; i++) {
    const ind = pop[i]!;
    const r = ranksView[i]!;
    ind.rank = r;
    ind.dominationCount = 0;
    ind.dominatedIndices = [];
    fronts[r]!.push(ind);
  }
  return fronts;
}
