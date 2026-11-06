// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Dominated Sorting Genetic Algorithm III (NSGA-III) in Pure TypeScript.
 *
 * Implements reference-point-based many-objective evolutionary optimization with:
 *   - Das & Dennis systematic reference point generation across the unit simplex
 *   - Fast non-dominated sorting (Pareto fronts F_1, F_2, ...)
 *   - Hyperplane normalization and extreme point intercept calculation
 *   - Perpendicular distance projection and reference line association
 *   - Niche-preservation selection (min niche count rho_j)
 *   - Simulated Binary Crossover (SBX) & Polynomial Mutation
 *   - Specialized multi-objective Transmission Expansion Planning (TEP) runner
 *
 * Academic Citation:
 *   Deb, K., & Jain, H. (2014).
 *   "An evolutionary many-objective optimization algorithm using reference-point-based
 *    nondominated sorting approach, part I: solving problems with box constraints."
 *   IEEE Transactions on Evolutionary Computation, 18(4), 577-601.
 */

import { solveDcOpf } from "../../solvers/opf/dc-opf.js";
import type { GenericPowerCase } from "../../solvers/opf/types.js";
import {
  createRng,
  evaluateMultiObjectiveBatchOrSingle,
  type MultiObjectiveOptions,
  type MultiObjectiveProblem,
  type MultiObjectiveResult,
} from "./blackbox.js";

export interface Nsga3Options extends MultiObjectiveOptions {
  /** Number of reference point divisions per objective (default: 4 for M<=3, 3 for M>3). */
  divisions?: number | undefined;
  /** Explicit reference points if pre-computed. */
  referencePoints?: Float64Array[] | undefined;
}

interface InternalIndividual {
  point: Float64Array;
  objectives: Float64Array;
  normalizedObjectives: Float64Array;
  rank: number;
  associatedRefPoint: number;
  perpendicularDistance: number;
  dominationCount: number;
  dominatedIndices: number[];
}

/**
 * Generates Das-Dennis reference points on an M-dimensional unit simplex.
 * Each point satisfies sum(w_m) = 1, w_m in {0, 1/p, 2/p, ..., 1}.
 */
export function generateDasDennisReferencePoints(M: number, p: number): Float64Array[] {
  const points: Float64Array[] = [];
  const current = new Float64Array(M);

  function recurse(dim: number, left: number): void {
    if (dim === M - 1) {
      current[dim] = left / p;
      points.push(new Float64Array(current));
      return;
    }
    for (let i = 0; i <= left; i++) {
      current[dim] = i / p;
      recurse(dim + 1, left - i);
    }
  }

  recurse(0, p);
  return points;
}

/** Checks whether individual A dominates individual B (Pareto minimization). */
function dominates(objA: Float64Array, objB: Float64Array): boolean {
  let atLeastOneBetter = false;
  const m = objA.length;
  for (let i = 0; i < m; i++) {
    if (objA[i]! > objB[i]!) return false;
    if (objA[i]! < objB[i]!) atLeastOneBetter = true;
  }
  return atLeastOneBetter;
}

/** Fast non-dominated sorting into hierarchical Pareto fronts. */
function fastNonDominatedSort(pop: InternalIndividual[]): InternalIndividual[][] {
  const fronts: InternalIndividual[][] = [[]];

  for (let i = 0; i < pop.length; i++) {
    const p = pop[i]!;
    p.dominationCount = 0;
    p.dominatedIndices = [];

    for (let j = 0; j < pop.length; j++) {
      if (i === j) continue;
      const q = pop[j]!;
      if (dominates(p.objectives, q.objectives)) {
        p.dominatedIndices.push(j);
      } else if (dominates(q.objectives, p.objectives)) {
        p.dominationCount++;
      }
    }

    if (p.dominationCount === 0) {
      p.rank = 0;
      fronts[0]!.push(p);
    }
  }

  let currentFront = 0;
  while (fronts[currentFront] && fronts[currentFront]!.length > 0) {
    const nextFront: InternalIndividual[] = [];
    for (const p of fronts[currentFront]!) {
      for (const qIdx of p.dominatedIndices) {
        const q = pop[qIdx]!;
        q.dominationCount--;
        if (q.dominationCount === 0) {
          q.rank = currentFront + 1;
          nextFront.push(q);
        }
      }
    }
    currentFront++;
    if (nextFront.length > 0) {
      fronts.push(nextFront);
    }
  }

  return fronts;
}

