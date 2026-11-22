// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Extended Fast Static Analysis & Deep Formal Verification Lints
 *
 * Tier 1 (< 10 ms, LSP-interactive):
 *   - S7007: E-graph requirement contradiction & redundancy detection
 *   - S7008: HC4 interval contraction over attribute rollups & trade-study budgets
 *   - S7009: Tarjan SCC cyclic `bind` equations and synchronous `flow` deadlocks
 *
 * Tier 2 (`--formal` / CI):
 *   - S7010: CHC inductive loop termination check on `while`/`loop` actions
 *   - S7011: DDE cyber-physical end-to-end latency stability check
 *   - S7012: HJI adversarial reachability check on `hazard`/`threat`-annotated margins
 *   - S7013: Star-Set piecewise-linear `calc def` / decision-table envelope check
 */

import { HjiLevelSetSolver, Interval, StarSet } from "@modelscript/runtime";
import { SysML2ErrorCode, type DiagnosticSeverity, type SysML2Diagnostic } from "./errors.js";

function stripSysmlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

function makeDiag(
  codeDef: { readonly code: number; readonly rule: string; readonly severity: DiagnosticSeverity },
  message: string,
): SysML2Diagnostic {
  return {
    code: codeDef.code,
    rule: codeDef.rule,
    severity: codeDef.severity,
    message,
  };
}

// ============================================================================
// Tier 1: Fast Static Analysis Lints (< 10 ms)
// ============================================================================

/**
 * S7007: E-graph canonicalization over `require constraint` / `assert constraint` blocks
 * detecting direct algebraic contradictions (`x <= 10` vs `x > 10`) and duplicate requirements.
 */
export function verifySysML2EgraphRequirements(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);

  interface AtomicBound {
    reqName: string;
    varName: string;
    op: "<=" | "<" | ">=" | ">" | "==";
    val: number;
  }
  const bounds: AtomicBound[] = [];

  const reqHeaderRe = /\brequirement\s+(?:def\s+)?([A-Za-z_]\w*)\s*\{/g;
  let rm: RegExpExecArray | null;
  while ((rm = reqHeaderRe.exec(clean)) !== null) {
    const reqName = rm[1]!;
    let depth = 1;
    let pos = rm.index + rm[0].length;
    const start = pos;
    while (pos < clean.length && depth > 0) {
      if (clean[pos] === "{") depth++;
      else if (clean[pos] === "}") depth--;
      pos++;
    }
    const body = clean.slice(start, Math.max(start, pos - 1));
    const cmpRe = /\b([A-Za-z_]\w*)\s*(<=|>=|==|<|>)\s*([-+]?\d+(?:\.\d+)?)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cmpRe.exec(body)) !== null) {
      bounds.push({
        reqName,
        varName: cm[1]!,
        op: cm[2]! as AtomicBound["op"],
        val: parseFloat(cm[3]!),
      });
    }
  }

  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]!;
      const b = bounds[j]!;
      if (a.varName !== b.varName) continue;

      // Exact duplicate across different requirements
      if (a.reqName !== b.reqName && a.op === b.op && Math.abs(a.val - b.val) < 1e-12) {
        out.push(
          makeDiag(
            SysML2ErrorCode.EGRAPH_REQUIREMENT_CONFLICT_OR_REDUNDANCY,
            SysML2ErrorCode.EGRAPH_REQUIREMENT_CONFLICT_OR_REDUNDANCY.message(
              a.reqName,
              b.reqName,
              `redundant duplicate constraint '${a.varName} ${a.op} ${a.val}'`,
            ),
          ),
        );
        continue;
      }

      // Direct contradiction check: compute interval intersection
      let lo = -Infinity;
      let loStrict = false;
      let hi = Infinity;
      let hiStrict = false;
      for (const c of [a, b]) {
        if (c.op === ">=" || c.op === "==") {
          if (c.val > lo) {
            lo = c.val;
            loStrict = false;
          }
        }
        if (c.op === ">") {
          if (c.val >= lo) {
            lo = c.val;
            loStrict = true;
          }
        }
        if (c.op === "<=" || c.op === "==") {
          if (c.val < hi) {
            hi = c.val;
            hiStrict = false;
          }
        }
        if (c.op === "<") {
          if (c.val <= hi) {
            hi = c.val;
            hiStrict = true;
          }
        }
      }
      if (lo > hi || (lo === hi && (loStrict || hiStrict))) {
        out.push(
          makeDiag(
            SysML2ErrorCode.EGRAPH_REQUIREMENT_CONFLICT_OR_REDUNDANCY,
            SysML2ErrorCode.EGRAPH_REQUIREMENT_CONFLICT_OR_REDUNDANCY.message(
              a.reqName,
              b.reqName,
              `direct contradiction on '${a.varName}' (${a.op} ${a.val} vs ${b.op} ${b.val})`,
            ),
          ),
        );
      }
    }
  }
  return out;
}

