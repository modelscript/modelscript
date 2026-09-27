// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semi-Explicit Index-1 DAE Continuous Adjoint Sensitivity Solver.
 *
 * Computes exact gradients through DAE simulation trajectories using
 * continuous Hermite checkpoint reconstruction and backward adjoint integration.
 *
 * Supports:
 *   - Continuous trajectory checkpointing via DenseHermiteCheckpointTape.
 *   - Differential state (x) and algebraic variable (y) loss dependencies.
 *   - Automatic backward pull-back through algebraic BLT blocks.
 *   - Arbitrary parameter differentiation sets.
 */

import type { DAEBuilder } from "@modelscript/runtime";
import { Dual, evaluateArenaDualExpression } from "@modelscript/runtime";
import { DenseHermiteCheckpointTape } from "./dense-checkpoint-tape.js";
import type { ArenaSimulationResult } from "./simulate-arena.js";
import { ArenaSimulator, initializeArenaEnvironment } from "./simulate-arena.js";

export interface DaeStageLossEvaluation {
  loss: number;
  /** Gradient w.r.t differential states x: dL_stage/dx_i */
  gradState?: Map<string, number>;
  /** Gradient w.r.t algebraic variables y: dL_stage/dy_j */
  gradAlgebraic?: Map<string, number>;
  /** Direct gradient w.r.t parameters p: dL_stage/dp_k */
  gradParam?: Map<string, number>;
}

export interface DaeTerminalLossEvaluation {
  loss: number;
  /** Gradient w.r.t terminal differential states x(T): dPhi/dx_i */
  gradState?: Map<string, number>;
  /** Gradient w.r.t terminal algebraic variables y(T): dPhi/dy_j */
  gradAlgebraic?: Map<string, number>;
  /** Direct gradient w.r.t parameters p: dPhi/dp_k */
  gradParam?: Map<string, number>;
}

export type DaeAdjointProblem = DaeAdjointSolverOptions;

export interface DaeAdjointSolverOptions {
  /** Simulation start time (default: from experiment annotation or 0). */
  startTime?: number;
  /** Simulation stop time (default: from experiment annotation or 1). */
  stopTime?: number;
  /** Output communication step size. */
  step?: number;
  /** Number of output intervals. */
  numberOfIntervals?: number;
  /** Parameter overrides applied before simulation. */
  parameterOverrides?: Map<string, number>;
  /** Initial state overrides (name → value) applied at startTime. */
  initialStateOverrides?: Map<string, number>;
  /** Parameter names to compute sensitivities for. */
  parametersToDifferentiate: string[];
  /** Terminal cost Phi(x(T), y(T), p). */
  terminalLoss?: (
    states: Map<string, number>,
    algebraic: Map<string, number>,
    params: Map<string, number>,
  ) => DaeTerminalLossEvaluation;
  /** Running stage cost L_stage(t, x(t), y(t), p). */
  stageLoss?: (
    t: number,
    states: Map<string, number>,
    algebraic: Map<string, number>,
    params: Map<string, number>,
  ) => DaeStageLossEvaluation;
  /** Target trajectory for quadratic tracking loss. Supports both state and algebraic variables. */
  targetTrajectory?: {
    names: string[];
    t?: number[];
    y: number[][];
  };
  /** Pre-existing checkpoint tape if re-using a forward trajectory. */
  checkpointTape?: DenseHermiteCheckpointTape;
  /** Cooperative cancellation signal. */
  signal?: AbortSignal;
}

export interface DaeAdjointSolverResult {
  /** Evaluated total scalar loss L. */
  loss: number;
  /** Exact parameter gradients dL/dp. */
  gradients: Map<string, number>;
  /** Forward simulation result. */
  trajectory: ArenaSimulationResult;
  /** Continuous Hermite checkpoint tape. */
  tape: DenseHermiteCheckpointTape;
  /** Adjoint states over time (lambda_i(t)). */
  adjointTrajectory: {
    t: number[];
    lambda: Map<string, number[]>;
  };
}

export class DaeAdjointSolver {
  private sim: ArenaSimulator;
  private stateNames: string[] = [];
  private stateNameIds: number[] = [];
  private derivNameIds: number[] = [];
  private algebraicNames: string[] = [];
  private algNameIds: number[] = [];

  constructor(public arena: DAEBuilder) {
    this.sim = new ArenaSimulator(arena);
    this.sim.prepare();
    this.discoverVariables();
  }

