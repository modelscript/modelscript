// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Dominated Sorting Genetic Algorithm II (NSGA-II) in Pure TypeScript.
 *
 * Implements active generative multi-objective evolutionary search with:
 *   - Fast non-dominated sorting (O(M N^2))
 *   - Crowding distance assignment
 *   - Simulated Binary Crossover (SBX)
 *   - Polynomial Mutation
 *   - (mu + lambda) Elitist survivor selection
 *   - Parallel batch fitness evaluation
 *
 * Academic Citation:
 *   Deb, K., Pratap, A., Agarwal, S., & Meyarivan, T. (2002).
 *   "A fast and elitist multiobjective genetic algorithm: NSGA-II."
 *   IEEE Transactions on Evolutionary Computation, 6(2), 182-197.
 */

import {
  createRng,
  evaluateMultiObjectiveBatchOrSingle,
  type MultiObjectiveCandidate,
  type MultiObjectiveOptions,
  type MultiObjectiveProblem,
  type MultiObjectiveResult,
} from "./blackbox.js";

interface InternalIndividual {
  point: Float64Array;
  objectives: Float64Array;
  rank: number;
  crowdingDistance: number;
  dominationCount: number;
  dominatedIndices: number[];
}

/**
 * Checks whether individual A dominates individual B (minimization).
 */
function dominates(objA: Float64Array, objB: Float64Array): boolean {
  let atLeastOneStrictlyBetter = false;
  const m = objA.length;
  for (let i = 0; i < m; i++) {
    if (objA[i]! > objB[i]!) {
      return false;
    }
    if (objA[i]! < objB[i]!) {
      atLeastOneStrictlyBetter = true;
    }
  }
  return atLeastOneStrictlyBetter;
}

/**
 * Performs fast non-dominated sorting on a population.
 */
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
 * Assigns crowding distance to individuals within a single front.
 */
function assignCrowdingDistance(front: InternalIndividual[], numObjectives: number): void {
  const l = front.length;
  if (l === 0) return;

  for (let i = 0; i < l; i++) {
    front[i]!.crowdingDistance = 0;
  }

  if (l <= 2) {
    for (let i = 0; i < l; i++) {
      front[i]!.crowdingDistance = 1e14;
    }
    return;
  }

  for (let m = 0; m < numObjectives; m++) {
    front.sort((a, b) => a.objectives[m]! - b.objectives[m]!);

    front[0]!.crowdingDistance = 1e14;
    front[l - 1]!.crowdingDistance = 1e14;

    const objMin = front[0]!.objectives[m]!;
    const objMax = front[l - 1]!.objectives[m]!;
    const range = objMax - objMin;

    if (range > 1e-14) {
      for (let i = 1; i < l - 1; i++) {
        if (front[i]!.crowdingDistance < 1e14) {
          front[i]!.crowdingDistance += (front[i + 1]!.objectives[m]! - front[i - 1]!.objectives[m]!) / range;
        }
      }
    }
  }
}

/**
 * Crowded comparison operator: A is preferred to B if A has lower rank,
 * or equal rank with greater crowding distance.
 */
function crowdedCompare(a: InternalIndividual, b: InternalIndividual): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  return b.crowdingDistance - a.crowdingDistance;
}

/**
 * Solves a multi-objective black-box optimization problem using NSGA-II.
 */
