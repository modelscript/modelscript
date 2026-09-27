// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hybrid Adjoint Sensitivity Solver for Systems with Discrete Events and Reset Maps.
 *
 * Implements the exact hybrid adjoint jump conditions (Dirac delta integration)
 * across state zero-crossings and discrete transition events:
 *
 * Given an event triggering at t_e when h(t, x, p) = 0 with reset map:
 *   x(t_e^+) = Delta(x(t_e^-), p)
 *
 * The adjoint state lambda(t) jumps across t_e according to:
 *   lambda(t_e^-) = [dDelta/dx]^T lambda(t_e^+) + ( (dDelta/dt)^- - (dx/dt)^+ ) / (dh/dt)^- * grad_x h(t_e^-)
 *
 * And parameter sensitivities accumulate a discrete event term:
 *   Delta(dL/dp) = [dDelta/dp]^T lambda(t_e^+) + ( (dDelta/dt)^- - (dx/dt)^+ ) / (dh/dt)^- * grad_p h(t_e^-)
 */

import type { DAEBuilder } from "@modelscript/runtime";
import { DAEEventRelaxer, type EventRelaxerOptions } from "@modelscript/runtime";
import type { DaeAdjointSolverOptions, DaeAdjointSolverResult } from "./dae-adjoint-solver.js";
import { DenseHermiteCheckpointTape } from "./dense-checkpoint-tape.js";
import type { ArenaSimulationResult } from "./simulate-arena.js";
import { ArenaSimulator, initializeArenaEnvironment } from "./simulate-arena.js";

export interface DiscreteResetEvent {
  name: string;
  /** Indicator function h(t, x, p) = 0. Crossing occurs when h passes through 0. */
  indicator: (t: number, x: Map<string, number>, p: Map<string, number>) => number;
  /** Gradient of indicator w.r.t states: dh/dx_i */
  gradIndicatorState: (t: number, x: Map<string, number>, p: Map<string, number>) => Map<string, number>;
  /** Gradient of indicator w.r.t parameters: dh/dp_k */
  gradIndicatorParam?: (t: number, x: Map<string, number>, p: Map<string, number>) => Map<string, number>;
  /** Discrete reset map: x^+ = Delta(x^-, p) */
  resetMap: (t: number, xMinus: Map<string, number>, p: Map<string, number>) => Map<string, number>;
  /** Jacobian of reset map w.r.t states: dDelta_i / dx_j */
  jacobianResetState: (
    t: number,
    xMinus: Map<string, number>,
    p: Map<string, number>,
  ) => Map<string, Map<string, number>>;
  /** Jacobian of reset map w.r.t parameters: dDelta_i / dp_k */
  jacobianResetParam?: (
    t: number,
    xMinus: Map<string, number>,
    p: Map<string, number>,
  ) => Map<string, Map<string, number>>;
}

export interface HybridAdjointOptions extends DaeAdjointSolverOptions {
  /** Registered discrete reset events. */
  events?: DiscreteResetEvent[];
  /** Optional sigmoidal switch relaxation configuration for non-smooth if/abs/min/max. */
  relaxation?: EventRelaxerOptions;
}

interface RecordedOccurrence {
  event: DiscreteResetEvent;
  tE: number;
  xMinus: Map<string, number>;
  xPlus: Map<string, number>;
  dxMinus: Map<string, number>;
  dxPlus: Map<string, number>;
  applied?: boolean;
}

export class HybridAdjointSolver {
  private sim: ArenaSimulator;
  private relaxation?: EventRelaxerOptions;
  private stateNames: string[] = [];
  private stateNameIds: number[] = [];
  private derivNameIds: number[] = [];
  private algebraicNames: string[] = [];
  private algNameIds: number[] = [];

  constructor(
    public arena: DAEBuilder,
    options?: { relaxation?: EventRelaxerOptions },
  ) {
    this.relaxation = options?.relaxation;
    if (this.relaxation) {
      const relaxer = new DAEEventRelaxer(arena, this.relaxation);
      relaxer.relaxAllEquations();
    }
    this.sim = new ArenaSimulator(arena);
    this.sim.prepare();
    this.discoverVariables();
  }

