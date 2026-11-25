// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DAEBuilder,
  EqKind,
  ExprKind,
  Variability,
  evaluateArenaExpression,
  type ArenaExecutionBlock,
} from "@modelscript/runtime";
import { bdf } from "@modelscript/runtime/wasm_bdf.js";
import { dopri5 } from "@modelscript/runtime/wasm_dopri5.js";
import { evaluateArenaRuntime } from "@modelscript/runtime/wasm_evaluator.js";
import { buildAdJacobian } from "@modelscript/runtime/wasm_tape.js";
import { kencarp4 } from "../solvers/imex-kencarp4.js";
import { qssSolve } from "../solvers/qss-solver.js";
import { solveRadauIIA } from "../solvers/radau-iia.js";
import { rodas4p } from "../solvers/rodas4p.js";
import { autoCompositeSolve, rodas5p } from "../solvers/rodas5p.js";
import { solveSPRK } from "../solvers/sprk.js";
import { trbdf2 } from "../solvers/trbdf2.js";
import { tsit5 } from "../solvers/tsit5.js";
import { vern7, vern9 } from "../solvers/verner.js";
import {
  buildArenaEventCallback,
  buildArenaEventFunctions,
  type ArenaHybridEventsHost,
} from "./arena-hybrid-events.js";
import type {
  AdaptiveArenaCpuSolver,
  ArenaSimulateOptions,
  ArenaSimulationResult,
  FmuMapping,
  FrictionStateMapping,
  SafetyViolationRecord,
  VectorStateDescriptor,
} from "./arena-sim-types.js";
import { computeArenaStateJacobianBandwidth, resolveArenaOutputIds } from "./arena-structural-reduction.js";
import type { ArenaAssertion } from "./simulation.js";
import type { OnlineSTLMonitor, STLStepResult } from "./stl_monitor.js";

export interface ArenaAdaptiveSolverHost extends ArenaHybridEventsHost {
  executionBlocks: ArenaExecutionBlock[];
  assertions: ArenaAssertion[];
  fmuMappings: FmuMapping[];
  frictionStateMappings: FrictionStateMapping[];
  safetyViolations: SafetyViolationRecord[];
  intervalIssues: string[];
  canRunWasmSimulationLoop(): boolean;
  runWasmSimulationLoop(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    options?: {
      solver?: string | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
    },
  ): {
    t: number[];
    y: Float64Array[];
    terminatedEarly: boolean;
    safetyViolations: SafetyViolationRecord[];
    intervalIssues: string[];
  };
  buildRhsFunction(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
  ): (t: number, y: number[]) => number[];
  processWhenClauses(valuesByStringId: Float64Array): void;
  checkIntervalSafetyBarriers(valuesByStringId: Float64Array, stateStringIds: number[], currentTime: number): void;
}

// ─────────────────────────────────────────────────────────────────────────
// Preserved Vector ODE Fast Path
// ─────────────────────────────────────────────────────────────────────────

/**
 * Checks whether the arena contains an unconstrained vector ODE system with preserved arrays.
 * If true, populates `vectorStates` and sets up `parameters` so that numerical integration
 * can step the continuous state vectors directly without scalarizing into millions of variables.
 */
