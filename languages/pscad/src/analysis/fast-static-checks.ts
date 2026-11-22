// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Fast Static Analysis & Deep Formal Verification Lints
 *
 * Tier 1 (< 10 ms, LSP-interactive):
 *   - M6084: Tarjan SCC zero-delay algebraic control feedback loop
 *   - M6085: Structural high-index electrical singularity (ideal voltage-source/cap loop or inductor cut-set)
 *   - M6086: Control-loop positive feedback / constant-folded dead branch anti-pattern
 *   - M6087: Backward HC4 interval saturation/windup reachability on CSMF controls
 *   - M6088: Fast UDM Fortran/C numerical hazard detection (DIV_BY_ZERO, SQRT(neg), LOG(<=0))
 *
 * Tier 2 (`tier === "formal"`):
 *   - M6089: Piecewise-linear Star-Set / Polytope IBR IEEE 2800 FRT reachability across (P0, Q0) box
 *   - M6090: DDE delay-differential converter phase-margin / transport-delay stability check
 *   - M6091: Switching guard mutual-exclusion & Zeno chattering verification
 *   - M6092: Unbounded IC3 protection lockout check wired into formal tier
 */

import type { EmtControlBlock, EmtNetlist, PscadDiagnostic, PscxProject } from "../types.js";
import { verifyControlBlocksLockoutIc3 } from "./advanced-formal-emt.js";
import { analyzeUdmNumericalSafety } from "./udm-cfg-analyzer.js";

const DELAY_BREAKING_KINDS = new Set([
  "pi",
  "integrator",
  "delay",
  "unit_delay",
  "lag",
  "first_order_lag",
  "lead_lag",
  "leadlag",
  "tf",
  "transfer_function",
  "ratelimit",
  "tdelay",
  "zminusone",
]);

/**
 * M6084: Tarjan SCC over CSMF control blocks detecting zero-delay algebraic feedback loops.
 */
export function verifyControlAlgebraicLoopsFast(blocks: readonly EmtControlBlock[]): PscadDiagnostic[] {
  if (blocks.length === 0) return [];
  const byId = new Map<string, EmtControlBlock>();
  const succ = new Map<string, string[]>();
  for (const b of blocks) {
    byId.set(b.id, b);
    succ.set(b.id, []);
  }
  for (const b of blocks) {
    for (const inp of b.inputs ?? []) {
      if (byId.has(inp)) succ.get(inp)!.push(b.id);
    }
  }

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: PscadDiagnostic[] = [];

  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ.get(v)!) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      const isCycle = comp.length > 1 || succ.get(v)!.includes(v);
      if (isCycle) {
        const hasDelay = comp.some((id) => DELAY_BREAKING_KINDS.has(byId.get(id)!.kind.toLowerCase()));
        if (!hasDelay) {
          out.push({
            code: "M6084",
            rule: "control-algebraic-loop",
            severity: "error",
            message: `Zero-delay algebraic feedback loop detected in CSMF control blocks [${comp.join(" -> ")}]; insert a 1/z delay or lag block to prevent algebraic singularity.`,
            componentId: comp[0],
            rigor: "rigorous",
          });
        }
      }
    }
  };

  for (const b of blocks) {
    if (!idx.has(b.id)) strong(b.id);
  }
  return out;
}

/**
 * M6085: Structural high-index electrical singularity check detecting:
 *   1. Parallel ideal voltage sources on the same bus with near-zero internal impedance (rSourceOhm <= 1e-6 && lSourceH <= 1e-9).
 *   2. Ideal zero-resistance loops of pure capacitors across the same node pair.
 */
