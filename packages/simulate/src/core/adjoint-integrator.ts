// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-Native Continuous Adjoint Sensitivity & Trajectory Integrator.
 *
 * Implements reverse-mode automatic differentiation through dynamical
 * differential-algebraic simulation trajectories (Neural ODEs / adjoint sensitivity).
 *
 * Given a dynamical system:
 *   dx/dt = f(t, x, p),  x(0) = x_0(p)
 *
 * And a scalar objective functional:
 *   L = Phi(x(T), p) + integral_0^T L_stage(t, x(t), p) dt
 *
 * The adjoint state lambda(t) satisfies the backward differential equation:
 *   d lambda/dt = - [df/dx]^T lambda(t) - [dL_stage/dx]^T
 *   lambda(T)   = [dPhi/dx(T)]^T
 *
 * And the total parameter gradient is:
 *   dL/dp = [dPhi/dp]^T + lambda(0)^T [dx_0/dp] + integral_0^T ( lambda(t)^T [df/dp] + [dL_stage/dp]^T ) dt
 */

import type { DAEBuilder } from "@modelscript/runtime";
import type { ArenaSimulationResult } from "./simulate-arena.js";
import { ArenaSimulator, initializeArenaEnvironment } from "./simulate-arena.js";

export interface StageLossEvaluation {
  loss: number;
  /** Gradient w.r.t state vector x at time t: dL_stage/dx_i */
  gradState: Map<string, number>;
  /** Optional direct gradient w.r.t parameters p: dL_stage/dp_j */
  gradParam?: Map<string, number>;
}

export interface TerminalLossEvaluation {
  loss: number;
  /** Gradient w.r.t terminal state x(T): dPhi/dx_i */
  gradState: Map<string, number>;
  /** Optional direct gradient w.r.t parameters p: dPhi/dp_j */
  gradParam?: Map<string, number>;
}

export interface ArenaAdjointOptions {
  /** Start time (default: 0). */
  startTime?: number;
  /** Stop time (default: 1). */
  stopTime?: number;
  /** Output communication step size. */
  step?: number;
  /** Number of output intervals. */
  numberOfIntervals?: number;
  /** Parameter overrides applied before simulation. */
  parameterOverrides?: Map<string, number>;
  /** Parameter names to compute sensitivities for. */
  parametersToDifferentiate: string[];
  /** Terminal cost Phi(x(T), p). */
  terminalLoss?: (states: Map<string, number>, params: Map<string, number>) => TerminalLossEvaluation;
  /** Running stage cost L_stage(t, x(t), p). */
  stageLoss?: (t: number, states: Map<string, number>, params: Map<string, number>) => StageLossEvaluation;
  /**
   * Convenience: target trajectory for tracking/parameter identification.
   * Uses quadratic loss: 0.5 * sum_k ||x(t_k) - x^*_k||^2.
   */
  targetTrajectory?: {
    states: string[];
    y: number[][];
  };
  /** Cooperative cancellation signal. */
  signal?: AbortSignal;
}

export interface ArenaAdjointResult {
  /** Evaluated total loss L. */
  loss: number;
  /** Exact gradients w.r.t differentiated parameters: dL/dp. */
  gradients: Map<string, number>;
  /** Forward simulation trajectory result. */
  trajectory: ArenaSimulationResult;
  /** Adjoint states over time (lambda_i(t)). */
  adjointTrajectory?: {
    t: number[];
    lambda: Map<string, number[]>;
  };
}

/**
 * Trajectory Checkpoint recorded during the forward pass.
 */
interface Checkpoint {
  t: number;
  stateValues: Map<string, number>;
}

export class ArenaAdjointIntegrator {
  private sim: ArenaSimulator;
  private stateNames: string[] = [];
  private stateNameIds: number[] = [];
  private derivNameIds: number[] = [];

  constructor(public arena: DAEBuilder) {
    this.sim = new ArenaSimulator(arena);
    this.sim.prepare();
  }