  private discoverVariables(): void {
    const stateVarSet = new Set(this.sim.stateVars);
    const algNames: string[] = [];
    const algIds: number[] = [];

    // All variables in execution blocks that are not states, derivatives, or parameters
    for (const block of this.sim.executionBlocks) {
      if (block.type === "single") {
        if (!stateVarSet.has(block.varIdx)) {
          const name = this.arena.getVarName(block.varIdx);
          if (!name.startsWith("der(") && !this.sim.parameters.has(name)) {
            algNames.push(name);
            algIds.push(this.arena.getVarNameId(block.varIdx));
          }
        }
      } else if (block.type === "system") {
        for (const vIdx of block.vars) {
          if (!stateVarSet.has(vIdx)) {
            const name = this.arena.getVarName(vIdx);
            if (!name.startsWith("der(") && !this.sim.parameters.has(name)) {
              algNames.push(name);
              algIds.push(this.arena.getVarNameId(vIdx));
            }
          }
        }
      }
    }

    this.algebraicNames = Array.from(new Set(algNames));
    this.algNameIds = this.algebraicNames.map((n) => this.arena.interner.intern(n));
  }

  /**
   * Computes the exact objective loss and parameter sensitivities (gradients)
   * using continuous Hermite checkpoint reconstruction and backward DAE adjoint integration.
   */
  public solve(options: DaeAdjointSolverOptions): DaeAdjointSolverResult {
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

    // ── Phase 1: Forward Simulation & Dense Hermite Checkpoint Recording ──
    const initRes = initializeArenaEnvironment(this.arena, this.sim, {
      startTime,
      parameterOverrides: this.sim.parameters,
      initialStateOverrides: options.initialStateOverrides,
    });

    this.stateNames = initRes.stateNames;
    this.stateNameIds = initRes.stateStringIds;
    this.derivNameIds = initRes.derivStringIds;
    const nStates = this.stateNames.length;
    const nAlg = this.algebraicNames.length;

    const valuesByStringId = new Float64Array(initRes.valuesByStringId);
    const timeId = this.arena.interner.intern("time");

    const tape = options.checkpointTape ?? new DenseHermiteCheckpointTape(this.stateNames, this.algebraicNames);

    const tValues: number[] = [];
    const yValues: number[][] = [];

    const steps = Math.max(Math.round((stopTime - startTime) / step), 1);
    let currentTime = startTime;

    valuesByStringId[timeId] = currentTime;
    this.sim.evaluateBlocks(valuesByStringId);
    this.sim.evaluateDerivativeEquations(valuesByStringId);

    // Initial state and derivative vectors
    let currX = new Float64Array(nStates);
    let currDx = new Float64Array(nStates);
    let currY = new Float64Array(nAlg);

    for (let i = 0; i < nStates; i++) {
      currX[i] = valuesByStringId[this.stateNameIds[i]!] ?? 0;
      currDx[i] = valuesByStringId[this.derivNameIds[i]!] ?? 0;
    }
    for (let i = 0; i < nAlg; i++) {
      currY[i] = valuesByStringId[this.algNameIds[i]!] ?? 0;
    }

    if (options.checkpointTape && options.checkpointTape.length > 0) {
      for (const seg of tape.getSegments()) {
        if (tValues.length === 0) {
          tValues.push(seg.t0);
          yValues.push(Array.from(seg.x0));
        }
        tValues.push(seg.t1);
        yValues.push(Array.from(seg.x1));
      }
    } else {
      tValues.push(currentTime);
      yValues.push(Array.from(currX));

      // Forward integration loop
      for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
        if (options.signal?.aborted) {
          throw new Error("DAE Adjoint integration aborted during forward pass.");
        }

        const h = Math.min(step, stopTime - currentTime);
        const tNext = currentTime + h;

        const prevX = new Float64Array(currX);
        const prevDx = new Float64Array(currDx);
        const prevY = new Float64Array(currY);

        // Perform RK4 forward step
        this.sim.rk4Step(h, valuesByStringId, this.stateNameIds, this.derivNameIds, timeId, currentTime);

        currentTime = tNext;
        valuesByStringId[timeId] = currentTime;
        this.sim.evaluateBlocks(valuesByStringId);
        this.sim.evaluateDerivativeEquations(valuesByStringId);

        currX = new Float64Array(nStates);
        currDx = new Float64Array(nStates);
        currY = new Float64Array(nAlg);

        for (let i = 0; i < nStates; i++) {
          currX[i] = valuesByStringId[this.stateNameIds[i]!] ?? 0;
          currDx[i] = valuesByStringId[this.derivNameIds[i]!] ?? 0;
        }
        for (let i = 0; i < nAlg; i++) {
          currY[i] = valuesByStringId[this.algNameIds[i]!] ?? 0;
        }

        tape.pushSegment(currentTime - h, currentTime, prevX, currX, prevDx, currDx, prevY, currY);

        tValues.push(currentTime);
        yValues.push(Array.from(currX));
      }
    }