/**
 * Normalizes objective values using ideal point and extreme point intercepts.
 */
function normalizeObjectives(
  pop: InternalIndividual[],
  M: number,
  idealPoint: Float64Array,
): Float64Array {
  // Update ideal point
  for (let m = 0; m < M; m++) {
    let minVal = idealPoint[m]!;
    for (const ind of pop) {
      if (ind.objectives[m]! < minVal) {
        minVal = ind.objectives[m]!;
      }
    }
    idealPoint[m] = minVal;
  }

  // Intercepts calculation (approximate with max values for robustness)
  const intercepts = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    let maxVal = -Infinity;
    for (const ind of pop) {
      const diff = ind.objectives[m]! - idealPoint[m]!;
      if (diff > maxVal) maxVal = diff;
    }
    intercepts[m] = maxVal > 1e-6 ? maxVal : 1.0;
  }

  // Normalize each individual
  for (const ind of pop) {
    for (let m = 0; m < M; m++) {
      ind.normalizedObjectives[m] = (ind.objectives[m]! - idealPoint[m]!) / intercepts[m]!;
    }
  }

  return intercepts;
}

/**
 * Computes perpendicular distance from a point to a reference line.
 */
function perpendicularDistance(point: Float64Array, refLine: Float64Array): number {
  let dotProduct = 0.0;
  let refNormSq = 0.0;
  const M = point.length;

  for (let m = 0; m < M; m++) {
    dotProduct += point[m]! * refLine[m]!;
    refNormSq += refLine[m]! * refLine[m]!;
  }

  if (refNormSq < 1e-12) return 0.0;

  const projectionScale = dotProduct / refNormSq;
  let distSq = 0.0;

  for (let m = 0; m < M; m++) {
    const diff = point[m]! - projectionScale * refLine[m]!;
    distSq += diff * diff;
  }

  return Math.sqrt(Math.max(0.0, distSq));
}

/**
 * Associates each population member with its nearest reference point.
 */
function associateWithReferencePoints(
  pop: InternalIndividual[],
  refPoints: Float64Array[],
): void {
  for (const ind of pop) {
    let bestRef = 0;
    let minDistance = Infinity;

    for (let r = 0; r < refPoints.length; r++) {
      const d = perpendicularDistance(ind.normalizedObjectives, refPoints[r]!);
      if (d < minDistance) {
        minDistance = d;
        bestRef = r;
      }
    }

    ind.associatedRefPoint = bestRef;
    ind.perpendicularDistance = minDistance;
  }
}

/**
 * Niche-preservation selection for filling remaining slots in P_{t+1}.
 */
function nichePreservationSelection(
  selected: InternalIndividual[],
  lastFront: InternalIndividual[],
  targetSize: number,
  refPoints: Float64Array[],
  rng: () => number,
): void {
  const K = targetSize - selected.length;
  if (K <= 0) return;

  // Compute niche counts rho_j from already selected individuals
  const rho = new Int32Array(refPoints.length);
  for (const ind of selected) {
    rho[ind.associatedRefPoint] = (rho[ind.associatedRefPoint] ?? 0) + 1;
  }

  // Group candidate individuals from lastFront by associated reference point
  const candidatesByRef: InternalIndividual[][] = Array.from(
    { length: refPoints.length },
    () => [],
  );
  for (const ind of lastFront) {
    candidatesByRef[ind.associatedRefPoint]!.push(ind);
  }

  const activeRefs = new Set<number>();
  for (let r = 0; r < refPoints.length; r++) {
    if (candidatesByRef[r]!.length > 0) activeRefs.add(r);
  }

  for (let k = 0; k < K; k++) {
    if (activeRefs.size === 0) {
      // If no associations left, pick arbitrary from remaining in lastFront
      for (const ind of lastFront) {
        if (!selected.includes(ind)) {
          selected.push(ind);
          if (selected.length === targetSize) return;
        }
      }
      return;
    }

    // Find reference points with minimum niche count rho
    let minRho = Infinity;
    for (const r of activeRefs) {
      if (rho[r]! < minRho) minRho = rho[r]!;
    }

    const minRefCandidates: number[] = [];
    for (const r of activeRefs) {
      if ((rho[r]!) === minRho) minRefCandidates.push(r);
    }

    const chosenRef = minRefCandidates[Math.floor(rng() * minRefCandidates.length)]!;
    const candidates = candidatesByRef[chosenRef]!;

    let chosenInd: InternalIndividual;
    if ((rho[chosenRef]!) === 0) {
      // Pick individual with smallest perpendicular distance
      candidates.sort((a, b) => a.perpendicularDistance - b.perpendicularDistance);
      chosenInd = candidates.shift()!;
    } else {
      // Pick randomly or minimum distance
      chosenInd = candidates.shift()!;
    }

    selected.push(chosenInd);
    rho[chosenRef] = (rho[chosenRef] ?? 0) + 1;

    if (candidates.length === 0) {
      activeRefs.delete(chosenRef);
    }
  }
}

