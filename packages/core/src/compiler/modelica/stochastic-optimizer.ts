// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Stochastic Optimization Framework.
 *
 * Provides scenario-based optimization methods for decision-making under uncertainty:
 *
 *   - **Sample Average Approximation (SAA):** Replaces expectation with a sample mean,
 *     converting the stochastic program into a deterministic NLP with N scenario copies.
 *
 *   - **Progressive Hedging (PH):** Decomposable multi-stage stochastic programming
 *     via scenario-wise subproblems with consensus constraints (Rockafellar & Wets, 1991).
 *
 *   - **VSS/EVPI diagnostics:** Value of Stochastic Solution and Expected Value of
 *     Perfect Information to quantify the benefit of stochastic vs deterministic approaches.
 *
 * Integrates with the existing SQP solver in optimizer.ts for subproblem solutions
 * and the Monte Carlo engine in monte-carlo.ts for scenario generation.
 */

import {
  type MonteCarloOptions,
  type RandomVariable,
  Xoshiro256pp,
  latinHypercubeSample,
  sampleDistribution,
} from "./monte-carlo.js";
import type { OptimizationProblem, OptimizationResult, TranscriptionMethod } from "./optimizer.js";

// ─────────────────────────────────────────────────────────────────────
// Stochastic Problem Definitions
// ─────────────────────────────────────────────────────────────────────

/** A single scenario realization: parameter name → sampled value. */
export type Scenario = Map<string, number>;

/**
 * Two-stage stochastic optimization problem.
 *
 *   min_x  E_ξ[ f(x, ξ) ]
 *   s.t.   E_ξ[ g(x, ξ) ] ≤ 0      (expected-value constraints)
 *     or   P( g(x, ξ) ≤ 0 ) ≥ 1−ε   (chance constraints)
 */
export interface StochasticProblem {
  /** Base deterministic optimization problem. */
  baseProblem: OptimizationProblem;
  /** Random variables with their distributions. */
  randomVariables: RandomVariable[];
  /** Pre-generated scenarios (if not provided, generated from randomVariables). */
  scenarios?: Scenario[];
  /** Scenario weights (probabilities). Defaults to uniform 1/N. */
  weights?: number[];
  /** Monte Carlo options for scenario generation. */
  monteCarloOptions?: MonteCarloOptions;
}

/**
 * Multi-stage stochastic optimization problem.
 * Each stage has its own decision variables and constraints.
 */
export interface MultiStageStochasticProblem {
  /** Stages: each stage has a set of decisions and constraint definitions. */
  stages: StageDefinition[];
  /** Scenario tree: each scenario is a full realization across all stages. */
  scenarios: Scenario[];
  /** Scenario probabilities. */
  weights: number[];
  /** Penalty parameter ρ for Progressive Hedging (default: 1.0). */
  rho?: number;
  /** Maximum PH iterations (default: 100). */
  maxIterations?: number;
  /** PH convergence tolerance (default: 1e-4). */
  tolerance?: number;
}

export interface StageDefinition {
  /** Variable names that are decided at this stage. */
  variables: string[];
  /** Transcription method for optimal control within this stage. */
  method?: TranscriptionMethod;
}

/**
 * Stochastic optimization result.
 */
export interface StochasticResult extends OptimizationResult {
  /** Per-scenario optimal costs. */
  scenarioCosts: number[];
  /** Value of Stochastic Solution: EEV − RP. */
  vss?: number;
  /** Expected Value of Perfect Information: RP − WS. */
  evpi?: number;
  /** Number of scenarios used. */
  numScenarios: number;
}

// ─────────────────────────────────────────────────────────────────────
// Scenario Generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate scenarios from random variable distributions.
 */
export function generateScenarios(
  randomVars: RandomVariable[],
  options?: MonteCarloOptions,
): { scenarios: Scenario[]; weights: number[] } {
  const N = options?.numSamples ?? 100;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);

  let scenarios: Scenario[];
  if (options?.latinHypercube) {
    scenarios = latinHypercubeSample(randomVars, N, rng);
  } else {
    scenarios = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      scenarios.push(sample);
    }
  }

  // Uniform weights
  const weights = new Array<number>(scenarios.length).fill(1 / scenarios.length);
  return { scenarios, weights };
}

// ─────────────────────────────────────────────────────────────────────
// Sample Average Approximation (SAA)
// ─────────────────────────────────────────────────────────────────────