  /**
   * Computes the exact objective loss and parameter sensitivities (gradients)
   * using backward continuous adjoint integration.
   */
  public computeGradients(options: ArenaAdjointOptions): ArenaAdjointResult {
    const exp = this.arena.experiment;
    const startTime = options.startTime ?? exp.startTime ?? 0;
    const stopTime = options.stopTime ?? exp.stopTime ?? 1;
    const step =
      options.step ??
      (options.numberOfIntervals
        ? (stopTime - startTime) / options.numberOfIntervals
        : (exp.interval ?? (stopTime - startTime) / 200));

    const paramsToDiff = options.parametersToDifferentiate;

    // Apply parameter overrides
    if (options.parameterOverrides) {
      for (const [name, val] of options.parameterOverrides) {
        this.sim.parameters.set(name, val);
      }
    }

    // ── Phase 1: Forward Simulation with Trajectory Checkpointing ──
    const initRes = initializeArenaEnvironment(this.arena, this.sim, {
      startTime,
      parameterOverrides: this.sim.parameters,
    });

    this.stateNames = initRes.stateNames;
    this.stateNameIds = initRes.stateStringIds;
    this.derivNameIds = initRes.derivStringIds;
    const nStates = this.stateNames.length;

    const valuesByStringId = new Float64Array(initRes.valuesByStringId);
    const timeId = this.arena.interner.intern("time");

    const checkpoints: Checkpoint[] = [];
    const tValues: number[] = [];
    const yValues: number[][] = [];

    const steps = Math.max(Math.round((stopTime - startTime) / step), 1);
    let currentTime = startTime;

    // Initial checkpoint
    const initialMap = new Map<string, number>();
    for (let i = 0; i < nStates; i++) {
      initialMap.set(this.stateNames[i]!, valuesByStringId[this.stateNameIds[i]!] ?? 0);
    }
    checkpoints.push({ t: currentTime, stateValues: new Map(initialMap) });
    tValues.push(currentTime);
    yValues.push(Array.from(this.stateNames.map((s) => initialMap.get(s) ?? 0)));

    // Forward integration (RK4) while logging checkpoints
    for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
      if (options.signal?.aborted) {
        throw new Error("Adjoint integration aborted during forward pass.");
      }

      const h = Math.min(step, stopTime - currentTime);
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocksAndDerivs(valuesByStringId);

      this.sim.rk4Step(h, valuesByStringId, this.stateNameIds, this.derivNameIds, timeId, currentTime);

      currentTime += h;
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocksAndDerivs(valuesByStringId);

      const stepMap = new Map<string, number>();
      for (let i = 0; i < nStates; i++) {
        const nextY = valuesByStringId[this.stateNameIds[i]!] ?? 0;
        stepMap.set(this.stateNames[i]!, nextY);
      }

      checkpoints.push({ t: currentTime, stateValues: stepMap });
      tValues.push(currentTime);
      yValues.push(Array.from(this.stateNames.map((s) => stepMap.get(s) ?? 0)));
    }

    const forwardTrajectory: ArenaSimulationResult = {
      t: tValues,
      y: yValues,
      states: this.stateNames,
    };

    // ── Phase 2: Compute Loss and Initialize Terminal Adjoint State ──
    const N = checkpoints.length - 1;
    const finalCp = checkpoints[N]!;
    const currentParams = new Map(this.sim.parameters);

    let totalLoss = 0;
    const lambda = new Map<string, number>();
    for (const name of this.stateNames) lambda.set(name, 0);

    const gradParams = new Map<string, number>();
    for (const p of paramsToDiff) gradParams.set(p, 0);

    // Terminal cost Phi(x(T), p)
    if (options.terminalLoss) {
      const termEval = options.terminalLoss(finalCp.stateValues, currentParams);
      totalLoss += termEval.loss;
      for (const [sName, g] of termEval.gradState) {
        lambda.set(sName, (lambda.get(sName) ?? 0) + g);
      }
      if (termEval.gradParam) {
        for (const [pName, g] of termEval.gradParam) {
          if (gradParams.has(pName)) {
            gradParams.set(pName, (gradParams.get(pName) ?? 0) + g);
          }
        }
      }
    }