export function detectPreservedVectorODE(
  arena: DAEBuilder,
  parameters: Map<string, number>,
  vectorStates: VectorStateDescriptor[],
  preOverrides: Map<string, number> | null,
): boolean {
  if (arena.initialAlgorithmSections && arena.initialAlgorithmSections.length > 0) {
    return false;
  }
  if (arena.eqCount === 0) return false;

  // Resolve parameters first so start expressions can be evaluated
  parameters.clear();
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const name = arena.getVarName(i);
      const val = preOverrides?.get(name) ?? arena.getVarStartValue(i);
      parameters.set(name, val);
    }
  }

  vectorStates.length = 0;
  const assignedVars = new Set<number>();

  for (let i = 0; i < arena.eqCount; i++) {
    const kind = arena.getEqKind(i);
    if (kind === EqKind.InitialSimple || kind === EqKind.InitialFor || kind === EqKind.When || arena.isEqInitial(i)) {
      return false;
    }

    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    const lhsKind = arena.getExprKind(lhs);

    let varName: string | null = null;
    let varLength = 1;

    if (lhsKind === ExprKind.Der) {
      const inner = arena.getExprData1(lhs);
      if (arena.getExprKind(inner) === ExprKind.Name) {
        varName = arena.interner.resolve(arena.getExprData1(inner));
      }
    } else if (lhsKind === ExprKind.ArrayCtor) {
      varLength = arena.getExprData1(lhs);
      const elem = arena.getExprLeft(lhs);
      if (arena.getExprKind(elem) === ExprKind.Der) {
        const derInner = arena.getExprData1(elem);
        const derInnerKind = arena.getExprKind(derInner);
        if (derInnerKind === ExprKind.Subscript) {
          const baseExpr = arena.getExprData1(derInner);
          if (arena.getExprKind(baseExpr) === ExprKind.Name) {
            const nameId = arena.getExprData1(baseExpr);
            varName = arena.interner.resolve(nameId);
          }
        } else if (derInnerKind === ExprKind.Name) {
          varName = arena.interner.resolve(arena.getExprData1(derInner));
        }
      }
    }

    if (!varName) return false;
    // Fast-path `simulateVector` only integrates uncoupled `der(x) = -x` vector ODEs.
    // Any other RHS must fall through to the general arena evaluator.
    if (arena.getExprKind(rhs) !== ExprKind.Negate) return false;
    const negInner = arena.getExprData1(rhs);
    if (arena.getExprKind(negInner) !== ExprKind.Name) return false;
    if (arena.interner.resolve(arena.getExprData1(negInner)) !== varName) return false;

    const varIdx = arena.getVarIdxByName(varName);
    if (varIdx < 0 || assignedVars.has(varIdx)) return false;
    if (arena.getVarVariability(varIdx) !== Variability.Continuous) return false;
    assignedVars.add(varIdx);

    const shape = arena.getVarShape(varIdx);
    let len = 1;
    for (const d of shape) len *= d;
    if (varLength > 1) len = varLength;

    let startVal = arena.getVarStartValue(varIdx) || 1.0;
    const startAttrId = arena.getVarAttrExprId(varIdx, "start");
    if (typeof startAttrId === "number" && startAttrId !== -1) {
      const v = evaluateArenaExpression(arena, startAttrId, parameters);
      if (typeof v === "number" && isFinite(v)) startVal = v;
    }

    vectorStates.push({
      varIdx,
      name: varName,
      shape,
      length: len,
      startVal,
      eqIdx: i,
      rhsExprId: rhs,
    });
  }

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;
    if (!assignedVars.has(i)) return false;
  }

  return true;
}

/**
 * Directly integrates an unconstrained preserved vector ODE without expanding
 * variables or execution blocks in linear memory.
 */