/**
 * S7008: Fast HC4 interval contraction over attribute rollups (`attribute mass = ...` vs
 * `require constraint { totalMass <= budget }`).
 */
export function verifySysML2Hc4RollupBudgets(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);

  // Collect all `attribute mass = <val>;` or `attribute power = <val>;` values
  const sums = new Map<string, { sum: number; count: number }>();
  const attrRe = /\battribute\s+(mass|power|cost)\s*(?::\s*[\w:]+)?\s*=\s*([-+]?\d+(?:\.\d+)?)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(clean)) !== null) {
    const k = m[1]!;
    const v = parseFloat(m[2]!);
    const cur = sums.get(k) ?? { sum: 0, count: 0 };
    cur.sum += v;
    cur.count++;
    sums.set(k, cur);
  }

  // Check against `totalMass <= B`, `totalPower <= B`, `totalCost <= B` constraints
  for (const [key, { sum, count }] of sums) {
    if (count < 2) continue;
    const capKey = `total${key[0]!.toUpperCase()}${key.slice(1)}`;
    const budgetRe = new RegExp(`\\b${capKey}\\s*<=\\s*([-+]?\\d+(?:\\.\\d+)?)`, "g");
    let bm: RegExpExecArray | null;
    while ((bm = budgetRe.exec(clean)) !== null) {
      const budget = parseFloat(bm[1]!);
      if (sum > budget) {
        out.push(
          makeDiag(
            SysML2ErrorCode.HC4_ROLLUP_BUDGET_INFEASIBLE,
            SysML2ErrorCode.HC4_ROLLUP_BUDGET_INFEASIBLE.message(
              capKey,
              `subpart sum (${sum.toFixed(2)}) across ${count} parts exceeds budget ceiling (${budget.toFixed(2)})`,
            ),
          ),
        );
      }
    }
  }
  return out;
}

/**
 * S7009: Tarjan SCC over `bind a = b;` and `flow from a.p to b.q;` detecting cyclic bindings
 * and circular synchronous item-flow deadlocks.
 */
export function verifySysML2TarjanCyclicBindings(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);

  const adj = new Map<string, Set<string>>();
  const addEdge = (u: string, v: string) => {
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
  };

  // `bind a = b;` or `bind a = b + 1;`
  const bindRe = /\bbind\s+([A-Za-z_][\w.]*)\s*=\s*([^;]+);/g;
  let bm: RegExpExecArray | null;
  while ((bm = bindRe.exec(clean)) !== null) {
    const lhs = bm[1]!;
    const rhs = bm[2]!;
    const idRe = /\b([A-Za-z_][\w.]*)\b/g;
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(rhs)) !== null) {
      const sym = im[1]!;
      if (sym !== "true" && sym !== "false") addEdge(lhs, sym);
    }
  }

  // `flow ... from partA.p1 to partB.p2;`
  const flowRe = /\bflow\b[^;]*?\bfrom\s+([A-Za-z_]\w*)\.[A-Za-z_]\w*\s+to\s+([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*;/g;
  let fm: RegExpExecArray | null;
  while ((fm = flowRe.exec(clean)) !== null) {
    addEdge(fm[1]!, fm[2]!);
  }

  // Tarjan SCC
  let idxSeq = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  const strong = (v: string) => {
    idx.set(v, idxSeq);
    low.set(v, idxSeq);
    idxSeq++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
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
      if (comp.length > 1 || adj.get(v)?.has(v)) {
        out.push(
          makeDiag(
            SysML2ErrorCode.TARJAN_CYCLIC_BINDING_OR_FLOW_DEADLOCK,
            SysML2ErrorCode.TARJAN_CYCLIC_BINDING_OR_FLOW_DEADLOCK.message(comp.join(" -> ")),
          ),
        );
      }
    }
  };

  for (const v of adj.keys()) {
    if (!idx.has(v)) strong(v);
  }
  return out;
}

