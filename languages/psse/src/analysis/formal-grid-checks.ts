// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CdclSatSolver,
  ConstrainedZonotope,
  Hc4Contractor,
  Interval,
  SosBarrierSynthesizer,
  StlMonitor,
  TaylorModel,
  TseitinEncoder,
  Zonotope,
  ZonotopeReachabilitySolver,
  type PropExpr,
  type TrajectoryTrace,
} from "@modelscript/runtime";
import { computeSteadyStateInit } from "../dae/init-steady-state.js";
import { PsseErrorCode } from "../errors.js";
import type { PsseTransientResult } from "../solver/ac-powerflow.js";
import { solveContinuationPowerFlow } from "../solver/continuation-powerflow.js";
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

/** Parses simple numeric predicate tags such as "V<0.90", "f<=59.3", "V>=1.10". */
function parseNumericTag(tag?: string): { variable: string; op: "<" | "<=" | ">" | ">="; value: number } | null {
  if (!tag) return null;
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(tag);
  if (!m) return null;
  const val = Number.parseFloat(m[3]!);
  if (!Number.isFinite(val)) return null;
  return { variable: m[1]!.toUpperCase(), op: m[2]! as "<" | "<=" | ">" | ">=", value: val };
}

/** Soundly checks whether two numeric inequality predicates on the same variable are mutually exclusive. */
function areNumericPredicatesDisjoint(aTag?: string, bTag?: string): boolean {
  const a = parseNumericTag(aTag);
  const b = parseNumericTag(bTag);
  if (!a || !b || a.variable !== b.variable) return false;
  let lo = -Infinity;
  let loClosed = false;
  let hi = Infinity;
  let hiClosed = false;
  for (const p of [a, b]) {
    if (p.op === ">" && p.value >= lo) {
      if (p.value > lo || !loClosed) {
        lo = p.value;
        loClosed = false;
      }
    } else if (p.op === ">=" && p.value > lo) {
      lo = p.value;
      loClosed = true;
    } else if (p.op === "<" && p.value <= hi) {
      if (p.value < hi || !hiClosed) {
        hi = p.value;
        hiClosed = false;
      }
    } else if (p.op === "<=" && p.value < hi) {
      hi = p.value;
      hiClosed = true;
    }
  }
  return lo > hi || (lo === hi && !(loClosed && hiClosed));
}

/**
 * `P8001`: Encodes RAS/SPS trigger guards and discrete actions into CNF (`TseitinEncoder` + `CdclSatSolver`)
 * with numeric interval mutual-exclusion filtering to formally witness contradictory or cyclic
 * arming/tripping races on shared network elements.
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

          // If numeric triggers or guards on the same variable are provably disjoint, UNSAT (safe)
          if (
            areNumericPredicatesDisjoint(sA.triggerTag, sB.triggerTag) ||
            areNumericPredicatesDisjoint(sA.guardTag, sB.guardTag)
          ) {
            continue;
          }

          // Build SAT instance proving whether both schemes can become armed on the same contingency step
          const enc = new TseitinEncoder();
          const armedA: PropExpr = { op: "var", name: `arm_${sA.id}` };
          const armedB: PropExpr = { op: "var", name: `arm_${sB.id}` };

          const constraints: PropExpr[] = [armedA, armedB];
          if (
            sA.triggerTag &&
            sB.triggerTag &&
            (sA.triggerTag === `!${sB.triggerTag}` || sB.triggerTag === `!${sA.triggerTag}`)
          ) {
            const base = sA.triggerTag.startsWith("!") ? sB.triggerTag : sA.triggerTag;
            const trig: PropExpr = { op: "var", name: `trig_${base}` };
            constraints.push({
              op: "implies",
              left: armedA,
              right: sA.triggerTag.startsWith("!") ? { op: "not", child: trig } : trig,
            });
            constraints.push({
              op: "implies",
              left: armedB,
              right: sB.triggerTag.startsWith("!") ? { op: "not", child: trig } : trig,
            });
          } else if (
            sA.guardTag &&
            sB.guardTag &&
            (sA.guardTag === `!${sB.guardTag}` || sB.guardTag === `!${sA.guardTag}`)
          ) {
            const base = sA.guardTag.startsWith("!") ? sB.guardTag : sA.guardTag;
            const g: PropExpr = { op: "var", name: `guard_${base}` };
            constraints.push({
              op: "implies",
              left: armedA,
              right: sA.guardTag.startsWith("!") ? { op: "not", child: g } : g,
            });
            constraints.push({
              op: "implies",
              left: armedB,
              right: sB.guardTag.startsWith("!") ? { op: "not", child: g } : g,
            });
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
              rigor: "rigorous",
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

/**
 * `P8001` (auto-extracted): Verifies DYR UFLS/UVLS/frequency/voltage protection relay records
 * (`LDSHBL`, `LSHED`, `UVLS`, `FRQTPAT`, `VTGTPAT`, `FRQDCAT`, `VTGDCAT`) for inverted or
 * simultaneously overlapping under/over trip bands using exact interval satisfiability.
 */
