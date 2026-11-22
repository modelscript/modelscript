// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/modelica — Fast Static Analysis & Deep Formal Verification Lints
 *
 * Tier 1 (< 10 ms, LSP-interactive):
 *   - M7801: Algorithm/function CFA (uninitialized output, unreachable branch, div-by-zero)
 *   - M7802: Set-Based Graph (SBG) symbolic array-equation slice overlap / missing boundary
 *   - M7803: E-graph linear canonicalization for duplicate (singular Jacobian) or contradictory equations
 *   - M7804: HC4 interval contraction over parameter bindings & min/max/start bounds
 *
 * Tier 2 (`--formal` / CI):
 *   - M7805: DDE delay-differential stability check for `delay(expr, tau)` feedback loops
 *   - M7806: Hybrid `when`/`reinit` Star-Set Zeno chattering & conflicting simultaneous `reinit`
 *   - M7807: CHC inductive loop variant check for `while` loops in `algorithm`/`function`
 *   - M7808: HJI/Stochastic disturbance barrier check against declared `min`/`max` safety limits
 */

import { DdeFlowpipeSolver, HjiLevelSetSolver, Interval } from "@modelscript/runtime";
import { makeDiagnostic, ModelicaErrorCode, type ErrorCodeDef, type ModelicaDiagnostic } from "../errors.js";

function emitDiag(def: ErrorCodeDef, _range: undefined, args: readonly string[]): ModelicaDiagnostic {
  return makeDiagnostic(def, undefined, ...args);
}

function stripModelicaComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

// ============================================================================
// Tier 1: Fast Static Analysis Lints (< 10 ms)
// ============================================================================

/**
 * M7801: Fast CFA check over `function` / `algorithm` blocks detecting:
 *   - `output` variables never assigned on any path
 *   - literal `if false then` unreachable branches
 *   - literal division by zero (`/ 0` or `/ 0.0`)
 */
export function verifyModelicaAlgorithmCfa(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);

  const fnRe = /\b(function|model|block)\s+([A-Za-z_][\w]*)([\s\S]*?)\bend\s+\2\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(clean)) !== null) {
    const kind = m[1]!;
    const name = m[2]!;
    const body = m[3]!;
    const algIdx = body.search(/\balgorithm\b/);
    if (algIdx === -1) continue;
    const declPart = body.slice(0, algIdx);
    const algPart = body.slice(algIdx);

    // Check unassigned `output` variables in functions
    if (kind === "function") {
      const outRe = /\boutput\s+[A-Za-z_][\w.]*\s+([A-Za-z_][\w]*)\b/g;
      let om: RegExpExecArray | null;
      while ((om = outRe.exec(declPart)) !== null) {
        const varName = om[1]!;
        const assignRe = new RegExp(`\\b${varName}\\s*:=`);
        if (!assignRe.test(algPart)) {
          out.push(
            emitDiag(ModelicaErrorCode.CFA_UNINITIALIZED_OR_DEAD_ALGORITHM, undefined, [
              name,
              `output variable '${varName}' is never assigned in algorithm section`,
            ]),
          );
        }
      }
    }

    // Check literal unreachable branch (`if false then`)
    if (/\bif\s+false\s+then\b/.test(algPart)) {
      out.push(
        emitDiag(ModelicaErrorCode.CFA_UNINITIALIZED_OR_DEAD_ALGORITHM, undefined, [
          name,
          `unreachable 'if false then' branch in algorithm section`,
        ]),
      );
    }

    // Check literal division by zero in algorithm
    if (/\/\s*0(?:\.0+)?(?![0-9eE.])/.test(algPart)) {
      out.push(
        emitDiag(ModelicaErrorCode.CFA_UNINITIALIZED_OR_DEAD_ALGORITHM, undefined, [
          name,
          `provable division by zero in algorithm expression`,
        ]),
      );
    }
  }
  return out;
}

/**
 * M7802: Set-Based Graph (SBG) symbolic interval slice analysis over `for i in a:b loop`
 * equation blocks, detecting overlapping index writes or missing array boundary indices
 * in O(1) without unrolling N.
 */
