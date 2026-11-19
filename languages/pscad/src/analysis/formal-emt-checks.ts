// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CdclSatSolver,
  DdeFlowpipeSolver,
  Interval,
  StlMonitor,
  TseitinEncoder,
  Zonotope,
  ZonotopeReachabilitySolver,
  type PropExpr,
  type TrajectoryTrace,
} from "@modelscript/runtime";
import type { EmtControlBlock, EmtNetlist, PscadDiagnostic } from "../types.js";

/**
 * `M6080`: Formal BMC/SAT verification of PSCAD breaker/tbreakn and logic-driven protection
 * state machines using `@modelscript/runtime` (`TseitinEncoder` + `CdclSatSolver`).
 * Translates upstream CSMF logic gates (`not`/`and`/`or`/`nand`/`nor`/`xor`) and analog
 * comparators (`compar`) into CNF with mutual-exclusion clauses so mutually exclusive
 * interlocks are proven UNSAT (safe) while genuine races emit M6080 (`rigor: "rigorous"`).
 */
export function verifyProtectionRelayBmc(blocks: readonly EmtControlBlock[]): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  if (blocks.length === 0) return diagnostics;

  const byId = new Map<string, EmtControlBlock>();
  const byActuatorTarget = new Map<string, EmtControlBlock[]>();
  for (const b of blocks) {
    byId.set(b.id, b);
    if (b.actuator?.targetId) {
      let arr = byActuatorTarget.get(b.actuator.targetId);
      if (!arr) {
        arr = [];
        byActuatorTarget.set(b.actuator.targetId, arr);
      }
      arr.push(b);
    }
    // Check tbreakn timing inversion/overlap (open TO1 >= reclose TO2 for NUMS=2)
    if (b.kind === "tbreakn") {
      const nums = Math.trunc(Number(b.params["NUMS"] ?? 1));
      const to1 = Number(b.params["TO1"] ?? 0);
      const to2 = Number(b.params["TO2"] ?? 0);
      if (nums >= 2 && to2 <= to1) {
        diagnostics.push({
          code: "M6080",
          rule: "protection-breaker-state-machine-deadlock",
          severity: "error",
          componentId: b.componentId ?? b.id,
          message: `Timed breaker controller '${b.id}' has contradictory open/reclose timings (TO1=${to1} s >= TO2=${to2} s), causing immediate breaker pumping/deadlock.`,
          rigor: "rigorous",
        });
      }
    }
  }

  interface CompInfo {
    varName: string;
    signal: string;
    op: "<" | "<=" | ">" | ">=";
    threshold: number;
  }

  const encodeSignal = (id: string, visiting: Set<string>, comps: CompInfo[]): PropExpr => {
    if (visiting.has(id)) return { op: "var", name: `sig_${id}` };
    const blk = byId.get(id);
    if (!blk) return { op: "var", name: `sig_${id}` };

    const gate = String(blk.params["op"] ?? blk.params["OP"] ?? blk.params["gate"] ?? blk.params["type"] ?? "")
      .trim()
      .toLowerCase();
    const kind = blk.kind.toLowerCase();

    // Analog comparator block: track threshold predicate for mutual-exclusion clauses
    if (kind === "compar" || kind === "compare" || kind === "comparator") {
      const thr = Number(blk.params["threshold"] ?? blk.params["Th"] ?? blk.params["TH"] ?? blk.params["Vref"] ?? NaN);
      const cmpOpRaw = String(blk.params["cmp"] ?? blk.params["mode"] ?? blk.params["op"] ?? ">").trim();
      const cmpOp: "<" | "<=" | ">" | ">=" =
        cmpOpRaw === "<" || cmpOpRaw === "lt"
          ? "<"
          : cmpOpRaw === "<=" || cmpOpRaw === "le"
            ? "<="
            : cmpOpRaw === ">=" || cmpOpRaw === "ge"
              ? ">="
              : ">";
      const varName = `cmp_${blk.id}`;
      if (Number.isFinite(thr) && blk.inputs.length >= 1) {
        comps.push({ varName, signal: blk.inputs[0]!, op: cmpOp, threshold: thr });
      }
      return { op: "var", name: varName };
    }

    if (blk.inputs.length === 0) {
      return { op: "var", name: `drv_${blk.id}` };
    }

    visiting.add(id);
    const children = blk.inputs.map((inp) => encodeSignal(inp, visiting, comps));
    visiting.delete(id);

    if (gate === "not" || gate === "inv" || gate === "invert" || kind === "not") {
      return { op: "not", child: children[0]! };
    }
    if (gate === "and" && children.length >= 2) {
      return { op: "and", children };
    }
    if (gate === "or" && children.length >= 2) {
      return { op: "or", children };
    }
    if (gate === "nand" && children.length >= 2) {
      return { op: "not", child: { op: "and", children } };
    }
    if (gate === "nor" && children.length >= 2) {
      return { op: "not", child: { op: "or", children } };
    }
    if (gate === "xor" && children.length === 2) {
      return {
        op: "and",
        children: [
          { op: "or", children: [children[0]!, children[1]!] },
          { op: "not", child: { op: "and", children: [children[0]!, children[1]!] } },
        ],
      };
    }
    // Single-input pass-through (buffer/wire/gain>0/logic wrapper)
    if (children.length === 1) {
      if (kind === "gain" && Number(blk.params["K"] ?? blk.params["k"] ?? 1) < 0) {
        return { op: "not", child: children[0]! };
      }
      return children[0]!;
    }
    return { op: "var", name: `drv_${blk.id}` };
  };

  const areCompsDisjoint = (a: CompInfo, b: CompInfo): boolean => {
    if (a.signal !== b.signal) return false;
    let lo = -Infinity;
    let loClosed = false;
    let hi = Infinity;
    let hiClosed = false;
    for (const p of [a, b]) {
      if (p.op === ">" && p.threshold >= lo) {
        if (p.threshold > lo || !loClosed) {
          lo = p.threshold;
          loClosed = false;
        }
      } else if (p.op === ">=" && p.threshold > lo) {
        lo = p.threshold;
        loClosed = true;
      } else if (p.op === "<" && p.threshold <= hi) {
        if (p.threshold < hi || !hiClosed) {
          hi = p.threshold;
          hiClosed = false;
        }
      } else if (p.op === "<=" && p.threshold < hi) {
        hi = p.threshold;
        hiClosed = true;
      }
    }
    return lo > hi || (lo === hi && !(loClosed && hiClosed));
  };

  // Check multi-driver or SR-latch contradictions driving the same physical breaker
  for (const [targetId, drivers] of byActuatorTarget) {
    if (drivers.length < 2) continue;
    let raceFound = false;
    for (let i = 0; i < drivers.length && !raceFound; i++) {
      for (let j = i + 1; j < drivers.length && !raceFound; j++) {
        const dA = drivers[i]!;
        const dB = drivers[j]!;
        const comps: CompInfo[] = [];
        const exprA = encodeSignal(dA.id, new Set(), comps);
        const exprB = encodeSignal(dB.id, new Set(), comps);

        const constraints: PropExpr[] = [exprA, exprB];
        // Add sound mutual-exclusion clauses for disjoint analog comparators on the same signal
        for (let ci = 0; ci < comps.length; ci++) {
          for (let cj = ci + 1; cj < comps.length; cj++) {
            if (areCompsDisjoint(comps[ci]!, comps[cj]!)) {
              constraints.push({
                op: "not",
                child: {
                  op: "and",
                  children: [
                    { op: "var", name: comps[ci]!.varName },
                    { op: "var", name: comps[cj]!.varName },
                  ],
                },
              });
            }
          }
        }

        const enc = new TseitinEncoder();
        const root = enc.encode({ op: "and", children: constraints });
        const solver = new CdclSatSolver();
        for (const c of enc.clauses) solver.addClause(c);
        solver.addClause([root]);
        const res = solver.solve();
        solver.destroy();

        if (res.status === "SAT") {
          raceFound = true;
          diagnostics.push({
            code: "M6080",
            rule: "protection-breaker-state-machine-deadlock",
            severity: "error",
            componentId: dA.componentId ?? dA.id,
            message: `Breaker '${targetId}' has multiple conflicting control drivers (${dA.id}, ${dB.id}) with satisfiable simultaneous trip/close race.`,
            rigor: "rigorous",
          });
        }
      }
    }
  }

  return diagnostics;
}

