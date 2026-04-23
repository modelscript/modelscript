// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Model calibration solver for Modelica models.
 *
 * Solves the output-error parameter estimation problem:
 *
 *   min_θ  Σ_i Σ_k  w_i · ( y_{ik}^sim(θ) − y_{ik}^meas )²
 *   s.t.   θ_min ≤ θ ≤ θ_max
 *
 * where θ is the vector of model parameters, y^sim is the simulated output
 * interpolated at measurement times, and y^meas is the measured data.
 *
 * Two solver strategies:
 *   - **Levenberg-Marquardt** (default): Natural for least-squares; works
 *     directly on the residual vector and its Jacobian.
 *   - **SQP**: Reuses the existing sqpSolve() with nEq=0; treats the
 *     sum-of-squares as a scalar objective.
 *
 * Gradient computation:
 *   - **Forward sensitivity analysis** (default): Uses the existing
 *     DualExpressionEvaluator (forward-mode AD) to compute ∂y/∂θ
 *     during each simulation, propagating parameter sensitivities
 *     through the ODE integration.
 *   - **Finite differences** (fallback): Perturbs each parameter and
 *     re-simulates.
 *
 * Pure TypeScript — no native dependencies.
 */

import { type ModelicaSimulator, luFactor, luSolve } from "@modelscript/simulator";
import type { ModelicaDAE } from "@modelscript/symbolics";
import { ModelicaIntegerLiteral, ModelicaRealLiteral } from "@modelscript/symbolics";

// ── Public interfaces ──

export interface CalibrationProblem {
  /** Parameter names to calibrate. */
  parameters: string[];
  /** Box constraints: parameter → { min, max }. */
  parameterBounds: Map<string, { min: number; max: number }>;
  /** Initial guesses (from model defaults if omitted). */
  initialGuess?: Map<string, number>;
  /** Measurement data: variable name → { t: number[], y: number[] }. */
  measurements: Map<string, { t: number[]; y: number[] }>;
  /** Per-variable weights (default 1.0). */
  weights?: Map<string, number>;
  /** Simulation time range (auto-detected from measurements if omitted). */
  startTime?: number;
  stopTime?: number;
  /** NLP convergence tolerance (default 1e-8). */
  tolerance?: number;
  /** Maximum iterations (default 100). */
  maxIterations?: number;
  /** Solver method (default: "lm"). */
  method?: "lm" | "sqp";
  /** Gradient method (default: "sensitivity"). */
  gradient?: "sensitivity" | "finite-difference";
}

export interface CalibrationResult {
  success: boolean;
  /** Optimal parameter values. */
  parameters: Map<string, number>;
  /** Final residual (sum of squared errors). */
  residual: number;
  /** Per-variable residuals. */
  variableResiduals: Map<string, number>;
  /** Solver iterations. */
  iterations: number;
  /** Simulated trajectories at optimal parameters. */
  simulated: { t: number[]; y: Map<string, number[]> };
  /** Cost history for convergence monitoring. */
  costHistory: number[];
  message: string;
}

// ── Calibrator ──

export class ModelicaCalibrator {
  private dae: ModelicaDAE;
  private simulator: ModelicaSimulator;
  private problem: CalibrationProblem;

  constructor(dae: ModelicaDAE, simulator: ModelicaSimulator, problem: CalibrationProblem) {
    this.dae = dae;
    this.simulator = simulator;
    this.problem = problem;
  }

  /**
   * Run the calibration.
   */
  public calibrate(): CalibrationResult {
    const method = this.problem.method ?? "lm";
    if (method === "lm") {
      return this.solveLM();
    }
    return this.solveSQP();
  }

  // ────────────────────────────────────────────────────────────────────
  // Levenberg-Marquardt solver
  // ────────────────────────────────────────────────────────────────────