    const forwardTrajectory: ArenaSimulationResult = {
      t: tValues,
      y: yValues,
      states: this.stateNames,
    };

    // ── Phase 2: Terminal Loss & Terminal Adjoint State Initialization ──
    const currentParams = new Map(this.sim.parameters);
    const finalStateMap = tape.getStateMap(stopTime);
    const finalAlgMap = tape.getAlgebraicMap(stopTime);

    let totalLoss = 0;
    const lambda = new Map<string, number>();
    for (const name of this.stateNames) lambda.set(name, 0);

    const gradParams = new Map<string, number>();
    for (const p of paramsToDiff) gradParams.set(p, 0);

    // Terminal cost Phi(x(T), y(T), p)
    if (options.terminalLoss) {
      const termEval = options.terminalLoss(finalStateMap, finalAlgMap, currentParams);
      totalLoss += termEval.loss;

      if (termEval.gradState) {
        for (const [sName, g] of termEval.gradState) {
          lambda.set(sName, (lambda.get(sName) ?? 0) + g);
        }
      }

      // If terminal loss depends on algebraic variables y, propagate: dPhi/dx += (dPhi/dy) * (dy/dx)
      if (termEval.gradAlgebraic && termEval.gradAlgebraic.size > 0) {
        const seedVars = [...this.stateNames, ...paramsToDiff];
        const algSens = this.evaluateVariableSensitivities(
          stopTime,
          finalStateMap,
          Array.from(termEval.gradAlgebraic.keys()),
          seedVars,
        );

        for (const [algName, dPhi_dy] of termEval.gradAlgebraic) {
          const sensMap = algSens.get(algName);
          if (sensMap) {
            for (const sName of this.stateNames) {
              const dy_dx = sensMap.get(sName) ?? 0;
              lambda.set(sName, (lambda.get(sName) ?? 0) + dPhi_dy * dy_dx);
            }
            for (const pName of paramsToDiff) {
              const dy_dp = sensMap.get(pName) ?? 0;
              gradParams.set(pName, (gradParams.get(pName) ?? 0) + dPhi_dy * dy_dp);
            }
          }
        }
      }

      if (termEval.gradParam) {
        for (const [pName, g] of termEval.gradParam) {
          if (gradParams.has(pName)) {
            gradParams.set(pName, (gradParams.get(pName) ?? 0) + g);
          }
        }
      }
    }

    // Trajectory tracking MSE cost
    if (options.targetTrajectory) {
      const target = options.targetTrajectory;
      const targetTimes = target.t ?? tValues;
      const nTargetSteps = targetTimes.length;

      for (let k = 0; k < nTargetSteps; k++) {
        const tK = targetTimes[k]!;
        const sMap = tape.getStateMap(tK);
        const aMap = tape.getAlgebraicMap(tK);

        for (let nameIdx = 0; nameIdx < target.names.length; nameIdx++) {
          const varName = target.names[nameIdx]!;
          const actualVal = sMap.get(varName) ?? aMap.get(varName) ?? 0;
          const targetVal = target.y[nameIdx]?.[k] ?? target.y[k]?.[nameIdx] ?? 0;
          const diff = actualVal - targetVal;
          totalLoss += 0.5 * diff * diff;

          // If at terminal time, add to lambda(T)
          if (k === nTargetSteps - 1 && Math.abs(tK - stopTime) < 1e-8) {
            if (this.stateNames.includes(varName)) {
              lambda.set(varName, (lambda.get(varName) ?? 0) + diff);
            }
          }
        }
      }
    }

    // ── Phase 3: Continuous Backward Adjoint Integration via Hermite Tape ──
    const seedVars = [...this.stateNames, ...paramsToDiff];
    const adjointTrajectoryMap = new Map<string, number[]>();
    for (const name of this.stateNames) {
      adjointTrajectoryMap.set(name, [lambda.get(name) ?? 0]);
    }

    const nSegments = tape.length;

