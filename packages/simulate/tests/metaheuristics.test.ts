// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { test } from "node:test";
import {
  type BlackBoxProblem,
  cmaesSolve,
  deSolve,
  type MultiObjectiveProblem,
  nsga2Solve,
  psoSolve,
} from "../src/optimizer/index.js";

// ── Standard Benchmark Functions ──

function sphere(x: Float64Array): number {
  let sum = 0;
  for (const val of x) {
    sum += val * val;
  }
  return sum;
}

function rosenbrock(x: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < x.length - 1; i++) {
    const xi = x[i]!;
    const next = x[i + 1]!;
    sum += 100 * Math.pow(next - xi * xi, 2) + Math.pow(xi - 1, 2);
  }
  return sum;
}

function rastrigin(x: Float64Array): number {
  const n = x.length;
  let sum = 10 * n;
  for (let i = 0; i < n; i++) {
    sum += x[i]! * x[i]! - 10 * Math.cos(2 * Math.PI * x[i]!);
  }
  return sum;
}

function ackley(x: Float64Array): number {
  const n = x.length;
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    sum1 += x[i]! * x[i]!;
    sum2 += Math.cos(2 * Math.PI * x[i]!);
  }
  return -20 * Math.exp(-0.2 * Math.sqrt(sum1 / n)) - Math.exp(sum2 / n) + 20 + Math.E;
}

// ── Tests ──

test("CMA-ES minimizes Sphere function to high precision", async () => {
  const dim = 3;
  const problem: BlackBoxProblem = {
    dimension: dim,
    bounds: {
      min: new Float64Array([-5, -5, -5]),
      max: new Float64Array([5, 5, 5]),
    },
    fitness: sphere,
    initialGuess: new Float64Array([3.0, -2.5, 4.0]),
  };

  const res = await cmaesSolve(problem, {
    maxGenerations: 60,
    seed: 42,
    targetFitness: 1e-4,
  });

  assert(res.bestFitness < 1e-3, `CMA-ES should reach near 0, got ${res.bestFitness}`);
  for (let i = 0; i < dim; i++) {
    assert(Math.abs(res.bestSolution[i]!) < 0.1, `Solution component ${i} should be near 0`);
  }
});

test("CMA-ES navigates ill-conditioned Rosenbrock valley", async () => {
  const dim = 2;
  const problem: BlackBoxProblem = {
    dimension: dim,
    bounds: {
      min: new Float64Array([-5, -5]),
      max: new Float64Array([5, 5]),
    },
    fitness: rosenbrock,
    initialGuess: new Float64Array([-1.5, 2.0]),
  };

  const res = await cmaesSolve(problem, {
    maxGenerations: 200,
    populationSize: 20,
    seed: 123,
    targetFitness: 1e-4,
  });

  assert(res.bestFitness < 1e-3, `CMA-ES on Rosenbrock expected < 1e-3, got ${res.bestFitness}`);
  assert(Math.abs(res.bestSolution[0]! - 1.0) < 0.05, "x[0] should be close to 1.0");
  assert(Math.abs(res.bestSolution[1]! - 1.0) < 0.05, "x[1] should be close to 1.0");
});

test("Self-Adaptive Differential Evolution solves Rastrigin multimodal landscape", async () => {
  const dim = 3;
  const problem: BlackBoxProblem = {
    dimension: dim,
    bounds: {
      min: new Float64Array([-5.12, -5.12, -5.12]),
      max: new Float64Array([5.12, 5.12, 5.12]),
    },
    fitness: rastrigin,
    initialGuess: new Float64Array([3.5, -4.0, 2.5]),
  };

  const res = await deSolve(problem, {
    maxGenerations: 80,
    populationSize: 30,
    seed: 777,
    strategy: "best/1/bin",
  });

  assert(res.bestFitness < 1.0, `DE on Rastrigin expected < 1.0, got ${res.bestFitness}`);
});

test("Self-Adaptive DE supports batchFitness acceleration", async () => {
  const dim = 2;
  let batchCalls = 0;

  const problem: BlackBoxProblem = {
    dimension: dim,
    bounds: {
      min: new Float64Array([-5, -5]),
      max: new Float64Array([5, 5]),
    },
    fitness: sphere,
    batchFitness: async (candidates: Float64Array[]) => {
      batchCalls++;
      return candidates.map((c) => sphere(c));
    },
  };

  const res = await deSolve(problem, {
    maxGenerations: 20,
    populationSize: 15,
    seed: 999,
  });

  assert(batchCalls > 10, `batchFitness should be called, called ${batchCalls} times`);
  assert(res.bestFitness < 0.1, `Batch DE should converge, got ${res.bestFitness}`);
});

test("Particle Swarm Optimization minimizes Ackley benchmark", async () => {
  const dim = 3;
  const problem: BlackBoxProblem = {
    dimension: dim,
    bounds: {
      min: new Float64Array([-5, -5, -5]),
      max: new Float64Array([5, 5, 5]),
    },
    fitness: ackley,
  };

  const res = await psoSolve(problem, {
    maxGenerations: 70,
    swarmSize: 30,
    seed: 456,
  });

  assert(res.bestFitness < 1.0, `PSO on Ackley expected < 1.0, got ${res.bestFitness}`);
});

test("NSGA-II generates well-distributed Pareto frontier on ZDT1", async () => {
  const dim = 4;
  const problem: MultiObjectiveProblem = {
    dimension: dim,
    numObjectives: 2,
    bounds: {
      min: new Float64Array(dim).fill(0),
      max: new Float64Array(dim).fill(1),
    },
    fitness: (x: Float64Array) => {
      const f1 = x[0]!;
      let gSum = 0;
      for (let i = 1; i < dim; i++) {
        gSum += x[i]!;
      }
      const g = 1 + (9 * gSum) / (dim - 1);
      const f2 = g * (1 - Math.sqrt(Math.max(0, f1 / g)));
      return new Float64Array([f1, f2]);
    },
  };

  const res = await nsga2Solve(problem, {
    maxGenerations: 40,
    populationSize: 30,
    seed: 314,
  });

  assert(res.paretoFront.length > 5, "Pareto front should contain non-dominated points");

  // Verify non-domination property on extracted Pareto front
  for (let i = 0; i < res.paretoFront.length; i++) {
    for (let j = 0; j < res.paretoFront.length; j++) {
      if (i === j) continue;
      const a = res.paretoFront[i]!.objectives;
      const b = res.paretoFront[j]!.objectives;
      // No point should strictly dominate another point in paretoFront
      const aDominatesB = (a[0]! <= b[0]! && a[1]! < b[1]!) || (a[0]! < b[0]! && a[1]! <= b[1]!);
      assert(!aDominatesB, `Pareto front point ${i} should not dominate point ${j}`);
    }
  }

  // Check that objectives span a trade-off range (f1 from ~0 to ~1)
  const minF1 = Math.min(...res.paretoFront.map((p) => p.objectives[0]!));
  const maxF1 = Math.max(...res.paretoFront.map((p) => p.objectives[0]!));
  assert(maxF1 - minF1 > 0.4, `Pareto front should span f1 trade-off, spread = ${maxF1 - minF1}`);
});