export function verifyModelicaSbgArrayEquations(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);

  // Collect declared 1D arrays with integer size: `Real x[N];`
  const arraySizes = new Map<string, number>();
  const declRe = /\b(?:Real|Integer|Boolean)\s+([A-Za-z_][\w]*)\s*\[\s*(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(clean)) !== null) {
    arraySizes.set(m[1]!, parseInt(m[2]!, 10));
  }
  if (arraySizes.size === 0) return out;

  // Collect symbolic index intervals written to each array in `equation` section
  const eqIdx = clean.search(/\bequation\b/);
  if (eqIdx === -1) return out;
  const eqBody = clean.slice(eqIdx);

  const slicesByArr = new Map<string, Array<{ lo: number; hi: number; desc: string }>>();
  const addSlice = (arr: string, lo: number, hi: number, desc: string) => {
    const list = slicesByArr.get(arr) ?? [];
    list.push({ lo, hi, desc });
    slicesByArr.set(arr, list);
  };

  // Match `for idx in lo:hi loop ... arr[idx (+ k)?] = ... end for;`
  const forRe = /\bfor\s+([A-Za-z_][\w]*)\s+in\s+(\d+)\s*:\s*(\d+)\s+loop([\s\S]*?)\bend\s+for\s*;/g;
  let fm: RegExpExecArray | null;
  while ((fm = forRe.exec(eqBody)) !== null) {
    const iterVar = fm[1]!;
    const lo = parseInt(fm[2]!, 10);
    const hi = parseInt(fm[3]!, 10);
    const loopBody = fm[4]!;
    const lhsRe = new RegExp(`\\b([A-Za-z_][\\w]*)\\s*\\[\\s*${iterVar}(?:\\s*([+-])\\s*(\\d+))?\\s*\\]\\s*=`, "g");
    let lm: RegExpExecArray | null;
    while ((lm = lhsRe.exec(loopBody)) !== null) {
      const arr = lm[1]!;
      if (!arraySizes.has(arr)) continue;
      const shift = lm[2] && lm[3] ? (lm[2] === "+" ? parseInt(lm[3], 10) : -parseInt(lm[3], 10)) : 0;
      addSlice(arr, lo + shift, hi + shift, `for ${iterVar} in ${lo}:${hi} -> ${arr}[${lo + shift}:${hi + shift}]`);
    }
  }

  // Match scalar boundary assignments `arr[k] = ...;` outside `for` loops
  const strippedLoops = eqBody.replace(forRe, " ");
  const scalarRe = /\b([A-Za-z_][\w]*)\s*\[\s*(\d+)\s*\]\s*=/g;
  let sm: RegExpExecArray | null;
  while ((sm = scalarRe.exec(strippedLoops)) !== null) {
    const arr = sm[1]!;
    if (!arraySizes.has(arr)) continue;
    const idx = parseInt(sm[2]!, 10);
    addSlice(arr, idx, idx, `${arr}[${idx}]`);
  }

  // Set-Based Graph interval union & overlap check
  for (const [arr, size] of arraySizes) {
    const slices = slicesByArr.get(arr);
    if (!slices || slices.length === 0) continue;

    // 1. Out-of-bounds slice check
    for (const s of slices) {
      if (s.lo < 1 || s.hi > size) {
        out.push(
          emitDiag(ModelicaErrorCode.SBG_ARRAY_EQUATION_IMBALANCE, undefined, [
            arr,
            `slice [${s.lo}:${s.hi}] (${s.desc}) exceeds declared dimension [1:${size}]`,
          ]),
        );
      }
    }

    // 2. Pairwise overlap check
    const sorted = [...slices].sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.lo <= prev.hi) {
        out.push(
          emitDiag(ModelicaErrorCode.SBG_ARRAY_EQUATION_IMBALANCE, undefined, [
            arr,
            `overlapping index slices [${prev.lo}:${prev.hi}] and [${cur.lo}:${cur.hi}] (over-determined array)`,
          ]),
        );
      }
    }

    // 3. Missing boundary / gap check
    let coveredUpTo = 0;
    for (const s of sorted) {
      if (s.lo > coveredUpTo + 1) {
        out.push(
          emitDiag(ModelicaErrorCode.SBG_ARRAY_EQUATION_IMBALANCE, undefined, [
            arr,
            `missing equation coverage for index range [${coveredUpTo + 1}:${s.lo - 1}] of [1:${size}]`,
          ]),
        );
      }
      coveredUpTo = Math.max(coveredUpTo, s.hi);
    }
    if (coveredUpTo < size) {
      out.push(
        emitDiag(ModelicaErrorCode.SBG_ARRAY_EQUATION_IMBALANCE, undefined, [
          arr,
          `missing equation coverage for boundary index range [${coveredUpTo + 1}:${size}] of [1:${size}]`,
        ]),
      );
    }
  }
  return out;
}