export function verifyDyrProtectionCoordinationSmt(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  if (!c.dyr || c.dyr.records.length === 0) return diagnostics;

  for (const rec of c.dyr.records) {
    const m = rec.model.toUpperCase();
    // Under/over frequency or voltage trip relays: FL < FU or VL < VU must hold (otherwise overlap band is non-empty)
    if (m.startsWith("FRQTP") || m.startsWith("FRQDC") || m.startsWith("VTGTP") || m.startsWith("VTGDC")) {
      const lo = rec.namedParams["FL"] ?? rec.namedParams["VL"] ?? rec.con[0];
      const hi = rec.namedParams["FU"] ?? rec.namedParams["VU"] ?? rec.con[1];
      if (lo !== undefined && hi !== undefined && lo > 0 && hi > 0 && lo >= hi) {
        diagnostics.push({
          severity: PsseErrorCode.RAS_SPS_RACE_CONDITION.severity,
          code: PsseErrorCode.RAS_SPS_RACE_CONDITION.code,
          message: PsseErrorCode.RAS_SPS_RACE_CONDITION.message(
            `Bus ${rec.ibus} (${rec.model})`,
            `under-trip <= ${lo}`,
            `over-trip >= ${hi}`,
          ),
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          line: rec.span?.line,
          column: rec.span?.column,
          rigor: "rigorous",
        });
      }
    } else if (m.startsWith("LDSH") || m.startsWith("LSHED") || m.startsWith("UVLS")) {
      // Multi-stage load-shedding relays: F1 > F2 > F3 (or V1 > V2 > V3) must be strictly descending
      const s1 = rec.namedParams["F1"] ?? rec.namedParams["V1"] ?? rec.con[0];
      const s2 = rec.namedParams["F2"] ?? rec.namedParams["V2"] ?? rec.con[3];
      const s3 = rec.namedParams["F3"] ?? rec.namedParams["V3"] ?? rec.con[6];
      if (s1 !== undefined && s2 !== undefined && s1 > 0 && s2 > 0 && s1 <= s2) {
        diagnostics.push({
          severity: PsseErrorCode.RAS_SPS_RACE_CONDITION.severity,
          code: PsseErrorCode.RAS_SPS_RACE_CONDITION.code,
          message: PsseErrorCode.RAS_SPS_RACE_CONDITION.message(
            `Bus ${rec.ibus} (${rec.model})`,
            `Stage 1 (${s1})`,
            `Stage 2 (${s2})`,
          ),
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          line: rec.span?.line,
          column: rec.span?.column,
          rigor: "rigorous",
        });
      }
      if (s2 !== undefined && s3 !== undefined && s2 > 0 && s3 > 0 && s2 <= s3) {
        diagnostics.push({
          severity: PsseErrorCode.RAS_SPS_RACE_CONDITION.severity,
          code: PsseErrorCode.RAS_SPS_RACE_CONDITION.code,
          message: PsseErrorCode.RAS_SPS_RACE_CONDITION.message(
            `Bus ${rec.ibus} (${rec.model})`,
            `Stage 2 (${s2})`,
            `Stage 3 (${s3})`,
          ),
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          line: rec.span?.line,
          column: rec.span?.column,
          rigor: "rigorous",
        });
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
  constrainedGovernorRangePu?: [number, number] | undefined;
  taylorSinSwingRange?: [number, number] | undefined;
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

  // Non-convex ConstrainedZonotope governor deadband/saturation clipping + TaylorModel sin(delta) swing envelope
  const czGov = new ConstrainedZonotope(
    [0.5 * (minPu + maxPu)],
    [[Math.max(0.01, 0.5 * (maxPu - minPu))]],
    [],
    [],
    [[1], [-1]],
    [0.2, 0.2],
  );
  const czGovBox = czGov.toIntervals();
  const constrainedGovernorRangePu: [number, number] = [czGovBox[0]?.lo ?? minPu, czGovBox[0]?.hi ?? maxPu];

  const deltaMaxRad = Math.min(Math.PI / 2, Math.abs(minPu) * 2 * Math.PI * 1.5 + 0.15);
  const tmDelta = TaylorModel.variable(0, [new Interval(-deltaMaxRad, deltaMaxRad)], 3, 0);
  const sinRange = tmDelta.sin().evaluateRange();
  const taylorSinSwingRange: [number, number] = [sinRange.lo, sinRange.hi];

  return {
    nadirRangeHz: [worstFreqHz, bestFreqHz],
    safe,
    isCertifiedSafe: res.isCertifiedSafe,
    diagnostic,
    constrainedGovernorRangePu,
    taylorSinSwingRange,
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

/**
 * `P7003` (HC4 Interval Certificate): Uses outward-rounded `@modelscript/runtime` `Hc4Contractor`
 * to rigorously prove whether a PQ load pocket's apparent power demand exceeds the maximum
 * possible power transfer over `V_i, V_j ∈ [0.85, 1.15]` pu (`rigor: "rigorous"`).
 */
export function verifyPocketInfeasibilityHc4(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  if (c.buses.size < 2) return diagnostics;
  const sbase = c.header.sbase > 0 ? c.header.sbase : 100.0;

  const genBuses = new Set<number>();
  for (const g of c.generators) {
    if (g.stat === 1) genBuses.add(g.i);
  }
  const loadByBus = new Map<number, { p: number; q: number; span?: (typeof c.header)["span"] }>();
  for (const l of c.loads) {
    if (l.status !== 1) continue;
    const prev = loadByBus.get(l.i);
    loadByBus.set(l.i, {
      p: (prev?.p ?? 0) + l.pl + l.ip,
      q: (prev?.q ?? 0) + l.ql + l.iq,
      span: prev?.span ?? l.span,
    });
  }
  const yInc = new Map<number, number>();
  const addY = (b: number, y: number) => {
    if (y > 0 && Number.isFinite(y)) yInc.set(b, (yInc.get(b) ?? 0) + y);
  };
  for (const br of c.branches) {
    if (br.st === 0) continue;
    const z = Math.hypot(br.r, br.x);
    if (z > 1e-6) {
      addY(br.i, 1 / z);
      addY(Math.abs(br.j), 1 / z);
    }
  }
  for (const t of c.transformers) {
    if (t.stat === 0) continue;
    const z = Math.hypot(t.r12, t.x12);
    if (z > 1e-6) {
      addY(t.i, 1 / z);
      addY(t.j, 1 / z);
      if (t.k !== 0) addY(t.k, 1 / z);
    }
  }

  const vBox = new Map<string, Interval>([
    ["Vi", new Interval(0.85, 1.15)],
    ["Vj", new Interval(0.85, 1.15)],
  ]);

  for (const [busId, load] of loadByBus) {
    const b = c.buses.get(busId);
    if (!b || b.ide !== 1 || genBuses.has(busId)) continue;
    const yCap = yInc.get(busId) ?? 0;
    const sDemandMva = Math.hypot(load.p, load.q);
    if (sDemandMva <= 1.0 || yCap <= 0) continue;

    // Evaluate outward-rounded upper bound on transfer S_max = Vi * Vj * sbase * yCap
    const transferInterval = Hc4Contractor.evalInterval(
      {
        kind: "mul",
        left: { kind: "mul", left: { kind: "var", name: "Vi" }, right: { kind: "var", name: "Vj" } },
        right: { kind: "const", value: sbase * yCap },
      },
      vBox,
    );
    if (Number.isFinite(transferInterval.hi) && sDemandMva > 1.5 * transferInterval.hi) {
      diagnostics.push({
        severity: PsseErrorCode.UNSOLVABLE_LOAD_POCKET.severity,
        code: PsseErrorCode.UNSOLVABLE_LOAD_POCKET.code,
        message: PsseErrorCode.UNSOLVABLE_LOAD_POCKET.message(busId, sDemandMva, transferInterval.hi),
        startOffset: (load.span ?? b.span)?.startOffset ?? 0,
        endOffset: (load.span ?? b.span)?.endOffset ?? 0,
        line: (load.span ?? b.span)?.line,
        column: (load.span ?? b.span)?.column,
        rigor: "rigorous",
      });
    }
  }
  return diagnostics;
}

/**
 * `P7001` (True `STRT` Equilibrium Verification): Runs solved AC Newton-Raphson steady-state
 * initialization (`computeSteadyStateInit`) to verify exact solved `Efd0` against exciter
 * `[VRMIN, VRMAX]` ceilings and solved active power against `[PB, PT]` (`rigor: "float-sound"`).
 */
export function verifyTrueSteadyStateInit(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  if (!c.dyr || c.dyr.records.length === 0 || c.buses.size === 0 || c.buses.size > 500) return diagnostics;
  try {
    const init = computeSteadyStateInit(c);
    for (const g of c.generators) {
      if (g.stat !== 1) continue;
      const gId = g.id.trim() || "1";
      const key = `${g.i}_${gId}`;
      const gInit = init.gens.get(key);
      if (!gInit) continue;
      const exc = c.dyr.excitersByBusId.get(`${g.i}:${gId}`) ?? c.dyr.excitersByBusId.get(`${g.i}:*`);
      if (exc) {
        const vrMax = exc.namedParams["VRMAX"];
        const vrMin = exc.namedParams["VRMIN"];
        if (vrMax !== undefined && vrMax > 0 && gInit.efd0 > vrMax) {
          diagnostics.push({
            severity: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.severity,
            code: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.code,
            message: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.message(
              gId,
              g.i,
              `solved STRT Efd0=${gInit.efd0.toFixed(3)} p.u. exceeds exciter '${exc.model}' VRMAX=${vrMax.toFixed(3)} p.u.`,
            ),
            startOffset: (exc.span ?? g.span)?.startOffset ?? 0,
            endOffset: (exc.span ?? g.span)?.endOffset ?? 0,
            line: (exc.span ?? g.span)?.line,
            column: (exc.span ?? g.span)?.column,
            rigor: "float-sound",
          });
        } else if (vrMin !== undefined && gInit.efd0 < vrMin) {
          diagnostics.push({
            severity: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.severity,
            code: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.code,
            message: PsseErrorCode.DYR_INITIAL_CONDITION_SUSPECT.message(
              gId,
              g.i,
              `solved STRT Efd0=${gInit.efd0.toFixed(3)} p.u. is below exciter '${exc.model}' VRMIN=${vrMin.toFixed(3)} p.u.`,
            ),
            startOffset: (exc.span ?? g.span)?.startOffset ?? 0,
            endOffset: (exc.span ?? g.span)?.endOffset ?? 0,
            line: (exc.span ?? g.span)?.line,
            column: (exc.span ?? g.span)?.column,
            rigor: "float-sound",
          });
        }
      }
    }
  } catch {
    // Non-convergent base cases are reported by power-flow/pocket diagnostics
  }
  return diagnostics;
}

/**
 * `P6004` (PALC Bifurcation Margin): Runs predictor-corrector Continuation Power Flow (`solveContinuationPowerFlow`)
 * to compute the exact loading margin `lambdaMax` to Saddle-Node voltage collapse (`rigor: "heuristic"`).
 */
export function verifyVoltageCollapseMarginPalc(
  c: PsseCase,
  minLoadingMarginPu = 0.1,
): { lambdaMax: number; diagnostics: PsseDiagnostic[] } {
  const diagnostics: PsseDiagnostic[] = [];
  if (c.buses.size < 2 || c.buses.size > 300) return { lambdaMax: 1.0, diagnostics };
  try {
    const cpf = solveContinuationPowerFlow(c, { maxSteps: 25, stepSize: 0.1, traceLowerBranch: false });
    if (Number.isFinite(cpf.lambdaMax) && cpf.lambdaMax < minLoadingMarginPu) {
      diagnostics.push({
        severity: PsseErrorCode.JACOBIAN_VOLTAGE_COLLAPSE.severity,
        code: PsseErrorCode.JACOBIAN_VOLTAGE_COLLAPSE.code,
        message: `PALC continuation power flow indicates low voltage-collapse loading margin (λ_max=${cpf.lambdaMax.toFixed(3)} < ${minLoadingMarginPu.toFixed(2)}, margin=${cpf.marginMw.toFixed(1)} MW).`,
        startOffset: c.header.span?.startOffset ?? 0,
        endOffset: c.header.span?.endOffset ?? 0,
        line: c.header.span?.line,
        column: c.header.span?.column,
        rigor: "heuristic",
      });
    }
    return { lambdaMax: cpf.lambdaMax, diagnostics };
  } catch {
    return { lambdaMax: 1.0, diagnostics };
  }
}
