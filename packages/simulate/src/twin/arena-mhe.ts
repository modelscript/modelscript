// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Online Moving Horizon Estimator (MHE) for the WebAssembly DAE Arena.
 *
 * Utilizes continuous adjoint sensitivities (solveDaeAdjoint) and L-BFGS-B optimization
 * to simultaneously estimate physical parameters and in-arena neural surrogate weights
 * over rolling telemetry windows [t - W, t].
 */

import { DAEBuilder, type ArenaNeuralBlock } from "@modelscript/runtime";
import { DaeAdjointSolver, type DaeAdjointProblem } from "../core/dae-adjoint-solver.js";
import type { LbfgsbOptions, LbfgsbResult } from "../optimizer/solvers/lbfgsb.js";
import { lbfgsbSolve } from "../optimizer/solvers/lbfgsb.js";
import type { TelemetryWindow } from "./telemetry-buffer.js";

export type MheParameterBounds = Record<
  string,
  {
    min?: number;
    max?: number;
    prior?: number;
    regWeight?: number;
  }
>;

export interface MovingHorizonEstimatorOptions {
  /** The DAE problem representation in the WebAssembly arena. */
  problem: DAEBuilder | DaeAdjointProblem | { builder: DAEBuilder };
  /** Physical parameter names to calibrate. */
  parametersToEstimate: string[];
  /** Optional bounds, priors, and regularization weights for physical parameters. */
  parameterBounds?: MheParameterBounds;
  /** Optional neural surrogate block embedded in the DAE arena. */
  neuralBlock?: ArenaNeuralBlock;
  /** Optional initial state overrides at window start. */
  initialStates?: Record<string, number> | Map<string, number>;
  /** Global regularization weight lambda for prior deviation penalty. Default: 1e-4. */
  regularizationLambda?: number;
  /** L-BFGS-B optimizer configuration overrides. */
  optimizerOptions?: LbfgsbOptions;
}

export interface MheResult {
  converged: boolean;
  iterations: number;
  lossBefore: number;
  lossAfter: number;
  calibratedParameters: Record<string, number>;
  calibratedWeights?: Float64Array;
  residualNorm: number;
  parameterDeltas: Record<
    string,
    {
      prior: number;
      calibrated: number;
      deltaPct: number;
    }
  >;
  lbfgsResult: LbfgsbResult;
}

export class MovingHorizonEstimator {
  readonly arena: DAEBuilder;
  readonly solver: DaeAdjointSolver;
  readonly parametersToEstimate: string[];
  readonly parameterBounds: MheParameterBounds;
  readonly neuralBlock?: ArenaNeuralBlock;
  readonly initialStates?: Record<string, number> | Map<string, number>;
  readonly regularizationLambda: number;
  readonly optimizerOptions: LbfgsbOptions;

  private currentParameters: Map<string, number> = new Map();

  constructor(options: MovingHorizonEstimatorOptions) {
    const rawProb = options.problem as unknown as { builder?: DAEBuilder };
    if (rawProb instanceof DAEBuilder) {
      this.arena = rawProb;
    } else if (rawProb.builder instanceof DAEBuilder) {
      this.arena = rawProb.builder;
    } else {
      throw new Error("MovingHorizonEstimator: problem must be a DAEBuilder or contain a builder");
    }
    this.solver = new DaeAdjointSolver(this.arena);
    this.parametersToEstimate = [...options.parametersToEstimate];
    this.parameterBounds = options.parameterBounds ?? {};
    this.neuralBlock = options.neuralBlock;
    this.initialStates = options.initialStates;
    this.regularizationLambda = options.regularizationLambda ?? 1e-4;
    this.optimizerOptions = {
      maxIterations: 25,
      tolerance: 1e-5,
      ...options.optimizerOptions,
    };

    // Initialize current parameters from priors or defaults
    for (const name of this.parametersToEstimate) {
      const prior = this.parameterBounds[name]?.prior ?? 1.0;
      this.currentParameters.set(name, prior);
    }
  }

