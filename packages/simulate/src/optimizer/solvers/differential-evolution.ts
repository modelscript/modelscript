// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Self-Adaptive Differential Evolution (jDE) in Pure TypeScript.
 *
 * Implements self-adaptive parameter control (Brest et al.), multiple mutation
 * strategies (rand/1/bin, best/1/bin, current-to-best/1), bounce-back boundary
 * handling, and batched population evaluations.
 *
 * Academic Citation:
 *   Brest, J., Greiner, S., Boskovic, B., Mernik, M., & Zumer, V. (2006).
 *   "Self-adapting control parameters in differential evolution: A comparative study
 *   on numerical benchmark problems." IEEE Transactions on Evolutionary Computation, 10(6), 646-657.
 */

import {
  type BlackBoxProblem,
  createRng,
  evaluateBatchOrSingle,
  type SingleObjectiveOptions,
  type SingleObjectiveResult,
} from "./blackbox.js";

export type DeStrategy = "rand/1/bin" | "best/1/bin" | "current-to-best/1";

export interface DeOptions extends SingleObjectiveOptions {
  strategy?: DeStrategy;
  targetFitness?: number;
  initialF?: number;
  initialCR?: number;
}

/**
 * Solves a single-objective bound-constrained black-box problem using Self-Adaptive DE.
 */