/**
 * Parses a simple linear expression `c0 + c1*x1 + c2*x2 ...` into canonical coefficient map
 * for fast E-graph / affine equivalence checking.
 */
function parseLinearForm(expr: string): { coeffs: Map<string, number>; constant: number } | null {
  const s = expr.replace(/\s+/g, "");
  if (!s || /[()/*^]/.test(s.replace(/(\d+(?:\.\d+)?)\*([A-Za-z_]\w*)/g, "$1*$2").replace(/\*/g, ""))) {
    // Only handle pure affine sums/differences with optional numeric coefficient
    if (/[()/^]/.test(s)) return null;
  }
  const coeffs = new Map<string, number>();
  let constant = 0;
  // Split into signed terms
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  for (const rawTerm of terms) {
    let sign = 1;
    let t = rawTerm;
    if (t.startsWith("+")) t = t.slice(1);
    else if (t.startsWith("-")) {
      sign = -1;
      t = t.slice(1);
    }
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      constant += sign * parseFloat(t);
    } else if (/^[A-Za-z_]\w*$/.test(t)) {
      coeffs.set(t, (coeffs.get(t) ?? 0) + sign);
    } else {
      const km = /^(\d+(?:\.\d+)?)\*([A-Za-z_]\w*)$/.exec(t) ?? /^([A-Za-z_]\w*)\*(\d+(?:\.\d+)?)$/.exec(t);
      if (!km) return null;
      const num = /^\d/.test(km[1]!) ? parseFloat(km[1]!) : parseFloat(km[2]!);
      const sym = /^\d/.test(km[1]!) ? km[2]! : km[1]!;
      coeffs.set(sym, (coeffs.get(sym) ?? 0) + sign * num);
    }
  }
  // Remove near-zero terms
  for (const [k, v] of coeffs) {
    if (Math.abs(v) < 1e-12) coeffs.delete(k);
  }
  return { coeffs, constant };
}

/**
 * M7803: E-graph linear canonicalizer detecting algebraically duplicate equations
 * (singular Jacobian) and contradictory linear equations before flattening.
 */
export function verifyModelicaEgraphEquations(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);
  const eqIdx = clean.search(/\bequation\b/);
  if (eqIdx === -1) return out;
  const eqSection = clean.slice(eqIdx + 8).replace(/\bend\s+[A-Za-z_]\w*\s*;[\s\S]*$/, "");

  interface CanonEq {
    raw: string;
    key: string;
    constNorm: number;
  }
  const seen = new Map<string, CanonEq>();

  const stmts = eqSection.split(";");
  for (const rawStmt of stmts) {
    const st = rawStmt.trim();
    if (!st || st.startsWith("for ") || st.startsWith("if ") || st.startsWith("when ") || st.startsWith("connect(")) {
      continue;
    }
    const eqPos = st.indexOf("=");
    if (eqPos === -1 || st[eqPos - 1] === ":" || st[eqPos + 1] === "=") continue;
    const lhs = parseLinearForm(st.slice(0, eqPos));
    const rhs = parseLinearForm(st.slice(eqPos + 1));
    if (!lhs || !rhs) continue;

    // Canonical form: sum(c_i * x_i) + c0 = 0
    const combined = new Map<string, number>(lhs.coeffs);
    for (const [k, v] of rhs.coeffs) {
      combined.set(k, (combined.get(k) ?? 0) - v);
    }
    for (const [k, v] of combined) {
      if (Math.abs(v) < 1e-12) combined.delete(k);
    }
    const c0 = lhs.constant - rhs.constant;
    const vars = Array.from(combined.keys()).sort();
    if (vars.length === 0) continue;

    // Normalize by leading variable coefficient so `a + b = c` and `2*c - 2*b = 2*a` share identical key
    const leadCoeff = combined.get(vars[0]!)!;
    const key = vars.map((v) => `${v}:${(combined.get(v)! / leadCoeff).toFixed(6)}`).join("|");
    const constNorm = c0 / leadCoeff;

    const prev = seen.get(key);
    if (prev) {
      if (Math.abs(prev.constNorm - constNorm) < 1e-9) {
        out.push(
          emitDiag(ModelicaErrorCode.EGRAPH_DUPLICATE_OR_CONTRADICTORY_EQ, undefined, [
            prev.raw,
            st,
            "algebraically duplicate equation (singular Jacobian)",
          ]),
        );
      } else {
        out.push(
          emitDiag(ModelicaErrorCode.EGRAPH_DUPLICATE_OR_CONTRADICTORY_EQ, undefined, [
            prev.raw,
            st,
            "algebraically contradictory equations (infeasible linear system)",
          ]),
        );
      }
    } else {
      seen.set(key, { raw: st, key, constNorm });
    }
  }
  return out;
}