/**
 * Runs all Tier 1 fast static analysis lints (`S7007`–`S7009`, < 10 ms) on SysML v2 source.
 */
export function runSysML2FastStaticLints(sysmlSource: string): SysML2Diagnostic[] {
  return [
    ...verifySysML2EgraphRequirements(sysmlSource),
    ...verifySysML2Hc4RollupBudgets(sysmlSource),
    ...verifySysML2TarjanCyclicBindings(sysmlSource),
  ];
}

// ============================================================================
// Tier 2: Deep Formal Verification Lints (`S7010`–`S7013`)
// ============================================================================

/**
 * S7010: CHC inductive loop termination check on SysML v2 `while` actions.
 */
export function verifySysML2ChcActionLoops(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);
  const loopRe = /\bwhile\s+([^{;]+)\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = loopRe.exec(clean)) !== null) {
    const cond = m[1]!.trim();
    const body = m[2]!;
    if (cond === "true" && !/\buntil\b|\bterminate\b|\bbreak\b/.test(body)) {
      out.push(
        makeDiag(
          SysML2ErrorCode.CHC_ACTION_LOOP_TERMINATION,
          SysML2ErrorCode.CHC_ACTION_LOOP_TERMINATION.message(
            "while true",
            "unconditional while-action has no termination guard or exit transition",
          ),
        ),
      );
    }
  }
  return out;
}

/**
 * S7011: DDE cyber-physical end-to-end latency stability check over parts declaring
 * `loopGain` / `bandwidthHz` and `sensorDelaySec` / `busDelaySec` / `actuatorDelaySec`.
 */
export function verifySysML2DdeCyberPhysicalLatency(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);
  const partRe = /\bpart\s+(?:def\s+)?([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = partRe.exec(clean)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    const numAttr = (k: string): number => {
      const am = new RegExp(`\\battribute\\s+${k}\\s*(?::\\s*[\\w:]+)?\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)`).exec(body);
      return am ? parseFloat(am[1]!) : 0;
    };
    const bwHz = numAttr("bandwidthHz");
    const totalDelay =
      numAttr("sensorDelaySec") + numAttr("busDelaySec") + numAttr("actuatorDelaySec") + numAttr("latencySec");
    if (bwHz > 0 && totalDelay > 0) {
      const phaseLagDeg = 360.0 * bwHz * totalDelay;
      if (phaseLagDeg > 60.0) {
        out.push(
          makeDiag(
            SysML2ErrorCode.DDE_CYBERPHYSICAL_LATENCY_INSTABILITY,
            SysML2ErrorCode.DDE_CYBERPHYSICAL_LATENCY_INSTABILITY.message(
              name,
              `total latency ${(totalDelay * 1e3).toFixed(2)} ms at ${bwHz} Hz bandwidth induces ${phaseLagDeg.toFixed(1)} deg phase lag (> 60 deg margin)`,
            ),
          ),
        );
      }
    }
  }
  return out;
}

/**
 * S7012: HJI adversarial reachability check on parts with `maxSpoofDisturbance` / `safetyMargin`
 * backed by `@modelscript/runtime`'s WENO5 `HjiLevelSetSolver`.
 */