export async function nsga2Solve(
  problem: MultiObjectiveProblem,
  options?: MultiObjectiveOptions,
): Promise<MultiObjectiveResult> {
  const n = problem.dimension;
  const numObj = problem.numObjectives;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const popSize = Math.max(10, (options?.populationSize ?? Math.max(40, 10 * n)) & ~1); // Ensure even
  const maxGen = options?.maxGenerations ?? 50;
  const pCrossover = options?.crossoverProb ?? 0.9;
  const pMutation = options?.mutationProb ?? 1.0 / n;
  const etaC = options?.crossoverDistIndex ?? 20;
  const etaM = options?.mutationDistIndex ?? 20;

  // 1. Initial population creation
  const initialPoints: Float64Array[] = [];
  for (let i = 0; i < popSize; i++) {
    const pt = new Float64Array(n);
    if (i === 0 && problem.initialGuess) {
      pt.set(problem.initialGuess);
    } else {
      for (let j = 0; j < n; j++) {
        pt[j] = minBounds[j]! + rng() * (maxBounds[j]! - minBounds[j]!);
      }
    }
    initialPoints.push(pt);
  }

  // 2. Initial evaluation
  const initialObjs = await evaluateMultiObjectiveBatchOrSingle(problem, initialPoints);
  let totalEvaluations = popSize;

  let population: InternalIndividual[] = [];
  for (let i = 0; i < popSize; i++) {
    population.push({
      point: initialPoints[i]!,
      objectives: initialObjs[i]!,
      rank: 0,
      crowdingDistance: 0,
      dominationCount: 0,
      dominatedIndices: [],
    });
  }

  const initialFronts = fastNonDominatedSort(population);
  for (const front of initialFronts) {
    assignCrowdingDistance(front, numObj);
  }

  // Tournament selection helper
  const tournamentSelect = (): InternalIndividual => {
    const i1 = Math.floor(rng() * popSize);
    const i2 = Math.floor(rng() * popSize);
    const a = population[i1]!;
    const b = population[i2]!;
    return crowdedCompare(a, b) <= 0 ? a : b;
  };

  // Evolution Loop
  for (let gen = 0; gen < maxGen; gen++) {
    // 3. Offspring generation (SBX + Polynomial Mutation)
    const offspringPoints: Float64Array[] = [];

    for (let i = 0; i < popSize; i += 2) {
      const p1 = tournamentSelect().point;
      const p2 = tournamentSelect().point;

      const c1 = new Float64Array(n);
      const c2 = new Float64Array(n);

      // SBX Crossover
      if (rng() < pCrossover) {
        for (let j = 0; j < n; j++) {
          if (rng() <= 0.5) {
            const u = rng();
            let beta = 1.0;
            if (u <= 0.5) {
              beta = Math.pow(2.0 * u, 1.0 / (etaC + 1.0));
            } else {
              beta = Math.pow(1.0 / (2.0 * (1.0 - u)), 1.0 / (etaC + 1.0));
            }
            c1[j] = 0.5 * ((1.0 + beta) * p1[j]! + (1.0 - beta) * p2[j]!);
            c2[j] = 0.5 * ((1.0 - beta) * p1[j]! + (1.0 + beta) * p2[j]!);
          } else {
            c1[j] = p1[j]!;
            c2[j] = p2[j]!;
          }
        }
      } else {
        c1.set(p1);
        c2.set(p2);
      }

      // Polynomial Mutation for c1 & c2
      for (const child of [c1, c2]) {
        for (let j = 0; j < n; j++) {
          if (rng() < pMutation) {
            const u = rng();
            let delta = 0;
            if (u < 0.5) {
              delta = Math.pow(2.0 * u, 1.0 / (etaM + 1.0)) - 1.0;
            } else {
              delta = 1.0 - Math.pow(2.0 * (1.0 - u), 1.0 / (etaM + 1.0));
            }
            child[j] = child[j]! + delta * (maxBounds[j]! - minBounds[j]!);
          }

          // Bound clamp
          const lb = minBounds[j]!;
          const ub = maxBounds[j]!;
          if (child[j]! < lb) child[j] = lb;
          if (child[j]! > ub) child[j] = ub;
        }
      }

      offspringPoints.push(c1, c2);
    }

    // 4. Batch evaluation of offspring
    const offspringObjs = await evaluateMultiObjectiveBatchOrSingle(problem, offspringPoints);
    totalEvaluations += offspringPoints.length;

    const offspring: InternalIndividual[] = [];
    for (let i = 0; i < offspringPoints.length; i++) {
      offspring.push({
        point: offspringPoints[i]!,
        objectives: offspringObjs[i]!,
        rank: 0,
        crowdingDistance: 0,
        dominationCount: 0,
        dominatedIndices: [],
      });
    }

    // 5. Merge parents + offspring: size 2N
    const combined = population.concat(offspring);
    const fronts = fastNonDominatedSort(combined);

    const nextPopulation: InternalIndividual[] = [];
    for (const front of fronts) {
      assignCrowdingDistance(front, numObj);

      if (nextPopulation.length + front.length <= popSize) {
        nextPopulation.push(...front);
      } else {
        // Sort remaining front by crowding distance descending
        front.sort((a, b) => b.crowdingDistance - a.crowdingDistance);
        const needed = popSize - nextPopulation.length;
        for (let k = 0; k < needed; k++) {
          nextPopulation.push(front[k]!);
        }
        break;
      }
    }

    population = nextPopulation;

    if (options?.onGeneration) {
      const paretoCount = population.filter((p) => p.rank === 0).length;
      options.onGeneration(gen, paretoCount);
    }
  }

  // 6. Extract Pareto front (rank 0)
  const finalFronts = fastNonDominatedSort(population);
  const paretoIndividuals = finalFronts[0] ?? [];
  assignCrowdingDistance(paretoIndividuals, numObj);

  const paretoFront: MultiObjectiveCandidate[] = paretoIndividuals.map((ind) => ({
    point: new Float64Array(ind.point),
    objectives: new Float64Array(ind.objectives),
    rank: ind.rank,
    crowdingDistance: ind.crowdingDistance,
  }));

  const allCandidates: MultiObjectiveCandidate[] = population.map((ind) => ({
    point: new Float64Array(ind.point),
    objectives: new Float64Array(ind.objectives),
    rank: ind.rank,
    crowdingDistance: ind.crowdingDistance,
  }));

  return {
    paretoFront,
    allCandidates,
    evaluations: totalEvaluations,
    iterations: maxGen,
    message: "Completed NSGA-II generation cycle",
  };
}