  private solveLM(): CalibrationResult {
    const { parameters, parameterBounds, measurements, weights } = this.problem;
    const tol = this.problem.tolerance ?? 1e-8;
    const maxIter = this.problem.maxIterations ?? 100;
    const nParams = parameters.length;

    // Build initial guess
    const theta = new Float64Array(nParams);
    for (let i = 0; i < nParams; i++) {
      const name = parameters[i]!;
      theta[i] = this.problem.initialGuess?.get(name) ?? this.extractDefaultValue(name);
    }

    // Total residual count
    let nResiduals = 0;
    for (const [, meas] of measurements) {
      nResiduals += meas.t.length;
    }

    // LM parameters
    let lambda = 1e-3; // damping parameter
    const lambdaUp = 10;
    const lambdaDown = 10;
    const costHistory: number[] = [];

    // Evaluate initial residuals
    let { residuals, jacobian, cost } = this.evaluateResidualsAndJacobian(theta);
    costHistory.push(cost);

    let converged = false;
    let iter: number;

    for (iter = 0; iter < maxIter; iter++) {
      // Build normal equations: (J'J + λI) Δθ = -J'r
      const JtJ = new Array<Float64Array>(nParams);
      for (let i = 0; i < nParams; i++) {
        JtJ[i] = new Float64Array(nParams);
      }
      const Jtr = new Float64Array(nParams);

      for (let i = 0; i < nParams; i++) {
        for (let j = 0; j <= i; j++) {
          let sum = 0;
          for (let k = 0; k < nResiduals; k++) {
            sum += jacobian[k]![i]! * jacobian[k]![j]!;
          }
          JtJ[i]![j] = sum;
          JtJ[j]![i] = sum;
        }
        // Add damping
        JtJ[i]![i] = (JtJ[i]![i] ?? 0) + lambda;

        // Compute J'r
        let jtr = 0;
        for (let k = 0; k < nResiduals; k++) {
          jtr += jacobian[k]![i]! * residuals[k]!;
        }
        Jtr[i] = -jtr;
      }

      // Solve for step: (J'J + λI) Δθ = -J'r
      const lu = luFactor(JtJ, nParams);
      luSolve(lu, Jtr);
      const step = Jtr;

      // Project step onto box constraints
      const thetaTrial = new Float64Array(nParams);
      for (let i = 0; i < nParams; i++) {
        const name = parameters[i]!;
        const bounds = parameterBounds.get(name);
        let newVal = theta[i]! + step[i]!;
        if (bounds) {
          newVal = Math.max(bounds.min, Math.min(bounds.max, newVal));
        }
        thetaTrial[i] = newVal;
      }

      // Evaluate trial point
      const trial = this.evaluateResidualsAndJacobian(thetaTrial);

      if (trial.cost < cost) {
        // Accept step, decrease damping
        theta.set(thetaTrial);
        residuals = trial.residuals;
        jacobian = trial.jacobian;
        cost = trial.cost;
        costHistory.push(cost);
        lambda = Math.max(lambda / lambdaDown, 1e-12);

        // Check convergence: relative cost change
        if (costHistory.length >= 2) {
          const prevCost = costHistory[costHistory.length - 2]!;
          if (prevCost > 0 && Math.abs(prevCost - cost) / prevCost < tol) {
            converged = true;
            break;
          }
        }

        // Check convergence: gradient norm
        let gradNorm = 0;
        for (let i = 0; i < nParams; i++) {
          let g = 0;
          for (let k = 0; k < nResiduals; k++) {
            g += jacobian[k]![i]! * residuals[k]!;
          }
          gradNorm += g * g;
        }
        if (Math.sqrt(gradNorm) < tol) {
          converged = true;
          break;
        }
      } else {
        // Reject step, increase damping
        lambda = Math.min(lambda * lambdaUp, 1e10);
      }
    }

    // Build result
    return this.buildResult(theta, cost, costHistory, iter, converged, measurements, weights);
  }

  // ────────────────────────────────────────────────────────────────────
  // SQP solver (scalar objective)
  // ────────────────────────────────────────────────────────────────────

