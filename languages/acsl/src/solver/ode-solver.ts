// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RK4 & Adaptive Dormand-Prince RK45 Hybrid ODE/Event Simulator for `@modelscript/acsl`.
 *
 * Features:
 *   - Automatic topological sorting of `DERIVATIVE` algebraic equations (classic ACSL sorting)
 *   - Fixed-step 4th-order Runge-Kutta (`rk4`) and adaptive Dormand-Prince (`rk45`)
 *   - Hybrid `DISCRETE` blocks with periodic `INTERVAL` sampling and `SCHEDULE` (.AT./.XZ./.XP./.XN.) events
 *   - Standard ACSL operators (`INTEG`, `LIMINT`, `REALPL`, `CMPXPL`, `LEDLAG`, `DELAY`, `PULSE`, `RAMP`, `STEP`, `BOUND`, `DEAD`, `QUANT`, `SW`, `ZHOLD`)
 *   - `TABLE` 1D piecewise-linear interpolation, `TERMT(...)` stopping condition, and `TERMINAL` post-processing
 */

import { parseAcsl } from "../parser/acsl-parser.js";
import type { AcslAssignment, AcslExpr, AcslProgram, AcslTableDef } from "../types.js";

export interface AcslSimulationOptions {
  /** Final simulation time (default: 10.0 or overridden by TERMT). */
  tEnd?: number;
  /** Communication/recording interval (overrides CINTERVAL if provided). */
  cinterval?: number;
  /** Maximum integration step size (overrides MAXTERVAL if provided). */
  maxterval?: number;
  /** Integration method: fixed-step RK4 or adaptive Dormand-Prince RK45 (default: "rk4"). */
  method?: "rk4" | "rk45";
  /** Relative tolerance for adaptive RK45 (default: 1e-7). */
  rtol?: number;
  /** Absolute tolerance for adaptive RK45 (default: 1e-9). */
  atol?: number;
  /** Parameter overrides applied after CONSTANT declarations. */
  overrides?: Record<string, number>;
  /** Maximum number of integration steps safety cap (default: 500000). */
  maxSteps?: number;
}

export interface AcslSimulationResult {
  times: number[];
  series: Record<string, number[]>;
  finalValues: Record<string, number>;
  terminalValues: Record<string, number>;
  steps: number;
  eventsFired: number;
  terminatedByTermt: boolean;
}

interface StateDescriptor {
  key: string; // Upper-case canonical name
  origName: string;
  kind: "INTEG" | "LIMINT" | "REALPL" | "CMPXPL_Y" | "CMPXPL_V" | "LEDLAG";
  derivExpr?: AcslExpr | undefined;
  loExpr?: AcslExpr | undefined;
  hiExpr?: AcslExpr | undefined;
  auxExprs?: AcslExpr[] | undefined;
  companionKey?: string | undefined;
}

function collectIdents(expr: AcslExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "ident":
      out.add(expr.name.toUpperCase());
      break;
    case "unary":
      collectIdents(expr.operand, out);
      break;
    case "binary":
      collectIdents(expr.left, out);
      collectIdents(expr.right, out);
      break;
    case "call":
      for (const a of expr.args) collectIdents(a, out);
      break;
    default:
      break;
  }
}

function interpTable(table: AcslTableDef, x: number): number {
  const bp = table.breakpoints;
  const vals = table.values;
  const n = Math.min(bp.length, vals.length);
  if (n === 0) return 0;
  if (n === 1 || x <= bp[0]!) return vals[0]!;
  if (x >= bp[n - 1]!) return vals[n - 1]!;
  for (let i = 0; i < n - 1; i++) {
    const x0 = bp[i]!;
    const x1 = bp[i + 1]!;
    if (x >= x0 && x <= x1) {
      const span = x1 - x0;
      const alpha = span > 0 ? (x - x0) / span : 0;
      return vals[i]! + alpha * (vals[i + 1]! - vals[i]!);
    }
  }
  return vals[n - 1]!;
}

/**
 * Topologically sorts algebraic assignments in `DERIVATIVE` so dependencies are computed before uses.
 */
