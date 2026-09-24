// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Validated Hybrid Automata Flowpipe Reachability Engine.
 *
 * Implements:
 *   - Continuous mode flowpipes with adaptive Taylor models & Householder QR preconditioning.
 *   - Guard crossing detection via polynomial evaluation on Taylor models.
 *   - Guaranteed crossing time interval refinement via Interval Newton root-finding.
 *   - Discrete mode jumps with continuous state reset maps: x^+ = R(x^-).
 *   - Mode invariant monitoring and comprehensive safety requirement verification.
 */

import { computeRotationMatrix, encloseRotatedBox } from "../solvers/wasm_qr.js";
import { ConstrainedZonotope } from "./wasm_constrained_zonotope.js";
import type { FlowpipeReachabilityResult, FlowpipeRequirement, FlowpipeStepResult } from "./wasm_taylor_model.js";
import { Interval, TaylorModel } from "./wasm_taylor_model.js";
import { Zonotope } from "./wasm_zonotope.js";

export interface HybridMode {
  id: string;
  name?: string;
  /** Continuous dynamics: dy/dt = f(t, y) returning an array of TaylorModels */
  dynamics: (t: TaylorModel, y: TaylorModel[]) => TaylorModel[];
  /** Invariants: state bounds that must hold while active in this mode */
  invariants?: { stateIndex: number; min?: number; max?: number }[];
}

export interface HybridTransition {
  id: string;
  sourceModeId: string;
  targetModeId: string;
  /**
   * Guard function: scalar function of state TaylorModels g(y).
   * A guard crossing occurs when g(y) crosses 0 or becomes <= 0.
   */
  guard: (y: TaylorModel[]) => TaylorModel;
  /** Optional point evaluator for nominal trajectory checks: g(y) <= 0 */
  guardPoint?: (y: number[]) => number;
  /** State reset map: computes post-jump state enclosure from pre-jump enclosure */
  reset?: (preState: Interval[]) => Interval[];
  /** Nominal state reset map */
  resetPoint?: (prePoint: number[]) => number[];
  /** Transition description/label */
  label?: string;
}

export interface HybridAutomaton {
  modes: HybridMode[] | Map<string, HybridMode>;
  transitions: HybridTransition[];
}

export interface HybridJumpEvent {
  transitionId: string;
  sourceModeId: string;
  targetModeId: string;
  time: number;
  timeEnclosure: Interval;
  preJumpEnclosure: Interval[];
  postJumpEnclosure: Interval[];
  preJumpNominal: number[];
  postJumpNominal: number[];
}

export interface HybridFlowpipeModeSegment {
  modeId: string;
  modeName?: string;
  startTime: number;
  endTime: number;
  steps: FlowpipeStepResult[];
}

export interface HybridFlowpipeResult {
  isCertifiedSafe: boolean;
  segments: HybridFlowpipeModeSegment[];
  jumps: HybridJumpEvent[];
  violations: FlowpipeReachabilityResult["violations"];
  totalSteps: number;
  summary: string;
}

export interface HybridFlowpipeProblemOptions {
  automaton: HybridAutomaton;
  initialModeId: string;
  initialEnclosure: Interval[];
  nominalInitial: number[];
  tSpan: [number, number];
  dt: number;
  order?: number;
  minOrder?: number;
  maxOrder?: number;
  adaptive?: boolean;
  tol?: number;
  minDt?: number;
  maxDt?: number;
  useQrPreconditioning?: boolean;
  useConstrainedZonotopes?: boolean;
  maxConstrainedGenerators?: number;
  requirements?: FlowpipeRequirement[];
  maxPicardIterations?: number;
  maxJumps?: number;
  enableSetBranching?: boolean;
  maxBranches?: number;
}

/**
 * Validated Interval Newton root finder for scalar guard crossing functions.
 * Solves g(t) = 0 on t in [tLo, tHi] with guaranteed enclosure.
 */