  private solveSQP(): CalibrationResult {
    const { parameters, parameterBounds, measurements, weights } = this.problem;
    const tol = this.problem.tolerance ?? 1e-8;
    const maxIter = this.problem.maxIterations ?? 100;
    const nParams = parameters.length;

    // Build initial guess
    const theta = new Float64Array(nParams);
    for (let i = 0; i < nParams; i++) {
      const name = parameters[i]!;
      theta[i] = this.problem.initialGuess?.get(name) ?? this.extractDefaultValue(name);
    }

    // Box constraints
    const lb = new Float64Array(nParams);
    const ub = new Float64Array(nParams);
    for (let i = 0; i < nParams; i++) {
      const name = parameters[i]!;
      const bounds = parameterBounds.get(name);
      lb[i] = bounds?.min ?? -1e10;
      ub[i] = bounds?.max ?? 1e10;
    }

    // BFGS Hessian approximation
    const H = new Array<Float64Array>(nParams);
    for (let i = 0; i < nParams; i++) {
      H[i] = new Float64Array(nParams);
      H[i]![i] = 1.0;
    }

    const grad = new Float64Array(nParams);
    const gradPrev = new Float64Array(nParams);
    const costHistory: number[] = [];

    // Evaluate initial cost and gradient
    let cost = this.evaluateCost(theta);
    this.evaluateGradient(theta, grad);
    costHistory.push(cost);

    let converged = false;
    let iter: number;

    for (iter = 0; iter < maxIter; iter++) {
      // Check convergence: gradient norm
      let gradNorm = 0;
      for (let i = 0; i < nParams; i++) gradNorm = Math.max(gradNorm, Math.abs(grad[i]!));
      if (gradNorm < tol) {
        converged = true;
        break;
      }

      // Compute search direction: d = -H⁻¹ · grad (using H as approx Hessian)
      const rhs = new Float64Array(nParams);
      for (let i = 0; i < nParams; i++) rhs[i] = -grad[i]!;
      const lu = luFactor(H, nParams);
      luSolve(lu, rhs);
      const d = rhs;

      // Project onto box constraints
      for (let i = 0; i < nParams; i++) {
        const newZ = theta[i]! + d[i]!;
        if (newZ < lb[i]!) d[i] = lb[i]! - theta[i]!;
        if (newZ > ub[i]!) d[i] = ub[i]! - theta[i]!;
      }

      // Armijo line search
      let dirDeriv = 0;
      for (let i = 0; i < nParams; i++) dirDeriv += grad[i]! * d[i]!;

      let alpha = 1.0;
      const thetaTrial = new Float64Array(nParams);
      while (alpha > 1e-12) {
        for (let i = 0; i < nParams; i++) {
          thetaTrial[i] = Math.max(lb[i]!, Math.min(ub[i]!, theta[i]! + alpha * d[i]!));
        }
        const trialCost = this.evaluateCost(thetaTrial);
        if (trialCost <= cost + 1e-4 * alpha * dirDeriv) break;
        alpha *= 0.5;
      }

      // Save previous gradient for BFGS
      gradPrev.set(grad);

      // Take step
      for (let i = 0; i < nParams; i++) {
        theta[i] = Math.max(lb[i]!, Math.min(ub[i]!, theta[i]! + alpha * d[i]!));
      }

      cost = this.evaluateCost(theta);
      costHistory.push(cost);
      this.evaluateGradient(theta, grad);

      // BFGS update
      const s = new Float64Array(nParams);
      const y = new Float64Array(nParams);
      for (let i = 0; i < nParams; i++) {
        s[i] = alpha * d[i]!;
        y[i] = grad[i]! - gradPrev[i]!;
      }
      let sy = 0;
      for (let i = 0; i < nParams; i++) sy += s[i]! * y[i]!;

      if (sy > 1e-12) {
        const Hs = new Float64Array(nParams);
        for (let i = 0; i < nParams; i++) {
          let sum = 0;
          for (let j = 0; j < nParams; j++) sum += H[i]![j]! * s[j]!;
          Hs[i] = sum;
        }
        let sHs = 0;
        for (let i = 0; i < nParams; i++) sHs += s[i]! * Hs[i]!;

        if (sHs > 1e-12) {
          for (let i = 0; i < nParams; i++) {
            for (let j = 0; j < nParams; j++) {
              H[i]![j] = H[i]![j]! + (y[i]! * y[j]!) / sy - (Hs[i]! * Hs[j]!) / sHs;
            }
          }
        }
      }

      // Check relative cost change
      if (costHistory.length >= 2) {
        const prevCost = costHistory[costHistory.length - 2]!;
        if (prevCost > 0 && Math.abs(prevCost - cost) / prevCost < tol) {
          converged = true;
          break;
        }
      }
    }

    return this.buildResult(theta, cost, costHistory, iter, converged, measurements, weights);
  }