function topoSortAlgebraic(assignments: AcslAssignment[], stateKeys: Set<string>): AcslAssignment[] {
  const byTarget = new Map<string, AcslAssignment>();
  for (const a of assignments) {
    byTarget.set(a.target.toUpperCase(), a);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: AcslAssignment[] = [];

  const visit = (target: string): void => {
    if (visited.has(target) || visiting.has(target)) return;
    const assign = byTarget.get(target);
    if (!assign) return;
    visiting.add(target);
    const deps = new Set<string>();
    collectIdents(assign.expr, deps);
    for (const d of deps) {
      if (!stateKeys.has(d) && byTarget.has(d)) {
        visit(d);
      }
    }
    visiting.delete(target);
    visited.add(target);
    sorted.push(assign);
  };

  for (const a of assignments) {
    visit(a.target.toUpperCase());
  }
  return sorted;
}

/**
 * Simulates an ACSL program using RK4 or adaptive Dormand-Prince RK45 with hybrid discrete events.
 */
export function simulateAcsl(
  programOrSource: AcslProgram | string,
  options: AcslSimulationOptions = {},
): AcslSimulationResult {
  const program = typeof programOrSource === "string" ? parseAcsl(programOrSource) : programOrSource;
  const method = options.method ?? (program.algorithm?.code === 2 ? "rk45" : "rk4");
  const rtol = options.rtol ?? 1e-7;
  const atol = options.atol ?? 1e-9;
  const maxSteps = options.maxSteps ?? 500_000;

  // Symbol environment (uppercase key -> numeric value) + original-case name map
  const env = new Map<string, number>([
    ["T", 0.0],
    ["TIME", 0.0],
    ["PI", Math.PI],
    ["E", Math.E],
  ]);
  const origNames = new Map<string, string>();
  const tables = new Map<string, AcslTableDef>();
  for (const tbl of program.tables) {
    tables.set(tbl.name.toUpperCase(), tbl);
  }

  // Zero-order hold memory & transport delay history
  const zholdMem = new Map<string, number>();
  const delayHistory = new Map<string, Array<{ t: number; v: number }>>();

  const recordName = (name: string) => {
    const k = name.toUpperCase();
    if (!origNames.has(k)) origNames.set(k, name);
  };

  function evalExpr(expr: AcslExpr, t: number): number {
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "boolean":
        return expr.value ? 1.0 : 0.0;
      case "string":
        return 0.0;
      case "ident": {
        const k = expr.name.toUpperCase();
        if (k === "T" || k === "TIME") return t;
        return env.get(k) ?? 0.0;
      }
      case "unary": {
        const v = evalExpr(expr.operand, t);
        if (expr.op === "-") return -v;
        if (expr.op === "+") return v;
        return v === 0 ? 1.0 : 0.0;
      }
      case "binary": {
        const l = evalExpr(expr.left, t);
        const r = evalExpr(expr.right, t);
        switch (expr.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return r !== 0 ? l / r : 0.0;
          case "**":
            return Math.pow(l, r);
          case ".EQ.":
          case "==":
            return Math.abs(l - r) <= 1e-12 ? 1.0 : 0.0;
          case ".NE.":
          case "/=":
            return Math.abs(l - r) > 1e-12 ? 1.0 : 0.0;
          case ".LT.":
          case "<":
            return l < r ? 1.0 : 0.0;
          case ".LE.":
          case "<=":
            return l <= r ? 1.0 : 0.0;
          case ".GT.":
          case ">":
            return l > r ? 1.0 : 0.0;
          case ".GE.":
          case ">=":
            return l >= r ? 1.0 : 0.0;
          case ".AND.":
            return l !== 0 && r !== 0 ? 1.0 : 0.0;
          case ".OR.":
            return l !== 0 || r !== 0 ? 1.0 : 0.0;
        }
        return 0.0;
      }
      case "call": {
        const fn = expr.callee.toUpperCase();
        const args = expr.args.map((a) => evalExpr(a, t));
        const tbl = tables.get(fn);
        if (tbl) return interpTable(tbl, args[0] ?? 0);

        switch (fn) {
          case "SIN":
            return Math.sin(args[0] ?? 0);
          case "COS":
            return Math.cos(args[0] ?? 0);
          case "TAN":
            return Math.tan(args[0] ?? 0);
          case "ASIN":
            return Math.asin(args[0] ?? 0);
          case "ACOS":
            return Math.acos(args[0] ?? 0);
          case "ATAN":
            return Math.atan(args[0] ?? 0);
          case "ATAN2":
            return Math.atan2(args[0] ?? 0, args[1] ?? 1);
          case "SINH":
            return Math.sinh(args[0] ?? 0);
          case "COSH":
            return Math.cosh(args[0] ?? 0);
          case "TANH":
            return Math.tanh(args[0] ?? 0);
          case "EXP":
            return Math.exp(args[0] ?? 0);
          case "LOG":
          case "ALOG":
            return Math.log(Math.max(1e-300, args[0] ?? 1));
          case "LOG10":
          case "ALOG10":
            return Math.log10(Math.max(1e-300, args[0] ?? 1));
          case "SQRT":
            return Math.sqrt(Math.max(0, args[0] ?? 0));
          case "ABS":
            return Math.abs(args[0] ?? 0);
          case "MOD":
          case "AMOD":
            return (args[1] ?? 1) !== 0 ? (args[0] ?? 0) % (args[1] ?? 1) : 0;
          case "MIN":
          case "AMIN1":
            return args.length > 0 ? Math.min(...args) : 0;
          case "MAX":
          case "AMAX1":
            return args.length > 0 ? Math.max(...args) : 0;
          case "SIGN":
            return (args[1] ?? 1) >= 0 ? Math.abs(args[0] ?? 0) : -Math.abs(args[0] ?? 0);
          case "INT":
            return Math.trunc(args[0] ?? 0);
          case "NINT":
            return Math.round(args[0] ?? 0);
          case "FLOOR":
            return Math.floor(args[0] ?? 0);
          case "CEIL":
            return Math.ceil(args[0] ?? 0);
          case "STEP": {
            const t0 = args[0] ?? 0;
            return t >= t0 ? 1.0 : 0.0;
          }
          case "RAMP": {
            const t0 = args[0] ?? 0;
            return t > t0 ? t - t0 : 0.0;
          }
          case "PULSE": {
            const tz = args[0] ?? 0;
            const p = Math.max(1e-12, args[1] ?? 1);
            const w = args[2] ?? 0.5;
            if (t < tz) return 0.0;
            const phase = t - tz - Math.floor((t - tz) / p) * p;
            return phase < w ? 1.0 : 0.0;
          }
          case "BOUND": {
            const lo = args[0] ?? -1;
            const hi = args[1] ?? 1;
            const u = args[2] ?? 0;
            return Math.min(hi, Math.max(lo, u));
          }
          case "DEAD": {
            const lo = args[0] ?? -0.1;
            const hi = args[1] ?? 0.1;
            const u = args[2] ?? 0;
            if (u > hi) return u - hi;
            if (u < lo) return u - lo;
            return 0.0;
          }
          case "QUANT": {
            const q = Math.max(1e-12, args[0] ?? 0.1);
            const u = args[1] ?? 0;
            return Math.round(u / q) * q;
          }
          case "SW":
          case "RSW": {
            const cond = args[0] ?? 0;
            return cond > 0 ? (args[1] ?? 0) : (args[2] ?? 0);
          }
          case "ZHOLD": {
            const clk = args[0] ?? 0;
            const u = args[1] ?? 0;
            const key = `ZHOLD_${expr.args.length}`;
            if (clk > 0 || !zholdMem.has(key)) zholdMem.set(key, u);
            return zholdMem.get(key) ?? u;
          }
          case "DELAY": {
            const u = args[0] ?? 0;
            const ic = args[1] ?? 0;
            const td = Math.max(0, args[2] ?? 0);
            const key = `DELAY_${td}`;
            let hist = delayHistory.get(key);
            if (!hist) {
              hist = [];
              delayHistory.set(key, hist);
            }
            if (hist.length === 0 || t > hist[hist.length - 1]!.t) {
              hist.push({ t, v: u });
            }
            const targetT = t - td;
            if (targetT <= 0 || hist.length === 0) return ic;
            for (let i = hist.length - 1; i >= 0; i--) {
              if (hist[i]!.t <= targetT) return hist[i]!.v;
            }
            return ic;
          }
          default:
            return args[0] ?? 0;
        }
      }
    }
  }

  // 1. Evaluate declarations
  for (const decl of program.declarations) {
    recordName(decl.name);
    const val = decl.initialValue ? evalExpr(decl.initialValue, 0.0) : 0.0;
    env.set(decl.name.toUpperCase(), val);
  }

  // Apply user parameter overrides
  if (options.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      recordName(k);
      env.set(k.toUpperCase(), v);
    }
  }

  // 2. Evaluate INITIAL section statements
  for (const assign of program.assignments) {
    if (assign.section === "INITIAL") {
      recordName(assign.target);
      env.set(assign.target.toUpperCase(), evalExpr(assign.expr, 0.0));
    }
  }

  // 3. Identify continuous states (INTEG, LIMINT, REALPL, CMPXPL, LEDLAG) and algebraic assignments
  const states: StateDescriptor[] = [];
  const stateKeys = new Set<string>();
  const algebraicAssignments: AcslAssignment[] = [];

  for (const assign of program.assignments) {
    if (assign.section !== "DERIVATIVE" && assign.section !== "DYNAMIC") continue;
    const key = assign.target.toUpperCase();
    recordName(assign.target);

    if (assign.expr.kind === "call" && (assign.expr.callee === "INTEG" || assign.expr.callee === "LIMINT")) {
      const icVal = assign.expr.args[1] ? evalExpr(assign.expr.args[1], 0.0) : 0.0;
      env.set(key, icVal);
      stateKeys.add(key);
      states.push({
        key,
        origName: assign.target,
        kind: assign.expr.callee,
        derivExpr: assign.expr.args[0] ?? { kind: "number", value: 0 },
        loExpr: assign.expr.callee === "LIMINT" ? assign.expr.args[2] : undefined,
        hiExpr: assign.expr.callee === "LIMINT" ? assign.expr.args[3] : undefined,
      });
    } else if (assign.expr.kind === "call" && assign.expr.callee === "REALPL" && assign.expr.args.length >= 2) {
      const icVal = assign.expr.args[2] ? evalExpr(assign.expr.args[2], 0.0) : 0.0;
      env.set(key, icVal);
      stateKeys.add(key);
      states.push({
        key,
        origName: assign.target,
        kind: "REALPL",
        auxExprs: assign.expr.args,
      });
    } else if (assign.expr.kind === "call" && assign.expr.callee === "CMPXPL" && assign.expr.args.length >= 3) {
      const ic1 = assign.expr.args[3] ? evalExpr(assign.expr.args[3], 0.0) : 0.0;
      const ic2 = assign.expr.args[4] ? evalExpr(assign.expr.args[4], 0.0) : 0.0;
      const vKey = `${key}__DOT`;
      env.set(key, ic1);
      env.set(vKey, ic2);
      stateKeys.add(key);
      stateKeys.add(vKey);
      states.push(
        {
          key,
          origName: assign.target,
          kind: "CMPXPL_Y",
          companionKey: vKey,
          auxExprs: assign.expr.args,
        },
        {
          key: vKey,
          origName: `${assign.target}_dot`,
          kind: "CMPXPL_V",
          companionKey: key,
          auxExprs: assign.expr.args,
        },
      );
    } else if (assign.expr.kind === "call" && assign.expr.callee === "LEDLAG" && assign.expr.args.length >= 3) {
      const icVal = assign.expr.args[3] ? evalExpr(assign.expr.args[3], 0.0) : 0.0;
      env.set(key, icVal);
      stateKeys.add(key);
      states.push({
        key,
        origName: assign.target,
        kind: "LEDLAG",
        auxExprs: assign.expr.args,
      });
    } else {
      algebraicAssignments.push(assign);
    }
  }

  const sortedAlgebraic = topoSortAlgebraic(algebraicAssignments, stateKeys);

  // 4. Determine timing parameters
  const cintFromProg = program.cinterval ? evalExpr(program.cinterval.expr, 0.0) : undefined;
  const maxtFromProg = program.maxterval ? evalExpr(program.maxterval.expr, 0.0) : undefined;
  const tEnd = options.tEnd ?? 10.0;
  const cinterval = options.cinterval ?? (cintFromProg && cintFromProg > 0 ? cintFromProg : tEnd / 100);
  const maxterval = options.maxterval ?? (maxtFromProg && maxtFromProg > 0 ? maxtFromProg : Math.min(cinterval, 0.01));

  // Helper: evaluate all algebraic equations + compute derivatives vector `dy` for given `(t, y)`
  const nStates = states.length;
  const y = new Float64Array(nStates);
  for (let i = 0; i < nStates; i++) {
    y[i] = env.get(states[i]!.key) ?? 0.0;
  }

  function evaluateRHS(t: number, yVec: Float64Array, dyOut: Float64Array): void {
    env.set("T", t);
    env.set("TIME", t);
    for (let i = 0; i < nStates; i++) {
      const st = states[i]!;
      let val = yVec[i]!;
      if (st.kind === "LIMINT" && st.loExpr && st.hiExpr) {
        const lo = evalExpr(st.loExpr, t);
        const hi = evalExpr(st.hiExpr, t);
        val = Math.min(hi, Math.max(lo, val));
      }
      env.set(st.key, val);
    }

    for (const assign of sortedAlgebraic) {
      env.set(assign.target.toUpperCase(), evalExpr(assign.expr, t));
    }

    for (let i = 0; i < nStates; i++) {
      const st = states[i]!;
      switch (st.kind) {
        case "INTEG":
          dyOut[i] = st.derivExpr ? evalExpr(st.derivExpr, t) : 0.0;
          break;
        case "LIMINT": {
          const d = st.derivExpr ? evalExpr(st.derivExpr, t) : 0.0;
          const lo = st.loExpr ? evalExpr(st.loExpr, t) : -Infinity;
          const hi = st.hiExpr ? evalExpr(st.hiExpr, t) : Infinity;
          const cur = env.get(st.key) ?? 0.0;
          dyOut[i] = (cur <= lo && d < 0) || (cur >= hi && d > 0) ? 0.0 : d;
          break;
        }
        case "REALPL": {
          const tau = Math.max(1e-9, evalExpr(st.auxExprs![0]!, t));
          const u = evalExpr(st.auxExprs![1]!, t);
          dyOut[i] = (u - yVec[i]!) / tau;
          break;
        }
        case "CMPXPL_Y":
          dyOut[i] = env.get(st.companionKey!) ?? 0.0;
          break;
        case "CMPXPL_V": {
          const a = Math.max(1e-9, evalExpr(st.auxExprs![0]!, t));
          const b = evalExpr(st.auxExprs![1]!, t);
          const u = evalExpr(st.auxExprs![2]!, t);
          const pos = env.get(st.companionKey!) ?? 0.0;
          dyOut[i] = (u - b * yVec[i]! - pos) / a;
          break;
        }
        case "LEDLAG": {
          const t2 = Math.max(1e-9, evalExpr(st.auxExprs![1]!, t));
          const u = evalExpr(st.auxExprs![2]!, t);
          dyOut[i] = (u - yVec[i]!) / t2;
          break;
        }
      }
    }
  }

  // Discrete event setup
  const discreteByName = new Map(program.discreteBlocks.map((b) => [b.name.toUpperCase(), b]));
  const nextPeriodicTime = new Map<string, number>();
  for (const disc of program.discreteBlocks) {
    if (disc.intervalExpr) {
      const dt = evalExpr(disc.intervalExpr, 0.0);
      if (dt > 0) nextPeriodicTime.set(disc.name.toUpperCase(), 0.0);
    }
  }
  const firedAtSchedules = new Set<number>();
  const prevCrossVals = new Map<number, number>();
  let eventsFired = 0;

  function runDiscreteBlock(blockName: string, t: number): void {
    const blk = discreteByName.get(blockName.toUpperCase());
    if (!blk) return;
    env.set("T", t);
    env.set("TIME", t);
    for (const a of blk.assignments) {
      recordName(a.target);
      const val = evalExpr(a.expr, t);
      env.set(a.target.toUpperCase(), val);
      // If a discrete block resets a continuous state, sync y vector too
      const stIdx = states.findIndex((s) => s.key === a.target.toUpperCase());
      if (stIdx >= 0) y[stIdx] = val;
    }
    eventsFired++;
  }

  // Recording buffers
  const times: number[] = [];
  const series: Record<string, number[]> = {};
  const recordedKeys = [
    ...new Set([...states.map((s) => s.key), ...sortedAlgebraic.map((a) => a.target.toUpperCase())]),
  ];
  for (const k of recordedKeys) {
    series[origNames.get(k) ?? k] = [];
  }

  function recordSample(t: number): void {
    times.push(t);
    for (const k of recordedKeys) {
      const name = origNames.get(k) ?? k;
      series[name]!.push(env.get(k) ?? 0.0);
    }
  }

  // Initial RHS evaluation & sample at t = 0
  const k1 = new Float64Array(nStates);
  const k2 = new Float64Array(nStates);
  const k3 = new Float64Array(nStates);
  const k4 = new Float64Array(nStates);
  const k5 = new Float64Array(nStates);
  const k6 = new Float64Array(nStates);
  const k7 = new Float64Array(nStates);
  const yTmp = new Float64Array(nStates);
  const yNext = new Float64Array(nStates);

  evaluateRHS(0.0, y, k1);
  // Seed initial zero-crossing signs
  for (let i = 0; i < program.schedules.length; i++) {
    const s = program.schedules[i]!;
    if (s.triggerKind !== "AT") {
      prevCrossVals.set(i, evalExpr(s.expr, 0.0));
    }
  }
  recordSample(0.0);

  let t = 0.0;
  let nextCommT = cinterval;
  let h = Math.min(maxterval, cinterval);
  let steps = 0;
  let terminatedByTermt = false;

  const checkTermt = (curT: number): boolean => {
    for (const termt of program.termts) {
      if (evalExpr(termt.condition, curT) > 0) return true;
    }
    return false;
  };

  while (t < tEnd - 1e-12 && steps < maxSteps) {
    // Check periodic DISCRETE blocks
    for (const disc of program.discreteBlocks) {
      const key = disc.name.toUpperCase();
      const nextT = nextPeriodicTime.get(key);
      if (nextT !== undefined && t >= nextT - 1e-12) {
        runDiscreteBlock(key, t);
        const dt = disc.intervalExpr ? evalExpr(disc.intervalExpr, t) : cinterval;
        nextPeriodicTime.set(key, nextT + Math.max(1e-9, dt));
      }
    }

    // Determine step size bounded by tEnd, nextCommT, and maxterval
    let dt = Math.min(h, maxterval, tEnd - t);
    if (t + dt > nextCommT + 1e-12 && nextCommT > t + 1e-12) {
      dt = nextCommT - t;
    }
    if (dt <= 1e-15) break;

    if (method === "rk4" || nStates === 0) {
      // Classic 4th-order Runge-Kutta
      evaluateRHS(t, y, k1);
      for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + 0.5 * dt * k1[i]!;
      evaluateRHS(t + 0.5 * dt, yTmp, k2);
      for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + 0.5 * dt * k2[i]!;
      evaluateRHS(t + 0.5 * dt, yTmp, k3);
      for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + dt * k3[i]!;
      evaluateRHS(t + dt, yTmp, k4);
      for (let i = 0; i < nStates; i++) {
        y[i] = y[i]! + (dt / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!);
      }
      t += dt;
      steps++;
    } else {
      // Adaptive Dormand-Prince RK45
      evaluateRHS(t, y, k1);
      for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + dt * (1 / 5) * k1[i]!;
      evaluateRHS(t + dt / 5, yTmp, k2);
      for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + dt * ((3 / 40) * k1[i]! + (9 / 40) * k2[i]!);
      evaluateRHS(t + (3 * dt) / 10, yTmp, k3);
      for (let i = 0; i < nStates; i++) {
        yTmp[i] = y[i]! + dt * ((44 / 45) * k1[i]! - (56 / 15) * k2[i]! + (32 / 9) * k3[i]!);
      }
      evaluateRHS(t + (4 * dt) / 5, yTmp, k4);
      for (let i = 0; i < nStates; i++) {
        yTmp[i] =
          y[i]! +
          dt * ((19372 / 6561) * k1[i]! - (25360 / 2187) * k2[i]! + (64448 / 6561) * k3[i]! - (212 / 729) * k4[i]!);
      }
      evaluateRHS(t + (8 * dt) / 9, yTmp, k5);
      for (let i = 0; i < nStates; i++) {
        yTmp[i] =
          y[i]! +
          dt *
            ((9017 / 3168) * k1[i]! -
              (355 / 33) * k2[i]! +
              (46732 / 5247) * k3[i]! +
              (49 / 176) * k4[i]! -
              (5103 / 18656) * k5[i]!);
      }
      evaluateRHS(t + dt, yTmp, k6);
      for (let i = 0; i < nStates; i++) {
        yNext[i] =
          y[i]! +
          dt *
            ((35 / 384) * k1[i]! +
              (500 / 1113) * k3[i]! +
              (125 / 192) * k4[i]! -
              (2187 / 6784) * k5[i]! +
              (11 / 84) * k6[i]!);
      }
      evaluateRHS(t + dt, yNext, k7);

      let errNorm = 0.0;
      for (let i = 0; i < nStates; i++) {
        const err =
          dt *
          ((71 / 57600) * k1[i]! -
            (71 / 16695) * k3[i]! +
            (71 / 1920) * k4[i]! -
            (17253 / 339200) * k5[i]! +
            (22 / 525) * k6[i]! -
            (1 / 40) * k7[i]!);
        const scale = atol + rtol * Math.max(Math.abs(y[i]!), Math.abs(yNext[i]!));
        const ratio = err / scale;
        errNorm += ratio * ratio;
      }
      errNorm = Math.sqrt(errNorm / Math.max(1, nStates));

      if (errNorm <= 1.0 || dt <= 1e-12) {
        y.set(yNext);
        t += dt;
        steps++;
        const factor = errNorm === 0 ? 2.0 : Math.min(2.5, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2)));
        h = Math.min(maxterval, dt * factor);
      } else {
        const factor = Math.max(0.1, 0.9 * Math.pow(errNorm, -0.25));
        h = Math.max(1e-12, dt * factor);
        continue;
      }
    }

    // Clamp LIMINT states after step
    for (let i = 0; i < nStates; i++) {
      const st = states[i]!;
      if (st.kind === "LIMINT" && st.loExpr && st.hiExpr) {
        const lo = evalExpr(st.loExpr, t);
        const hi = evalExpr(st.hiExpr, t);
        y[i] = Math.min(hi, Math.max(lo, y[i]!));
      }
    }

    evaluateRHS(t, y, k1);

    // Check SCHEDULE events
    for (let i = 0; i < program.schedules.length; i++) {
      const sched = program.schedules[i]!;
      if (sched.triggerKind === "AT") {
        const fireT = evalExpr(sched.expr, t);
        if (!firedAtSchedules.has(i) && t >= fireT - 1e-12) {
          firedAtSchedules.add(i);
          runDiscreteBlock(sched.targetDiscrete, t);
        }
      } else {
        const prev = prevCrossVals.get(i) ?? 0;
        const curr = evalExpr(sched.expr, t);
        prevCrossVals.set(i, curr);
        const crossedPos = prev < 0 && curr >= 0;
        const crossedNeg = prev > 0 && curr <= 0;
        if (
          (sched.triggerKind === "XP" && crossedPos) ||
          (sched.triggerKind === "XN" && crossedNeg) ||
          (sched.triggerKind === "XZ" && (crossedPos || crossedNeg))
        ) {
          runDiscreteBlock(sched.targetDiscrete, t);
        }
      }
    }

    // Record output at communication interval or end
    if (t >= nextCommT - 1e-9 || t >= tEnd - 1e-12) {
      recordSample(t);
      while (nextCommT <= t + 1e-9) nextCommT += cinterval;
    }

    // Check TERMT
    if (checkTermt(t)) {
      terminatedByTermt = true;
      if (times[times.length - 1] !== t) recordSample(t);
      break;
    }
  }

  // Evaluate TERMINAL section
  const terminalValues: Record<string, number> = {};
  for (const assign of program.assignments) {
    if (assign.section === "TERMINAL") {
      recordName(assign.target);
      const val = evalExpr(assign.expr, t);
      env.set(assign.target.toUpperCase(), val);
      terminalValues[assign.target] = val;
    }
  }

  const finalValues: Record<string, number> = {};
  for (const [k, v] of env) {
    if (k === "PI" || k === "E") continue;
    finalValues[origNames.get(k) ?? k] = v;
  }

  return {
    times,
    series,
    finalValues,
    terminalValues,
    steps,
    eventsFired,
    terminatedByTermt,
  };
}