    // Trajectory tracking MSE cost (convenience)
    if (options.targetTrajectory) {
      const target = options.targetTrajectory;
      for (let k = 0; k <= N; k++) {
        const cp = checkpoints[k]!;
        for (let sIdx = 0; sIdx < target.states.length; sIdx++) {
          const sName = target.states[sIdx]!;
          const actualVal = cp.stateValues.get(sName) ?? 0;
          const targetVal = target.y[sIdx]?.[k] ?? target.y[k]?.[sIdx] ?? 0;
          const diff = actualVal - targetVal;
          totalLoss += 0.5 * diff * diff;

          // If terminal step, add to lambda(T)
          if (k === N) {
            lambda.set(sName, (lambda.get(sName) ?? 0) + diff);
          }
        }
      }
    }

    // ── Phase 3: Backward Adjoint State Integration ──
    const seedVars = [...this.stateNames, ...paramsToDiff];
    const adjointTrajectoryMap = new Map<string, number[]>();
    for (const name of this.stateNames) adjointTrajectoryMap.set(name, [lambda.get(name) ?? 0]);

    for (let k = N - 1; k >= 0; k--) {
      if (options.signal?.aborted) {
        throw new Error("Adjoint integration aborted during backward pass.");
      }

      const cpNext = checkpoints[k + 1]!;
      const cpCurr = checkpoints[k]!;
      const dt = cpNext.t - cpCurr.t;

      // Evaluate Jacobians at cpNext
      const jacNext = this.sim.evaluateRHSWithJacobian(cpNext.t, cpNext.stateValues, undefined, seedVars);

      // Evaluate Jacobians at cpCurr
      const jacCurr = this.sim.evaluateRHSWithJacobian(cpCurr.t, cpCurr.stateValues, undefined, seedVars);

      // Stage loss contribution at cpNext and cpCurr
      let stageGradXNext = new Map<string, number>();
      let stageGradPNext = new Map<string, number>();
      let stageGradXCurr = new Map<string, number>();
      let stageGradPCurr = new Map<string, number>();

      if (options.stageLoss) {
        const evalNext = options.stageLoss(cpNext.t, cpNext.stateValues, currentParams);
        const evalCurr = options.stageLoss(cpCurr.t, cpCurr.stateValues, currentParams);
        totalLoss += 0.5 * (evalNext.loss + evalCurr.loss) * dt;
        stageGradXNext = evalNext.gradState;
        stageGradPNext = evalNext.gradParam ?? new Map();
        stageGradXCurr = evalCurr.gradState;
        stageGradPCurr = evalCurr.gradParam ?? new Map();
      }

      // If target trajectory tracking is active, add stage derivative (dt * diff) for k < N
      if (options.targetTrajectory) {
        const target = options.targetTrajectory;
        for (let sIdx = 0; sIdx < target.states.length; sIdx++) {
          const sName = target.states[sIdx]!;
          const actualValNext = cpNext.stateValues.get(sName) ?? 0;
          const targetValNext = target.y[sIdx]?.[k + 1] ?? target.y[k + 1]?.[sIdx] ?? 0;
          const diffNext = actualValNext - targetValNext;
          stageGradXNext.set(sName, (stageGradXNext.get(sName) ?? 0) + diffNext);

          const actualValCurr = cpCurr.stateValues.get(sName) ?? 0;
          const targetValCurr = target.y[sIdx]?.[k] ?? target.y[k]?.[sIdx] ?? 0;
          const diffCurr = actualValCurr - targetValCurr;
          stageGradXCurr.set(sName, (stageGradXCurr.get(sName) ?? 0) + diffCurr);
        }
      }

      // Adjoint vector at t_{k+1}
      const lambdaNext = new Map(lambda);

      // Heun (RK2) backward step for lambda:
      // d lambda / dt = - J_x^T lambda - grad_x L
      // k1 = - J_x(t_{k+1})^T lambda_{k+1} - grad_x L(t_{k+1})
      const k1 = new Map<string, number>();
      for (const xName of this.stateNames) {
        let vjpX = 0;
        for (const [fName, fJac] of jacNext.J) {
          const lambda_f = lambdaNext.get(fName) ?? 0;
          const df_dx = fJac.get(xName) ?? 0;
          vjpX += lambda_f * df_dx;
        }
        const gX = stageGradXNext.get(xName) ?? 0;
        k1.set(xName, -vjpX - gX);
      }

      // Predictor lambda at t_k
      const lambdaPred = new Map<string, number>();
      for (const xName of this.stateNames) {
        lambdaPred.set(xName, (lambdaNext.get(xName) ?? 0) - dt * (k1.get(xName) ?? 0));
      }

      // k2 = - J_x(t_k)^T lambdaPred - grad_x L(t_k)
      const k2 = new Map<string, number>();
      for (const xName of this.stateNames) {
        let vjpX = 0;
        for (const [fName, fJac] of jacCurr.J) {
          const lambda_f = lambdaPred.get(fName) ?? 0;
          const df_dx = fJac.get(xName) ?? 0;
          vjpX += lambda_f * df_dx;
        }
        const gX = stageGradXCurr.get(xName) ?? 0;
        k2.set(xName, -vjpX - gX);
      }

      // Corrector: lambda_k = lambda_{k+1} - (dt/2) * (k1 + k2)
      for (const xName of this.stateNames) {
        const nextVal = lambdaNext.get(xName) ?? 0;
        const slope = 0.5 * ((k1.get(xName) ?? 0) + (k2.get(xName) ?? 0));
        // Moving backward in time: lambda(t - dt) = lambda(t) - (- slope * dt)
        const updated = nextVal - slope * dt;
        lambda.set(xName, updated);
        adjointTrajectoryMap.get(xName)?.push(updated);
      }

      // ── Parameter Sensitivity Accumulation (Trapezoidal Rule) ──
      // Integral over [t_k, t_{k+1}] of (lambda^T J_p + dL_stage/dp) dt
      for (const pName of paramsToDiff) {
        let vjpPNext = 0;
        for (const [fName, fJac] of jacNext.J) {
          const lambda_f = lambdaNext.get(fName) ?? 0;
          const df_dp = fJac.get(pName) ?? 0;
          vjpPNext += lambda_f * df_dp;
        }
        const contribNext = vjpPNext + (stageGradPNext.get(pName) ?? 0);

        let vjpPCurr = 0;
        for (const [fName, fJac] of jacCurr.J) {
          const lambda_f = lambda.get(fName) ?? 0;
          const df_dp = fJac.get(pName) ?? 0;
          vjpPCurr += lambda_f * df_dp;
        }
        const contribCurr = vjpPCurr + (stageGradPCurr.get(pName) ?? 0);

        const deltaP = 0.5 * (contribNext + contribCurr) * dt;
        gradParams.set(pName, (gradParams.get(pName) ?? 0) + deltaP);
      }
    }

    // Reverse trajectory arrays to chronological order
    for (const arr of adjointTrajectoryMap.values()) arr.reverse();

    return {
      loss: totalLoss,
      gradients: gradParams,
      trajectory: forwardTrajectory,
      adjointTrajectory: {
        t: tValues,
        lambda: adjointTrajectoryMap,
      },
    };
  }

  private evaluateBlocksAndDerivs(valuesByStringId: Float64Array): void {
    this.sim.evaluateBlocks(valuesByStringId);
    this.sim.evaluateDerivativeEquations(valuesByStringId);
  }
}

/**
 * High-level API to compute exact parameter sensitivities and gradients
 * through a Modelica/DAE simulation trajectory.
 *
 * @param arena    The compiled DAEBuilder.
 * @param options  Adjoint and loss configuration.
 * @returns        Total loss, parameter gradient map, and simulation trajectory.
 */
export function simulateGrad(arena: DAEBuilder, options: ArenaAdjointOptions): ArenaAdjointResult {
  const integrator = new ArenaAdjointIntegrator(arena);
  return integrator.computeGradients(options);
}