export function runPreservedVectorODE(
  arena: DAEBuilder,
  vectorStates: VectorStateDescriptor[],
  options?: ArenaSimulateOptions,
): ArenaSimulationResult {
  const exp = arena.experiment;
  const startTime = options?.startTime ?? exp.startTime ?? 0;
  const stopTime = options?.stopTime ?? exp.stopTime ?? 10;
  const numIntervals = options?.numberOfIntervals ?? exp.numberOfIntervals;
  const step =
    options?.step ??
    (numIntervals ? (stopTime - startTime) / numIntervals : (exp.interval ?? (stopTime - startTime) / 500));

  const steps = Math.max(Math.round((stopTime - startTime) / step), 1);
  const solver = options?.solver ?? "euler";

  let totalStates = 0;
  for (const s of vectorStates) {
    totalStates += s.length;
  }

  const stateVec = new Float64Array(totalStates);
  let offset = 0;
  for (const s of vectorStates) {
    const len = s.length;
    stateVec.fill(s.startVal, offset, offset + len);
    offset += len;
  }

  if (options?.initialStateOverrides) {
    for (const [name, val] of options.initialStateOverrides) {
      let stateOffset = 0;
      for (const s of vectorStates) {
        if (s.name === name && s.length === 1) {
          stateVec[stateOffset] = val;
        }
        stateOffset += s.length;
      }
    }
  }

  const t_out: number[] = [startTime];
  const y_out: (Float64Array | number[])[] = [totalStates > 10000 ? new Float64Array(stateVec) : Array.from(stateVec)];
  let currentTime = startTime;

  for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
    if (solver === "euler") {
      let stateOffset = 0;
      for (const s of vectorStates) {
        const len = s.length;
        const rhs = s.rhsExprId;
        const rhsKind = arena.getExprKind(rhs);
        if (rhsKind === ExprKind.Negate) {
          const factor = 1 - step;
          for (let i = stateOffset; i < stateOffset + len; i++) {
            stateVec[i]! *= factor;
          }
        } else {
          for (let i = stateOffset; i < stateOffset + len; i++) {
            stateVec[i]! += step * -stateVec[i]!;
          }
        }
        stateOffset += len;
      }
    } else {
      // RK4 or higher-order solver
      let stateOffset = 0;
      for (const s of vectorStates) {
        const len = s.length;
        const rhs = s.rhsExprId;
        const rhsKind = arena.getExprKind(rhs);
        if (rhsKind === ExprKind.Negate) {
          const h = step;
          const factor = 1 - h + (h * h) / 2 - (h * h * h) / 6 + (h * h * h * h) / 24;
          for (let i = stateOffset; i < stateOffset + len; i++) {
            stateVec[i]! *= factor;
          }
        } else {
          const h = step;
          const factor = 1 - h + (h * h) / 2 - (h * h * h) / 6 + (h * h * h * h) / 24;
          for (let i = stateOffset; i < stateOffset + len; i++) {
            stateVec[i]! *= factor;
          }
        }
        stateOffset += len;
      }
    }

    currentTime += step;
    t_out.push(currentTime);
    y_out.push(totalStates > 10000 ? new Float64Array(stateVec) : Array.from(stateVec));
  }

  const outNames: string[] = [];
  if (totalStates <= 1000000) {
    for (const s of vectorStates) {
      if (s.length === 1) {
        outNames.push(s.name);
      } else {
        for (let i = 1; i <= s.length; i++) {
          outNames.push(`${s.name}[${i}]`);
        }
      }
    }
  }

  const yResult = (totalStates > 10000 ? y_out : y_out.map((row) => Array.from(row))) as unknown as number[][];

  return {
    t: t_out,
    y: yResult,
    states: outNames,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Trajectory Alignment
// ─────────────────────────────────────────────────────────────────────────

export function alignTrajectoryToOutputTimes(
  sourceTimes: number[],
  sourceStates: number[][],
  targetTimes: number[],
  numVars: number,
): { times: number[]; states: number[][] } {
  if (sourceTimes.length === 0 || sourceStates.length === 0) {
    return { times: targetTimes, states: targetTimes.map(() => new Array(numVars).fill(0)) };
  }
  if (
    sourceTimes.length === targetTimes.length &&
    sourceTimes.every((t, idx) => Math.abs(t - (targetTimes[idx] ?? 0)) < 1e-14)
  ) {
    return { times: targetTimes, states: sourceStates };
  }
  const aligned: number[][] = new Array(targetTimes.length);
  let j = 0;
  for (let s = 0; s < targetTimes.length; s++) {
    const tTarget = targetTimes[s]!;
    while (j + 1 < sourceTimes.length && (sourceTimes[j + 1] ?? 0) < tTarget) {
      j++;
    }
    if (j + 1 >= sourceTimes.length || Math.abs((sourceTimes[j] ?? 0) - tTarget) < 1e-14) {
      aligned[s] = [
        ...(sourceStates[j] ?? sourceStates[sourceStates.length - 1] ?? new Array<number>(numVars).fill(0)),
      ];
    } else {
      const t0Seg = sourceTimes[j]!;
      const t1Seg = sourceTimes[j + 1]!;
      const alpha = t1Seg > t0Seg ? (tTarget - t0Seg) / (t1Seg - t0Seg) : 0;
      const s0 = sourceStates[j]!;
      const s1 = sourceStates[j + 1]!;
      const row = new Array<number>(numVars);
      for (let i = 0; i < numVars; i++) {
        row[i] = (1 - alpha) * (s0[i] ?? 0) + alpha * (s1[i] ?? 0);
      }
      aligned[s] = row;
    }
  }
  return { times: targetTimes, states: aligned };
}

// ─────────────────────────────────────────────────────────────────────────
// Adaptive & Quantized-State Solvers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs simulation using an adaptive or Quantized-State solver (Dopri5, Tsit5, BDF, Rodas4P,
 * Rodas5P, AutoComposite, TRBDF2, Radau5/9, SPRK, Vern7/9, KenCarp4, QSS1/2/3, LIQSS2, Auto).
 */
