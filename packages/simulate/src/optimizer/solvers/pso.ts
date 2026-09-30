// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Particle Swarm Optimization (PSO) in Pure TypeScript.
 *
 * Implements Clerc & Kennedy's constriction factor formulation and inertia weight
 * strategies with velocity clamping, boundary reflection, and batch evaluations.
 *
 * Academic Citation:
 *   Clerc, M., & Kennedy, J. (2002). "The particle swarm - explosion, stability,
 *   and convergence in a multidimensional complex space." IEEE Transactions on
 *   Evolutionary Computation, 6(1), 58-73.
 */

import {
  type BlackBoxProblem,
  createRng,
  evaluateBatchOrSingle,
  type SingleObjectiveOptions,
  type SingleObjectiveResult,
} from "./blackbox.js";

export interface PsoOptions extends SingleObjectiveOptions {
  swarmSize?: number;
  c1?: number;
  c2?: number;
  w?: number;
  useConstriction?: boolean;
  targetFitness?: number;
}

/**
 * Solves a single-objective bound-constrained black-box problem using PSO.
 */
export async function psoSolve(problem: BlackBoxProblem, options?: PsoOptions): Promise<SingleObjectiveResult> {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const swarmSize = Math.max(10, options?.swarmSize ?? Math.max(20, 10 * n));
  const maxGen = options?.maxGenerations ?? Math.max(100, 40 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;
  const useConstriction = options?.useConstriction ?? true;

  const c1 = options?.c1 ?? 2.05;
  const c2 = options?.c2 ?? 2.05;
  let chi = 1.0;
  let w = options?.w ?? 0.7298;

  if (useConstriction) {
    const phi = c1 + c2;
    if (phi > 4) {
      chi = 2.0 / Math.abs(phi - 2.0 + Math.sqrt(phi * phi - 4.0 * phi));
    }
  }

  // Velocity limits
  const vMax = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    vMax[j] = 0.5 * (maxBounds[j]! - minBounds[j]!);
  }

  // Initialize swarm
  const positions: Float64Array[] = [];
  const velocities: Float64Array[] = [];
  const pBests: Float64Array[] = [];

  for (let i = 0; i < swarmSize; i++) {
    const pos = new Float64Array(n);
    const vel = new Float64Array(n);

    if (i === 0 && problem.initialGuess) {
      pos.set(problem.initialGuess);
    } else {
      for (let j = 0; j < n; j++) {
        pos[j] = minBounds[j]! + rng() * (maxBounds[j]! - minBounds[j]!);
        vel[j] = (rng() - 0.5) * vMax[j]!;
      }
    }

    positions.push(pos);
    velocities.push(vel);
    pBests.push(new Float64Array(pos));
  }

  // Initial evaluations
  const pBestFitnesses = await evaluateBatchOrSingle(problem, positions);
  let totalEvaluations = swarmSize;

  let gBestIdx = 0;
  for (let i = 1; i < swarmSize; i++) {
    if (pBestFitnesses[i]! < pBestFitnesses[gBestIdx]!) {
      gBestIdx = i;
    }
  }

  let gBest = new Float64Array(positions[gBestIdx]!);
  let gBestFitness = pBestFitnesses[gBestIdx]!;
  const history: number[] = [gBestFitness];

  let converged = false;
  let exitMessage = "Maximum iterations reached";

  for (let gen = 0; gen < maxGen; gen++) {
    if (gBestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    // Update positions and velocities
    for (let i = 0; i < swarmSize; i++) {
      const pos = positions[i]!;
      const vel = velocities[i]!;
      const pBest = pBests[i]!;

      for (let j = 0; j < n; j++) {
        const r1 = rng();
        const r2 = rng();

        let newV = vel[j]!;
        if (useConstriction) {
          newV = chi * (newV + c1 * r1 * (pBest[j]! - pos[j]!) + c2 * r2 * (gBest[j]! - pos[j]!));
        } else {
          newV = w * newV + c1 * r1 * (pBest[j]! - pos[j]!) + c2 * r2 * (gBest[j]! - pos[j]!);
        }

        // Clamp velocity
        const maxV = vMax[j]!;
        if (newV > maxV) newV = maxV;
        if (newV < -maxV) newV = -maxV;
        vel[j] = newV;

        let newPos = pos[j]! + newV;
        const lb = minBounds[j]!;
        const ub = maxBounds[j]!;

        // Boundary reflection with damping
        if (newPos < lb) {
          newPos = lb;
          vel[j] = -0.5 * vel[j]!;
        } else if (newPos > ub) {
          newPos = ub;
          vel[j] = -0.5 * vel[j]!;
        }

        pos[j] = newPos;
      }
    }

    // Batch evaluate swarm
    const fitnesses = await evaluateBatchOrSingle(problem, positions);
    totalEvaluations += swarmSize;

    let swarmVariance = 0;
    for (let i = 0; i < swarmSize; i++) {
      if (fitnesses[i]! < pBestFitnesses[i]!) {
        pBests[i]!.set(positions[i]!);
        pBestFitnesses[i] = fitnesses[i]!;

        if (fitnesses[i]! < gBestFitness) {
          gBestFitness = fitnesses[i]!;
          gBest = new Float64Array(positions[i]!);
        }
      }
      swarmVariance += Math.abs(fitnesses[i]! - gBestFitness);
    }

    history.push(gBestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, gBestFitness, gBest);
    }

    if (swarmVariance / swarmSize < tol) {
      converged = true;
      exitMessage = `Swarm variance below tolerance ${tol}`;
      break;
    }
  }

  return {
    bestSolution: gBest,
    bestFitness: gBestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}

/**
 * Synchronous variant of PSO for purely synchronous fitness functions.
 */
export function psoSolveSync(problem: BlackBoxProblem, options?: PsoOptions): SingleObjectiveResult {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const swarmSize = Math.max(10, options?.swarmSize ?? Math.max(20, 10 * n));
  const maxGen = options?.maxGenerations ?? Math.max(100, 40 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;
  const useConstriction = options?.useConstriction ?? true;

  const c1 = options?.c1 ?? 2.05;
  const c2 = options?.c2 ?? 2.05;
  let chi = 1.0;
  let w = options?.w ?? 0.7298;

  if (useConstriction) {
    const phi = c1 + c2;
    if (phi > 4) {
      chi = 2.0 / Math.abs(phi - 2.0 + Math.sqrt(phi * phi - 4.0 * phi));
    }
  }

  const vMax = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    vMax[j] = 0.5 * (maxBounds[j]! - minBounds[j]!);
  }

  const positions: Float64Array[] = [];
  const velocities: Float64Array[] = [];
  const pBests: Float64Array[] = [];

  for (let i = 0; i < swarmSize; i++) {
    const pos = new Float64Array(n);
    const vel = new Float64Array(n);

    if (i === 0 && problem.initialGuess) {
      pos.set(problem.initialGuess);
    } else {
      for (let j = 0; j < n; j++) {
        pos[j] = minBounds[j]! + rng() * (maxBounds[j]! - minBounds[j]!);
        vel[j] = (rng() - 0.5) * vMax[j]!;
      }
    }

    positions.push(pos);
    velocities.push(vel);
    pBests.push(new Float64Array(pos));
  }

  const pBestFitnesses = positions.map((p) => problem.fitness(p) as number);
  let totalEvaluations = swarmSize;

  let gBestIdx = 0;
  for (let i = 1; i < swarmSize; i++) {
    if (pBestFitnesses[i]! < pBestFitnesses[gBestIdx]!) {
      gBestIdx = i;
    }
  }

  let gBest = new Float64Array(positions[gBestIdx]!);
  let gBestFitness = pBestFitnesses[gBestIdx]!;
  const history: number[] = [gBestFitness];

  let converged = false;
  let exitMessage = "Maximum iterations reached";

  for (let gen = 0; gen < maxGen; gen++) {
    if (gBestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    for (let i = 0; i < swarmSize; i++) {
      const pos = positions[i]!;
      const vel = velocities[i]!;
      const pBest = pBests[i]!;

      for (let j = 0; j < n; j++) {
        const r1 = rng();
        const r2 = rng();

        let newV = vel[j]!;
        if (useConstriction) {
          newV = chi * (newV + c1 * r1 * (pBest[j]! - pos[j]!) + c2 * r2 * (gBest[j]! - pos[j]!));
        } else {
          newV = w * newV + c1 * r1 * (pBest[j]! - pos[j]!) + c2 * r2 * (gBest[j]! - pos[j]!);
        }

        const maxV = vMax[j]!;
        if (newV > maxV) newV = maxV;
        if (newV < -maxV) newV = -maxV;
        vel[j] = newV;

        let newPos = pos[j]! + newV;
        const lb = minBounds[j]!;
        const ub = maxBounds[j]!;

        if (newPos < lb) {
          newPos = lb;
          vel[j] = -0.5 * vel[j]!;
        } else if (newPos > ub) {
          newPos = ub;
          vel[j] = -0.5 * vel[j]!;
        }

        pos[j] = newPos;
      }
    }

    const fitnesses = positions.map((p) => problem.fitness(p) as number);
    totalEvaluations += swarmSize;

    let swarmVariance = 0;
    for (let i = 0; i < swarmSize; i++) {
      if (fitnesses[i]! < pBestFitnesses[i]!) {
        pBests[i]!.set(positions[i]!);
        pBestFitnesses[i] = fitnesses[i]!;

        if (fitnesses[i]! < gBestFitness) {
          gBestFitness = fitnesses[i]!;
          gBest = new Float64Array(positions[i]!);
        }
      }
      swarmVariance += Math.abs(fitnesses[i]! - gBestFitness);
    }

    history.push(gBestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, gBestFitness, gBest);
    }

    if (swarmVariance / swarmSize < tol) {
      converged = true;
      exitMessage = `Swarm variance below tolerance ${tol}`;
      break;
    }
  }

  return {
    bestSolution: gBest,
    bestFitness: gBestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}