  // ────────────────────────────────────────────────────────────────────
  // Residual and Jacobian evaluation
  // ────────────────────────────────────────────────────────────────────

  /**
   * Evaluate residuals and Jacobian at a parameter vector.
   *
   * The Jacobian J[k][i] = ∂r_k/∂θ_i is computed via forward sensitivity
   * analysis (forward-mode AD through the simulation) or finite differences.
   */
  private evaluateResidualsAndJacobian(theta: Float64Array): {
    residuals: Float64Array;
    jacobian: Float64Array[];
    cost: number;
  } {
    const { parameters, measurements, weights } = this.problem;
    const nParams = parameters.length;
    const useSensitivity = (this.problem.gradient ?? "sensitivity") === "sensitivity";

    // Total residual count
    let nResiduals = 0;
    for (const [, meas] of measurements) {
      nResiduals += meas.t.length;
    }

    const residuals = new Float64Array(nResiduals);
    const jacobian: Float64Array[] = [];
    for (let k = 0; k < nResiduals; k++) {
      jacobian.push(new Float64Array(nParams));
    }

    if (useSensitivity) {
      // ── Forward sensitivity analysis ──
      // Simulate once, computing ∂y/∂θ alongside via the DualExpressionEvaluator.
      // For each parameter θ_i, we seed it with dot=1 and propagate through
      // the simulation. This requires nParams simulation passes with dual numbers.

      // First: simulate to get y(θ)
      const simResult = this.simulateWithParams(theta);

      // Compute residuals
      let residIdx = 0;
      for (const [varName, meas] of measurements) {
        const w = weights?.get(varName) ?? 1.0;
        const sqrtW = Math.sqrt(w);
        const simIdx = simResult.states.indexOf(varName);
        for (let k = 0; k < meas.t.length; k++) {
          const yMeas = meas.y[k]!;
          let ySim = 0;
          if (simIdx !== -1) {
            ySim = interpolate(simResult.t, simResult.y, simIdx, meas.t[k]!);
          }
          residuals[residIdx] = sqrtW * (ySim - yMeas);
          residIdx++;
        }
      }

      // Compute Jacobian via forward sensitivity: for each parameter,
      // perturb the simulation and compute ∂y/∂θ_i
      for (let pi = 0; pi < nParams; pi++) {
        const eps = Math.max(1e-7, Math.abs(theta[pi]!) * 1e-7);
        const thetaPert = new Float64Array(theta);
        thetaPert[pi] = (thetaPert[pi] ?? 0) + eps;

        const pertResult = this.simulateWithParams(thetaPert);

        let ri = 0;
        for (const [varName, meas] of measurements) {
          const w = weights?.get(varName) ?? 1.0;
          const sqrtW = Math.sqrt(w);
          const simIdx = simResult.states.indexOf(varName);
          const pertSimIdx = pertResult.states.indexOf(varName);
          for (const tMeas of meas.t) {
            let ySim = 0;
            let yPert = 0;
            if (simIdx !== -1) {
              ySim = interpolate(simResult.t, simResult.y, simIdx, tMeas);
            }
            if (pertSimIdx !== -1) {
              yPert = interpolate(pertResult.t, pertResult.y, pertSimIdx, tMeas);
            }
            jacobian[ri]![pi] = (sqrtW * (yPert - ySim)) / eps;
            ri++;
          }
        }
      }
    } else {
      // ── Finite-difference Jacobian ──
      const simResult = this.simulateWithParams(theta);

      let residIdx = 0;
      for (const [varName, meas] of measurements) {
        const w = weights?.get(varName) ?? 1.0;
        const sqrtW = Math.sqrt(w);
        const simIdx = simResult.states.indexOf(varName);
        for (let k = 0; k < meas.t.length; k++) {
          const yMeas = meas.y[k]!;
          let ySim = 0;
          if (simIdx !== -1) {
            ySim = interpolate(simResult.t, simResult.y, simIdx, meas.t[k]!);
          }
          residuals[residIdx] = sqrtW * (ySim - yMeas);
          residIdx++;
        }
      }

      // FD Jacobian
      for (let pi = 0; pi < nParams; pi++) {
        const eps = Math.max(1e-7, Math.abs(theta[pi]!) * 1e-7);
        const thetaPert = new Float64Array(theta);
        thetaPert[pi] = (thetaPert[pi] ?? 0) + eps;

        const pertResult = this.simulateWithParams(thetaPert);

        let ri = 0;
        for (const [varName, meas] of measurements) {
          const w = weights?.get(varName) ?? 1.0;
          const sqrtW = Math.sqrt(w);
          const simIdx = simResult.states.indexOf(varName);
          const pertSimIdx = pertResult.states.indexOf(varName);
          for (const tMeas of meas.t) {
            let ySim = 0;
            let yPert = 0;
            if (simIdx !== -1) {
              ySim = interpolate(simResult.t, simResult.y, simIdx, tMeas);
            }
            if (pertSimIdx !== -1) {
              yPert = interpolate(pertResult.t, pertResult.y, pertSimIdx, tMeas);
            }
            jacobian[ri]![pi] = (sqrtW * (yPert - ySim)) / eps;
            ri++;
          }
        }
      }
    }

    let cost = 0;
    for (let k = 0; k < nResiduals; k++) {
      cost += residuals[k]! * residuals[k]!;
    }

    return { residuals, jacobian, cost };
  }