/**
 * `M6081`: Inspects CSMF feedback cycles containing delay elements (`tdelay`, `bin_delay`, `zminusone`)
 * and propagates a delayed ODE flowpipe via `@modelscript/runtime`'s `DdeFlowpipeSolver`.
 */
export function verifyControlDelayStability(blocks: readonly EmtControlBlock[], dtSec = 50e-6): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  if (blocks.length === 0) return diagnostics;

  const byId = new Map<string, EmtControlBlock>();
  for (const b of blocks) byId.set(b.id, b);

  // Locate strongly connected cycles containing a time-delay block
  const delayBlocks = blocks.filter((b) => b.kind === "tdelay" || b.kind === "bin_delay" || b.kind === "zminusone");
  if (delayBlocks.length === 0) return diagnostics;

  for (const db of delayBlocks) {
    // Trace cycle back to `db.id`, preserving exact input-pin sign on `sum` blocks
    const queue: Array<{ id: string; gain: number; depth: number }> = db.inputs.map((inp) => ({
      id: inp,
      gain: 1,
      depth: 1,
    }));
    const seen = new Set<string>();
    let head = 0;
    let loopGain: number | null = null;
    while (head < queue.length) {
      const cur = queue[head++]!;
      if (cur.id === db.id) {
        loopGain = cur.gain;
        break;
      }
      if (seen.has(cur.id) || cur.depth > blocks.length) continue;
      seen.add(cur.id);
      const blk = byId.get(cur.id);
      if (!blk) continue;
      let baseGain = cur.gain;
      if (blk.kind === "gain") {
        baseGain *= Number(blk.params["K"] ?? blk.params["k"] ?? blk.params["G"] ?? 1);
      }
      for (let inIdx = 0; inIdx < blk.inputs.length; inIdx++) {
        const up = blk.inputs[inIdx]!;
        let edgeGain = baseGain;
        if (blk.kind === "sum") {
          const pinSign = Number(blk.params[`s${inIdx + 1}`] ?? (inIdx === 0 ? 1 : 1));
          edgeGain *= Number.isFinite(pinSign) ? pinSign : 1;
        }
        queue.push({ id: up, gain: edgeGain, depth: cur.depth + 1 });
      }
    }

    if (loopGain === null) continue;
    const tauSec = Math.max(
      dtSec,
      Number(db.params["T"] ?? db.params["delay"] ?? db.params["Td"] ?? (db.kind === "zminusone" ? dtSec : 0)),
    );
    if (tauSec <= 0) continue;

    // Model signed delayed loop perturbation dx/dt = (-x + loopGain * x(t - tau)) / tau_eff
    // By Hayes' theorem for tau*dx/dt + x = K*x(t - tau), asymptotic stability holds for
    // K in (-sqrt(1 + (pi/2)^2), +1.0) ≈ (-2.26, +1.0); positive feedback > 1.05 diverges
    // monotonically, while negative feedback destabilizes below -2.26 via Hopf oscillation.
    const signedGain = loopGain;
    if (signedGain > 1.05 || signedGain < -2.26) {
      const aPole = 1.0 / Math.max(1e-3, tauSec);
      const res = DdeFlowpipeSolver.solve(
        {
          numStates: 1,
          delay: tauSec,
          f: (_t, x, xDel) => [-aPole * x[0]! + aPole * signedGain * xDel[0]!],
          historyEnclosure: () => [new Interval(0.95, 1.05)],
          nominalHistory: () => [1.0],
        },
        [0, Math.min(0.5, 4 * tauSec)],
        Math.max(dtSec, tauSec / 20),
      );
      const last = res.steps[res.steps.length - 1];
      const finalMag = Math.max(Math.abs(last?.tubes[0]?.lo ?? 1), Math.abs(last?.tubes[0]?.hi ?? 1));
      if (finalMag > 1.25) {
        diagnostics.push({
          code: "M6081",
          rule: "time-delay-control-loop-instability",
          severity: "warning",
          componentId: db.componentId ?? db.id,
          message: `Delayed feedback loop through '${db.id}' (τ=${(tauSec * 1e3).toFixed(2)} ms, K_loop=${signedGain.toFixed(2)}) grows to ${finalMag.toFixed(2)} pu in DDE flowpipe analysis.`,
          rigor: "heuristic",
        });
      }
    }
  }

  return diagnostics;
}