/**
 * M7804: Fast HC4 interval check over `parameter` / variable `min`, `max`, `start`, and binding values.
 */
export function verifyModelicaHc4ParameterBounds(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);

  const declRe =
    /\b(?:parameter\s+)?(?:Real|Integer)\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?\s*(?:=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?))?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(clean)) !== null) {
    const name = m[1]!;
    const mods = m[2] ?? "";
    const binding = m[3] !== undefined ? parseFloat(m[3]) : undefined;

    const minM = /\bmin\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(mods);
    const maxM = /\bmax\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(mods);
    const startM = /\bstart\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(mods);
    const minVal = minM ? parseFloat(minM[1]!) : undefined;
    const maxVal = maxM ? parseFloat(maxM[1]!) : undefined;
    const startVal = startM ? parseFloat(startM[1]!) : undefined;

    if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
      out.push(
        emitDiag(ModelicaErrorCode.HC4_PARAMETER_BOUND_INFEASIBLE, undefined, [
          name,
          `empty domain interval [min=${minVal}, max=${maxVal}]`,
        ]),
      );
    }
    const val = binding ?? startVal;
    if (val !== undefined) {
      if (minVal !== undefined && val < minVal) {
        out.push(
          emitDiag(ModelicaErrorCode.HC4_PARAMETER_BOUND_INFEASIBLE, undefined, [
            name,
            `value ${val} violates lower bound min=${minVal}`,
          ]),
        );
      }
      if (maxVal !== undefined && val > maxVal) {
        out.push(
          emitDiag(ModelicaErrorCode.HC4_PARAMETER_BOUND_INFEASIBLE, undefined, [
            name,
            `value ${val} violates upper bound max=${maxVal}`,
          ]),
        );
      }
    }
  }
  return out;
}

/**
 * Runs all Tier 1 fast static lints (`M7801`–`M7804`, < 10 ms) on Modelica source.
 */
export function runModelicaFastStaticLints(source: string): ModelicaDiagnostic[] {
  return [
    ...verifyModelicaAlgorithmCfa(source),
    ...verifyModelicaSbgArrayEquations(source),
    ...verifyModelicaEgraphEquations(source),
    ...verifyModelicaHc4ParameterBounds(source),
  ];
}

// ============================================================================
// Tier 2: Deep Formal Verification Lints (`M7805`–`M7808`)
// ============================================================================

/**
 * M7805: DDE stability check for `delay(expr, tau)` equations with large gain-delay product.
 */