    for (let k = nSegments - 1; k >= 0; k--) {
      if (options.signal?.aborted) {
        throw new Error("DAE Adjoint integration aborted during backward pass.");
      }

      const tNext = tValues[k + 1]!;
      const tCurr = tValues[k]!;
      const dt = tNext - tCurr;

      const stateNext = tape.getStateMap(tNext);
      const stateCurr = tape.getStateMap(tCurr);
      const algNext = tape.getAlgebraicMap(tNext);
      const algCurr = tape.getAlgebraicMap(tCurr);

      // Evaluate system Jacobians at tNext and tCurr
      const jacNext = this.sim.evaluateRHSWithJacobian(tNext, stateNext, undefined, seedVars);
      const jacCurr = this.sim.evaluateRHSWithJacobian(tCurr, stateCurr, undefined, seedVars);

      // Evaluate stage loss gradients at tNext and tCurr
      let stageGradXNext = new Map<string, number>();
      let stageGradPNext = new Map<string, number>();
      let stageGradXCurr = new Map<string, number>();
      let stageGradPCurr = new Map<string, number>();

      if (options.stageLoss) {
        const evalNext = options.stageLoss(tNext, stateNext, algNext, currentParams);
        const evalCurr = options.stageLoss(tCurr, stateCurr, algCurr, currentParams);
        totalLoss += 0.5 * (evalNext.loss + evalCurr.loss) * dt;

        stageGradXNext = evalNext.gradState ?? new Map();
        stageGradPNext = evalNext.gradParam ?? new Map();
        stageGradXCurr = evalCurr.gradState ?? new Map();
        stageGradPCurr = evalCurr.gradParam ?? new Map();

        // Propagate algebraic stage gradients
        if (evalNext.gradAlgebraic && evalNext.gradAlgebraic.size > 0) {
          const algSensNext = this.evaluateVariableSensitivities(
            tNext,
            stateNext,
            Array.from(evalNext.gradAlgebraic.keys()),
            seedVars,
          );
          for (const [algName, dL_dy] of evalNext.gradAlgebraic) {
            const sens = algSensNext.get(algName);
            if (sens) {
              for (const sName of this.stateNames) {
                stageGradXNext.set(sName, (stageGradXNext.get(sName) ?? 0) + dL_dy * (sens.get(sName) ?? 0));
              }
              for (const pName of paramsToDiff) {
                stageGradPNext.set(pName, (stageGradPNext.get(pName) ?? 0) + dL_dy * (sens.get(pName) ?? 0));
              }
            }
          }
        }

        if (evalCurr.gradAlgebraic && evalCurr.gradAlgebraic.size > 0) {
          const algSensCurr = this.evaluateVariableSensitivities(
            tCurr,
            stateCurr,
            Array.from(evalCurr.gradAlgebraic.keys()),
            seedVars,
          );
          for (const [algName, dL_dy] of evalCurr.gradAlgebraic) {
            const sens = algSensCurr.get(algName);
            if (sens) {
              for (const sName of this.stateNames) {
                stageGradXCurr.set(sName, (stageGradXCurr.get(sName) ?? 0) + dL_dy * (sens.get(sName) ?? 0));
              }
              for (const pName of paramsToDiff) {
                stageGradPCurr.set(pName, (stageGradPCurr.get(pName) ?? 0) + dL_dy * (sens.get(pName) ?? 0));
              }
            }
          }
        }
      }

      // Trajectory tracking stage loss contribution
      if (options.targetTrajectory) {
        const target = options.targetTrajectory;
        const targetTimes = target.t ?? tValues;
        for (let nameIdx = 0; nameIdx < target.names.length; nameIdx++) {
          const varName = target.names[nameIdx]!;
          if (this.stateNames.includes(varName)) {
            const series =
              Array.isArray(target.y[nameIdx]) && (target.y[nameIdx] as number[]).length === targetTimes.length
                ? (target.y[nameIdx] as number[])
                : target.y.map((row) => row[nameIdx] ?? 0);

            const actualValNext = stateNext.get(varName) ?? 0;
            const targetValNext = target.t
              ? interpolateSeries(targetTimes, series, tNext)
              : (target.y[nameIdx]?.[k + 1] ?? target.y[k + 1]?.[nameIdx] ?? 0);
            const diffNext = actualValNext - targetValNext;
            stageGradXNext.set(varName, (stageGradXNext.get(varName) ?? 0) + diffNext);

            const actualValCurr = stateCurr.get(varName) ?? 0;
            const targetValCurr = target.t
              ? interpolateSeries(targetTimes, series, tCurr)
              : (target.y[nameIdx]?.[k] ?? target.y[k]?.[nameIdx] ?? 0);
            const diffCurr = actualValCurr - targetValCurr;
            stageGradXCurr.set(varName, (stageGradXCurr.get(varName) ?? 0) + diffCurr);
          }
        }
      }

      const lambdaNext = new Map(lambda);

      // Heun (RK2) backward step for lambda:
      // k1 = - J_x(tNext)^T lambdaNext - grad_x L(tNext)
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

      // Predictor lambda at tCurr
      const lambdaPred = new Map<string, number>();
      for (const xName of this.stateNames) {
        lambdaPred.set(xName, (lambdaNext.get(xName) ?? 0) - dt * (k1.get(xName) ?? 0));
      }

      // k2 = - J_x(tCurr)^T lambdaPred - grad_x L(tCurr)
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

      // Corrector: lambda(tCurr) = lambda(tNext) + (dt/2) * (k1 + k2) (moving backward in time)
      for (const xName of this.stateNames) {
        const nextVal = lambdaNext.get(xName) ?? 0;
        const slope = 0.5 * ((k1.get(xName) ?? 0) + (k2.get(xName) ?? 0));
        const updated = nextVal - slope * dt;
        lambda.set(xName, updated);
        adjointTrajectoryMap.get(xName)?.push(updated);
      }

      // Accumulate parameter sensitivity integral over [tCurr, tNext]
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

    // Chronological ordering of adjoint trajectories
    for (const arr of adjointTrajectoryMap.values()) arr.reverse();

    return {
      loss: totalLoss,
      gradients: gradParams,
      trajectory: forwardTrajectory,
      tape,
      adjointTrajectory: {
        t: tValues,
        lambda: adjointTrajectoryMap,
      },
    };
  }