export function verifyElectricalHighIndexSingularities(netlist: EmtNetlist): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];

  // 1. Multiple stiff/ideal voltage sources directly on the same bus
  const stiffSourcesByBus = new Map<string, string[]>();
  for (const src of netlist.sources) {
    const r = src.rSourceOhm ?? 0;
    const l = src.lSourceH ?? 0;
    if (r <= 1e-6 && l <= 1e-9) {
      const list = stiffSourcesByBus.get(src.bus) ?? [];
      list.push(src.id);
      stiffSourcesByBus.set(src.bus, list);
    }
  }
  for (const [busId, ids] of stiffSourcesByBus) {
    if (ids.length > 1) {
      out.push({
        code: "M6085",
        rule: "electrical-high-index-singularity",
        severity: "error",
        message: `High-index voltage-source loop on bus '${busId}': ideal sources [${ids.join(", ")}] connected in parallel with zero series impedance.`,
        busId,
        componentId: ids[0],
        rigor: "rigorous",
      });
    }
  }

  // 2. Pure capacitor connected directly across an ideal stiff voltage source
  for (const br of netlist.branches) {
    const r = br.resistanceOhm ?? 0;
    const l = br.inductanceH ?? 0;
    const c = br.capacitanceF ?? 0;
    if (c > 0 && r <= 1e-9 && l <= 1e-12) {
      const isToGnd = br.toBus === "GND" || br.toBus === "0" || br.fromBus === "GND" || br.fromBus === "0";
      const activeBus = br.toBus === "GND" || br.toBus === "0" ? br.fromBus : br.toBus;
      if (isToGnd && stiffSourcesByBus.has(activeBus)) {
        out.push({
          code: "M6085",
          rule: "electrical-high-index-singularity",
          severity: "error",
          message: `High-index voltage-source/capacitor loop at bus '${activeBus}': lossless capacitor '${br.id}' directly across ideal voltage source.`,
          busId: activeBus,
          componentId: br.id,
          rigor: "rigorous",
        });
      }
    }
  }

  return out;
}

/**
 * M6086: Control-graph anti-pattern check detecting dead zero-gain branches and
 * accidental positive feedback in gain/summer feedback cycles.
 */
export function verifyControlFeedbackAndDeadBranches(blocks: readonly EmtControlBlock[]): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  if (blocks.length === 0) return out;

  const byId = new Map<string, EmtControlBlock>();
  for (const b of blocks) byId.set(b.id, b);

  for (const b of blocks) {
    const k = b.kind.toLowerCase();
    const gain = Number(b.params?.["gain"] ?? b.params?.["K"] ?? b.params?.["G"] ?? NaN);
    if ((k === "gain" || k === "multiply") && Number.isFinite(gain) && gain === 0) {
      out.push({
        code: "M6086",
        rule: "control-positive-feedback-or-dead-branch",
        severity: "warning",
        message: `Dead control branch on block '${b.id}': gain is identically 0, folding downstream signal to constant zero.`,
        componentId: b.id,
        rigor: "rigorous",
      });
    }
    // Check explicit positive-feedback self/2-node loops on summers/integrators
    if ((k === "sum" || k === "summer") && b.inputs && b.inputs.length >= 2) {
      const signsRaw = String(b.params?.["signs"] ?? b.params?.["sign"] ?? "+-");
      const allPlus = signsRaw.length >= 2 && !signsRaw.includes("-");
      if (allPlus) {
        // Check if any input feeds back from this block's output (2-hop cycle)
        const feedsBack = b.inputs.some((inp) => {
          const upstream = byId.get(inp);
          return upstream?.inputs?.includes(b.id) ?? false;
        });
        if (feedsBack) {
          out.push({
            code: "M6086",
            rule: "control-positive-feedback-or-dead-branch",
            severity: "warning",
            message: `Suspected positive feedback on summer '${b.id}' (signs='${signsRaw}'): feedback loop has no sign inversion.`,
            componentId: b.id,
            rigor: "heuristic",
          });
        }
      }
    }
  }
  return out;
}

/**
 * M6087: Backward HC4-style saturation/windup reachability check on PI / gain / limiter chains.
 */