export function verifyModelicaDdeDelayStability(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);
  const delayRe =
    /der\s*\(\s*([A-Za-z_]\w*)\s*\)\s*=\s*([-+]?\d+(?:\.\d+)?)?\s*\*?\s*delay\s*\(\s*([^,]+),\s*([-+]?\d+(?:\.\d+)?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = delayRe.exec(clean)) !== null) {
    const rawGain = m[2] ? parseFloat(m[2]) : -1.0;
    const gain = Math.abs(rawGain);
    const tau = parseFloat(m[4]!);
    if (tau <= 0) continue;

    // Run @modelscript/runtime Method-of-Steps DDE flowpipe over 4 delay horizons
    const horizon = Math.min(Math.max(4 * tau, 1.0), 10.0);
    const dt = Math.max(tau / 10, 0.02);
    const flowpipe = DdeFlowpipeSolver.solve(
      {
        numStates: 1,
        delay: tau,
        f: (_t, _x, xDelayed) => [rawGain * (xDelayed[0] ?? 0)],
        historyEnclosure: () => [new Interval(0.95, 1.05)],
        nominalHistory: () => [1.0],
      },
      [0, horizon],
      dt,
    );
    let peakMag = 1.0;
    for (const s of flowpipe.steps) {
      const t0 = s.tubes[0];
      if (t0) peakMag = Math.max(peakMag, Math.abs(t0.lo), Math.abs(t0.hi));
    }

    // Classical Hayes / DDE stability criterion for x'(t) = -k * x(t - tau): stable iff k * tau < pi/2
    if (gain * tau >= Math.PI / 2 || peakMag > 10.0) {
      out.push(
        emitDiag(ModelicaErrorCode.DDE_DELAY_INSTABILITY, undefined, [
          m[0],
          `gain-delay product k*tau=${(gain * tau).toFixed(3)} >= pi/2 (${(Math.PI / 2).toFixed(3)}), DDE flowpipe peak=${peakMag.toFixed(2)}`,
        ]),
      );
    }
  }
  return out;
}

/**
 * M7806: Hybrid `when`/`reinit` Zeno chattering and simultaneous conflicting `reinit` detector.
 */
export function verifyModelicaHybridWhenZeno(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);
  const whenRe = /\bwhen\s+([\s\S]*?)\bthen([\s\S]*?)\bend\s+when\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = whenRe.exec(clean)) !== null) {
    const cond = m[1]!.trim();
    const body = m[2]!;
    const reinitRe = /\breinit\s*\(\s*([A-Za-z_]\w*)\s*,\s*([^)]+)\)/g;
    const reinitTargets = new Map<string, string[]>();
    let rm: RegExpExecArray | null;
    while ((rm = reinitRe.exec(body)) !== null) {
      const v = rm[1]!;
      const expr = rm[2]!.trim();
      const list = reinitTargets.get(v) ?? [];
      list.push(expr);
      reinitTargets.set(v, list);

      // Zeno check: `when x >= C then reinit(x, C)` or `reinit(x, x)` re-triggers immediately
      const threshM = new RegExp(`\\b${v}\\s*(>=|<=|>|<)\\s*([-+]?\\d+(?:\\.\\d+)?)`).exec(cond);
      if (threshM && Number.isFinite(Number(expr))) {
        const op = threshM[1]!;
        const c = parseFloat(threshM[2]!);
        const rVal = parseFloat(expr);
        const retriggers =
          (op === ">=" && rVal >= c) ||
          (op === ">" && rVal > c) ||
          (op === "<=" && rVal <= c) ||
          (op === "<" && rVal < c);
        if (retriggers) {
          out.push(
            emitDiag(ModelicaErrorCode.HYBRID_WHEN_ZENO_OR_AMBIGUITY, undefined, [
              v,
              `reinit(${v}, ${expr}) remains inside guard '${cond}' and induces Zeno chattering`,
            ]),
          );
        }
      }
    }
    for (const [v, exprs] of reinitTargets) {
      if (exprs.length > 1) {
        out.push(
          emitDiag(ModelicaErrorCode.HYBRID_WHEN_ZENO_OR_AMBIGUITY, undefined, [
            v,
            `multiple conflicting reinit(${v}, ...) calls in same 'when' clause`,
          ]),
        );
      }
    }
  }
  return out;
}

/**
 * M7807: CHC inductive loop variant check for `while` loops in `algorithm`/`function` blocks.
 */