/**
 * Sample Average Approximation solver.
 *
 * Solves:
 *   min_x  (1/N) Σᵢ f(x, ξᵢ)
 *   s.t.   (1/N) Σᵢ g(x, ξᵢ) ≤ 0
 *
 * by solving each scenario as a separate deterministic problem, then
 * averaging the results. For problems with shared decision variables
 * (first-stage decisions), the SAA NLP is constructed by replicating
 * the constraints for each scenario while sharing the control variables.
 */
export class SampleAverageApproximation {
  /**
   * Solve the SAA problem.
   *
   * @param problem   Stochastic problem definition
   * @param solveFn   Function that solves a single deterministic OCP
   *                  with parameter overrides and returns the result
   */
  solve(
    problem: StochasticProblem,
    solveFn: (baseProblem: OptimizationProblem, paramOverrides: Map<string, number>) => OptimizationResult,
  ): StochasticResult {
    // Generate or use provided scenarios
    let scenarios = problem.scenarios;
    let weights = problem.weights;
    if (!scenarios || scenarios.length === 0) {
      const gen = generateScenarios(problem.randomVariables, problem.monteCarloOptions);
      scenarios = gen.scenarios;
      weights = gen.weights;
    }
    if (!weights) {
      weights = new Array(scenarios.length).fill(1 / scenarios.length);
    }

    const N = scenarios.length;
    const scenarioCosts: number[] = [];
    const scenarioResults: OptimizationResult[] = [];

    // Solve each scenario independently
    for (let i = 0; i < N; i++) {
      const overrides = new Map<string, number>(problem.baseProblem.parameterOverrides ?? []);
      // Merge scenario parameter values
      for (const [name, value] of scenarios[i]!) {
        overrides.set(name, value);
      }

      const scenarioProblem: OptimizationProblem = {
        ...problem.baseProblem,
        parameterOverrides: overrides,
      };

      try {
        const result = solveFn(scenarioProblem, overrides);
        scenarioResults.push(result);
        scenarioCosts.push(result.cost);
      } catch {
        scenarioCosts.push(Infinity);
      }
    }

    // Compute formulation-specific cost (EV, CVaR, Worst-case, Average)
    let rpCost = 0;
    const method = problem.baseProblem.robustMethod ?? "expected-value";

    if (method === "worst-case") {
      // Min-Max formulation: taking the worst scenario cost
      rpCost = -Infinity;
      for (let i = 0; i < N; i++) {
        if (isFinite(scenarioCosts[i]!) && scenarioCosts[i]! > rpCost) {
          rpCost = scenarioCosts[i]!;
        }
      }
      if (rpCost === -Infinity) rpCost = Infinity;
    } else if (method === "cvar") {
      // Conditional Value at Risk
      const alpha = problem.baseProblem.cvarLevel ?? 0.95;
      const validCosts = scenarioCosts.filter((c) => isFinite(c)).sort((a, b) => a - b);
      if (validCosts.length > 0) {
        const tailStartIndex = Math.floor(alpha * validCosts.length);
        const tail = validCosts.slice(tailStartIndex);
        rpCost = tail.reduce((sum, c) => sum + c, 0) / tail.length;
      } else {
        rpCost = Infinity;
      }
    } else {
      // Default: Expected Value (average)
      let totalWeight = 0;
      for (let i = 0; i < N; i++) {
        if (isFinite(scenarioCosts[i]!)) {
          rpCost += weights[i]! * scenarioCosts[i]!;
          totalWeight += weights[i]!;
        }
      }
      rpCost = totalWeight > 0 ? rpCost / totalWeight : Infinity;
    }

    // Average control trajectories across successful scenarios
    const successResults = scenarioResults.filter((r) => r.success);
    const avgControls = new Map<string, number[]>();
    const avgStates = new Map<string, number[]>();

    if (successResults.length > 0) {
      const refResult = successResults[0]!;

      // Average controls
      for (const [name, vals] of refResult.controls) {
        const avg = new Array<number>(vals.length).fill(0);
        for (const r of successResults) {
          const cv = r.controls.get(name);
          if (cv) {
            for (let k = 0; k < vals.length; k++) {
              avg[k]! += (cv[k] ?? 0) / successResults.length;
            }
          }
        }
        avgControls.set(name, avg);
      }

      // Average states
      for (const [name, vals] of refResult.states) {
        const avg = new Array<number>(vals.length).fill(0);
        for (const r of successResults) {
          const sv = r.states.get(name);
          if (sv) {
            for (let k = 0; k < vals.length; k++) {
              avg[k]! += (sv[k] ?? 0) / successResults.length;
            }
          }
        }
        avgStates.set(name, avg);
      }
    }

    // Compute VSS: solve EV problem (expected-value parameters)
    // VSS = EEV − RP (value of using stochastic solution vs deterministic)
    // We skip computing this if there's no solveFn for the EV problem

    const refResult = successResults[0];
    const tGrid = refResult?.t ?? [];
    const totalIter = scenarioResults.reduce((s, r) => s + r.iterations, 0);

    return {
      success: successResults.length > 0,
      cost: rpCost,
      iterations: totalIter,
      t: tGrid,
      states: avgStates,
      controls: avgControls,
      costHistory: [rpCost],
      messages: `SAA solved ${successResults.length}/${N} scenarios. RP cost = ${rpCost.toExponential(4)}.`,
      scenarioCosts,
      numScenarios: N,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Progressive Hedging (PH)
// ─────────────────────────────────────────────────────────────────────

/**
 * Progressive Hedging solver for multi-stage stochastic programs.
 *
 * Decomposes the problem into per-scenario subproblems with augmented
 * Lagrangian terms that enforce consensus:
 *
 *   min_xˢ fˢ(xˢ) + ⟨wˢ, xˢ⟩ + (ρ/2)‖xˢ − x̄‖²
 *
 * where x̄ is the consensus (scenario-weighted average), wˢ are
 * Lagrange multipliers, and ρ is the penalty parameter.
 *
 * Algorithm:
 *   1. Solve each scenario independently to get x⁰ˢ
 *   2. Compute consensus x̄ = Σ pˢ xˢ
 *   3. Update multipliers: wˢ ← wˢ + ρ(xˢ − x̄)
 *   4. Re-solve augmented scenario subproblems
 *   5. Repeat until ‖xˢ − x̄‖ < tol for all s
 *
 * Reference: Rockafellar, R.T. & Wets, R.J-B. (1991),
 *   "Scenarios and Policy Aggregation in Optimization Under Uncertainty",
 *   Mathematics of Operations Research.
 */
export class ProgressiveHedging {
  solve(
    problem: MultiStageStochasticProblem,
    solveFn: (
      baseProblem: OptimizationProblem,
      paramOverrides: Map<string, number>,
      augmentedLagrangian?: { multipliers: Map<string, number[]>; consensus: Map<string, number[]>; rho: number },
    ) => OptimizationResult,
    baseProblem: OptimizationProblem,
  ): StochasticResult {
    const { scenarios, weights, stages } = problem;
    const rho = problem.rho ?? 1.0;
    const maxIter = problem.maxIterations ?? 100;
    const tol = problem.tolerance ?? 1e-4;
    const N = scenarios.length;

    // Collect all decision variable names across stages
    const allVars: string[] = [];
    for (const stage of stages) {
      allVars.push(...stage.variables);
    }

    // Initialize: solve each scenario independently
    const scenarioSolutions: Map<string, number[]>[] = [];
    const scenarioCosts: number[] = [];

    for (let s = 0; s < N; s++) {
      const overrides = new Map<string, number>(baseProblem.parameterOverrides ?? []);
      for (const [name, value] of scenarios[s]!) {
        overrides.set(name, value);
      }
      const result = solveFn(baseProblem, overrides);
      scenarioCosts.push(result.cost);

      // Extract solution for consensus variables
      const sol = new Map<string, number[]>();
      for (const name of allVars) {
        sol.set(name, result.controls.get(name) ?? result.states.get(name) ?? [0]);
      }
      scenarioSolutions.push(sol);
    }

    // Initialize multipliers to zero
    const multipliers: Map<string, number[]>[] = [];
    for (let s = 0; s < N; s++) {
      const w = new Map<string, number[]>();
      for (const name of allVars) {
        const len = scenarioSolutions[s]!.get(name)?.length ?? 1;
        w.set(name, new Array(len).fill(0));
      }
      multipliers.push(w);
    }

    // PH iterations
    let converged = false;

    let iter: number;
    for (iter = 0; iter < maxIter; iter++) {
      // Step 1: Compute consensus x̄ = Σ pˢ xˢ
      const consensus = new Map<string, number[]>();
      for (const name of allVars) {
        const len = scenarioSolutions[0]!.get(name)?.length ?? 1;
        const avg = new Array<number>(len).fill(0);
        for (let s = 0; s < N; s++) {
          const xs = scenarioSolutions[s]!.get(name);
          if (xs) {
            for (let k = 0; k < len; k++) {
              avg[k]! += weights[s]! * (xs[k] ?? 0);
            }
          }
        }
        consensus.set(name, avg);
      }

      // Step 2: Check convergence — max ‖xˢ − x̄‖∞ over all scenarios
      let maxDeviation = 0;
      for (let s = 0; s < N; s++) {
        for (const name of allVars) {
          const xs = scenarioSolutions[s]!.get(name) ?? [];
          const xbar = consensus.get(name) ?? [];
          for (let k = 0; k < xs.length; k++) {
            maxDeviation = Math.max(maxDeviation, Math.abs((xs[k] ?? 0) - (xbar[k] ?? 0)));
          }
        }
      }

      if (maxDeviation < tol) {
        converged = true;
        break;
      }

      // Step 3: Update multipliers: wˢ ← wˢ + ρ(xˢ − x̄)
      for (let s = 0; s < N; s++) {
        for (const name of allVars) {
          const ws = multipliers[s]!.get(name)!;
          const xs = scenarioSolutions[s]!.get(name) ?? [];
          const xbar = consensus.get(name) ?? [];
          for (let k = 0; k < ws.length; k++) {
            ws[k]! += rho * ((xs[k] ?? 0) - (xbar[k] ?? 0));
          }
        }
      }

      // Step 4: Re-solve augmented subproblems
      for (let s = 0; s < N; s++) {
        const overrides = new Map<string, number>(baseProblem.parameterOverrides ?? []);
        for (const [name, value] of scenarios[s]!) {
          overrides.set(name, value);
        }

        const result = solveFn(baseProblem, overrides, {
          multipliers: multipliers[s]!,
          consensus,
          rho,
        });

        scenarioCosts[s] = result.cost;

        // Update solution
        for (const name of allVars) {
          scenarioSolutions[s]!.set(name, result.controls.get(name) ?? result.states.get(name) ?? [0]);
        }
      }
    }

    // Build final result from consensus
    const finalConsensus = new Map<string, number[]>();
    for (const name of allVars) {
      const len = scenarioSolutions[0]!.get(name)?.length ?? 1;
      const avg = new Array<number>(len).fill(0);
      for (let s = 0; s < N; s++) {
        const xs = scenarioSolutions[s]!.get(name);
        if (xs) {
          for (let k = 0; k < len; k++) {
            avg[k]! += weights[s]! * (xs[k] ?? 0);
          }
        }
      }
      finalConsensus.set(name, avg);
    }

    // Weighted average cost
    let avgCost = 0;
    for (let s = 0; s < N; s++) {
      avgCost += weights[s]! * scenarioCosts[s]!;
    }

    const refResult = scenarioSolutions[0];
    const nPoints = refResult ? (refResult.values().next().value?.length ?? 0) : 0;
    const tGrid: number[] = [];
    if (nPoints > 0) {
      const dt = (baseProblem.stopTime - baseProblem.startTime) / (nPoints - 1);
      for (let k = 0; k < nPoints; k++) {
        tGrid.push(baseProblem.startTime + k * dt);
      }
    }

    return {
      success: converged,
      cost: avgCost,
      iterations: iter,
      t: tGrid,
      states: finalConsensus,
      controls: finalConsensus,
      costHistory: [avgCost],
      messages: converged
        ? `PH converged in ${iter} iterations with ${N} scenarios.`
        : `PH did not converge after ${iter} iterations (max deviation above tolerance).`,
      scenarioCosts,
      numScenarios: N,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// VSS and EVPI Diagnostics
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the Value of Stochastic Solution (VSS) and Expected Value
 * of Perfect Information (EVPI).
 *
 *   VSS = EEV − RP ≥ 0
 *     - RP: optimal cost of the stochastic (recourse) problem
 *     - EEV: cost of using the EV (expected-value) solution in stochastic scenarios
 *     - Quantifies the benefit of the stochastic approach
 *
 *   EVPI = RP − WS ≥ 0
 *     - WS: wait-and-see optimal cost (average of per-scenario optima)
 *     - Quantifies the value of having perfect information
 *
 * @param rpCost       Recourse Problem optimal cost
 * @param scenarioCosts Per-scenario optimal costs (from SAA)
 * @param weights      Scenario probabilities
 * @param evSolveFn    Function to solve the EV problem and evaluate it per scenario
 */
export function computeVSSandEVPI(
  rpCost: number,
  scenarioCosts: number[],
  weights: number[],
  evCost?: number,
): { vss?: number; evpi: number } {
  // WS = Σ pˢ · (optimal cost for scenario s) — wait-and-see value
  let ws = 0;
  for (let i = 0; i < scenarioCosts.length; i++) {
    ws += weights[i]! * scenarioCosts[i]!;
  }
  const evpi = rpCost - ws;

  // VSS = EEV − RP
  const vss = evCost !== undefined ? evCost - rpCost : undefined;

  if (vss !== undefined) {
    return { vss, evpi: Math.max(0, evpi) };
  }
  return { evpi: Math.max(0, evpi) };
}
