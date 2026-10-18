// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal Black-Box & Metaheuristic Optimization Interfaces.
 *
 * Provides domain-agnostic single- and multi-objective optimization problem
 * contracts, supporting batch evaluations, vectorization, and deterministic seeding.
 */

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