export interface ConverterReachabilityResult {
  safe: boolean;
  isCertifiedSafe: boolean;
  peakCurrentPu: number;
  peakDcVoltagePu: number;
  diagnostics: PscadDiagnostic[];
}

/**
 * `M6082`: Computes short-horizon reachable current & DC-link voltage envelopes for grid-connected
 * converters / IBRs under grid impedance + voltage disturbance uncertainty using `ZonotopeReachabilitySolver`.
 */
export function verifyConverterReachability(
  netlist: EmtNetlist,
  options: { vStepDisturbancePu?: number; iMaxPu?: number; vDcMaxPu?: number } = {},
): ConverterReachabilityResult {
  const diagnostics: PscadDiagnostic[] = [];
  const iMax = options.iMaxPu ?? 1.35;
  const vDcMax = options.vDcMaxPu ?? 1.25;
  const vStep = options.vStepDisturbancePu ?? 0.25;

  const units = [
    ...(netlist.converterBridges ?? []).map((b) => ({ id: b.id, bus: b.acBus, mva: b.ratedMva })),
    ...netlist.fmuInstances.map((f) => ({ id: f.id, bus: f.busConnection, mva: f.ratedMva })),
  ];
  if (units.length === 0 || netlist.sources.length === 0) {
    return { safe: true, isCertifiedSafe: true, peakCurrentPu: 1.0, peakDcVoltagePu: 1.0, diagnostics };
  }

  const omega = 2 * Math.PI * (netlist.nominalFrequencyHz || 60);
  // Find minimum SCR source impedance connected to the grid
  let maxZPu = 0.05;
  let rOverX = 0.2;
  for (const src of netlist.sources) {
    if (src.dc) continue;
    const busKv = netlist.buses.get(src.bus)?.baseKv || src.vPeakKv || 230;
    const zOhm = Math.hypot(src.rSourceOhm ?? 0, omega * (src.lSourceH ?? 0));
    const totalMva = units.reduce((a, u) => a + Math.max(1, u.mva), 0);
    const zBase = (busKv * busKv) / Math.max(1, totalMva);
    if (zBase > 0 && zOhm > 0) {
      const zPu = zOhm / zBase;
      if (zPu > maxZPu) {
        maxZPu = zPu;
        const xOhm = Math.max(1e-4, omega * (src.lSourceH ?? 0));
        rOverX = Math.max(0.05, (src.rSourceOhm ?? 0) / xOhm);
      }
    }
  }

  // Linearized deviation dynamics from nominal operating point [ΔI_pu, ΔVdc_pu]
  const damp = Math.max(8, 25 / Math.max(0.2, maxZPu));
  const A = [
    [-damp * rOverX, -12.0],
    [10.0, -18.0],
  ];
  const coupling = Math.min(3.5, 0.8 + maxZPu);
  const B = [[coupling * 18.0], [coupling * 6.0]];
  const U = Zonotope.fromIntervals([new Interval(-vStep, vStep)]);
  const initialSet = Zonotope.fromIntervals([new Interval(-0.02, 0.02), new Interval(-0.02, 0.02)]);

  const reach = ZonotopeReachabilitySolver.solve({
    A,
    B,
    U,
    initialSet,
    nominalInitial: [0, 0],
    tSpan: [0, 0.15],
    dt: 0.005,
    maxOrder: 10,
    requirements: [
      { name: "Overcurrent", stateIndex: 0, operator: "<=", limitValue: iMax - 1.0 },
      { name: "DC_Overvoltage", stateIndex: 1, operator: "<=", limitValue: vDcMax - 1.0 },
    ],
    budgetMs: 150,
  });

  let maxDi = 0;
  let maxDvdc = 0;
  for (const s of reach.steps) {
    maxDi = Math.max(maxDi, Math.abs(s.enclosure[0]?.lo ?? 0), Math.abs(s.enclosure[0]?.hi ?? 0));
    maxDvdc = Math.max(maxDvdc, Math.abs(s.enclosure[1]?.lo ?? 0), Math.abs(s.enclosure[1]?.hi ?? 0));
  }
  const peakI = 1.0 + maxDi;
  const peakV = 1.0 + maxDvdc;
  const safe = reach.isCertifiedSafe && peakI <= iMax && peakV <= vDcMax;

  if (!safe) {
    diagnostics.push({
      code: "M6082",
      rule: "converter-overcurrent-overvoltage-flowpipe",
      severity: "warning",
      componentId: units[0]!.id,
      message: `Zonotope flowpipe under ±${(vStep * 100).toFixed(0)}% disturbance (Z_g=${maxZPu.toFixed(2)} pu) reaches peak converter current ${peakI.toFixed(2)} pu / V_dc ${peakV.toFixed(2)} pu beyond hardware threshold.`,
    });
  }

  return {
    safe,
    isCertifiedSafe: reach.isCertifiedSafe,
    peakCurrentPu: peakI,
    peakDcVoltagePu: peakV,
    diagnostics,
  };
}