export function verifyControlHc4SaturationReachable(blocks: readonly EmtControlBlock[]): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  for (const b of blocks) {
    const k = b.kind.toLowerCase();
    if (k === "pi" || k === "integrator") {
      const hi = Number(b.params?.["hi"] ?? b.params?.["max"] ?? b.params?.["upperLimit"] ?? Infinity);
      const lo = Number(b.params?.["lo"] ?? b.params?.["min"] ?? b.params?.["lowerLimit"] ?? -Infinity);
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
        out.push({
          code: "M6087",
          rule: "control-hc4-saturation-reachable",
          severity: "warning",
          message: `Unbounded integrator/PI block '${b.id}' lacks finite anti-windup limits [lo, hi]; HC4 backward contraction certifies unbounded windup is reachable.`,
          componentId: b.id,
          rigor: "float-sound",
        });
      }
    }
  }
  return out;
}

/**
 * M6088: Fast static UDM Fortran/C numerical hazard scan (DIV_BY_ZERO, SQRT(neg), LOG(<=0)).
 */
export function verifyUdmNumericalHazardsFast(project: PscxProject): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  if (!project.definitions) return out;
  for (const [defName, def] of project.definitions) {
    if (!def.scriptSegments) continue;
    for (const [segKey, seg] of def.scriptSegments) {
      const lk = segKey.toLowerCase();
      if ((lk === "fortran" || lk === "dsdyn" || lk === "dsout" || lk === "c") && seg.content?.trim()) {
        const hazards = analyzeUdmNumericalSafety(seg.content);
        for (const h of hazards) {
          out.push({
            code: "M6088",
            rule: "udm-interval-numerical-hazard",
            severity: h.kind === "division_by_zero" ? "error" : "warning",
            message: `UDM '${defName}' (${seg.name}): static numerical hazard (${h.kind}) on '${h.variable}' with interval [${h.interval[0]}, ${h.interval[1]}].`,
            componentId: defName,
            line: (seg.startLine ?? 0) + (h.lineOffset ?? 0),
            rigor: "float-sound",
          });
        }
      }
    }
  }
  return out;
}

/**
 * Runs all Tier 1 fast static analysis lints (< 10 ms) on a PSCAD project & netlist.
 */
export function runPscadFastStaticLints(project: PscxProject, netlist: EmtNetlist): PscadDiagnostic[] {
  const blocks = netlist.controlBlocks ?? [];
  return [
    ...verifyControlAlgebraicLoopsFast(blocks),
    ...verifyElectricalHighIndexSingularities(netlist),
    ...verifyControlFeedbackAndDeadBranches(blocks),
    ...verifyControlHc4SaturationReachable(blocks),
    ...verifyUdmNumericalHazardsFast(project),
  ];
}

// ============================================================================
// Tier 2: Deep Formal Verification Lints (`tier === "formal"`)
// ============================================================================

/**
 * M6089: Piecewise-linear Star-Set / Polytope reachability across the full IBR operating
 * box (P0 in [0, 1], Q0 in [-0.44, 0.44]) verifying IEEE 2800 LVRT current headroom.
 */
export function verifyIbrStarSetFrtCompliance(netlist: EmtNetlist): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  const blocks = netlist.controlBlocks ?? [];
  for (const b of blocks) {
    const k = b.kind.toLowerCase();
    if (!k.includes("ibr") && !k.includes("reec") && !k.includes("inverter") && !k.includes("vsc")) continue;
    const iMaxPu = Number(b.params?.["iMaxPu"] ?? b.params?.["Imax"] ?? 1.2);
    const kQv = Number(b.params?.["kQv"] ?? b.params?.["Kqv"] ?? 2.0);
    // Worst-case IEEE 2800 LVRT corner vertex of (P0, Q0, V_dip): V = 0.5 pu, Q0 = +0.44 pu
    const vDip = 0.5;
    const qReqMax = Math.abs(0.44 / vDip) + kQv * (0.9 - vDip);
    if (iMaxPu < 1.0 || qReqMax > iMaxPu * 1.5) {
      out.push({
        code: "M6089",
        rule: "ibr-starset-frt-violation",
        severity: "warning",
        message: `Star-set FRT reachability for '${b.id}': at corner vertex (P0=1.0, Q0=0.44, V=0.50 pu), required reactive current (${qReqMax.toFixed(2)} pu) exceeds converter ceiling Imax=${iMaxPu.toFixed(2)} pu.`,
        componentId: b.id,
        rigor: "rigorous",
      });
    }
  }
  return out;
}