export function runArenaAdaptiveSimulation(
  host: ArenaAdaptiveSolverHost,
  solver: AdaptiveArenaCpuSolver,
  steps: number,
  step: number,
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  derivStringIds: number[],
  timeId: number,
  options?: {
    atol?: number | undefined;
    rtol?: number | undefined;
    outputStringIds?: number[] | undefined;
    stlMonitors?: OnlineSTLMonitor[] | undefined;
    earlyTerminateOnViolation?: boolean | undefined;
    intervalBarrierCheck?: boolean | undefined;
    onStepViolation?:
      ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void) | undefined;
  },
) {
  const n = stateStringIds.length;
  const startTime = valuesByStringId[timeId] ?? 0;
  const stopTime = startTime + steps * step;
  const atol = options?.atol ?? 1e-7;
  const rtol = options?.rtol ?? 1e-7;

  // Build output times
  const outputTimes: number[] = [];
  for (let i = 0; i <= steps; i++) {
    outputTimes.push(startTime + i * step);
  }

  // Extract initial state
  const y0: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    y0[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
  }

  const outIds = resolveArenaOutputIds(host.arena, options?.outputStringIds ?? stateStringIds);
  const stateIdToIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const sid = stateStringIds[i];
    if (sid !== undefined && sid >= 0) stateIdToIdx.set(sid, i);
  }
  const needsFullEnvReconstruction =
    Boolean(options?.intervalBarrierCheck) ||
    (outIds !== stateStringIds && outIds.some((oid) => !stateIdToIdx.has(oid)));

  const initEnvSnapshot = new Float64Array(valuesByStringId);
  const initPreEnvSnapshot = new Float64Array(host.preValuesByStringId ?? valuesByStringId);
  const initWhenWasActive = host.whenClauses.map((c) => c.wasActive);
  const initEiPrevValue = host.eventIndicators.map((ei) => ei.prevValue);

  const envSnapshots: { t: number; env: Float64Array; preEnv: Float64Array }[] = needsFullEnvReconstruction
    ? [
        {
          t: startTime,
          env: new Float64Array(initEnvSnapshot),
          preEnv: new Float64Array(initPreEnvSnapshot),
        },
      ]
    : [];

  const resetAdaptiveState = () => {
    valuesByStringId.set(initEnvSnapshot);
    if (host.preValuesByStringId) host.preValuesByStringId.set(initPreEnvSnapshot);
    for (let i = 0; i < host.whenClauses.length; i++) {
      host.whenClauses[i]!.wasActive = initWhenWasActive[i]!;
    }
    for (let i = 0; i < host.eventIndicators.length; i++) {
      host.eventIndicators[i]!.prevValue = initEiPrevValue[i]!;
    }
    host.bumpDiscreteEventEpoch();
    host.sampleNextTimeByIdx.clear();
    if (needsFullEnvReconstruction) {
      envSnapshots.length = 1;
    }
  };

  // Build RHS function
  const rhsFn = host.buildRhsFunction(valuesByStringId, stateStringIds, derivStringIds, timeId);

  // Build event functions, callback, and crossing directions
  const eventFns = buildArenaEventFunctions(host, valuesByStringId, stateStringIds, timeId);
  const eventCb =
    eventFns.length > 0
      ? buildArenaEventCallback(
          host,
          valuesByStringId,
          stateStringIds,
          timeId,
          needsFullEnvReconstruction
            ? (tEv) => {
                envSnapshots.push({
                  t: tEv,
                  env: new Float64Array(valuesByStringId),
                  preEnv: new Float64Array(host.preValuesByStringId ?? valuesByStringId),
                });
              }
            : undefined,
        )
      : undefined;
  const eventDirs = host.eventIndicators.map((ei) => ei.direction);

  let rawResult: { times: number[]; states: number[][]; converged?: boolean; rejectedSteps?: number };

  if (solver === "bdf") {
    // Build analytical Jacobian via reverse-mode AD (if available).
    // This avoids O(n) finite-difference RHS evaluations per Jacobian update.
    const adJacobian = buildAdJacobian(host.arena);
    rawResult = bdf(
      rhsFn,
      startTime,
      y0,
      stopTime,
      outputTimes,
      {
        atol,
        rtol,
        initialStep: step,
        maxStep: Math.abs(stopTime - startTime),
        eventDirections: eventDirs,
        ...(adJacobian ? { jacobian: adJacobian } : {}),
      },
      eventFns.length > 0 ? eventFns : undefined,
      eventCb,
    );
  } else if (solver === "tsit5") {
    // In-WASM fast path if no events or complex features
    if (
      eventFns.length === 0 &&
      (!options?.stlMonitors || options.stlMonitors.length === 0) &&
      !options?.intervalBarrierCheck &&
      host.whenClauses.length === 0 &&
      host.stateMachineRuntimes.length === 0 &&
      host.fmuMappings.length === 0 &&
      host.arena.algorithmSections.length === 0 &&
      host.frictionStateMappings.length === 0 &&
      host.assertions.length === 0 &&
      host.canRunWasmSimulationLoop()
    ) {
      const wasmRes = host.runWasmSimulationLoop(
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        { ...options, solver: "tsit5" },
      );
      return {
        t: wasmRes.t,
        y: wasmRes.y,
        terminatedEarly: wasmRes.terminatedEarly,
        safetyViolations: wasmRes.safetyViolations,
        intervalIssues: wasmRes.intervalIssues,
        stats: {
          steps: steps,
          acceptedSteps: steps,
          rejectedSteps: 0,
          fEvals: steps * 6,
          converged: true,
        },
      };
    }
    rawResult = tsit5(rhsFn, startTime, y0, stopTime, outputTimes, {
      atol,
      rtol,
      initialStep: step,
      maxStep: Math.abs(stopTime - startTime),
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "rodas5p") {
    rawResult = rodas5p(rhsFn, startTime, y0, stopTime, outputTimes, {
      atol,
      rtol,
      initialStep: step,
      maxStep: Math.abs(stopTime - startTime),
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "auto-composite") {
    rawResult = autoCompositeSolve(rhsFn, startTime, y0, stopTime, outputTimes, {
      atol,
      rtol,
      initialStep: step,
      maxStep: Math.abs(stopTime - startTime),
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "rodas4p") {
    rawResult = rodas4p(rhsFn, startTime, y0, stopTime, outputTimes, {
      atol,
      rtol,
      initialStep: step,
      maxStep: Math.abs(stopTime - startTime),
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "trbdf2") {
    rawResult = trbdf2(rhsFn, startTime, y0, stopTime, outputTimes, {
      atol,
      rtol,
      initialStep: step,
      maxStep: Math.abs(stopTime - startTime),
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "radau5" || solver === "radau9") {
    const order = solver === "radau9" ? 9 : 5;
    const adJacobian = buildAdJacobian(host.arena);
    const res = solveRadauIIA(
      {
        f: (_t: number, y: number[]) => rhsFn(_t, y),
        y0: Array.from(y0),
        tSpan: [startTime, stopTime],
        ...(adJacobian ? { jac: adJacobian } : {}),
      },
      {
        order,
        atol,
        rtol,
        initialStepSize: step,
      },
    );
    const aligned = alignTrajectoryToOutputTimes(res.times, res.states, outputTimes, n);
    rawResult = {
      times: aligned.times,
      states: aligned.states,
      converged: res.stats.converged ?? true,
      rejectedSteps: res.stats.rejectedSteps,
    };
  } else if (
    solver === "sprk" ||
    solver === "verlet" ||
    solver === "ruth3" ||
    solver === "forest-ruth4" ||
    solver === "yoshida6" ||
    solver === "yoshida8"
  ) {
    const method = solver === "sprk" ? "forest-ruth4" : solver;
    const res = solveSPRK(
      {
        f: (_t: number, y: number[]) => rhsFn(_t, y),
        y0: Array.from(y0),
        tSpan: [startTime, stopTime],
      },
      {
        method,
        dt: step,
      },
    );
    const aligned = alignTrajectoryToOutputTimes(res.times, res.states, outputTimes, n);
    rawResult = {
      times: aligned.times,
      states: aligned.states,
      converged: res.stats.converged ?? true,
      rejectedSteps: res.stats.rejectedSteps,
    };
  } else if (solver === "vern7" || solver === "vern9") {
    const fn = solver === "vern9" ? vern9 : vern7;
    const res = fn(
      {
        f: (_t: number, y: number[]) => rhsFn(_t, y),
        y0: Array.from(y0),
        tSpan: [startTime, stopTime],
      },
      {
        atol,
        rtol,
        initialStep: step,
      },
    );
    const aligned = alignTrajectoryToOutputTimes(res.times, res.states, outputTimes, n);
    rawResult = {
      times: aligned.times,
      states: aligned.states,
      converged: res.stats.converged ?? true,
      rejectedSteps: res.stats.rejectedSteps,
    };
  } else if (solver === "kencarp4") {
    const res = kencarp4(
      {
        f: (_t: number, y: number[]) => rhsFn(_t, y),
        y0: Array.from(y0),
        tSpan: [startTime, stopTime],
      },
      {
        atol,
        rtol,
        initialStep: step,
      },
    );
    const aligned = alignTrajectoryToOutputTimes(res.times, res.states, outputTimes, n);
    rawResult = {
      times: aligned.times,
      states: aligned.states,
      converged: res.stats.converged ?? true,
      rejectedSteps: res.stats.rejectedSteps,
    };
  } else if (solver === "qss1" || solver === "qss2" || solver === "qss3" || solver === "liqss2") {
    rawResult = qssSolve(rhsFn, startTime, y0, stopTime, outputTimes, {
      method: solver,
      atol: options?.atol,
      rtol: options?.rtol,
      eventFunctions: eventFns.length > 0 ? eventFns : undefined,
      eventCallback: eventCb,
      eventDirections: eventDirs,
    });
  } else if (solver === "auto") {
    // In-WASM fast path if no events or complex features
    if (
      eventFns.length === 0 &&
      (!options?.stlMonitors || options.stlMonitors.length === 0) &&
      !options?.intervalBarrierCheck &&
      host.whenClauses.length === 0 &&
      host.stateMachineRuntimes.length === 0 &&
      host.fmuMappings.length === 0 &&
      host.arena.algorithmSections.length === 0 &&
      host.frictionStateMappings.length === 0 &&
      host.assertions.length === 0 &&
      host.canRunWasmSimulationLoop()
    ) {
      const wasmRes = host.runWasmSimulationLoop(
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        { ...options, solver: "tsit5" },
      );
      return {
        t: wasmRes.t,
        y: wasmRes.y,
        terminatedEarly: wasmRes.terminatedEarly,
        safetyViolations: wasmRes.safetyViolations,
        intervalIssues: wasmRes.intervalIssues,
        stats: {
          steps: steps,
          acceptedSteps: steps,
          rejectedSteps: 0,
          fEvals: steps * 6,
          converged: true,
        },
      };
    }
    const adaptiveMaxStep = eventFns.length > 0 ? step : Math.abs(stopTime - startTime);
    rawResult = dopri5(
      rhsFn,
      startTime,
      y0,
      stopTime,
      outputTimes,
      {
        atol,
        rtol,
        initialStep: step,
        maxStep: adaptiveMaxStep,
      },
      eventFns.length > 0 ? eventFns : undefined,
      eventCb,
      eventDirs,
    );
    const isResultBad = (res: { times: number[]; states: number[][]; converged?: boolean; rejectedSteps?: number }) => {
      if (res.converged === false) return true;
      const lastT = res.times[res.times.length - 1] ?? startTime;
      if (lastT < stopTime - 1e-6) return true;
      const totalSteps = res.times.length;
      if ((res.rejectedSteps ?? 0) > Math.max(100, totalSteps * 0.5)) return true;
      for (const row of res.states) {
        for (const v of row) {
          if (!isFinite(v)) return true;
        }
      }
      return false;
    };
    if (isResultBad(rawResult)) {
      resetAdaptiveState();
      rawResult = rodas4p(rhsFn, startTime, y0, stopTime, outputTimes, {
        atol,
        rtol,
        initialStep: step,
        maxStep: adaptiveMaxStep,
        eventFunctions: eventFns.length > 0 ? eventFns : undefined,
        eventCallback: eventCb,
        eventDirections: eventDirs,
      });
      if (isResultBad(rawResult)) {
        resetAdaptiveState();
        const adJacobian = buildAdJacobian(host.arena);
        rawResult = bdf(
          rhsFn,
          startTime,
          y0,
          stopTime,
          outputTimes,
          { atol, rtol, ...(adJacobian ? { jacobian: adJacobian } : {}) },
          eventFns.length > 0 ? eventFns : undefined,
          eventCb,
        );
      }
    }
  } else {
    // dopri5
    const adaptiveMaxStep = eventFns.length > 0 ? step : Math.abs(stopTime - startTime);
    rawResult = dopri5(
      rhsFn,
      startTime,
      y0,
      stopTime,
      outputTimes,
      {
        atol,
        rtol,
        initialStep: step,
        maxStep: adaptiveMaxStep,
      },
      eventFns.length > 0 ? eventFns : undefined,
      eventCb,
      eventDirs,
    );
  }

  // Convert to Float64Array output format
  const t_out = rawResult.times;
  let y_out: Float64Array[];
  if (!needsFullEnvReconstruction) {
    const numRows = rawResult.states.length;
    y_out = new Array(numRows);
    if (outIds === stateStringIds) {
      for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
        const row = rawResult.states[rowIdx]!;
        const fa = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          fa[i] = row[i] ?? 0;
        }
        y_out[rowIdx] = fa;
      }
    } else {
      const outLen = outIds.length;
      const outStateIndices = new Int32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        outStateIndices[i] = stateIdToIdx.get(outIds[i] ?? -1) ?? -1;
      }
      for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
        const row = rawResult.states[rowIdx]!;
        const fa = new Float64Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const sIdx = outStateIndices[i]!;
          fa[i] = sIdx >= 0 ? (row[sIdx] ?? 0) : 0;
        }
        y_out[rowIdx] = fa;
      }
    }
    // Sync environment once to the final state so post-simulation callers observe exact terminal values
    if (numRows > 0) {
      const lastRow = rawResult.states[numRows - 1]!;
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = lastRow[i] ?? 0;
      }
      valuesByStringId[timeId] = t_out[numRows - 1] ?? stopTime;
      host.evaluateBlocks(valuesByStringId);
      host.evaluateDerivativeEquations(valuesByStringId);
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = lastRow[i] ?? 0;
      }
    }
  } else {
    let snapIdx = 0;
    let loadedSnapIdx = -1;
    y_out = rawResult.states.map((row, rowIdx) => {
      const tSample = t_out[rowIdx] ?? startTime;
      while (snapIdx + 1 < envSnapshots.length && envSnapshots[snapIdx + 1]!.t <= tSample + 1e-8) {
        snapIdx++;
      }
      const activeSnap = envSnapshots[snapIdx];
      if (activeSnap) {
        valuesByStringId.set(activeSnap.env);
        if (host.preValuesByStringId && host.preValuesByStringId.length === activeSnap.preEnv.length) {
          host.preValuesByStringId.set(activeSnap.preEnv);
        }
        if (snapIdx !== loadedSnapIdx) {
          loadedSnapIdx = snapIdx;
          host.bumpDiscreteEventEpoch();
        }
      }

      // First, load the states into the environment
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = row[i] ?? 0;
      }
      // Set current sample time
      valuesByStringId[timeId] = tSample;

      // Re-evaluate algebraic variables for the recorded state
      host.evaluateBlocks(valuesByStringId);
      host.evaluateDerivativeEquations(valuesByStringId);
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = row[i] ?? 0;
      }

      const fa = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        fa[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      return fa;
    });
  }

  host.safetyViolations = [];
  host.intervalIssues = [];
  const stlMonitors = options?.stlMonitors ?? [];
  for (const m of stlMonitors) m.reset();
  let terminatedEarly = false;
  let cutIdx = t_out.length;

  if (stlMonitors.length > 0 || options?.intervalBarrierCheck) {
    for (let k = 0; k < t_out.length; k++) {
      const tCurr = t_out[k]!;
      const yCurr = y_out[k]!;

      if (stlMonitors.length > 0) {
        for (const mon of stlMonitors) {
          const stepRes = mon.step(tCurr, yCurr);
          if (stepRes.isViolated) {
            host.safetyViolations.push({
              t: tCurr,
              monitorName: mon.options.requirementName ?? "STL Safety Barrier",
              robustness: stepRes.robustness,
              details: `Safety barrier breached at t=${tCurr.toFixed(4)}s: rho=${stepRes.robustness.toFixed(4)} < 0`,
            });
            if (options?.onStepViolation) {
              options.onStepViolation(tCurr, yCurr, mon, stepRes);
            }
            if (stepRes.shouldTerminate || options?.earlyTerminateOnViolation) {
              terminatedEarly = true;
              cutIdx = k + 1;
              break;
            }
          }
        }
        if (terminatedEarly) break;
      }

      if (options?.intervalBarrierCheck) {
        for (let i = 0; i < n; i++) {
          valuesByStringId[stateStringIds[i] ?? -1] = rawResult.states[k]?.[i] ?? 0;
        }
        host.checkIntervalSafetyBarriers(valuesByStringId, stateStringIds, tCurr);
        if (host.intervalIssues.length > 0 && options?.earlyTerminateOnViolation) {
          terminatedEarly = true;
          cutIdx = k + 1;
          break;
        }
      }
    }
  }

  const finalT = terminatedEarly ? t_out.slice(0, cutIdx) : t_out;
  const finalY = terminatedEarly ? y_out.slice(0, cutIdx) : y_out;

  return {
    t: finalT,
    y: finalY,
    terminatedEarly,
    safetyViolations: host.safetyViolations,
    intervalIssues: host.intervalIssues,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SUNDIALS CVODE WASM Driver
// ─────────────────────────────────────────────────────────────────────────

/**
 * Executes the simulation using the LLNL SUNDIALS CVODE WebAssembly BDF integrator,
 * handling zero-crossing rootfinding (`CV_ROOT_RETURN`), discrete `when`-clause updates,
 * state machine transitions, and solver reinitialization.
 */
export async function runArenaCvodeWasm(
  host: ArenaAdaptiveSolverHost,
  wasmMod: import("../solvers/sundials-wasm.js").SundialsEmscriptenModule,
  CvodeSolverClass: typeof import("../solvers/sundials-wasm.js").CvodeSolver,
  steps: number,
  step: number,
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  derivStringIds: number[],
  timeId: number,
  options?: {
    signal?: AbortSignal | undefined;
    atol?: number | undefined;
    rtol?: number | undefined;
    outputStringIds?: number[] | undefined;
    linearSolver?: "auto" | "dense" | "band" | "klu" | "spgmr" | undefined;
    mu?: number | undefined;
    ml?: number | undefined;
    nnz?: number | undefined;
  },
): Promise<{ t: number[]; y: number[][] }> {
  host.preValuesByStringId = new Float64Array(valuesByStringId.length);
  host.preValuesByStringId.set(valuesByStringId);
  const t = valuesByStringId[timeId] ?? 0;
  const n = stateStringIds.length;
  const outIds = resolveArenaOutputIds(host.arena, options?.outputStringIds ?? stateStringIds);
  const outN = outIds.length;

  if (n === 0) {
    const resultT = new Float64Array(steps + 1);
    const resultY: Float64Array[] = new Array(steps + 1);
    let currentT = t;
    valuesByStringId[timeId] = currentT;
    host.evaluateBlocks(valuesByStringId);
    host.processWhenClauses(valuesByStringId);
    host.evaluateBlocks(valuesByStringId);
    host.preValuesByStringId.set(valuesByStringId);
    resultT[0] = currentT;
    resultY[0] = new Float64Array(outN);
    for (let i = 0; i < outN; i++) resultY[0][i] = valuesByStringId[outIds[i] as number] ?? 0;

    for (let s = 1; s <= steps; s++) {
      currentT += step;
      valuesByStringId[timeId] = currentT;
      host.evaluateBlocks(valuesByStringId);
      host.processWhenClauses(valuesByStringId);
      host.evaluateBlocks(valuesByStringId);
      host.preValuesByStringId.set(valuesByStringId);
      resultT[s] = currentT;
      resultY[s] = new Float64Array(outN);
      for (let i = 0; i < outN; i++) resultY[s]![i] = valuesByStringId[outIds[i] as number] ?? 0;
    }
    return { t: Array.from(resultT), y: resultY.map((arr) => Array.from(arr)) };
  }

  const y0 = new Array<number>(n);
  for (let i = 0; i < n; i++) y0[i] = valuesByStringId[stateStringIds[i] as number] ?? 0;

  const rhsFn = (t_eval: number, y: Float64Array, ydot: Float64Array) => {
    valuesByStringId[timeId] = t_eval;
    for (let i = 0; i < n; i++) valuesByStringId[stateStringIds[i] as number] = y[i] ?? 0;
    host.evaluateBlocks(valuesByStringId);
    host.evaluateDerivativeEquations(valuesByStringId);
    for (let i = 0; i < n; i++) ydot[i] = valuesByStringId[derivStringIds[i] as number] ?? 0;
    return 0;
  };

  const nEvents = host.eventIndicators.length;
  let eventFn: import("../solvers/sundials-wasm.js").EventFunction | undefined;
  if (nEvents > 0) {
    eventFn = (t_eval: number, y: Float64Array, gout: Float64Array) => {
      valuesByStringId[timeId] = t_eval;
      for (let i = 0; i < n; i++) valuesByStringId[stateStringIds[i] as number] = y[i] ?? 0;
      host.evaluateBlocks(valuesByStringId);
      host.evaluateDerivativeEquations(valuesByStringId);
      for (let i = 0; i < nEvents; i++) {
        const ei = host.eventIndicators[i]!;
        let val = evaluateArenaRuntime(host.arena, ei.exprId, valuesByStringId);
        if (ei.direction === 0) {
          val = val ? 1 : -1;
        }
        gout[i] = val;
      }
      return 0;
    };
  }

  const { mu: structuralMu, ml: structuralMl } = computeArenaStateJacobianBandwidth(
    host.arena,
    host.executionBlocks,
    stateStringIds,
    derivStringIds,
  );
  const isBanded = n > 50 && structuralMu + structuralMl > 0 && structuralMu + structuralMl < Math.floor(n / 3);
  const chosenLinearSolver = options?.linearSolver ?? (isBanded ? "band" : "auto");

  const solver = new CvodeSolverClass(wasmMod, n, t, y0, rhsFn, nEvents, eventFn, {
    atol: options?.atol,
    rtol: options?.rtol,
    linearSolver: chosenLinearSolver,
    mu: options?.mu ?? structuralMu,
    ml: options?.ml ?? structuralMl,
    nnz: options?.nnz,
  });

  let resultT = new Float64Array(steps + 1);
  let resultY: Float64Array[] = new Array(steps + 1);

  resultT[0] = t;
  host.evaluateBlocks(valuesByStringId);
  host.evaluateDerivativeEquations(valuesByStringId);
  const y0_out = new Float64Array(outN);
  for (let i = 0; i < outN; i++) {
    y0_out[i] = valuesByStringId[outIds[i] as number] ?? 0;
  }
  resultY[0] = y0_out;

  let outIdx = 1;
  let currentT = t;
  for (let stepIdx = 1; stepIdx <= steps; stepIdx++) {
    const targetT = t + stepIdx * step;
    let reachedTarget = false;

    let stepCount = 0;
    while (!reachedTarget) {
      if (options?.signal?.aborted) {
        solver.dispose();
        throw new Error("Simulation aborted");
      }

      const stepResult = solver.step(targetT);
      const flag = stepResult.flag;
      currentT = stepResult.t;

      stepCount++;
      if (stepCount > 1000) {
        throw new Error(`Infinite loop detected at targetT=${targetT}, currentT=${currentT}, flag=${flag}`);
      }

      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] as number] = stepResult.y[i] ?? 0;
      }
      valuesByStringId[timeId] = currentT;

      if (flag === 2) {
        // CV_ROOT_RETURN
        host.preValuesByStringId.set(valuesByStringId);
        for (let i = 0; i < nEvents; i++) {
          const ei = host.eventIndicators[i]!;
          const val = evaluateArenaRuntime(host.arena, ei.exprId, valuesByStringId);
          ei.prevValue = val;
        }
        host.processWhenClauses(valuesByStringId);
        host.executeStateMachines(valuesByStringId);
        host.evaluateBlocks(valuesByStringId);
        host.evaluateDerivativeEquations(valuesByStringId);

        const y_new = new Array<number>(n);
        for (let i = 0; i < n; i++) y_new[i] = valuesByStringId[stateStringIds[i] as number] ?? 0;
        solver.reinit(currentT, y_new);
      }

      if (flag < 0) {
        solver.dispose();
        throw new Error(`CVODE solver failed with flag ${flag} at t=${currentT}`);
      }

      if (currentT >= targetT - 1e-12) {
        reachedTarget = true;
      }
    }

    if (outIdx >= resultT.length) {
      const newSize = resultT.length * 2;
      const newT = new Float64Array(newSize);
      newT.set(resultT);
      resultT = newT;

      const newY = new Array(newSize);
      for (let i = 0; i < resultY.length; i++) newY[i] = resultY[i];
      resultY = newY;
    }

    resultT[outIdx] = currentT;

    // We must re-evaluate algebraic variables for the recorded state because
    // the solver may have last evaluated the RHS at an intermediate or extrapolated time!
    host.evaluateBlocks(valuesByStringId);
    host.evaluateDerivativeEquations(valuesByStringId);

    const step_y = new Float64Array(outN);
    for (let i = 0; i < outN; i++) {
      step_y[i] = valuesByStringId[outIds[i] as number] ?? 0;
    }
    resultY[outIdx] = step_y;
    outIdx++;
  }

  solver.dispose();

  return {
    t: Array.from(resultT.subarray(0, outIdx)),
    y: resultY.slice(0, outIdx).map((arr) => Array.from(arr)),
  };
}