  /**
   * Computes sensitivities dy/dv for observed algebraic variables y w.r.t seed variables v.
   */
  private evaluateVariableSensitivities(
    time: number,
    stateValues: Map<string, number>,
    targetVars: string[],
    seedVars: string[],
  ): Map<string, Map<string, number>> {
    const envSize = Math.max(this.arena.interner.size + 256, 4096);
    const valuesByStringId = new Float64Array(envSize);

    for (const [name, val] of this.sim.parameters) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    for (const [name, val] of stateValues) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    const timeId = this.arena.interner.intern("time");
    valuesByStringId[timeId] = time;

    this.sim.evaluateBlocks(valuesByStringId);

    const result = new Map<string, Map<string, number>>();
    for (const tVar of targetVars) {
      result.set(tVar, new Map());
    }

    for (const seedVar of seedVars) {
      const dualEnv = new Array<Dual>(envSize);
      for (let sid = 0; sid < envSize; sid++) {
        dualEnv[sid] = Dual.constant(valuesByStringId[sid] ?? 0);
      }

      const seedNameId = this.arena.interner.intern(seedVar);
      if (seedNameId < envSize) {
        dualEnv[seedNameId] = new Dual(valuesByStringId[seedNameId] ?? 0, 1.0);
      }

      // Propagate dual numbers through execution blocks
      for (const block of this.sim.executionBlocks) {
        if (block.type === "single") {
          const val = evaluateArenaDualExpression(this.arena, block.exprId, dualEnv);
          if (val !== null) {
            const varNameId = this.arena.getVarNameId(block.varIdx);
            dualEnv[varNameId] = val;
          }
        }
      }

      for (const tVar of targetVars) {
        const tId = this.arena.interner.intern(tVar);
        const dualVal = dualEnv[tId];
        result.get(tVar)!.set(seedVar, dualVal ? dualVal.dot : 0);
      }
    }

    return result;
  }
}

/**
 * Convenient entry point for solving DAE continuous adjoint sensitivities.
 */
export function solveDaeAdjoint(arena: DAEBuilder, options: DaeAdjointSolverOptions): DaeAdjointSolverResult {
  const solver = new DaeAdjointSolver(arena);
  return solver.solve(options);
}

function interpolateSeries(times: number[], values: number[], t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]!) return values[0] ?? 0;
  if (t >= times[n - 1]!) return values[n - 1] ?? 0;

  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }

  const t0 = times[lo]!;
  const t1 = times[hi]!;
  const v0 = values[lo] ?? 0;
  const v1 = values[hi] ?? 0;
  if (t1 === t0) return v0;
  return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
}