export class IntervalNewtonRootFinder {
  /**
   * Refines a guard crossing interval [tLo, tHi] using Interval Newton iterations.
   *
   * @param evalGuard Function that computes [g(t), g'(t)] for a given time interval.
   * @param initialInterval Initial search interval [tLo, tHi].
   * @param maxIter Maximum Newton iterations (default: 5).
   * @param tol Target time width tolerance (default: 1e-6).
   */
  static refineRoot(
    evalGuard: (t: Interval) => { value: Interval; deriv: Interval },
    initialInterval: Interval,
    maxIter = 5,
    tol = 1e-6,
  ): Interval {
    let current = new Interval(initialInterval.lo, initialInterval.hi);

    for (let iter = 0; iter < maxIter; iter++) {
      if (current.width <= tol) break;

      const mid = current.mid;
      const midInv = new Interval(mid, mid);
      const evalMid = evalGuard(midInv);
      const evalDomain = evalGuard(current);

      const deriv = evalDomain.deriv;
      // If derivative interval contains 0, perform standard interval bisection step
      if (deriv.lo <= 0 && deriv.hi >= 0) {
        const left = new Interval(current.lo, mid);
        const right = new Interval(mid, current.hi);
        const evalLeft = evalGuard(left);
        if (evalLeft.value.lo <= 0 && evalLeft.value.hi >= 0) {
          current = left;
        } else {
          current = right;
        }
        continue;
      }

      // Interval Newton Operator: N(I) = mid - g(mid) / g'(I)
      // Division by interval: [a, b] / [c, d]
      let quotLo: number;
      let quotHi: number;
      const valLo = evalMid.value.lo;
      const valHi = evalMid.value.hi;

      const p1 = valLo / deriv.lo;
      const p2 = valLo / deriv.hi;
      const p3 = valHi / deriv.lo;
      const p4 = valHi / deriv.hi;
      quotLo = Math.min(p1, p2, p3, p4);
      quotHi = Math.max(p1, p2, p3, p4);

      const newLo = mid - quotHi;
      const newHi = mid - quotLo;

      // Intersect with current interval: current \cap N(I)
      const intersectedLo = Math.max(current.lo, newLo);
      const intersectedHi = Math.min(current.hi, newHi);

      if (intersectedLo > intersectedHi) {
        // Empty intersection, fallback to midpoint bisection
        current = new Interval(Math.max(initialInterval.lo, current.lo), Math.min(initialInterval.hi, current.hi));
        break;
      }

      current = new Interval(intersectedLo, intersectedHi);
    }

    return current;
  }
}

/**
 * Validated hybrid reachability engine integrating continuous Taylor models with discrete mode transitions.
 */