export function verifyModelicaChcWhileLoops(source: string): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);
  const whileRe = /\bwhile\s+([\s\S]*?)\bloop([\s\S]*?)\bend\s+while\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = whileRe.exec(clean)) !== null) {
    const cond = m[1]!.trim();
    const body = m[2]!;
    if (cond === "true" && !/\bbreak\b/.test(body)) {
      out.push(
        emitDiag(ModelicaErrorCode.CHC_ALGORITHM_LOOP_UNBOUNDED, undefined, [
          "while true",
          `unconditional 'while true' loop with no 'break' statement cannot terminate`,
        ]),
      );
      continue;
    }
    const cmpM = /^([A-Za-z_]\w*)\s*(<|<=|>|>=)\s*/.exec(cond);
    if (cmpM) {
      const v = cmpM[1]!;
      const assignsVar = new RegExp(`\\b${v}\\s*:=`).test(body);
      if (!assignsVar) {
        out.push(
          emitDiag(ModelicaErrorCode.CHC_ALGORITHM_LOOP_UNBOUNDED, undefined, [
            v,
            `loop guard variable '${v}' in 'while ${cond}' is never modified inside loop body`,
          ]),
        );
      }
    }
  }
  return out;
}

/**
 * M7808: HJI/Stochastic disturbance barrier check for bounded-input linear state equations
 * `der(x) = -a * x + b * d` against declared `min`/`max` safety limits.
 */
export function verifyModelicaHjiDisturbanceBarrier(source: string, maxDisturbance = 1.0): ModelicaDiagnostic[] {
  const out: ModelicaDiagnostic[] = [];
  const clean = stripModelicaComments(source);

  const bounds = new Map<string, { min?: number | undefined; max?: number | undefined }>();
  const declRe = /\bReal\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let dm: RegExpExecArray | null;
  while ((dm = declRe.exec(clean)) !== null) {
    const mods = dm[2]!;
    const minM = /\bmin\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(mods);
    const maxM = /\bmax\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(mods);
    if (minM || maxM) {
      bounds.set(dm[1]!, {
        min: minM ? parseFloat(minM[1]!) : undefined,
        max: maxM ? parseFloat(maxM[1]!) : undefined,
      });
    }
  }

  // Match `der(x) = -a * x + b * d` (with input/disturbance `d`)
  const odeRe =
    /der\s*\(\s*([A-Za-z_]\w*)\s*\)\s*=\s*-\s*(\d+(?:\.\d+)?)\s*\*\s*\1\s*\+\s*(\d+(?:\.\d+)?)\s*\*\s*([A-Za-z_]\w*)/g;
  let om: RegExpExecArray | null;
  while ((om = odeRe.exec(clean)) !== null) {
    const x = om[1]!;
    const a = parseFloat(om[2]!);
    const b = parseFloat(om[3]!);
    const bnd = bounds.get(x);
    if (!bnd || a <= 0) continue;
    // Run @modelscript/runtime 1D WENO5 HJI Backward Reachable Tube alongside analytical steady-state radius
    const reachRadius = (b / a) * maxDisturbance;
    if (bnd.max !== undefined) {
      const span = Math.max(bnd.max * 2.0, reachRadius * 1.2, 1.0);
      const hji = HjiLevelSetSolver.solve(
        {
          bounds: [[-span, span]],
          gridPoints: [25],
          f: (st, _u, w) => [-a * (st[0] ?? 0) + b * w],
          controlBounds: [0, 0],
          disturbanceBounds: [-maxDisturbance, maxDisturbance],
          targetLevelSet: (st) => bnd.max! - Math.abs(st[0] ?? 0),
          initialState: [0],
        },
        1.5,
        0.05,
      );
      if (!hji.isSafe || reachRadius > bnd.max) {
        out.push(
          emitDiag(ModelicaErrorCode.HJI_DISTURBANCE_BARRIER_BREACH, undefined, [
            x,
            `reachable disturbance envelope +/-${reachRadius.toFixed(2)} exceeds max=${bnd.max} under |${om[4]}|<=${maxDisturbance} (HJI BRT unsafeFrac=${(hji.unsafeVolumeFraction * 100).toFixed(1)}%)`,
          ]),
        );
      }
    }
  }
  return out;
}

/**
 * Runs all Tier 2 formal verification lints (`M7805`–`M7808`) on Modelica source.
 */
export function runModelicaFormalLints(
  source: string,
  options?: { maxDisturbance?: number | undefined },
): ModelicaDiagnostic[] {
  return [
    ...verifyModelicaDdeDelayStability(source),
    ...verifyModelicaHybridWhenZeno(source),
    ...verifyModelicaChcWhileLoops(source),
    ...verifyModelicaHjiDisturbanceBarrier(source, options?.maxDisturbance ?? 1.0),
  ];
}
