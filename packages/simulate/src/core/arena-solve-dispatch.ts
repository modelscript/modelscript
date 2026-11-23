// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Unified Arena-Native Problem Dispatch (`solveArena`).
 *
 * Inspects `dae.problemFlags` on a WebAssembly `DAEBuilder` arena and automatically
 * dispatches to the appropriate WASM/numerical solver across all supported problem classes:
 *   - Optimization / NLP (`PROBLEM_OPTIMIZATION`)
 *   - Stochastic Differential Equations (`PROBLEM_SDE`)
 *   - Boundary Value Problems (`PROBLEM_BVP`)
 *   - Jump Processes / Gillespie SSA (`PROBLEM_JUMP`)
 *   - Delay Differential Equations (`PROBLEM_DDE`)
 *   - ODE / DAE + STL Robustness Verification (`PROBLEM_ODE`, `PROBLEM_DAE`, `PROBLEM_REACHABILITY`)
 */

import {
  type DAEBuilder,
  EqKind,
  ExprKind,
  PROBLEM_BVP,
  PROBLEM_DDE,
  PROBLEM_JUMP,
  PROBLEM_OPTIMIZATION,
  PROBLEM_REACHABILITY,
  PROBLEM_SDE,
  Variability,
} from "@modelscript/runtime";
import { solveBVP } from "../solvers/bvp-solver.js";
import { ddeSteps } from "../solvers/dde-solver.js";
import { ArenaSimulator } from "./simulate-arena.js";

export interface ArenaSolveOptions {
  /** Time span `[t0, tEnd]` for dynamic problems (defaults to `dae.experiment` or `[0, 1]`). */
  tSpan?: [number, number] | undefined;
  /** Number of steps for SDE/ODE/Tau-Leaping solvers (default: 200). */
  steps?: number | undefined;
  /** SDE method: `"milstein"` (default, uses WASM AD), `"euler-maruyama"`, or `"ensemble"`. */
  sdeMethod?: "milstein" | "euler-maruyama" | "ensemble" | undefined;
  /** Number of Monte Carlo ensemble paths when `sdeMethod === "ensemble"` (default: 64). */
  ensemblePaths?: number | undefined;
  /** Jump SSA method: `"gillespie"` (default) or `"tau-leaping"`. */
  jumpMethod?: "gillespie" | "tau-leaping" | undefined;
  /** PRNG seed for SDE / Jump SSA (default: `dae.stochastic.getConfig().seed || 42`). */
  seed?: number | undefined;
  /** Max SSA jump events (default: 10000). */
  maxEvents?: number | undefined;
  /** Max optimization iterations for arena NLP solver (default: 200). */
  maxIterations?: number | undefined;
  /** Explicit override of problem kind if an arena has multiple problem flags set. */
  forceKind?: "optimization" | "sde" | "bvp" | "dde" | "jump" | "dae" | undefined;
}

export interface ArenaSolveResult {
  kind: "optimization" | "sde" | "bvp" | "dde" | "jump" | "dae";
  times?: number[] | undefined;
  states?: number[][] | undefined;
  /** Ensemble variance trajectories when `sdeMethod === "ensemble"`. */
  variance?: number[][] | undefined;
  stateNames?: string[] | undefined;
  jumpIds?: number[] | undefined;
  /** Optimal decision vector and objective value for optimization problems. */
  optimalValues?: number[] | undefined;
  objectiveValue?: number | undefined;
  maxConstraintViolation?: number | undefined;
  /** Quantitative STL robustness values for attached `dae.uncertainty` STL specs. */
  stlRobustness?: number[] | undefined;
}

/**
 * Extracts explicit `der(x_i) = rhs_i` pairs from a `DAEBuilder` arena.
 */
function extractExplicitStateDrifts(dae: DAEBuilder): { stateVarIds: number[]; driftExprIds: number[] } {
  const stateVarIds: number[] = [];
  const driftExprIds: number[] = [];
  const seen = new Set<number>();
  const eqCount = dae.getEqCount();
  for (let i = 0; i < eqCount; i++) {
    if (dae.isEqRemoved(i)) continue;
    const kind = dae.getEqKind(i);
    if (kind !== EqKind.Simple) continue;
    const lhs = dae.getEqLhs(i);
    const rhs = dae.getEqRhs(i);
    if (dae.getExprKind(lhs) === ExprKind.Der) {
      const inner = dae.getExprData1(lhs);
      let varId = -1;
      if (inner < dae.getExprCount() && dae.getExprKind(inner) === ExprKind.Name) {
        const raw = dae.getExprData1(inner);
        varId = raw < dae.getVarCount() ? raw : dae.lookupVariable(raw);
      } else if (inner < dae.getVarCount()) {
        varId = inner;
      }
      if (varId >= 0 && !seen.has(varId)) {
        seen.add(varId);
        stateVarIds.push(varId);
        driftExprIds.push(rhs);
      }
    }
  }
  return { stateVarIds, driftExprIds };
}