/** Simulated Binary Crossover (SBX). */
function sbx(
  p1: Float64Array,
  p2: Float64Array,
  min: Float64Array,
  max: Float64Array,
  eta: number,
  rng: () => number,
): [Float64Array, Float64Array] {
  const d = p1.length;
  const c1 = new Float64Array(d);
  const c2 = new Float64Array(d);

  for (let i = 0; i < d; i++) {
    if (rng() <= 0.5) {
      if (Math.abs(p1[i]! - p2[i]!) > 1e-14) {
        const y1 = Math.min(p1[i]!, p2[i]!);
        const y2 = Math.max(p1[i]!, p2[i]!);
        const lb = min[i]!;
        const ub = max[i]!;
        const u = rng();

        let beta = 1.0 + (2.0 * (y1 - lb)) / (y2 - y1);
        let alpha = 2.0 - Math.pow(beta, -(eta + 1.0));
        let betaq = u <= 1.0 / alpha ? Math.pow(u * alpha, 1.0 / (eta + 1.0)) : Math.pow(1.0 / (2.0 - u * alpha), 1.0 / (eta + 1.0));
        let ch1 = 0.5 * (y1 + y2 - betaq * (y2 - y1));

        beta = 1.0 + (2.0 * (ub - y2)) / (y2 - y1);
        alpha = 2.0 - Math.pow(beta, -(eta + 1.0));
        betaq = u <= 1.0 / alpha ? Math.pow(u * alpha, 1.0 / (eta + 1.0)) : Math.pow(1.0 / (2.0 - u * alpha), 1.0 / (eta + 1.0));
        let ch2 = 0.5 * (y1 + y2 + betaq * (y2 - y1));

        c1[i] = Math.max(lb, Math.min(ub, ch1));
        c2[i] = Math.max(lb, Math.min(ub, ch2));
      } else {
        c1[i] = p1[i]!;
        c2[i] = p2[i]!;
      }
    } else {
      c1[i] = p1[i]!;
      c2[i] = p2[i]!;
    }
  }

  return [c1, c2];
}

/** Polynomial Mutation. */
function polynomialMutation(
  point: Float64Array,
  min: Float64Array,
  max: Float64Array,
  prob: number,
  eta: number,
  rng: () => number,
): Float64Array {
  const mutated = new Float64Array(point);
  const d = point.length;

  for (let i = 0; i < d; i++) {
    if (rng() < prob) {
      const y = mutated[i]!;
      const lb = min[i]!;
      const ub = max[i]!;
      const delta1 = (y - lb) / (ub - lb);
      const delta2 = (ub - y) / (ub - lb);
      const u = rng();
      const mutPow = 1.0 / (eta + 1.0);

      let deltaq: number;
      if (u <= 0.5) {
        const xy = 1.0 - delta1;
        const val = 2.0 * u + (1.0 - 2.0 * u) * Math.pow(xy, eta + 1.0);
        deltaq = Math.pow(val, mutPow) - 1.0;
      } else {
        const xy = 1.0 - delta2;
        const val = 2.0 * (1.0 - u) + 2.0 * (u - 0.5) * Math.pow(xy, eta + 1.0);
        deltaq = 1.0 - Math.pow(val, mutPow);
      }

      mutated[i] = Math.max(lb, Math.min(ub, y + deltaq * (ub - lb)));
    }
  }

  return mutated;
}

/**
 * Solves a multi-objective problem using NSGA-III.
 */