export interface Ieee2800StlReport {
  satisfied: boolean;
  overallRobustness: number;
  vOvervoltageRho: number;
  pRecoveryRho: number;
  freqRho: number;
  diagnostics: PscadDiagnostic[];
}

/**
 * `M6083`: Synthesizes dense-time IEEE 2800-2022 / NERC PRC-029 STL specifications and evaluates
 * quantitative safety robustness margins via `@modelscript/runtime`'s `StlMonitor`.
 */
export function evaluateIeee2800StlRobustness(
  timeSec: ArrayLike<number>,
  vPoiPu: ArrayLike<number>,
  pPoiPu: ArrayLike<number>,
  freqHz: ArrayLike<number>,
  options: { faultClearSec?: number; fNominalHz?: number } = {},
): Ieee2800StlReport {
  const n = Math.min(timeSec.length, vPoiPu.length, pPoiPu.length, freqHz.length);
  if (n < 2) {
    return {
      satisfied: true,
      overallRobustness: 0,
      vOvervoltageRho: 0,
      pRecoveryRho: 0,
      freqRho: 0,
      diagnostics: [],
    };
  }
  const tArr = Float64Array.from(timeSec).subarray(0, n);
  const t0 = tArr[0]!;
  const tEnd = tArr[n - 1]!;
  const fNom = options.fNominalHz ?? 60.0;
  const clearSec = options.faultClearSec ?? 0.2;
  const recStart = Math.min(tEnd, clearSec + 1.0);

  const trace: TrajectoryTrace = {
    time: tArr,
    signals: {
      vPoiPu: Float64Array.from(vPoiPu).subarray(0, n),
      pPoiPu: Float64Array.from(pPoiPu).subarray(0, n),
      freqHz: Float64Array.from(freqHz).subarray(0, n),
    },
  };

  const ovRes = StlMonitor.evaluate(StlMonitor.always([t0, tEnd], StlMonitor.predicate("vPoiPu", "<=", 1.2)), trace);
  const recRes = StlMonitor.evaluate(
    StlMonitor.always([recStart, tEnd], StlMonitor.predicate("pPoiPu", ">=", 0.9)),
    trace,
  );
  const freqRes = StlMonitor.evaluate(
    StlMonitor.always(
      [t0, tEnd],
      StlMonitor.and(
        StlMonitor.predicate("freqHz", ">=", fNom - 1.2),
        StlMonitor.predicate("freqHz", "<=", fNom + 1.2),
      ),
    ),
    trace,
  );

  const diagnostics: PscadDiagnostic[] = [];
  const overallRobustness = Math.min(ovRes.robustness, recRes.robustness, freqRes.robustness);
  if (!ovRes.isSatisfied) {
    diagnostics.push({
      code: "M6083",
      rule: "ieee2800-stl-specification-synthesis",
      severity: "warning",
      message: `IEEE 2800 Clause 5.4.2 STL transient overvoltage (V <= 1.20 pu) violated (ρ=${ovRes.robustness.toFixed(4)} at t=${(ovRes.timeOfWorstViolation ?? 0).toFixed(3)} s).`,
    });
  }
  if (!recRes.isSatisfied) {
    diagnostics.push({
      code: "M6083",
      rule: "ieee2800-stl-specification-synthesis",
      severity: "warning",
      message: `IEEE 2800 Clause 7.2.2.3.5 STL active power recovery (P >= 0.90 pu post-recovery) violated (ρ=${recRes.robustness.toFixed(4)} at t=${(recRes.timeOfWorstViolation ?? recStart).toFixed(3)} s).`,
    });
  }
  if (!freqRes.isSatisfied) {
    diagnostics.push({
      code: "M6083",
      rule: "ieee2800-stl-specification-synthesis",
      severity: "warning",
      message: `IEEE 2800 Clause 7.3.2 STL frequency ride-through band violated (ρ=${freqRes.robustness.toFixed(4)} at t=${(freqRes.timeOfWorstViolation ?? 0).toFixed(3)} s).`,
    });
  }

  return {
    satisfied: ovRes.isSatisfied && recRes.isSatisfied && freqRes.isSatisfied,
    overallRobustness,
    vOvervoltageRho: ovRes.robustness,
    pRecoveryRho: recRes.robustness,
    freqRho: freqRes.robustness,
    diagnostics,
  };
}