function attachStlRobustness(
  dae: DAEBuilder,
  times: number[],
  states: number[][],
  stateVarIds: number[],
): number[] | undefined {
  if (!dae.hasProblemFlag(PROBLEM_REACHABILITY) || dae.uncertainty.stlCount === 0) return undefined;
  const vc = dae.getVarCount();
  const fullTraj: number[][] = [];
  for (let k = 0; k < times.length; k++) {
    const row = new Array<number>(vc);
    for (let v = 0; v < vc; v++) row[v] = dae.getVarStartValue(v);
    const st = states[k]!;
    for (let s = 0; s < stateVarIds.length; s++) {
      row[stateVarIds[s]!] = st[s]!;
    }
    fullTraj.push(row);
  }
  const n = dae.uncertainty.stlCount;
  // Evaluate root STL node (last added)
  const rob = dae.uncertainty.evalTrajectoryRobustness(n - 1, times, fullTraj);
  return [rob];
}

/**
 * Auto-dispatches a multi-problem `DAEBuilder` arena to the matching native WASM/numerical solver.
 */
export function solveArena(dae: DAEBuilder, opts: ArenaSolveOptions = {}): ArenaSolveResult {
  const t0 = opts.tSpan?.[0] ?? dae.experiment.startTime ?? 0.0;
  const tEnd = opts.tSpan?.[1] ?? dae.experiment.stopTime ?? 1.0;
  const steps = opts.steps ?? dae.experiment.numberOfIntervals ?? 200;

  // 1. SDE Dispatch (zero-GC WASM Euler-Maruyama / Milstein / Ensemble)
  if (opts.forceKind === "sde" || (!opts.forceKind && dae.hasProblemFlag(PROBLEM_SDE))) {
    const { stateVarIds, driftExprIds } = extractExplicitStateDrifts(dae);
    const seed = opts.seed ?? dae.stochastic.getConfig().seed ?? 42;
    const method = opts.sdeMethod ?? "milstein";
    if (method === "ensemble") {
      const paths = opts.ensemblePaths ?? Math.max(16, dae.stochastic.getConfig().ensemblePaths || 64);
      const ens = dae.stochastic.runEnsemble(stateVarIds, driftExprIds, t0, tEnd, steps, paths, {
        seed,
        useMilstein: true,
      });
      return {
        kind: "sde",
        times: ens.times,
        states: ens.mean,
        variance: ens.variance,
        stateNames: stateVarIds.map((v) => dae.getVarName(v)),
        stlRobustness: attachStlRobustness(dae, ens.times, ens.mean, stateVarIds),
      };
    }
    const res =
      method === "euler-maruyama"
        ? dae.stochastic.runEulerMaruyama(stateVarIds, driftExprIds, t0, tEnd, steps, seed)
        : dae.stochastic.runMilstein(stateVarIds, driftExprIds, t0, tEnd, steps, seed);
    return {
      kind: "sde",
      times: res.times,
      states: res.states,
      stateNames: stateVarIds.map((v) => dae.getVarName(v)),
      stlRobustness: attachStlRobustness(dae, res.times, res.states, stateVarIds),
    };
  }

  // 2. Jump / SSA Dispatch (zero-GC WASM Gillespie Direct or Poisson Tau-Leaping)
  if (opts.forceKind === "jump" || (!opts.forceKind && dae.hasProblemFlag(PROBLEM_JUMP))) {
    const vc = dae.getVarCount();
    const trackedVarIds: number[] = [];
    for (let i = 0; i < vc; i++) {
      if (!dae.isVarRemoved(i) && dae.getVarVariability(i) <= Variability.Discrete) {
        trackedVarIds.push(i);
      }
    }
    if (opts.jumpMethod === "tau-leaping") {
      const res = dae.jumps.runTauLeaping(trackedVarIds, t0, tEnd, steps, opts.seed ?? 42);
      return {
        kind: "jump",
        times: res.times,
        states: res.states,
        stateNames: trackedVarIds.map((v) => dae.getVarName(v)),
        stlRobustness: attachStlRobustness(dae, res.times, res.states, trackedVarIds),
      };
    }
    const res = dae.jumps.runGillespie(trackedVarIds, t0, tEnd, opts.maxEvents ?? 10000, opts.seed ?? 42);
    return {
      kind: "jump",
      times: res.times,
      states: res.states,
      stateNames: trackedVarIds.map((v) => dae.getVarName(v)),
      jumpIds: res.jumpIds,
      stlRobustness: attachStlRobustness(dae, res.times, res.states, trackedVarIds),
    };
  }

  // 2b. DDE / NDDE Dispatch (Method of Steps backed by WASM delay channels)
  if (opts.forceKind === "dde" || (!opts.forceKind && dae.hasProblemFlag(PROBLEM_DDE))) {
    const { stateVarIds, driftExprIds } = extractExplicitStateDrifts(dae);
    const channels = dae.delays.getChannels();
    const vc = dae.getVarCount();
    const ex = dae.exports;
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const delayBufPtr = ex.atomicChunkAlloc(Math.max(1, channels.length) * 8);
    try {
      const y0 = stateVarIds.map((v) => dae.getVarStartValue(v));
      const constantDelays = channels.map((_, idx) => dae.delays.evalTau(idx, y0)).filter((tau) => tau > 0);
      const histVals = channels.map((_, idx) => dae.delays.evalHistory(idx, y0));
      const ddeRes = ddeSteps({
        f: (t, y, history) => {
          const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
          for (let v = 0; v < vc; v++) f64[v] = dae.getVarStartValue(v);
          for (let i = 0; i < stateVarIds.length; i++) f64[stateVarIds[i]!] = y[i]!;

          const dBuf = new Float64Array(ex.memory.buffer, delayBufPtr, Math.max(1, channels.length));
          for (let c = 0; c < channels.length; c++) {
            const tau = ex.dae_delay_evalTau(dae.ptr, c >>> 0, valsPtr) as number;
            const tPast = t - tau;
            if (tPast <= t0) {
              dBuf[c] = histVals[c] ?? (ex.dae_delay_evalHistory(dae.ptr, c >>> 0, valsPtr) as number);
            } else {
              const pastY = history(tPast);
              // Temporarily evaluate targetExpr at pastY
              for (let i = 0; i < stateVarIds.length; i++) f64[stateVarIds[i]!] = pastY[i]!;
              dBuf[c] = ex.dae_evalExpr(dae.ptr, channels[c]!.targetExprId >>> 0, valsPtr) as number;
              // Restore current y
              for (let i = 0; i < stateVarIds.length; i++) f64[stateVarIds[i]!] = y[i]!;
            }
          }
          ex.dae_setActiveDelayValues(delayBufPtr, channels.length >>> 0);
          try {
            return driftExprIds.map((eId) => ex.dae_evalExpr(dae.ptr, eId >>> 0, valsPtr) as number);
          } finally {
            ex.dae_setActiveDelayValues(0, 0);
          }
        },
        h: () => [...y0],
        y0,
        tSpan: [t0, tEnd],
        constantDelays,
      });
      return {
        kind: "dde",
        times: ddeRes.times,
        states: ddeRes.states,
        stateNames: stateVarIds.map((v) => dae.getVarName(v)),
        stlRobustness: attachStlRobustness(dae, ddeRes.times, ddeRes.states, stateVarIds),
      };
    } finally {
      ex.atomicChunkFree(delayBufPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  // 3. BVP Dispatch (Collocation/Shooting backed by WASM boundary residuals)
  if (opts.forceKind === "bvp" || (!opts.forceKind && dae.hasProblemFlag(PROBLEM_BVP))) {
    const { stateVarIds, driftExprIds } = extractExplicitStateDrifts(dae);
    const vc = dae.getVarCount();
    const ex = dae.exports;
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    try {
      const evalRhs = (_t: number, y: number[]): number[] => {
        const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
        for (let v = 0; v < vc; v++) f64[v] = dae.getVarStartValue(v);
        for (let i = 0; i < stateVarIds.length; i++) f64[stateVarIds[i]!] = y[i]!;
        return driftExprIds.map((eId) => ex.dae_evalExpr(dae.ptr, eId >>> 0, valsPtr) as number);
      };
      const evalBc = (ya: number[], yb: number[]): number[] => {
        const fullYa = new Array<number>(vc).fill(0);
        const fullYb = new Array<number>(vc).fill(0);
        for (let i = 0; i < stateVarIds.length; i++) {
          fullYa[stateVarIds[i]!] = ya[i]!;
          fullYb[stateVarIds[i]!] = yb[i]!;
        }
        return dae.bvp.evalBoundaryResiduals(fullYa, fullYb);
      };
      const yGuess = stateVarIds.map((v) => dae.getVarStartValue(v));
      const cfg = dae.bvp.getConfig();
      const bvpRes = solveBVP(
        { f: evalRhs, bc: evalBc, yGuess, tSpan: [t0, tEnd] },
        { numIntervals: cfg.intervals || 20 },
      );
      return {
        kind: "bvp",
        times: bvpRes.times,
        states: bvpRes.states,
        stateNames: stateVarIds.map((v) => dae.getVarName(v)),
        stlRobustness: attachStlRobustness(dae, bvpRes.times, bvpRes.states, stateVarIds),
      };
    } finally {
      ex.atomicChunkFree(valsPtr);
    }
  }

  // 4. Optimization Dispatch (WASM exact AD gradient + penalty descent)
  if (opts.forceKind === "optimization" || (!opts.forceKind && dae.hasProblemFlag(PROBLEM_OPTIMIZATION))) {
    const vc = dae.getVarCount();
    const decisionVarIds: number[] = [];
    const x: number[] = new Array<number>(vc);
    for (let i = 0; i < vc; i++) {
      x[i] = dae.getVarStartValue(i);
      if (!dae.isVarRemoved(i) && dae.getVarVariability(i) <= Variability.Discrete) {
        decisionVarIds.push(i);
      }
    }
    const cons = dae.optimization.getConstraints();
    const maxIter = opts.maxIterations ?? 200;
    let lr = 0.05;
    const rho = 25.0;

    for (let iter = 0; iter < maxIter; iter++) {
      const { gradient } = dae.optimization.evalObjectiveGradient(0, x, decisionVarIds, true);
      const gVals = dae.optimization.evalConstraints(x);
      const jac = cons.length > 0 ? dae.optimization.evalConstraintJacobian(x, decisionVarIds) : [];

      let gradNormSq = 0;
      const step = new Array<number>(decisionVarIds.length).fill(0);
      for (let k = 0; k < decisionVarIds.length; k++) {
        let gTotal = gradient[k] ?? 0;
        for (let c = 0; c < cons.length; c++) {
          const con = cons[c]!;
          const gv = gVals[c]!;
          const jck = jac[c]?.[k] ?? 0;
          if (gv < con.lb) gTotal += 2 * rho * (gv - con.lb) * jck;
          else if (gv > con.ub) gTotal += 2 * rho * (gv - con.ub) * jck;
        }
        step[k] = gTotal;
        gradNormSq += gTotal * gTotal;
      }
      if (Math.sqrt(gradNormSq) < 1e-7) break;
      const scale = Math.min(lr, 1.0 / (1.0 + Math.sqrt(gradNormSq)));
      for (let k = 0; k < decisionVarIds.length; k++) {
        x[decisionVarIds[k]!] = x[decisionVarIds[k]!]! - scale * step[k]!;
      }
      lr *= 0.995;
    }

    const objs = dae.optimization.evalObjectives(x, false);
    return {
      kind: "optimization",
      optimalValues: decisionVarIds.map((v) => x[v]!),
      stateNames: decisionVarIds.map((v) => dae.getVarName(v)),
      objectiveValue: objs[0] ?? 0,
      maxConstraintViolation: dae.optimization.maxConstraintViolation(x),
    };
  }

  // 5. Default ODE / DAE / DDE Fallback via ArenaSimulator
  const { stateVarIds } = extractExplicitStateDrifts(dae);
  const sim = new ArenaSimulator(dae);
  const dt = steps > 0 ? (tEnd - t0) / steps : 0.01;
  const maxStrId = Math.max(dae.interner.size + 16, dae.getVarCount() + 16);
  const valuesByStringId = new Float64Array(maxStrId);
  for (let i = 0; i < dae.getVarCount(); i++) {
    const sid = dae.getVarNameId(i);
    if (sid >= 0 && sid < valuesByStringId.length) {
      valuesByStringId[sid] = dae.getVarStartValue(i);
    }
  }
  const stateStringIds = stateVarIds.map((v) => dae.getVarNameId(v));
  const derivStringIds = stateVarIds.map((v) => dae.interner.intern(`der(${dae.getVarName(v)})`));
  const simRes = sim.simulate(steps, dt, valuesByStringId, stateStringIds, derivStringIds);
  const times = simRes.t;
  const states: number[][] = simRes.y.map((row) => Array.from(row));
  const names = stateVarIds.map((v) => dae.getVarName(v));
  void PROBLEM_DDE;
  return {
    kind: "dae",
    times,
    states,
    stateNames: names,
    stlRobustness: attachStlRobustness(dae, times, states, stateVarIds),
  };
}