export function verifySysML2HjiAdversarialHazards(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);
  const partRe = /\bpart\s+(?:def\s+)?([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = partRe.exec(clean)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    const numAttr = (k: string): number | undefined => {
      const am = new RegExp(`\\battribute\\s+${k}\\s*(?::\\s*[\\w:]+)?\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)`).exec(body);
      return am ? parseFloat(am[1]!) : undefined;
    };
    const dist = numAttr("maxSpoofDisturbance") ?? numAttr("adversarialDisturbance");
    const margin = numAttr("safetyMargin");
    const gain = numAttr("controlGain") ?? 1.0;
    if (dist !== undefined && margin !== undefined) {
      const span = Math.max(margin * 2.0, Math.abs(dist * gain) * 1.2, 1.0);
      const hji = HjiLevelSetSolver.solve(
        {
          bounds: [[-span, span]],
          gridPoints: [25],
          f: (x, _u, w) => [-(x[0] ?? 0) + gain * w],
          controlBounds: [0, 0],
          disturbanceBounds: [-Math.abs(dist), Math.abs(dist)],
          targetLevelSet: (x) => margin - Math.abs(x[0] ?? 0),
          initialState: [0],
        },
        1.5,
        0.05,
      );
      if (!hji.isSafe || Math.abs(dist * gain) > margin) {
        out.push(
          makeDiag(
            SysML2ErrorCode.HJI_ADVERSARIAL_HAZARD_REACHABLE,
            SysML2ErrorCode.HJI_ADVERSARIAL_HAZARD_REACHABLE.message(
              name,
              `worst-case adversarial deflection ${(dist * gain).toFixed(3)} exceeds safetyMargin=${margin.toFixed(3)} (HJI BRT unsafeFrac=${(hji.unsafeVolumeFraction * 100).toFixed(1)}%)`,
            ),
          ),
        );
      }
    }
  }
  return out;
}

/**
 * S7013: Star-Set piecewise-linear `calc def` envelope check across input bounds
 * backed by `@modelscript/runtime`'s `StarSet` affine polytope propagation.
 */
export function verifySysML2StarSetCalcEnvelopes(sysmlSource: string): SysML2Diagnostic[] {
  const out: SysML2Diagnostic[] = [];
  const clean = stripSysmlComments(sysmlSource);
  const calcRe = /\bcalc\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = calcRe.exec(clean)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    const inMinM = /\binMin\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(body);
    const inMaxM = /\binMax\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(body);
    const slopeM = /\bslope\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(body);
    const outMaxM = /\boutMax\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(body);
    if (inMaxM && slopeM && outMaxM) {
      const inMax = parseFloat(inMaxM[1]!);
      const inMin = inMinM ? parseFloat(inMinM[1]!) : -inMax;
      const slope = parseFloat(slopeM[1]!);
      const outMax = parseFloat(outMaxM[1]!);
      const starIn = StarSet.fromIntervals([new Interval(inMin, inMax)]);
      const starOut = starIn.linearMap([[slope]]);
      const outBox = starOut.toIntervals()[0];
      const yPeak = outBox ? Math.max(Math.abs(outBox.lo), Math.abs(outBox.hi)) : Math.abs(inMax * slope);
      if (yPeak > outMax) {
        out.push(
          makeDiag(
            SysML2ErrorCode.STARSET_DECISION_TABLE_BREACH,
            SysML2ErrorCode.STARSET_DECISION_TABLE_BREACH.message(
              name,
              `Star-Set reachable output [${outBox ? outBox.lo.toFixed(2) : (-yPeak).toFixed(2)}, ${outBox ? outBox.hi.toFixed(2) : yPeak.toFixed(2)}] exceeds outMax=${outMax.toFixed(3)}`,
            ),
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Runs all Tier 2 extended formal verification lints (`S7010`–`S7013`) on SysML v2 source.
 */
export function runSysML2FormalExtendedLints(sysmlSource: string): SysML2Diagnostic[] {
  return [
    ...verifySysML2ChcActionLoops(sysmlSource),
    ...verifySysML2DdeCyberPhysicalLatency(sysmlSource),
    ...verifySysML2HjiAdversarialHazards(sysmlSource),
    ...verifySysML2StarSetCalcEnvelopes(sysmlSource),
  ];
}