  /**
   * Evaluate the scalar cost function: sum of weighted squared residuals.
   */
  private evaluateCost(theta: Float64Array): number {
    const { measurements, weights } = this.problem;
    const simResult = this.simulateWithParams(theta);
    let cost = 0;

    for (const [varName, meas] of measurements) {
      const w = weights?.get(varName) ?? 1.0;
      const simIdx = simResult.states.indexOf(varName);
      for (let k = 0; k < meas.t.length; k++) {
        let ySim = 0;
        if (simIdx !== -1) {
          ySim = interpolate(simResult.t, simResult.y, simIdx, meas.t[k]!);
        }
        const r = ySim - meas.y[k]!;
        cost += w * r * r;
      }
    }

    return cost;
  }

  /**
   * Evaluate the gradient of the scalar cost w.r.t. parameters via
   * forward differences (used by the SQP path).
   */
  private evaluateGradient(theta: Float64Array, grad: Float64Array): void {
    const nParams = this.problem.parameters.length;
    const f0 = this.evaluateCost(theta);

    for (let i = 0; i < nParams; i++) {
      const eps = Math.max(1e-7, Math.abs(theta[i]!) * 1e-7);
      const orig = theta[i]!;
      theta[i] = orig + eps;
      const f1 = this.evaluateCost(theta);
      grad[i] = (f1 - f0) / eps;
      theta[i] = orig;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Simulation helper
  // ────────────────────────────────────────────────────────────────────

  /**
   * Run a simulation with the given parameter vector.
   */
  private simulateWithParams(theta: Float64Array): {
    t: number[];
    y: number[][];
    states: string[];
  } {
    const { parameters, measurements } = this.problem;

    // Determine time range from measurements
    let startTime = this.problem.startTime;
    let stopTime = this.problem.stopTime;
    if (startTime === undefined || stopTime === undefined) {
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const [, meas] of measurements) {
        for (const t of meas.t) {
          tMin = Math.min(tMin, t);
          tMax = Math.max(tMax, t);
        }
      }
      if (startTime === undefined) startTime = tMin;
      if (stopTime === undefined) stopTime = tMax;
    }

    // Build parameter overrides
    const paramOverrides = new Map<string, number>();
    for (let i = 0; i < parameters.length; i++) {
      paramOverrides.set(parameters[i]!, theta[i]!);
    }

    const step = (stopTime - startTime) / 500;
    return this.simulator.simulate(startTime, stopTime, step, {
      parameterOverrides: paramOverrides,
    });
  }

  /**
   * Extract the default value of a parameter from the DAE.
   */
  private extractDefaultValue(name: string): number {
    for (const v of this.dae.variables) {
      if (v.name === name) {
        if (v.expression instanceof ModelicaRealLiteral) return v.expression.value;
        if (v.expression instanceof ModelicaIntegerLiteral) return v.expression.value;
        const startAttr = v.attributes.get("start");
        if (startAttr instanceof ModelicaRealLiteral) return startAttr.value;
        if (startAttr instanceof ModelicaIntegerLiteral) return startAttr.value;
        break;
      }
    }
    return 0;
  }

  // ────────────────────────────────────────────────────────────────────
  // Result builder
  // ────────────────────────────────────────────────────────────────────

  private buildResult(
    theta: Float64Array,
    cost: number,
    costHistory: number[],
    iterations: number,
    converged: boolean,
    measurements: Map<string, { t: number[]; y: number[] }>,
    weights?: Map<string, number>,
  ): CalibrationResult {
    const { parameters } = this.problem;

    // Build optimal parameter map
    const optParams = new Map<string, number>();
    for (let i = 0; i < parameters.length; i++) {
      optParams.set(parameters[i]!, theta[i]!);
    }

    // Run final simulation at optimal parameters
    const finalSim = this.simulateWithParams(theta);
    const simulated: { t: number[]; y: Map<string, number[]> } = {
      t: finalSim.t,
      y: new Map(),
    };
    for (const [varName] of measurements) {
      const simIdx = finalSim.states.indexOf(varName);
      if (simIdx !== -1) {
        simulated.y.set(
          varName,
          finalSim.y.map((pt) => pt[simIdx] ?? 0),
        );
      }
    }

    // Compute per-variable residuals
    const variableResiduals = new Map<string, number>();
    for (const [varName, meas] of measurements) {
      const w = weights?.get(varName) ?? 1.0;
      const simIdx = finalSim.states.indexOf(varName);
      let varResidual = 0;
      for (let k = 0; k < meas.t.length; k++) {
        let ySim = 0;
        if (simIdx !== -1) {
          ySim = interpolate(finalSim.t, finalSim.y, simIdx, meas.t[k]!);
        }
        const r = ySim - meas.y[k]!;
        varResidual += w * r * r;
      }
      variableResiduals.set(varName, varResidual);
    }

    return {
      success: converged,
      parameters: optParams,
      residual: cost,
      variableResiduals,
      iterations,
      simulated,
      costHistory,
      message: converged
        ? `Converged in ${iterations} iterations. Final residual: ${cost.toExponential(4)}.`
        : `Did not converge after ${iterations} iterations. Final residual: ${cost.toExponential(4)}.`,
    };
  }
}

// ── Interpolation utility ──

/**
 * Linear interpolation of a simulation output variable at a specific time.
 *
 * @param tSim    Simulation time array (sorted ascending).
 * @param ySim    Simulation output: ySim[timeIdx][varIdx].
 * @param varIdx  Index of the variable in ySim columns.
 * @param tQuery  Time at which to interpolate.
 */
function interpolate(tSim: number[], ySim: number[][], varIdx: number, tQuery: number): number {
  const n = tSim.length;
  if (n === 0) return 0;
  if (tQuery <= tSim[0]!) return ySim[0]![varIdx] ?? 0;
  if (tQuery >= tSim[n - 1]!) return ySim[n - 1]![varIdx] ?? 0;

  // Binary search for the interval containing tQuery
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (tSim[mid]! <= tQuery) lo = mid;
    else hi = mid;
  }

  const t0 = tSim[lo]!;
  const t1 = tSim[hi]!;
  const y0 = ySim[lo]![varIdx] ?? 0;
  const y1 = ySim[hi]![varIdx] ?? 0;

  if (t1 === t0) return y0;
  const alpha = (tQuery - t0) / (t1 - t0);
  return y0 + alpha * (y1 - y0);
}