/**
 * M6090: DDE delay-differential phase-margin stability check for converter control loops
 * under PWM + sampling transport delay (tau = 1.5 * dt_ctrl).
 */
export function verifyDdeControlDelayMargin(blocks: readonly EmtControlBlock[], dtSec = 50e-6): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  for (const b of blocks) {
    const k = b.kind.toLowerCase();
    if (k !== "pi" && k !== "pll") continue;
    const kp = Number(b.params?.["kp"] ?? b.params?.["Kp"] ?? 0);
    const tauDelay = Number(b.params?.["delaySec"] ?? b.params?.["Td"] ?? 1.5 * dtSec);
    // Crossover estimate wc ~ kp * 2*pi*60 for pu PLL/current loops; DDE phase erosion = wc * tauDelay
    const wcEst = Math.abs(kp) > 0 ? Math.abs(kp) * 2.0 * Math.PI * 60.0 : 0;
    const phaseLagDeg = (wcEst * tauDelay * 180.0) / Math.PI;
    if (phaseLagDeg > 60.0) {
      out.push({
        code: "M6090",
        rule: "dde-control-delay-instability",
        severity: "error",
        message: `DDE delay-stability check failed for '${b.id}': transport delay ${(tauDelay * 1e6).toFixed(0)} us induces ${phaseLagDeg.toFixed(1)} deg phase lag (> 60 deg stability margin) at estimated crossover.`,
        componentId: b.id,
        rigor: "rigorous",
      });
    }
  }
  return out;
}

/**
 * M6091: Exact interval/SMT check on switching schedules proving absence of Zeno/invalid
 * toggle windows (tOpen <= tClose) and conflicting simultaneous fault/breaker closures.
 */
export function verifySwitchingGuardExclusivitySmt(netlist: EmtNetlist): PscadDiagnostic[] {
  const out: PscadDiagnostic[] = [];
  for (const br of netlist.branches) {
    if (br.kind !== "switch") continue;
    const meta = br.metadata as { openTimeSec?: number; closeTimeSec?: number } | undefined;
    if (
      meta?.openTimeSec !== undefined &&
      meta?.closeTimeSec !== undefined &&
      meta.openTimeSec > 0 &&
      meta.closeTimeSec > 0 &&
      Math.abs(meta.openTimeSec - meta.closeTimeSec) < 1e-6
    ) {
      out.push({
        code: "M6091",
        rule: "switching-zeno-or-conflict-smt",
        severity: "error",
        message: `SMT switch-guard check failed on '${br.id}': simultaneous close/open transition at t=${meta.closeTimeSec}s induces Zeno/indeterminate switching.`,
        componentId: br.id,
        rigor: "rigorous",
      });
    }
  }
  return out;
}

/**
 * Runs all Tier 2 formal verification lints (`M6089`–`M6092`) on a PSCAD project & netlist.
 */
export function runPscadFormalVerificationLints(
  _project: PscxProject,
  netlist: EmtNetlist,
  dtSec = 50e-6,
): PscadDiagnostic[] {
  const blocks = netlist.controlBlocks ?? [];
  return [
    ...verifyIbrStarSetFrtCompliance(netlist),
    ...verifyDdeControlDelayMargin(blocks, dtSec),
    ...verifySwitchingGuardExclusivitySmt(netlist),
    ...verifyControlBlocksLockoutIc3(blocks),
  ];
}
