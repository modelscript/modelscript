// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CdclSatSolver,
  Interval,
  SosBarrierSynthesizer,
  StlMonitor,
  TseitinEncoder,
  Zonotope,
  ZonotopeReachabilitySolver,
  type PropExpr,
  type TrajectoryTrace,
} from "@modelscript/runtime";
import { PsseErrorCode } from "../errors.js";
import type { PsseTransientResult } from "../solver/ac-powerflow.js";
import type { PsseCase, PsseDiagnostic } from "../types.js";

export interface FormalRasSchemeInput {
  id: string;
  /** Optional trigger predicate tokens referencing bus/branch events (e.g. "V<0.90", "TRIP_L1"). */
  triggerTag?: string | undefined;
  /** Optional guard predicate that disables or enables this scheme under a relay tag. */
  guardTag?: string | undefined;
  actions: Array<{
    kind: "open_branch" | "close_branch" | "trip_generator" | "shed_load" | "restore_load";
    target: string;
  }>;
}

/**
 * `P8001`: Encodes RAS/SPS trigger guards and discrete actions into CNF (`TseitinEncoder` + `CdclSatSolver`)
 * to formally witness contradictory or cyclic arming/tripping races on shared network elements.
 */
export function verifyRasSpsBmc(schemes: readonly FormalRasSchemeInput[]): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  if (schemes.length < 2) return diagnostics;

  // Opposite action pairs on identical equipment targets
  const isOppositePair = (a: string, b: string): boolean =>
    (a === "open_branch" && b === "close_branch") ||
    (a === "close_branch" && b === "open_branch") ||
    (a === "shed_load" && b === "restore_load") ||
    (a === "restore_load" && b === "shed_load");

  for (let i = 0; i < schemes.length; i++) {
    for (let j = i + 1; j < schemes.length; j++) {
      const sA = schemes[i]!;
      const sB = schemes[j]!;
      for (const actA of sA.actions) {
        for (const actB of sB.actions) {
          if (actA.target !== actB.target) continue;
          if (!isOppositePair(actA.kind, actB.kind)) continue;

          // Build SAT instance proving whether both schemes can become armed on the same contingency step
          const enc = new TseitinEncoder();
          const armedA: PropExpr = { op: "var", name: `arm_${sA.id}` };
          const armedB: PropExpr = { op: "var", name: `arm_${sB.id}` };

          const constraints: PropExpr[] = [armedA, armedB];
          if (sA.triggerTag && sB.triggerTag && sA.triggerTag === `!${sB.triggerTag}`) {
            const trig: PropExpr = { op: "var", name: `trig_${sB.triggerTag}` };
            constraints.push({ op: "implies", left: armedA, right: { op: "not", child: trig } });
            constraints.push({ op: "implies", left: armedB, right: trig });
          } else if (sA.guardTag && sB.guardTag && sA.guardTag === `!${sB.guardTag}`) {
            const g: PropExpr = { op: "var", name: `guard_${sB.guardTag}` };
            constraints.push({ op: "implies", left: armedA, right: { op: "not", child: g } });
            constraints.push({ op: "implies", left: armedB, right: g });
          }

          const root = enc.encode({ op: "and", children: constraints });
          const solver = new CdclSatSolver();
          for (const clause of enc.clauses) solver.addClause(clause);
          solver.addClause([root]);
          const sat = solver.solve();
          solver.destroy();

          if (sat.status === "SAT") {
            diagnostics.push({
              severity: PsseErrorCode.RAS_SPS_RACE_CONDITION.severity,
              code: PsseErrorCode.RAS_SPS_RACE_CONDITION.code,
              message: PsseErrorCode.RAS_SPS_RACE_CONDITION.message(actA.target, sA.id, sB.id),
              startOffset: 0,
              endOffset: 0,
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

export interface FrequencyNadirReachOptions {
  /** Override contingency active-power loss in MW (defaults to largest online non-slack unit, else max unit). */
  contingencyLossMw?: number | undefined;
  /** First UFLS shedding frequency threshold in Hz (default: 59.5 Hz on 60 Hz grid, 49.5 Hz on 50 Hz). */
  uflsThresholdHz?: number | undefined;
  /** Aggregate governor droop R in pu (default: 0.05). */
  rDroop?: number | undefined;
  /** Load frequency damping D in pu/pu (default: 1.0). */
  dLoad?: number | undefined;
  /** Equivalent turbine reheat/governor time constant in seconds (default: 2.5 s). */
  tGovSec?: number | undefined;
  /** Uncertainty fraction on disturbance magnitude / governor response (default: 0.10 = +-10%). */
  uncertaintyFraction?: number | undefined;
}

export interface FrequencyNadirReachResult {
  nadirRangeHz: [number, number];
  safe: boolean;
  isCertifiedSafe: boolean;
  diagnostic?: PsseDiagnostic | undefined;
}

/**
 * `P8003`: Evaluates worst-case system frequency nadir after the largest single-unit outage using
 * `@modelscript/runtime` certified linear `ZonotopeReachabilitySolver` on the 2-state SFR ODE.
 */
export function analyzeFrequencyNadirReachability(
  c: PsseCase,
  options: FrequencyNadirReachOptions = {},
): FrequencyNadirReachResult {
  const fBase = c.header.basfrq > 0 ? c.header.basfrq : 60.0;
  const sbase = c.header.sbase > 0 ? c.header.sbase : 100.0;
  const uflsHz = options.uflsThresholdHz ?? (Math.abs(fBase - 50) < 1 ? 49.5 : 59.5);

  const onlineGens = c.generators.filter((g) => g.stat === 1);
  let totalMva = 0;
  let totalHWeighted = 0;
  let largestUnitMw = 0;

  const hByGenKey = new Map<string, number>();
  if (c.dyr) {
    for (const r of c.dyr.records) {
      if (r.category !== "generator") continue;
      const h = r.namedParams["H"] ?? r.con[0];
      if (h !== undefined && Number.isFinite(h) && h > 0) {
        hByGenKey.set(`${r.ibus}:${r.id.trim() || "1"}`, h);
      }
    }
  }

  for (const g of onlineGens) {
    const mva = g.mbase > 0 ? g.mbase : sbase;
    const key = `${g.i}:${g.id.trim() || "1"}`;
    const h = hByGenKey.get(key) ?? 4.0;
    totalMva += mva;
    totalHWeighted += h * mva;
    if (g.pg > largestUnitMw) largestUnitMw = g.pg;
  }

  const lossMw = options.contingencyLossMw ?? largestUnitMw;
  const sysMva = Math.max(sbase, totalMva);
  const hEq = Math.max(0.5, totalHWeighted / sysMva);
  const dpPu = Math.max(0, lossMw / sysMva);

  if (dpPu <= 0 || onlineGens.length === 0) {
    return { nadirRangeHz: [fBase, fBase], safe: true, isCertifiedSafe: true };
  }

  const rDroop = Math.max(0.01, options.rDroop ?? 0.05);
  const dLoad = Math.max(0.1, options.dLoad ?? 1.0);
  const tGov = Math.max(0.2, options.tGovSec ?? 2.5);
  const unc = Math.max(0.0, options.uncertaintyFraction ?? 0.1);

  // State vector x = [Δf_pu, ΔPm_pu]; x' = A x + B u where u = -ΔPd_pu in [-dpPu*(1+unc), -dpPu*(1-unc)]
  const A = [
    [-dLoad / (2 * hEq), 1 / (2 * hEq)],
    [-1 / (rDroop * tGov), -1 / tGov],
  ];
  const B = [[1 / (2 * hEq)], [0]];
  const U = Zonotope.fromIntervals([new Interval(-dpPu * (1 + unc), -dpPu * (1 - unc))]);
  const initialSet = Zonotope.fromIntervals([new Interval(-1e-4, 1e-4), new Interval(-1e-4, 1e-4)]);
  const uflsDeltaPu = (uflsHz - fBase) / fBase;

  const res = ZonotopeReachabilitySolver.solve({
    A,
    B,
    U,
    initialSet,
    nominalInitial: [0, 0],
    tSpan: [0, 8.0],
    dt: 0.05,
    maxOrder: 12,
    requirements: [
      {
        name: "UFLS_Stage1",
        stateIndex: 0,
        operator: ">=",
        limitValue: uflsDeltaPu,
      },
    ],
    budgetMs: 250,
  });

  let minPu = 0;
  let maxPu = 0;
  for (const step of res.steps) {
    const iv = step.enclosure[0];
    if (iv) {
      if (iv.lo < minPu) minPu = iv.lo;
      if (iv.hi > maxPu) maxPu = iv.hi;
    }
  }
  const worstFreqHz = fBase * (1 + minPu);
  const bestFreqHz = fBase * (1 + maxPu);
  const safe = res.isCertifiedSafe && worstFreqHz > uflsHz;

  const diagnostic: PsseDiagnostic | undefined = safe
    ? undefined
    : {
        severity: PsseErrorCode.FREQUENCY_NADIR_UFLS_BREACH.severity,
        code: PsseErrorCode.FREQUENCY_NADIR_UFLS_BREACH.code,
        message: PsseErrorCode.FREQUENCY_NADIR_UFLS_BREACH.message(worstFreqHz, uflsHz, lossMw, hEq),
        startOffset: c.header.span?.startOffset ?? 0,
        endOffset: c.header.span?.endOffset ?? 0,
        line: c.header.span?.line,
        column: c.header.span?.column,
      };

  return {
    nadirRangeHz: [worstFreqHz, bestFreqHz],
    safe,
    isCertifiedSafe: res.isCertifiedSafe,
    diagnostic,
  };
}

export interface PsseStlVerifyOptions {
  vMinPu?: number | undefined;
  vMaxPu?: number | undefined;
  fMinHz?: number | undefined;
  fMaxHz?: number | undefined;
  fNominalHz?: number | undefined;
  /** Optional post-fault recovery start time in seconds (default: sim.summary.faultClearSec + 0.5). */
  recoveryStartSec?: number | undefined;
  vRecoveryMinPu?: number | undefined;
}

/**
 * `P8004`: Evaluates NERC PRC-024 / PRC-029 STL robustness over transient simulation waveforms
 * using `@modelscript/runtime` `StlMonitor`.
 */
export function verifyPsseTrajectoryStl(
  sim: PsseTransientResult,
  options: PsseStlVerifyOptions = {},
): { robustness: number; satisfied: boolean; diagnostics: PsseDiagnostic[] } {
  const diagnostics: PsseDiagnostic[] = [];
  if (sim.t.length < 2) return { robustness: 0, satisfied: true, diagnostics };

  const fNom = options.fNominalHz ?? 60.0;
  const vMin = options.vMinPu ?? 0.7;
  const vMax = options.vMaxPu ?? 1.2;
  const fMin = options.fMinHz ?? fNom - 1.2;
  const fMax = options.fMaxHz ?? fNom + 1.2;
  const tEnd = sim.t[sim.t.length - 1] ?? 1.0;

  const signals: Record<string, Float64Array> = {};
  const vKeys = Object.keys(sim.variables).filter(
    (k) => k.startsWith("Vm_") || k.startsWith("V_") || k.startsWith("v_bus_"),
  );
  const fKeys = Object.keys(sim.variables).filter(
    (k) => k.startsWith("f_") || k.startsWith("freq") || k.includes("speed"),
  );

  for (const k of vKeys) {
    signals[k] = new Float64Array(sim.variables[k]!);
  }
  for (const k of fKeys) {
    const arr = sim.variables[k]!;
    // Convert pu speed (~1.0) to Hz if values sit near 1.0 instead of 50/60
    const isPu = arr.length > 0 && Math.abs(arr[0]!) < 5.0;
    signals[k] = Float64Array.from(arr, (val) => (isPu ? val * fNom : val));
  }

  const trace: TrajectoryTrace = {
    time: new Float64Array(sim.t),
    signals,
  };

  let overallMinRho = Infinity;
  let anyViolated = false;

  for (const vk of vKeys) {
    const formula = StlMonitor.always(
      [0, tEnd],
      StlMonitor.and(StlMonitor.predicate(vk, ">=", vMin), StlMonitor.predicate(vk, "<=", vMax)),
    );
    const ev = StlMonitor.evaluate(formula, trace);
    if (ev.robustness < overallMinRho) overallMinRho = ev.robustness;
    if (!ev.isSatisfied) {
      anyViolated = true;
      diagnostics.push({
        severity: PsseErrorCode.NERC_PRC_STL_VIOLATION.severity,
        code: PsseErrorCode.NERC_PRC_STL_VIOLATION.code,
        message: PsseErrorCode.NERC_PRC_STL_VIOLATION.message(vk, ev.robustness, ev.timeOfWorstViolation ?? 0),
        startOffset: 0,
        endOffset: 0,
      });
    }
  }

  for (const fk of fKeys) {
    const formula = StlMonitor.always(
      [0, tEnd],
      StlMonitor.and(StlMonitor.predicate(fk, ">=", fMin), StlMonitor.predicate(fk, "<=", fMax)),
    );
    const ev = StlMonitor.evaluate(formula, trace);
    if (ev.robustness < overallMinRho) overallMinRho = ev.robustness;
    if (!ev.isSatisfied) {
      anyViolated = true;
      diagnostics.push({
        severity: PsseErrorCode.NERC_PRC_STL_VIOLATION.severity,
        code: PsseErrorCode.NERC_PRC_STL_VIOLATION.code,
        message: PsseErrorCode.NERC_PRC_STL_VIOLATION.message(fk, ev.robustness, ev.timeOfWorstViolation ?? 0),
        startOffset: 0,
        endOffset: 0,
      });
    }
  }

  if (vKeys.length === 0 && fKeys.length === 0) {
    // Fallback against summary metrics if channel variables weren't emitted
    const rhoV = sim.summary.minBusVoltagePu - vMin;
    const rhoF = Math.min(fMax - fNom, fNom - fMin) - sim.summary.maxFreqDeviationHz;
    overallMinRho = Math.min(rhoV, rhoF);
    if (overallMinRho < 0) {
      anyViolated = true;
      diagnostics.push({
        severity: PsseErrorCode.NERC_PRC_STL_VIOLATION.severity,
        code: PsseErrorCode.NERC_PRC_STL_VIOLATION.code,
        message: PsseErrorCode.NERC_PRC_STL_VIOLATION.message(
          rhoV < rhoF ? "summary.minBusVoltagePu" : "summary.maxFreqDeviationHz",
          overallMinRho,
          sim.summary.faultClearSec,
        ),
        startOffset: 0,
        endOffset: 0,
      });
    }
  }

  return {
    robustness: Number.isFinite(overallMinRho) ? overallMinRho : 0,
    satisfied: !anyViolated,
    diagnostics,
  };
}

export interface CriticalClearingBarrierResult {
  safe: boolean;
  minCctSec: number;
  criticalMachine?: string | undefined;
  diagnostics: PsseDiagnostic[];
}

/**
 * `P8002`: Evaluates per-machine critical clearing time (Equal-Area Criterion + post-fault
 * `SosBarrierSynthesizer` quadratic swing Lyapunov margin) for 3-phase fault clearing times.
 */
export function verifyCriticalClearingBarrier(
  c: PsseCase,
  options: { clearingTimeSec?: number; postFaultXRatio?: number } = {},
): CriticalClearingBarrierResult {
  const clearingSec = options.clearingTimeSec ?? 0.1; // 6 cycles @ 60 Hz
  const postFaultRatio = options.postFaultXRatio ?? 1.25;
  const fNom = c.header.basfrq > 0 ? c.header.basfrq : 60.0;
  const omegaS = 2 * Math.PI * fNom;
  const sbase = c.header.sbase > 0 ? c.header.sbase : 100.0;

  const hMap = new Map<string, number>();
  const xMap = new Map<string, number>();
  if (c.dyr) {
    for (const r of c.dyr.records) {
      if (r.category !== "generator") continue;
      const key = `${r.ibus}:${r.id.trim() || "1"}`;
      const h = r.namedParams["H"] ?? r.con[0];
      const xp = r.namedParams["Xdp"] ?? r.namedParams["Xdpp"] ?? r.namedParams["Xd"];
      if (h !== undefined && h > 0) hMap.set(key, h);
      if (xp !== undefined && xp > 0) xMap.set(key, xp);
    }
  }

  const diagnostics: PsseDiagnostic[] = [];
  let minCctSec = Infinity;
  let criticalMachine: string | undefined;

  for (const g of c.generators) {
    if (g.stat !== 1 || g.pg <= 1.0) continue;
    const key = `${g.i}:${g.id.trim() || "1"}`;
    const mbase = g.mbase > 0 ? g.mbase : sbase;
    const h = hMap.get(key) ?? 3.5;
    const xp = xMap.get(key) ?? (g.zx > 0 && g.zx < 1.5 ? g.zx : 0.25);
    const pmPu = Math.max(0.05, g.pg / mbase);
    const pMaxPre = Math.max(pmPu + 0.2, 1.05 / Math.max(0.08, xp));
    const pMaxPost = pMaxPre / Math.max(1.0, postFaultRatio);

    if (pmPu >= pMaxPost) {
      minCctSec = 0;
      criticalMachine = key;
      diagnostics.push({
        severity: PsseErrorCode.CRITICAL_CLEARING_BARRIER.severity,
        code: PsseErrorCode.CRITICAL_CLEARING_BARRIER.code,
        message: PsseErrorCode.CRITICAL_CLEARING_BARRIER.message(g.i, g.id.trim() || "1", 0, clearingSec * 1e3),
        startOffset: g.span?.startOffset ?? 0,
        endOffset: g.span?.endOffset ?? 0,
        line: g.span?.line,
        column: g.span?.column,
      });
      continue;
    }

    const delta0 = Math.asin(Math.min(0.95, pmPu / pMaxPre));
    const deltaPost = Math.asin(Math.min(0.95, pmPu / pMaxPost));
    const deltaMax = Math.PI - deltaPost;
    // Equal-area critical clearing angle: cos(delta_cr) = (pm*(deltaMax - delta0) + pMaxPost*cos(deltaMax)) / pMaxPost
    const cosDeltaCr = Math.max(
      -1.0,
      Math.min(1.0, (pmPu * (deltaMax - delta0) + pMaxPost * Math.cos(deltaMax)) / pMaxPost),
    );
    const deltaCr = Math.acos(cosDeltaCr);
    const accelRadS2 = (omegaS * pmPu) / (2 * Math.max(0.2, h));
    const cctSec = deltaCr > delta0 ? Math.sqrt((2 * (deltaCr - delta0)) / accelRadS2) : 0;

    // Evaluate linearized post-fault SOS/Lyapunov basin barrier around post-fault equilibrium
    const deltaClear = delta0 + 0.5 * accelRadS2 * clearingSec * clearingSec;
    const omegaClear = (pmPu / (2 * Math.max(0.2, h))) * clearingSec;
    const initialRadius = Math.hypot(deltaClear - deltaPost, omegaClear);
    const unsafeRadius = Math.max(0.1, deltaMax - deltaPost);
    const kSync = pMaxPost * Math.cos(deltaPost);
    const dM = 2.0;
    const barrier = SosBarrierSynthesizer.synthesizeQuadratic(
      {
        numVars: 2,
        varNames: ["delta_err", "omega_pu"],
        f: (y) => [y[1]!, (-kSync * y[0]! - dM * y[1]!) / (2 * Math.max(0.2, h))],
      },
      { initialRadius, unsafeRadius, degree: 2 },
    );

    if (cctSec < minCctSec) {
      minCctSec = cctSec;
      criticalMachine = key;
    }
    if (cctSec < clearingSec || initialRadius >= unsafeRadius || !barrier.candidateFound) {
      diagnostics.push({
        severity: PsseErrorCode.CRITICAL_CLEARING_BARRIER.severity,
        code: PsseErrorCode.CRITICAL_CLEARING_BARRIER.code,
        message: PsseErrorCode.CRITICAL_CLEARING_BARRIER.message(
          g.i,
          g.id.trim() || "1",
          cctSec * 1e3,
          clearingSec * 1e3,
        ),
        startOffset: g.span?.startOffset ?? 0,
        endOffset: g.span?.endOffset ?? 0,
        line: g.span?.line,
        column: g.span?.column,
      });
    }
  }

  return {
    safe: diagnostics.length === 0,
    minCctSec: Number.isFinite(minCctSec) ? minCctSec : 1.0,
    criticalMachine,
    diagnostics,
  };
}