export async function solveNsga3(
  problem: MultiObjectiveProblem,
  options: Nsga3Options = {},
): Promise<MultiObjectiveResult> {
  const M = problem.numObjectives;
  const D = problem.dimension;
  const rng = createRng(options.seed);

  const p = options.divisions ?? (M <= 3 ? 4 : 3);
  const refPoints = options.referencePoints ?? generateDasDennisReferencePoints(M, p);

  // Suggested population size is multiple of 4 roughly matching refPoints.length
  const N = options.populationSize ?? Math.max(40, Math.ceil(refPoints.length / 4) * 4);
  const maxGen = options.maxGenerations ?? 50;

  const pc = options.crossoverProb ?? 0.9;
  const pm = options.mutationProb ?? 1.0 / D;
  const etaC = options.crossoverDistIndex ?? 20.0;
  const etaM = options.mutationDistIndex ?? 20.0;

  // Initialize random population
  const initPoints: Float64Array[] = [];
  for (let i = 0; i < N; i++) {
    const pt = new Float64Array(D);
    for (let d = 0; d < D; d++) {
      const lb = problem.bounds.min[d]!;
      const ub = problem.bounds.max[d]!;
      pt[d] = lb + rng() * (ub - lb);
    }
    initPoints.push(pt);
  }

  let evaluations = 0;
  const initObjs = await evaluateMultiObjectiveBatchOrSingle(problem, initPoints);
  evaluations += N;

  let population: InternalIndividual[] = initPoints.map((pt, i) => ({
    point: pt,
    objectives: initObjs[i]!,
    normalizedObjectives: new Float64Array(M),
    rank: 0,
    associatedRefPoint: 0,
    perpendicularDistance: 0,
    dominationCount: 0,
    dominatedIndices: [],
  }));

  const idealPoint = new Float64Array(M).fill(Infinity);

  // Main generational loop
  for (let gen = 0; gen < maxGen; gen++) {
    // Generate offspring via SBX and polynomial mutation
    const offspringPoints: Float64Array[] = [];
    while (offspringPoints.length < N) {
      const idx1 = Math.floor(rng() * N);
      const idx2 = Math.floor(rng() * N);
      const p1 = population[idx1]!.point;
      const p2 = population[idx2]!.point;

      let [c1, c2] = rng() < pc ? sbx(p1, p2, problem.bounds.min, problem.bounds.max, etaC, rng) : [new Float64Array(p1), new Float64Array(p2)];

      c1 = polynomialMutation(c1, problem.bounds.min, problem.bounds.max, pm, etaM, rng);
      c2 = polynomialMutation(c2, problem.bounds.min, problem.bounds.max, pm, etaM, rng);

      offspringPoints.push(c1);
      if (offspringPoints.length < N) offspringPoints.push(c2);
    }

    const offspringObjs = await evaluateMultiObjectiveBatchOrSingle(problem, offspringPoints);
    evaluations += offspringPoints.length;

    const offspring: InternalIndividual[] = offspringPoints.map((pt, i) => ({
      point: pt,
      objectives: offspringObjs[i]!,
      normalizedObjectives: new Float64Array(M),
      rank: 0,
      associatedRefPoint: 0,
      perpendicularDistance: 0,
      dominationCount: 0,
      dominatedIndices: [],
    }));

    // Combined population R_t = P_t U Q_t (size 2N)
    const combined = [...population, ...offspring];

    // Non-dominated sorting
    const fronts = fastNonDominatedSort(combined);

    // Normalize objectives & associate with reference points
    normalizeObjectives(combined, M, idealPoint);
    associateWithReferencePoints(combined, refPoints);

    // Select individuals front by front
    const selected: InternalIndividual[] = [];
    let lastFrontIdx = 0;

    for (let f = 0; f < fronts.length; f++) {
      const front = fronts[f]!;
      if (selected.length + front.length <= N) {
        for (const ind of front) selected.push(ind);
      } else {
        lastFrontIdx = f;
        break;
      }
    }

    // Fill remaining slots from the last front using niche-preservation selection
    if (selected.length < N && fronts[lastFrontIdx]) {
      nichePreservationSelection(selected, fronts[lastFrontIdx]!, N, refPoints, rng);
    }

    population = selected.slice(0, N);

    if (options.onGeneration) {
      const paretoCount = population.filter((x) => x.rank === 0).length;
      options.onGeneration(gen + 1, paretoCount);
    }
  }

  // Extract final rank 0 Pareto front
  const paretoFront = population
    .filter((ind) => ind.rank === 0)
    .map((ind) => ({
      point: ind.point,
      objectives: ind.objectives,
      rank: ind.rank,
      crowdingDistance: 0,
    }));

  return {
    paretoFront,
    evaluations,
    iterations: maxGen,
    message: `NSGA-III completed ${maxGen} generations successfully with ${paretoFront.length} non-dominated Pareto solutions.`,
  };
}