  /**
   * Set current parameter estimate directly.
   */
  setParameter(name: string, value: number): void {
    this.currentParameters.set(name, value);
  }

  /**
   * Get current parameter estimate.
   */
  getParameter(name: string): number {
    return this.currentParameters.get(name) ?? 1.0;
  }

  /**
   * Run MHE optimization over the provided telemetry observation window.
   *
   * @param window The telemetry time window [t - W, t].
   * @param targetVariableNames DAE state or algebraic variable names corresponding to window channels.
   * @param initialStateOverrides Optional state overrides at window start. If not supplied, auto-seeds from window.channels at t_0.
   */
  estimate(
    window: TelemetryWindow,
    targetVariableNames: string[],
    initialStateOverrides?: Record<string, number> | Map<string, number>,
  ): MheResult {
    const numPoints = window.times.length;
    if (numPoints < 2) {
      throw new Error(`MovingHorizonEstimator.estimate: window must contain at least 2 points`);
    }

    const startTime = window.times[0]!;
    const stopTime = window.times[numPoints - 1]!;

    if (stopTime <= startTime) {
      throw new Error(`MovingHorizonEstimator.estimate: stopTime must be > startTime`);
    }

    // Resolve initial states at window start t_0
    const resolvedInitialStates = new Map<string, number>();
    const stateOverridesSource = initialStateOverrides ?? this.initialStates;
    if (stateOverridesSource) {
      if (stateOverridesSource instanceof Map) {
        for (const [k, v] of stateOverridesSource) resolvedInitialStates.set(k, v);
      } else {
        for (const [k, v] of Object.entries(stateOverridesSource)) resolvedInitialStates.set(k, v);
      }
    } else {
      // Auto-seed initial state from window observation at t_0 for matching target variables
      for (let chIdx = 0; chIdx < targetVariableNames.length; chIdx++) {
        const name = targetVariableNames[chIdx]!;
        const firstVal = window.channels[chIdx]?.[0];
        if (typeof firstVal === "number" && isFinite(firstVal)) {
          resolvedInitialStates.set(name, firstVal);
        }
      }
    }

    // Number of physical parameters
    const numParams = this.parametersToEstimate.length;

    // Vector size: physical params (+ neural weights if present)
    const numWeights = this.neuralBlock ? this.neuralBlock.getWeights(this.arena).length : 0;
    const dim = numParams + numWeights;

    const x0 = new Float64Array(dim);
    const lb = new Float64Array(dim);
    const ub = new Float64Array(dim);
    const priors = new Float64Array(dim);
    const regWeights = new Float64Array(dim);

    // Populate physical parameters
    for (let i = 0; i < numParams; i++) {
      const name = this.parametersToEstimate[i]!;
      const currentVal = this.currentParameters.get(name) ?? 1.0;
      const b = this.parameterBounds[name];

      x0[i] = currentVal;
      lb[i] = b?.min ?? -Infinity;
      ub[i] = b?.max ?? Infinity;
      priors[i] = b?.prior ?? currentVal;
      regWeights[i] = b?.regWeight ?? this.regularizationLambda;
    }

    // Populate neural weights if present
    if (this.neuralBlock && numWeights > 0) {
      const initialWeights = this.neuralBlock.getWeights(this.arena);
      for (let j = 0; j < numWeights; j++) {
        const idx = numParams + j;
        x0[idx] = initialWeights[j]!;
        lb[idx] = -10.0;
        ub[idx] = 10.0;
        priors[idx] = initialWeights[j]!;
        regWeights[idx] = this.regularizationLambda * 0.1;
      }
    }

    const dt = numPoints > 1 ? (stopTime - startTime) / (numPoints - 1) : 0.05;

    // Target trajectory formatting for solveDaeAdjoint
    const targetTrajectory = {
      names: targetVariableNames,
      t: Array.from(window.times),
      y: targetVariableNames.map((_, chIdx) => Array.from(window.channels[chIdx]!)),
    };

    let lossBefore = 0.0;
    let isFirstEval = true;

    // Objective and gradient evaluation function for L-BFGS-B
    const evalCostAndGrad = (x: Float64Array): { cost: number; grad: Float64Array } => {
      // 1. Apply parameters to map
      const paramOverrides = new Map<string, number>();
      for (let i = 0; i < numParams; i++) {
        paramOverrides.set(this.parametersToEstimate[i]!, x[i]!);
      }

      // 2. Apply neural weights if present
      if (this.neuralBlock && numWeights > 0) {
        const wSlice = x.subarray(numParams, numParams + numWeights);
        this.neuralBlock.setWeights(this.arena, wSlice);
      }

      // 3. Solve DAE continuous adjoints
      const adjointResult = this.solver.solve({
        startTime,
        stopTime,
        step: dt,
        parameterOverrides: paramOverrides,
        initialStateOverrides: resolvedInitialStates,
        parametersToDifferentiate: this.parametersToEstimate,
        targetTrajectory,
      });

      let totalLoss = adjointResult.loss;
      if (isFirstEval) {
        lossBefore = totalLoss;
        isFirstEval = false;
      }

      const grad = new Float64Array(dim);

      // Physical parameter gradients + regularization penalty d(0.5*reg*(p - p_prior)^2)/dp
      for (let i = 0; i < numParams; i++) {
        const name = this.parametersToEstimate[i]!;
        const dLdp = adjointResult.gradients.get(name) ?? 0.0;
        const reg = regWeights[i]!;
        const dev = x[i]! - priors[i]!;

        totalLoss += 0.5 * reg * dev * dev;
        grad[i] = dLdp + reg * dev;
      }

      // Regularization gradient
      if (this.neuralBlock && numWeights > 0) {
        for (let j = 0; j < numWeights; j++) {
          const idx = numParams + j;
          const reg = regWeights[idx]!;
          const dev = x[idx]! - priors[idx]!;
          totalLoss += 0.5 * reg * dev * dev;
          grad[idx] = reg * dev;
        }
      }

      return { cost: totalLoss, grad };
    };

    // Execute L-BFGS-B
    const lbfgsResult = lbfgsbSolve(x0, evalCostAndGrad, lb, ub, this.optimizerOptions);

    // Extract calibrated parameters
    const calibratedParameters: Record<string, number> = {};
    const parameterDeltas: Record<string, { prior: number; calibrated: number; deltaPct: number }> = {};

    for (let i = 0; i < numParams; i++) {
      const name = this.parametersToEstimate[i]!;
      const calVal = lbfgsResult.x[i]!;
      const priorVal = priors[i]!;

      this.currentParameters.set(name, calVal);
      calibratedParameters[name] = calVal;

      const deltaPct = priorVal !== 0 ? ((calVal - priorVal) / Math.abs(priorVal)) * 100.0 : 0.0;
      parameterDeltas[name] = {
        prior: priorVal,
        calibrated: calVal,
        deltaPct,
      };
    }

    let calibratedWeights: Float64Array | undefined;
    if (this.neuralBlock && numWeights > 0) {
      calibratedWeights = new Float64Array(lbfgsResult.x.subarray(numParams, numParams + numWeights));
      this.neuralBlock.setWeights(this.arena, calibratedWeights);
    }

    return {
      converged: lbfgsResult.converged,
      iterations: lbfgsResult.iterations,
      lossBefore,
      lossAfter: lbfgsResult.cost,
      calibratedParameters,
      calibratedWeights,
      residualNorm: Math.sqrt((2.0 * Math.max(0, lbfgsResult.cost)) / (numPoints * targetVariableNames.length)),
      parameterDeltas,
      lbfgsResult,
    };
  }
}