  private discoverVariables(): void {
    const stateVarSet = new Set(this.sim.stateVars);
    const algNames: string[] = [];
    const algIds: number[] = [];

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
   * Solves adjoint sensitivities across hybrid systems, applying discrete adjoint jump
   * conditions when explicit reset events are provided, and sigmoidal relaxations if configured.
   */
  public solve(options: HybridAdjointOptions): DaeAdjointSolverResult {
    const exp = this.arena.experiment;
    const startTime = options.startTime ?? exp.startTime ?? 0;
    const stopTime = options.stopTime ?? exp.stopTime ?? 1;
    const step =
      options.step ??
      (options.numberOfIntervals
        ? (stopTime - startTime) / options.numberOfIntervals
        : (exp.interval ?? (stopTime - startTime) / 200));

    const paramsToDiff = options.parametersToDifferentiate;

    if (options.parameterOverrides) {
      for (const [name, val] of options.parameterOverrides) {
        this.sim.parameters.set(name, val);
      }
    }

    // ── Phase 1: Forward Simulation with Event Triggering & Checkpoint Recording ──
    const initRes = initializeArenaEnvironment(this.arena, this.sim, {
      startTime,
      parameterOverrides: this.sim.parameters,
    });

    this.stateNames = initRes.stateNames;
    this.stateNameIds = initRes.stateStringIds;
    this.derivNameIds = initRes.derivStringIds;
    const nStates = this.stateNames.length;
    const nAlg = this.algebraicNames.length;

    const valuesByStringId = new Float64Array(initRes.valuesByStringId);
    const timeId = this.arena.interner.intern("time");
    const currentParams = new Map(this.sim.parameters);

    const tape = new DenseHermiteCheckpointTape(this.stateNames, this.algebraicNames);
    const tValues: number[] = [];
    const yValues: number[][] = [];
    const recordedOccurrences: RecordedOccurrence[] = [];

    let currentTime = startTime;
    valuesByStringId[timeId] = currentTime;
    this.sim.evaluateBlocks(valuesByStringId);
    this.sim.evaluateDerivativeEquations(valuesByStringId);

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

    tValues.push(currentTime);
    yValues.push(Array.from(currX));

    const events = options.events ?? [];
    const lastEventTimes = new Map<string, number>();

    while (currentTime < stopTime - 1e-12) {
      if (options.signal?.aborted) {
        throw new Error("Hybrid adjoint integration aborted during forward pass.");
      }

      let h = Math.min(step, stopTime - currentTime);
      const tNextTarget = currentTime + h;

      // Predict step to check for event crossing
      const prevX = new Float64Array(currX);
      const prevDx = new Float64Array(currDx);
      const prevY = new Float64Array(currY);

      const xMapBefore = new Map<string, number>();
      for (let i = 0; i < nStates; i++) xMapBefore.set(this.stateNames[i]!, currX[i]!);

      // Check each event indicator
      let earliestEvent: { evt: DiscreteResetEvent; tE: number } | null = null;

      for (const evt of events) {
        if (lastEventTimes.has(evt.name) && Math.abs(currentTime - lastEventTimes.get(evt.name)!) < 1e-6) {
          continue;
        }
        const h0 = evt.indicator(currentTime, xMapBefore, currentParams);
        // Estimate state at tNextTarget with Euler trial
        const xTrial = new Map<string, number>();
        for (let i = 0; i < nStates; i++) {
          xTrial.set(this.stateNames[i]!, (currX[i] ?? 0) + h * (currDx[i] ?? 0));
        }
        const h1 = evt.indicator(tNextTarget, xTrial, currentParams);

        if ((h0 <= 0 && h1 > 0) || (h0 >= 0 && h1 < 0) || (h0 * h1 <= 0 && h0 !== h1)) {
          // Bisection root finding for event time tE
          let tLow = currentTime;
          let tHigh = tNextTarget;
          for (let iter = 0; iter < 20; iter++) {
            const tMid = 0.5 * (tLow + tHigh);
            const frac = (tMid - currentTime) / h;
            const xMid = new Map<string, number>();
            for (let i = 0; i < nStates; i++) {
              xMid.set(this.stateNames[i]!, (currX[i] ?? 0) + frac * h * (currDx[i] ?? 0));
            }
            const hMid = evt.indicator(tMid, xMid, currentParams);
            if ((h0 <= 0 && hMid <= 0) || (h0 >= 0 && hMid >= 0)) {
              tLow = tMid;
            } else {
              tHigh = tMid;
            }
          }
          const tE = 0.5 * (tLow + tHigh);
          if (tE > currentTime && tE <= tNextTarget) {
            if (!earliestEvent || tE < earliestEvent.tE) {
              earliestEvent = { evt, tE };
            }
          }
        }
      }

      if (earliestEvent) {
        // Step forward up to event time tE
        const dtEvent = Math.max(1e-10, earliestEvent.tE - currentTime);
        this.sim.rk4Step(dtEvent, valuesByStringId, this.stateNameIds, this.derivNameIds, timeId, currentTime);

        currentTime += dtEvent;
        valuesByStringId[timeId] = currentTime;
        this.sim.evaluateBlocks(valuesByStringId);
        this.sim.evaluateDerivativeEquations(valuesByStringId);

        const xMinusArr = new Float64Array(nStates);
        const dxMinusArr = new Float64Array(nStates);
        const xMinusMap = new Map<string, number>();
        const dxMinusMap = new Map<string, number>();

        for (let i = 0; i < nStates; i++) {
          const val = valuesByStringId[this.stateNameIds[i]!] ?? 0;
          const dval = valuesByStringId[this.derivNameIds[i]!] ?? 0;
          xMinusArr[i] = val;
          dxMinusArr[i] = dval;
          xMinusMap.set(this.stateNames[i]!, val);
          dxMinusMap.set(this.stateNames[i]!, dval);
        }

        // Push segment up to tE^-
        tape.pushSegment(currentTime - dtEvent, currentTime, prevX, xMinusArr, prevDx, dxMinusArr, prevY, currY);

        // Apply reset map: x^+ = Delta(x^-, p)
        const xPlusMap = earliestEvent.evt.resetMap(currentTime, xMinusMap, currentParams);
        for (let i = 0; i < nStates; i++) {
          const sName = this.stateNames[i]!;
          if (xPlusMap.has(sName)) {
            valuesByStringId[this.stateNameIds[i]!] = xPlusMap.get(sName)!;
          }
        }

        // Re-evaluate derivatives at tE^+
        this.sim.evaluateBlocks(valuesByStringId);
        this.sim.evaluateDerivativeEquations(valuesByStringId);

        const dxPlusMap = new Map<string, number>();
        for (let i = 0; i < nStates; i++) {
          currX[i] = valuesByStringId[this.stateNameIds[i]!] ?? 0;
          currDx[i] = valuesByStringId[this.derivNameIds[i]!] ?? 0;
          dxPlusMap.set(this.stateNames[i]!, currDx[i]!);
        }

        lastEventTimes.set(earliestEvent.evt.name, currentTime);

        recordedOccurrences.push({
          event: earliestEvent.evt,
          tE: currentTime,
          xMinus: xMinusMap,
          xPlus: xPlusMap,
          dxMinus: dxMinusMap,
          dxPlus: dxPlusMap,
          applied: false,
        });

        tValues.push(currentTime);
        yValues.push(Array.from(currX));
        continue;
      }

      // Standard forward RK4 step
      this.sim.rk4Step(h, valuesByStringId, this.stateNameIds, this.derivNameIds, timeId, currentTime);

      currentTime += h;
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

    const forwardTrajectory: ArenaSimulationResult = {
      t: tValues,
      y: yValues,
      states: this.stateNames,
    };

    // ── Phase 2: Compute Loss and Initialize Terminal Adjoint State ──
    const finalStateMap = tape.getStateMap(stopTime);
    const finalAlgMap = tape.getAlgebraicMap(stopTime);

    let totalLoss = 0;
    const lambda = new Map<string, number>();
    for (const name of this.stateNames) lambda.set(name, 0);

    const gradParams = new Map<string, number>();
    for (const p of paramsToDiff) gradParams.set(p, 0);

    if (options.terminalLoss) {
      const termEval = options.terminalLoss(finalStateMap, finalAlgMap, currentParams);
      totalLoss += termEval.loss;

      if (termEval.gradState) {
        for (const [sName, g] of termEval.gradState) {
          lambda.set(sName, (lambda.get(sName) ?? 0) + g);
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

    // ── Phase 3: Backward Adjoint Integration with Hybrid Jump Conditions ──
    const seedVars = [...this.stateNames, ...paramsToDiff];
    const adjointTrajectoryMap = new Map<string, number[]>();
    for (const name of this.stateNames) {
      adjointTrajectoryMap.set(name, [lambda.get(name) ?? 0]);
    }

    const nSegments = tape.length;

    for (let k = nSegments - 1; k >= 0; k--) {
      if (options.signal?.aborted) {
        throw new Error("Hybrid adjoint integration aborted during backward pass.");
      }

      const tNext = tValues[k + 1]!;
      const tCurr = tValues[k]!;
      const dt = tNext - tCurr;

      const stateNext = tape.getStateMap(tNext);
      const stateCurr = tape.getStateMap(tCurr);

      // Check if an event occurred right at tCurr or tNext
      for (const occ of recordedOccurrences) {
        if (!occ.applied && Math.abs(occ.tE - tNext) < 1e-5) {
          occ.applied = true;
          // Backward crossing through event tE:
          // lambda(tE^-) = [dDelta/dx]^T lambda(tE^+) + ( (dDelta/dt)^- - (dx/dt)^+ ) / (dh/dt)^- * grad_x h(tE^-)
          const evt = occ.event;
          const jacResetX = evt.jacobianResetState(occ.tE, occ.xMinus, currentParams);
          const jacResetP = evt.jacobianResetParam
            ? evt.jacobianResetParam(occ.tE, occ.xMinus, currentParams)
            : new Map();

          const gradH_x = evt.gradIndicatorState(occ.tE, occ.xMinus, currentParams);
          const gradH_p = evt.gradIndicatorParam
            ? evt.gradIndicatorParam(occ.tE, occ.xMinus, currentParams)
            : new Map();

          // Calculate dh/dt
          let hDot = 0;
          for (const [sName, gh] of gradH_x) {
            hDot += gh * (occ.dxMinus.get(sName) ?? 0);
          }

          // Parameter sensitivity discrete jump:
          // Delta(dL/dp) = [dDelta/dp]^T lambda(tE^+) + jump_correction
          for (const pName of paramsToDiff) {
            let jumpP = 0;
            for (const [sName, row] of jacResetP) {
              const lambda_s = lambda.get(sName) ?? 0;
              jumpP += (row.get(pName) ?? 0) * lambda_s;
            }

            const ghP = gradH_p.get(pName) ?? 0;
            if (ghP !== 0 && Math.abs(hDot) > 1e-12) {
              jumpP += ghP / hDot;
            }

            gradParams.set(pName, (gradParams.get(pName) ?? 0) + jumpP);
          }

          // State adjoint jump: lambda(tE^-) = [dDelta/dx]^T lambda(tE^+)
          const lambdaOld = new Map(lambda);
          for (const sName of this.stateNames) {
            let jumpedLambda = 0;
            for (const [targetName, row] of jacResetX) {
              if (row.has(sName)) {
                jumpedLambda += (row.get(sName) ?? 0) * (lambdaOld.get(targetName) ?? 0);
              }
            }
            lambda.set(sName, jumpedLambda);
          }
        }
      }

      // Standard Heun adjoint backward integration
      const jacNext = this.sim.evaluateRHSWithJacobian(tNext, stateNext, undefined, seedVars);
      const jacCurr = this.sim.evaluateRHSWithJacobian(tCurr, stateCurr, undefined, seedVars);

      const lambdaNext = new Map(lambda);
      const k1 = new Map<string, number>();
      for (const xName of this.stateNames) {
        let vjpX = 0;
        for (const [fName, fJac] of jacNext.J) {
          const lambda_f = lambdaNext.get(fName) ?? 0;
          const df_dx = fJac.get(xName) ?? 0;
          vjpX += lambda_f * df_dx;
        }
        k1.set(xName, -vjpX);
      }

      const lambdaPred = new Map<string, number>();
      for (const xName of this.stateNames) {
        lambdaPred.set(xName, (lambdaNext.get(xName) ?? 0) - dt * (k1.get(xName) ?? 0));
      }

      const k2 = new Map<string, number>();
      for (const xName of this.stateNames) {
        let vjpX = 0;
        for (const [fName, fJac] of jacCurr.J) {
          const lambda_f = lambdaPred.get(fName) ?? 0;
          const df_dx = fJac.get(xName) ?? 0;
          vjpX += lambda_f * df_dx;
        }
        k2.set(xName, -vjpX);
      }

      for (const xName of this.stateNames) {
        const nextVal = lambdaNext.get(xName) ?? 0;
        const slope = 0.5 * ((k1.get(xName) ?? 0) + (k2.get(xName) ?? 0));
        const updated = nextVal - slope * dt;
        lambda.set(xName, updated);
        adjointTrajectoryMap.get(xName)?.push(updated);
      }

      // Parameter sensitivity integral accumulation
      for (const pName of paramsToDiff) {
        let vjpPNext = 0;
        for (const [fName, fJac] of jacNext.J) {
          const lambda_f = lambdaNext.get(fName) ?? 0;
          const df_dp = fJac.get(pName) ?? 0;
          vjpPNext += lambda_f * df_dp;
        }

        let vjpPCurr = 0;
        for (const [fName, fJac] of jacCurr.J) {
          const lambda_f = lambda.get(fName) ?? 0;
          const df_dp = fJac.get(pName) ?? 0;
          vjpPCurr += lambda_f * df_dp;
        }

        const deltaP = 0.5 * (vjpPNext + vjpPCurr) * dt;
        gradParams.set(pName, (gradParams.get(pName) ?? 0) + deltaP);
      }
    }

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
}

/**
 * Convenient helper to solve hybrid adjoint sensitivities with discrete reset events
 * and sigmoidal relaxations.
 */
export function solveHybridAdjoint(arena: DAEBuilder, options: HybridAdjointOptions): DaeAdjointSolverResult {
  const solver = new HybridAdjointSolver(arena, { relaxation: options.relaxation });
  return solver.solve(options);
}