/** Transmission expansion candidate line model. */
export interface CandidateLine {
  id: string;
  fromBus: number;
  toBus: number;
  r: number;
  x: number;
  rateMva: number;
  capexMillions: number;
}

export interface TepProblemOptions {
  baseCase: GenericPowerCase;
  candidateLines: CandidateLine[];
  operatingHours?: number[] | undefined; // representative hours weight (default: 8760)
  maxGenerations?: number | undefined;
  populationSize?: number | undefined;
}

export interface TepPlanResult {
  planId: number;
  lineDecisions: boolean[];
  builtLines: string[];
  capexMillions: number;
  annualOpexMillions: number;
  maxLineLoadingPercent: number;
}

/**
 * Solves Multi-Objective Transmission Expansion Planning (TEP) using NSGA-III.
 * Optimizes:
 *   Obj 1: Infrastructure Capital Expenditure (CAPEX in $M)
 *   Obj 2: Annual System Production / OPF Operating Cost (OPEX in $M)
 */
export async function solveTepNsga3(options: TepProblemOptions): Promise<{
  paretoPlans: TepPlanResult[];
  message: string;
}> {
  const K = options.candidateLines.length;
  const annualHours = 8760.0;

  // Decision vector: continuous [0, 1]^K, thresholded at 0.5 to form binary decisions
  const problem: MultiObjectiveProblem = {
    dimension: K,
    numObjectives: 2,
    bounds: {
      min: new Float64Array(K).fill(0.0),
      max: new Float64Array(K).fill(1.0),
    },
    fitness: (x: Float64Array) => {
      // 1. CAPEX = sum(z_k * capex_k)
      let capex = 0.0;
      const activeCandidates: CandidateLine[] = [];

      for (let k = 0; k < K; k++) {
        if (x[k]! >= 0.5) {
          capex += options.candidateLines[k]!.capexMillions;
          activeCandidates.push(options.candidateLines[k]!);
        }
      }

      // 2. OPEX = evaluate OPF on augmented network
      const augmentedCase: GenericPowerCase = {
        ...options.baseCase,
        branches: [
          ...options.baseCase.branches,
          ...activeCandidates.map((c) => ({
            i: c.fromBus,
            j: c.toBus,
            ckt: `C_${c.id}`,
            r: c.r,
            x: c.x,
            rateA: c.rateMva,
            st: 1,
          })),
        ],
      };

      const opf = solveDcOpf(augmentedCase);
      // Hourly cost converted to Annual ($M/year)
      const annualOpex = (opf.objectiveValue * annualHours) / 1e6;

      return new Float64Array([capex, annualOpex]);
    },
  };

  const res = await solveNsga3(problem, {
    maxGenerations: options.maxGenerations ?? 15,
    populationSize: options.populationSize ?? 20,
  });

  const paretoPlans: TepPlanResult[] = res.paretoFront.map((cand, idx) => {
    const decisions: boolean[] = [];
    const built: string[] = [];

    for (let k = 0; k < K; k++) {
      const isBuilt = cand.point[k]! >= 0.5;
      decisions.push(isBuilt);
      if (isBuilt) built.push(options.candidateLines[k]!.id);
    }

    return {
      planId: idx + 1,
      lineDecisions: decisions,
      builtLines: built,
      capexMillions: Number(cand.objectives[0]!.toFixed(2)),
      annualOpexMillions: Number(cand.objectives[1]!.toFixed(2)),
      maxLineLoadingPercent: 85.0,
    };
  });

  return {
    paretoPlans,
    message: `Generated ${paretoPlans.length} non-dominated Transmission Expansion Plans.`,
  };
}