export async function deSolve(problem: BlackBoxProblem, options?: DeOptions): Promise<SingleObjectiveResult> {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const popSize = Math.max(4, options?.populationSize ?? Math.max(20, 10 * n));
  const maxGen = options?.maxGenerations ?? Math.max(100, 40 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;
  const strategy: DeStrategy = options?.strategy ?? "rand/1/bin";

  const F_l = 0.1;
  const F_u = 0.9;
  const tau1 = 0.1;
  const tau2 = 0.1;

  // 1. Initialize population
  const population: Float64Array[] = [];
  const F_vec = new Float64Array(popSize);
  const CR_vec = new Float64Array(popSize);

  for (let i = 0; i < popSize; i++) {
    const ind = new Float64Array(n);
    if (i === 0 && problem.initialGuess) {
      ind.set(problem.initialGuess);
    } else {
      for (let j = 0; j < n; j++) {
        ind[j] = minBounds[j]! + rng() * (maxBounds[j]! - minBounds[j]!);
      }
    }
    population.push(ind);
    F_vec[i] = options?.initialF ?? 0.5;
    CR_vec[i] = options?.initialCR ?? 0.9;
  }

  // 2. Evaluate initial population
  const fitnesses = await evaluateBatchOrSingle(problem, population);
  let totalEvaluations = popSize;

  let bestIdx = 0;
  for (let i = 1; i < popSize; i++) {
    if (fitnesses[i]! < fitnesses[bestIdx]!) {
      bestIdx = i;
    }
  }

  let bestSolution = new Float64Array(population[bestIdx]!);
  let bestFitness = fitnesses[bestIdx]!;
  const history: number[] = [bestFitness];

  let converged = false;
  let exitMessage = "Maximum generations reached";

  for (let gen = 0; gen < maxGen; gen++) {
    if (bestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    const trials: Float64Array[] = [];
    const trial_F = new Float64Array(popSize);
    const trial_CR = new Float64Array(popSize);

    // 3. Generate mutant and trial vectors
    for (let i = 0; i < popSize; i++) {
      // Self-adaptation of F and CR
      trial_F[i] = rng() < tau1 ? F_l + rng() * F_u : F_vec[i]!;
      trial_CR[i] = rng() < tau2 ? rng() : CR_vec[i]!;

      const F = trial_F[i]!;
      const CR = trial_CR[i]!;

      // Distinct random indices r1, r2, r3 != i
      let r1 = Math.floor(rng() * popSize);
      while (r1 === i) r1 = Math.floor(rng() * popSize);
      let r2 = Math.floor(rng() * popSize);
      while (r2 === i || r2 === r1) r2 = Math.floor(rng() * popSize);
      let r3 = Math.floor(rng() * popSize);
      while (r3 === i || r3 === r1 || r3 === r2) r3 = Math.floor(rng() * popSize);

      const target = population[i]!;
      const x_r1 = population[r1]!;
      const x_r2 = population[r2]!;
      const x_r3 = population[r3]!;
      const x_best = population[bestIdx]!;

      const trial = new Float64Array(n);
      const jRand = Math.floor(rng() * n);

      for (let j = 0; j < n; j++) {
        if (rng() < CR || j === jRand) {
          let v_j = 0;
          if (strategy === "best/1/bin") {
            v_j = x_best[j]! + F * (x_r1[j]! - x_r2[j]!);
          } else if (strategy === "current-to-best/1") {
            v_j = target[j]! + F * (x_best[j]! - target[j]!) + F * (x_r1[j]! - x_r2[j]!);
          } else {
            // rand/1/bin
            v_j = x_r1[j]! + F * (x_r2[j]! - x_r3[j]!);
          }

          // Bounce-back boundary handling
          const lb = minBounds[j]!;
          const ub = maxBounds[j]!;
          if (v_j < lb) {
            v_j = lb + rng() * (target[j]! - lb);
          } else if (v_j > ub) {
            v_j = ub - rng() * (ub - target[j]!);
          }

          trial[j] = v_j;
        } else {
          trial[j] = target[j]!;
        }
      }

      trials.push(trial);
    }

    // 4. Batch evaluate all trial vectors
    const trialFitnesses = await evaluateBatchOrSingle(problem, trials);
    totalEvaluations += popSize;

    // 5. Selection
    let popVariance = 0;
    for (let i = 0; i < popSize; i++) {
      if (trialFitnesses[i]! <= fitnesses[i]!) {
        population[i] = trials[i]!;
        fitnesses[i] = trialFitnesses[i]!;
        F_vec[i] = trial_F[i]!;
        CR_vec[i] = trial_CR[i]!;

        if (trialFitnesses[i]! < bestFitness) {
          bestFitness = trialFitnesses[i]!;
          bestSolution = new Float64Array(trials[i]!);
          bestIdx = i;
        }
      }
      popVariance += Math.abs(fitnesses[i]! - bestFitness);
    }

    history.push(bestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, bestFitness, bestSolution);
    }

    // Population diversity convergence check
    if (popVariance / popSize < tol) {
      converged = true;
      exitMessage = `Population fitness variance below tolerance ${tol}`;
      break;
    }
  }

  return {
    bestSolution,
    bestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}

/**
 * Synchronous variant of Self-Adaptive DE for purely synchronous fitness functions.
 */
export function deSolveSync(problem: BlackBoxProblem, options?: DeOptions): SingleObjectiveResult {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const popSize = Math.max(4, options?.populationSize ?? Math.max(20, 10 * n));
  const maxGen = options?.maxGenerations ?? Math.max(100, 40 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;
  const strategy: DeStrategy = options?.strategy ?? "rand/1/bin";

  const F_l = 0.1;
  const F_u = 0.9;
  const tau1 = 0.1;
  const tau2 = 0.1;

  const population: Float64Array[] = [];
  const F_vec = new Float64Array(popSize);
  const CR_vec = new Float64Array(popSize);

  for (let i = 0; i < popSize; i++) {
    const ind = new Float64Array(n);
    if (i === 0 && problem.initialGuess) {
      ind.set(problem.initialGuess);
    } else {
      for (let j = 0; j < n; j++) {
        ind[j] = minBounds[j]! + rng() * (maxBounds[j]! - minBounds[j]!);
      }
    }
    population.push(ind);
    F_vec[i] = options?.initialF ?? 0.5;
    CR_vec[i] = options?.initialCR ?? 0.9;
  }

  const fitnesses = population.map((ind) => problem.fitness(ind) as number);
  let totalEvaluations = popSize;

  let bestIdx = 0;
  for (let i = 1; i < popSize; i++) {
    if (fitnesses[i]! < fitnesses[bestIdx]!) {
      bestIdx = i;
    }
  }

  let bestSolution = new Float64Array(population[bestIdx]!);
  let bestFitness = fitnesses[bestIdx]!;
  const history: number[] = [bestFitness];

  let converged = false;
  let exitMessage = "Maximum generations reached";

  for (let gen = 0; gen < maxGen; gen++) {
    if (bestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    const trials: Float64Array[] = [];
    const trial_F = new Float64Array(popSize);
    const trial_CR = new Float64Array(popSize);

    for (let i = 0; i < popSize; i++) {
      trial_F[i] = rng() < tau1 ? F_l + rng() * F_u : F_vec[i]!;
      trial_CR[i] = rng() < tau2 ? rng() : CR_vec[i]!;

      const F = trial_F[i]!;
      const CR = trial_CR[i]!;

      let r1 = Math.floor(rng() * popSize);
      while (r1 === i) r1 = Math.floor(rng() * popSize);
      let r2 = Math.floor(rng() * popSize);
      while (r2 === i || r2 === r1) r2 = Math.floor(rng() * popSize);
      let r3 = Math.floor(rng() * popSize);
      while (r3 === i || r3 === r1 || r3 === r2) r3 = Math.floor(rng() * popSize);

      const target = population[i]!;
      const x_r1 = population[r1]!;
      const x_r2 = population[r2]!;
      const x_r3 = population[r3]!;
      const x_best = population[bestIdx]!;

      const trial = new Float64Array(n);
      const jRand = Math.floor(rng() * n);

      for (let j = 0; j < n; j++) {
        if (rng() < CR || j === jRand) {
          let v_j = 0;
          if (strategy === "best/1/bin") {
            v_j = x_best[j]! + F * (x_r1[j]! - x_r2[j]!);
          } else if (strategy === "current-to-best/1") {
            v_j = target[j]! + F * (x_best[j]! - target[j]!) + F * (x_r1[j]! - x_r2[j]!);
          } else {
            v_j = x_r1[j]! + F * (x_r2[j]! - x_r3[j]!);
          }

          const lb = minBounds[j]!;
          const ub = maxBounds[j]!;
          if (v_j < lb) {
            v_j = lb + rng() * (target[j]! - lb);
          } else if (v_j > ub) {
            v_j = ub - rng() * (ub - target[j]!);
          }

          trial[j] = v_j;
        } else {
          trial[j] = target[j]!;
        }
      }

      trials.push(trial);
    }

    const trialFitnesses = trials.map((t) => problem.fitness(t) as number);
    totalEvaluations += popSize;

    let popVariance = 0;
    for (let i = 0; i < popSize; i++) {
      if (trialFitnesses[i]! <= fitnesses[i]!) {
        population[i] = trials[i]!;
        fitnesses[i] = trialFitnesses[i]!;
        F_vec[i] = trial_F[i]!;
        CR_vec[i] = trial_CR[i]!;

        if (trialFitnesses[i]! < bestFitness) {
          bestFitness = trialFitnesses[i]!;
          bestSolution = new Float64Array(trials[i]!);
          bestIdx = i;
        }
      }
      popVariance += Math.abs(fitnesses[i]! - bestFitness);
    }

    history.push(bestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, bestFitness, bestSolution);
    }

    if (popVariance / popSize < tol) {
      converged = true;
      exitMessage = `Population fitness variance below tolerance ${tol}`;
      break;
    }
  }

  return {
    bestSolution,
    bestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}