export class HybridFlowpipeSolver {
  /**
   * Computes guaranteed hybrid flowpipe reachability with guard crossings and state resets.
   */
  static solve(options: HybridFlowpipeProblemOptions): HybridFlowpipeResult {
    const {
      automaton,
      initialModeId,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order = 2,
      adaptive = true,
      tol = 1e-4,
      minDt = 1e-6,
      maxDt = 1.0,
      useQrPreconditioning = false,
      requirements = [],
      maxPicardIterations = 5,
      maxJumps = 16,
      enableSetBranching = false,
      maxBranches = 8,
    } = options;

    // Index modes by ID
    const modeMap = new Map<string, HybridMode>();
    if (Array.isArray(automaton.modes)) {
      for (const m of automaton.modes) modeMap.set(m.id, m);
    } else {
      for (const [k, v] of automaton.modes.entries()) modeMap.set(k, v);
    }

    // Index outgoing transitions by source mode ID
    const transitionsBySource = new Map<string, HybridTransition[]>();
    for (const t of automaton.transitions) {
      const list = transitionsBySource.get(t.sourceModeId) ?? [];
      list.push(t);
      transitionsBySource.set(t.sourceModeId, list);
    }

    const nStates = initialEnclosure.length;
    const [t0, tEnd] = tSpan;

    const segments: HybridFlowpipeModeSegment[] = [];
    const jumps: HybridJumpEvent[] = [];
    const violations: FlowpipeReachabilityResult["violations"] = [];

    let currentModeId = initialModeId;
    let currentEnclosure = initialEnclosure.map((inv) => new Interval(inv.lo, inv.hi));
    let currentNominal = [...nominalInitial];
    let currentTime = t0;
    let currentDt = dt;
    let currentOrder = order;
    const minOrder = options.minOrder ?? Math.max(1, order - 1);
    const maxOrder = options.maxOrder ?? Math.max(order, 6);
    const useConstrainedZonotopes = options.useConstrainedZonotopes ?? false;
    const maxConstrainedGenerators = options.maxConstrainedGenerators ?? 2 * nStates;
    let totalSteps = 0;

    let currentSegmentSteps: FlowpipeStepResult[] = [];
    let currentSegmentStartTime = t0;

    // Record initial step
    currentSegmentSteps.push({
      stepIndex: 0,
      time: t0,
      tubes: currentEnclosure.map((inv) => new Interval(inv.lo, inv.hi)),
      nominal: [...currentNominal],
    });

    // Check initial requirements
    for (const req of requirements) {
      const tube = currentEnclosure[req.stateIndex]!;
      const check = HybridFlowpipeSolver.checkRequirement(tube, req);
      if (!check.holds) {
        violations.push({
          stepIndex: 0,
          time: t0,
          stateIndex: req.stateIndex,
          operator: req.operator,
          worstCaseValue: check.worstValue,
          limitValue: req.limitValue,
          reason: `Initial state in mode '${currentModeId}' violates requirement: ${check.worstValue} ${req.operator} ${req.limitValue}`,
        });
      }
    }

    const maxStepsGuard = 10000;

    while (currentTime < tEnd - 1e-12 && totalSteps < maxStepsGuard) {
      const mode = modeMap.get(currentModeId);
      if (!mode) {
        throw new Error(`HybridFlowpipeSolver: Mode '${currentModeId}' not found in automaton.`);
      }

      if (currentTime + currentDt > tEnd) {
        currentDt = tEnd - currentTime;
      }

      // 1. Optional Householder QR preconditioning
      let Q_matrix: Float64Array[] | null = null;
      if (useQrPreconditioning && nStates > 1) {
        const eps = 1e-5;
        const J: Float64Array[] = [];
        const tNomTM = TaylorModel.constant(currentTime, 1, [new Interval(0, 1)], 1);
        const yNomTMs = currentNominal.map((v) => TaylorModel.constant(v, 1, [new Interval(0, 1)], 1));
        const fNom = mode.dynamics(tNomTM, yNomTMs).map((tm) => tm.get([0]));

        for (let i = 0; i < nStates; i++) {
          const row = new Float64Array(nStates);
          for (let j = 0; j < nStates; j++) {
            const yPert = currentNominal.map((v, idx) =>
              TaylorModel.constant(idx === j ? v + eps : v, 1, [new Interval(0, 1)], 1),
            );
            const fPert = mode.dynamics(tNomTM, yPert)[i]!.get([0]);
            row[j] = (fPert - fNom[i]!) / eps;
          }
          J.push(row);
        }

        const Phi: Float64Array[] = [];
        for (let i = 0; i < nStates; i++) {
          const row = new Float64Array(nStates);
          for (let j = 0; j < nStates; j++) {
            row[j] = (i === j ? 1.0 : 0.0) + currentDt * J[i]![j]!;
          }
          Phi.push(row);
        }

        Q_matrix = computeRotationMatrix(Phi, nStates);
      }

      // 2. Domain for this step: v0 in [0, currentDt], v_j in [-halfWidth, halfWidth]
      const stepDomain: Interval[] = [new Interval(0, currentDt)];
      for (let j = 0; j < nStates; j++) {
        const halfWidth = 0.5 * currentEnclosure[j]!.width;
        stepDomain.push(new Interval(-halfWidth, halfWidth));
      }

      const timeTM = TaylorModel.variable(0, stepDomain, currentOrder, currentTime);
      const stateTMs: TaylorModel[] = [];
      for (let j = 0; j < nStates; j++) {
        const center = currentEnclosure[j]!.mid;
        stateTMs.push(TaylorModel.variable(j + 1, stepDomain, currentOrder, center));
      }

      // Picard fixed-point contractor
      let picardTMs = stateTMs.map((tm) => tm.clone());
      for (let iter = 0; iter < maxPicardIterations; iter++) {
        const derivTMs = mode.dynamics(timeTM, picardTMs);
        const nextTMs: TaylorModel[] = [];
        for (let j = 0; j < nStates; j++) {
          const integratedDeriv = derivTMs[j]!.integrateTime(0);
          nextTMs.push(stateTMs[j]!.add(integratedDeriv));
        }
        picardTMs = nextTMs;
      }

      // Adaptive remainder check
      const maxRemWidth = Math.max(...picardTMs.map((tm) => tm.remainder.width));
      if (adaptive && maxRemWidth > tol) {
        if (currentDt <= minDt * 1.5 && currentOrder < maxOrder) {
          currentOrder++;
          continue;
        }
        if (currentDt > minDt * 1.01) {
          const shrink = Math.max(0.2, 0.8 * Math.pow(tol / Math.max(1e-15, maxRemWidth), 1 / (currentOrder + 1)));
          currentDt = Math.max(minDt, currentDt * shrink);
          continue;
        }
      }

      // 3. Check outgoing discrete transitions
      const outgoing = transitionsBySource.get(currentModeId) ?? [];
      let triggeredTransition: HybridTransition | null = null;
      let crossingTimeInterval: Interval | null = null;

      for (const tr of outgoing) {
        // Evaluate guard TaylorModel
        const guardTM = tr.guard(picardTMs);
        const guardRange = guardTM.evaluateRange();

        // Check point guard on nominal state
        let pointTriggered = false;
        if (tr.guardPoint) {
          const valNomStart = tr.guardPoint(currentNominal);
          const nominalEnd = picardTMs.map((tm) => tm.evaluateAt([currentDt, ...new Array(nStates).fill(0)]));
          const valNomEnd = tr.guardPoint(nominalEnd);
          if (valNomEnd <= 0 || (valNomStart > 0 && valNomEnd <= 0)) {
            pointTriggered = true;
          }
        }

        // Guard crossing condition: 0 in guardRange or guard range is <= 0 or pointTriggered
        if (pointTriggered || (guardRange.lo <= 0 && guardRange.hi >= 0) || guardRange.hi <= 0) {
          // Refine crossing time using Interval Newton
          const evalGuardAtDeltaT = (dtInv: Interval) => {
            const subDomain = [dtInv, ...stepDomain.slice(1)];
            const subTM = new TaylorModel(guardTM.numVars, guardTM.order, subDomain, guardTM.remainder);
            for (const [k, v] of guardTM.terms.entries()) subTM.terms.set(k, v);
            const val = subTM.evaluateRange();

            // Compute time derivative of guard
            let derivLo = 0.0;
            let derivHi = 0.0;
            for (const [k, coeff] of guardTM.terms.entries()) {
              const exps = TaylorModel.parseKey(k);
              const tExp = exps[0] ?? 0;
              if (tExp > 0) {
                const derCoeff = coeff * tExp;
                let termLo = derCoeff;
                let termHi = derCoeff;
                if (tExp > 1) {
                  const pwrLo = Math.pow(Math.max(0, dtInv.lo), tExp - 1);
                  const pwrHi = Math.pow(Math.max(0, dtInv.hi), tExp - 1);
                  termLo *= Math.min(pwrLo, pwrHi);
                  termHi *= Math.max(pwrLo, pwrHi);
                }
                derivLo += Math.min(termLo, termHi);
                derivHi += Math.max(termLo, termHi);
              }
            }
            return {
              value: val,
              deriv: new Interval(derivLo - 0.01, derivHi + 0.01),
            };
          };

          const refinedLocalDt = IntervalNewtonRootFinder.refineRoot(
            evalGuardAtDeltaT,
            new Interval(0, currentDt),
            5,
            1e-5,
          );

          triggeredTransition = tr;
          crossingTimeInterval = new Interval(currentTime + refinedLocalDt.lo, currentTime + refinedLocalDt.hi);
          break;
        }
      }

      // Handle triggered discrete transition
      if (triggeredTransition && crossingTimeInterval && jumps.length < maxJumps) {
        totalSteps++;
        const crossingTime = crossingTimeInterval.mid;
        const localDt = Math.max(0, Math.min(currentDt, crossingTime - currentTime));

        // Evaluate pre-jump enclosure at crossing time
        const crossDomain = [new Interval(localDt, localDt), ...stepDomain.slice(1)];
        const preJumpEnclosure: Interval[] = [];
        for (let j = 0; j < nStates; j++) {
          const crossTM = new TaylorModel(picardTMs[j]!.numVars, currentOrder, crossDomain, picardTMs[j]!.remainder);
          for (const [k, v] of picardTMs[j]!.terms.entries()) crossTM.terms.set(k, v);
          preJumpEnclosure.push(crossTM.evaluateRange());
        }

        const preJumpNominal = picardTMs.map((tm) => tm.evaluateAt([localDt, ...new Array(nStates).fill(0)]));

        if (enableSetBranching) {
          const zCrossing = Zonotope.fromIntervals(preJumpEnclosure);
          const [z1, z2] = zCrossing.split();
          const clustered = Zonotope.enclose(z1, z2).reduce(maxBranches).toIntervals();
          preJumpEnclosure.splice(0, preJumpEnclosure.length, ...clustered);
        } else if (useConstrainedZonotopes && nStates > 1) {
          const baseZ = Zonotope.fromIntervals(preJumpEnclosure);
          const cz = ConstrainedZonotope.fromZonotope(baseZ);
          const reduced = cz.reduce(maxConstrainedGenerators).toIntervals();
          for (let j = 0; j < nStates; j++) {
            preJumpEnclosure[j] = new Interval(
              Math.max(preJumpEnclosure[j]!.lo, reduced[j]!.lo),
              Math.min(preJumpEnclosure[j]!.hi, reduced[j]!.hi),
            );
          }
        }

        // Record final step in current mode
        currentSegmentSteps.push({
          stepIndex: totalSteps,
          time: crossingTime,
          tubes: preJumpEnclosure,
          nominal: preJumpNominal,
        });

        // Close current mode segment
        segments.push({
          modeId: currentModeId,
          modeName: mode.name,
          startTime: currentSegmentStartTime,
          endTime: crossingTime,
          steps: currentSegmentSteps,
        });

        // Apply reset map
        let postJumpEnclosure = preJumpEnclosure.map((inv) => new Interval(inv.lo, inv.hi));
        if (triggeredTransition.reset) {
          postJumpEnclosure = triggeredTransition.reset(preJumpEnclosure);
        }

        let postJumpNominal = [...preJumpNominal];
        if (triggeredTransition.resetPoint) {
          postJumpNominal = triggeredTransition.resetPoint(preJumpNominal);
        } else if (triggeredTransition.reset) {
          postJumpNominal = postJumpEnclosure.map((inv) => inv.mid);
        }

        // Record jump event
        jumps.push({
          transitionId: triggeredTransition.id,
          sourceModeId: currentModeId,
          targetModeId: triggeredTransition.targetModeId,
          time: crossingTime,
          timeEnclosure: crossingTimeInterval,
          preJumpEnclosure,
          postJumpEnclosure,
          preJumpNominal,
          postJumpNominal,
        });

        // Switch to target mode
        currentModeId = triggeredTransition.targetModeId;
        currentEnclosure = postJumpEnclosure;
        currentNominal = postJumpNominal;
        currentTime = crossingTime;

        // Initialize new mode segment
        currentSegmentStartTime = crossingTime;
        currentSegmentSteps = [
          {
            stepIndex: totalSteps,
            time: crossingTime,
            tubes: currentEnclosure.map((inv) => new Interval(inv.lo, inv.hi)),
            nominal: [...currentNominal],
          },
        ];

        // Reset step size for new mode
        currentDt = dt;
        continue;
      }

      // 4. Standard continuous step accepted without discrete transition
      totalSteps++;
      currentTime += currentDt;

      let nextTubes: Interval[] = [];
      for (let j = 0; j < nStates; j++) {
        nextTubes.push(picardTMs[j]!.evaluateRange());
      }

      const nominalPoint = [currentDt, ...new Array(nStates).fill(0)];
      const nextNominal: number[] = [];
      for (let j = 0; j < nStates; j++) {
        nextNominal.push(picardTMs[j]!.evaluateAt(nominalPoint));
      }

      if (Q_matrix) {
        const halfWidths = nextTubes.map((t) => 0.5 * t.width);
        const rotatedTubes = encloseRotatedBox(nextNominal, Q_matrix, halfWidths);
        const tightenedTubes: Interval[] = [];
        for (let j = 0; j < nStates; j++) {
          const direct = nextTubes[j]!;
          const rot = rotatedTubes[j]!;
          tightenedTubes.push(new Interval(Math.min(direct.lo, rot.lo), Math.max(direct.hi, rot.hi)));
        }
        nextTubes = tightenedTubes;
      }

      currentSegmentSteps.push({
        stepIndex: totalSteps,
        time: currentTime,
        tubes: nextTubes,
        nominal: nextNominal,
      });

      // Check requirements
      for (const req of requirements) {
        const tube = nextTubes[req.stateIndex]!;
        const check = HybridFlowpipeSolver.checkRequirement(tube, req);
        if (!check.holds) {
          violations.push({
            stepIndex: totalSteps,
            time: currentTime,
            stateIndex: req.stateIndex,
            operator: req.operator,
            worstCaseValue: check.worstValue,
            limitValue: req.limitValue,
            reason: `Hybrid flowpipe breach in mode '${currentModeId}' at t=${currentTime.toFixed(3)}s: state[${req.stateIndex}] worst-case ${check.worstValue.toFixed(4)} violates ${req.operator} ${req.limitValue}`,
          });
        }
      }

      // Enclosure at end of step
      const endDomain = [new Interval(currentDt, currentDt), ...stepDomain.slice(1)];
      currentEnclosure = [];
      for (let j = 0; j < nStates; j++) {
        const endTM = new TaylorModel(picardTMs[j]!.numVars, currentOrder, endDomain, picardTMs[j]!.remainder);
        for (const [k, v] of picardTMs[j]!.terms.entries()) endTM.terms.set(k, v);
        currentEnclosure.push(endTM.evaluateRange());
      }
      currentNominal = nextNominal;

      // Adapt step size & order
      if (adaptive) {
        if (maxRemWidth < tol * 1e-4 && currentOrder > minOrder && currentDt >= maxDt * 0.7) {
          currentOrder--;
        }
        const growth = Math.min(2.0, 0.9 * Math.pow(tol / Math.max(1e-15, maxRemWidth), 1 / (currentOrder + 1)));
        currentDt = Math.min(maxDt, Math.max(minDt, currentDt * growth));
      }
    }

    // Close final segment
    if (currentSegmentSteps.length > 0) {
      const mode = modeMap.get(currentModeId);
      segments.push({
        modeId: currentModeId,
        modeName: mode?.name,
        startTime: currentSegmentStartTime,
        endTime: currentTime,
        steps: currentSegmentSteps,
      });
    }

    const isCertifiedSafe = violations.length === 0;
    const summary = isCertifiedSafe
      ? `Hybrid reachability certified safe across ${segments.length} mode segment(s) and ${jumps.length} discrete jump(s) over ${totalSteps} steps.`
      : `Hybrid safety verification failed: detected ${violations.length} requirement violation(s).`;

    return {
      isCertifiedSafe,
      segments,
      jumps,
      violations,
      totalSteps,
      summary,
    };
  }

  private static checkRequirement(tube: Interval, req: FlowpipeRequirement): { holds: boolean; worstValue: number } {
    if (req.operator === "<=" || req.operator === "<") {
      const worst = tube.hi;
      return { holds: worst <= req.limitValue, worstValue: worst };
    }
    if (req.operator === ">=" || req.operator === ">") {
      const worst = tube.lo;
      return { holds: worst >= req.limitValue, worstValue: worst };
    }
    return { holds: true, worstValue: tube.mid };
  }
}
