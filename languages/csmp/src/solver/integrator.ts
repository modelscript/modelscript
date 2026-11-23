// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Numerical ODE Solver Engine for IBM System/360 CSMP & SCi CSSL-67.
 *
 * Supports:
 *  - `RKS` / `RKSFX` / `RK4`: Classical 4th-order Runge-Kutta
 *  - `MILNE`: 4th-order Milne predictor-corrector (RK4-bootstrapped)
 *  - `ADAMS`: 2nd-order Adams-Bashforth
 *  - `TRAPZ`: 2nd-order Trapezoidal (Heun)
 *  - `RECT`: 1st-order Euler rectangular rule
 */

import { topologicalSortEquations } from "../lints/index.js";
import type { CsmpAssignment, CsmpExpr, CsmpFunctionTable, CsmpProgram } from "../types.js";

export interface CsmpSimulationOptions {
  fintim?: number;
  delt?: number;
  prdel?: number;
  method?: string;
}

export interface CsmpSimulationResult {
  method: string;
  fintim: number;
  delt: number;
  times: number[];
  series: Record<string, number[]>;
  finalValues: Record<string, number>;
  terminalValues: Record<string, number>;
  steps: number;
}

interface StateBinding {
  name: string;
  kind: "INTGRL" | "REALPL" | "CMPXPL" | "LEDLAG";
  stmt: CsmpAssignment;
  /** Index of primary state in y[] */
  stateIdx: number;
  /** Optional second state index (for CMPXPL velocity) */
  stateIdx2?: number | undefined;
}

function evalTable(tbl: CsmpFunctionTable | undefined, x: number, quadratic: boolean): number {
  if (!tbl || tbl.points.length === 0) return 0;
  const pts = tbl.points;
  if (pts.length === 1 || x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;

  let seg = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (x >= pts[i]!.x && x <= pts[i + 1]!.x) {
      seg = i;
      break;
    }
  }

  if (quadratic && pts.length >= 3) {
    const i0 = seg + 2 < pts.length ? seg : pts.length - 3;
    const a = pts[i0]!;
    const b = pts[i0 + 1]!;
    const c = pts[i0 + 2]!;
    const la = ((x - b.x) * (x - c.x)) / ((a.x - b.x) * (a.x - c.x));
    const lb = ((x - a.x) * (x - c.x)) / ((b.x - a.x) * (b.x - c.x));
    const lc = ((x - a.x) * (x - b.x)) / ((c.x - a.x) * (c.x - b.x));
    return a.y * la + b.y * lb + c.y * lc;
  }

  const a = pts[seg]!;
  const b = pts[seg + 1]!;
  const frac = Math.abs(b.x - a.x) > 1e-15 ? (x - a.x) / (b.x - a.x) : 0;
  return a.y + frac * (b.y - a.y);
}

/**
 * Simulates a parsed `CsmpProgram` over `[0, FINTIM]` using the configured integration method.
 */
export function simulateCsmp(program: CsmpProgram, options: CsmpSimulationOptions = {}): CsmpSimulationResult {
  const fintim = options.fintim ?? program.timer.fintim ?? 10.0;
  const delt = options.delt ?? program.timer.delt ?? Math.min(0.01, fintim / 200);
  const prdel = options.prdel ?? program.timer.prdel ?? program.timer.outdel ?? delt;
  const method = (options.method ?? program.method ?? "RKSFX").toUpperCase();

  // Persistent environment for parameters, constants, and variables
  const env = new Map<string, number>();
  env.set("PI", Math.PI);
  env.set("TIME", 0.0);
  env.set("DELT", delt);
  env.set("FINTIM", fintim);
  env.set("PRDEL", prdel);
  env.set("KEEP", 1);

  for (const [k, d] of program.parameters) env.set(k, d.value);
  for (const [k, d] of program.constants) env.set(k, d.value);
  for (const [k, d] of program.incons) env.set(k, d.value);

  // Discrete memory for HYSTRS / ZHOLD / DERIV / DELAY
  const discreteState = new Map<string, number>();
  const delayBuffers = new Map<string, { buf: number[]; head: number }>();

  function evalExpr(expr: CsmpExpr, t: number, dt: number, keyHint: string = ""): number {
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "ident": {
        if (expr.name === "TIME") return t;
        return env.get(expr.name) ?? 0.0;
      }
      case "unary": {
        const v = evalExpr(expr.operand, t, dt, keyHint);
        return expr.op === "-" ? -v : v;
      }
      case "binary": {
        const l = evalExpr(expr.left, t, dt, `${keyHint}_l`);
        const r = evalExpr(expr.right, t, dt, `${keyHint}_r`);
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
        }
        return 0.0;
      }
      case "call": {
        const fn = expr.callee.toUpperCase();
        const argVal = (i: number, def = 0): number =>
          i < expr.args.length ? evalExpr(expr.args[i]!, t, dt, `${keyHint}_${i}`) : def;

        switch (fn) {
          // Math / Fortran intrinsics
          case "SIN":
            return Math.sin(argVal(0));
          case "COS":
            return Math.cos(argVal(0));
          case "TAN":
            return Math.tan(argVal(0));
          case "ASIN":
            return Math.asin(argVal(0));
          case "ACOS":
            return Math.acos(argVal(0));
          case "ATAN":
            return Math.atan(argVal(0));
          case "ATAN2":
            return Math.atan2(argVal(0), argVal(1));
          case "SINH":
            return Math.sinh(argVal(0));
          case "COSH":
            return Math.cosh(argVal(0));
          case "TANH":
            return Math.tanh(argVal(0));
          case "EXP":
            return Math.exp(argVal(0));
          case "ALOG":
          case "LOG":
            return Math.log(Math.max(1e-300, argVal(0)));
          case "ALOG10":
          case "LOG10":
            return Math.log10(Math.max(1e-300, argVal(0)));
          case "SQRT":
            return Math.sqrt(Math.max(0, argVal(0)));
          case "ABS":
            return Math.abs(argVal(0));
          case "AMAX1":
          case "MAX": {
            let m = -Infinity;
            for (let i = 0; i < expr.args.length; i++) m = Math.max(m, argVal(i));
            return m === -Infinity ? 0 : m;
          }
          case "AMIN1":
          case "MIN": {
            let m = Infinity;
            for (let i = 0; i < expr.args.length; i++) m = Math.min(m, argVal(i));
            return m === Infinity ? 0 : m;
          }
          case "AMOD":
          case "MOD": {
            const b = argVal(1, 1);
            return b !== 0 ? argVal(0) % b : 0;
          }
          case "SIGN":
            return argVal(1) >= 0 ? Math.abs(argVal(0)) : -Math.abs(argVal(0));
          case "INT":
            return Math.trunc(argVal(0));
          case "FLOAT":
            return argVal(0);

          // Signal sources & switching
          case "STEP":
            return t >= argVal(0) ? 1.0 : 0.0;
          case "RAMP": {
            const t0 = argVal(0);
            return t >= t0 ? t - t0 : 0.0;
          }
          case "SINE": {
            // SINE(P1=delay, P2=omega, P3=phase)
            const p1 = argVal(0);
            const p2 = argVal(1, 1);
            const p3 = argVal(2, 0);
            return t >= p1 ? Math.sin(p2 * (t - p1) + p3) : 0.0;
          }
          case "PULSE": {
            const p1 = argVal(0, 1);
            const x = argVal(1, 0);
            return x > 0 && t % Math.max(1e-12, p1) < 0.5 * p1 ? 1.0 : 0.0;
          }
          case "INSW": {
            // INSW(X1, X2, X3): X2 if X1 < 0, else X3
            return argVal(0) < 0 ? argVal(1) : argVal(2);
          }
          case "FCNSW": {
            // FCNSW(X1, X2, X3, X4): X2 if X1 < 0, X3 if X1 == 0, X4 if X1 > 0
            const x1 = argVal(0);
            return x1 < 0 ? argVal(1) : x1 === 0 ? argVal(2) : argVal(3);
          }
          case "COMPAR":
            return argVal(0) < argVal(1) ? 0.0 : 1.0;

          // CSMP/360 Nonlinear & Function Generator blocks
          case "LIMIT": {
            const p1 = argVal(0);
            const p2 = argVal(1);
            const x = argVal(2);
            return Math.min(p2, Math.max(p1, x));
          }
          case "DEADSP": {
            const p1 = argVal(0);
            const p2 = argVal(1);
            const x = argVal(2);
            if (x > p2) return x - p2;
            if (x < p1) return x - p1;
            return 0.0;
          }
          case "HYSTRS": {
            const ic = argVal(0);
            const p1 = argVal(1);
            const p2 = argVal(2);
            const x = argVal(3);
            let y = discreteState.get(keyHint) ?? ic;
            if (x > y + p2) y = x - p2;
            else if (x < y + p1) y = x - p1;
            discreteState.set(keyHint, y);
            return y;
          }
          case "ZHOLD": {
            const x1 = argVal(0);
            const x2 = argVal(1);
            let y = discreteState.get(keyHint) ?? 0.0;
            if (x1 > 0) {
              y = x2;
              discreteState.set(keyHint, y);
            }
            return y;
          }
          case "DERIV": {
            const ic = argVal(0);
            const x = argVal(1);
            const prev = discreteState.get(keyHint) ?? ic;
            const d = dt > 1e-12 ? (x - prev) / dt : 0.0;
            discreteState.set(keyHint, x);
            return d;
          }
          case "DELAY": {
            const n = Math.max(1, Math.round(argVal(0, 10)));
            const x = argVal(2);
            let entry = delayBuffers.get(keyHint);
            if (!entry) {
              entry = { buf: new Array<number>(n).fill(0), head: 0 };
              delayBuffers.set(keyHint, entry);
            }
            const out = entry.buf[entry.head] ?? 0;
            entry.buf[entry.head] = x;
            entry.head = (entry.head + 1) % n;
            return out;
          }
          case "AFGEN":
          case "NLFGEN": {
            const tblArg = expr.args[0];
            const tblName = tblArg?.kind === "ident" ? tblArg.name : "";
            const tbl = program.functionTables.get(tblName);
            const x = argVal(1);
            return evalTable(tbl, x, fn === "NLFGEN");
          }
          default: {
            // User-defined MACRO invocation
            const macro = program.macros.get(fn);
            if (macro) {
              const saved = new Map<string, number | undefined>();
              for (let i = 0; i < macro.inputs.length; i++) {
                const inp = macro.inputs[i]!;
                saved.set(inp, env.get(inp));
                env.set(inp, argVal(i));
              }
              let lastVal = 0.0;
              for (const bStmt of macro.body) {
                lastVal = evalExpr(bStmt.expr, t, dt, `${keyHint}_${bStmt.target}`);
                env.set(bStmt.target, lastVal);
              }
              const ret = macro.outputs[0] ? (env.get(macro.outputs[0]) ?? lastVal) : lastVal;
              for (const [k, v] of saved) {
                if (v === undefined) env.delete(k);
                else env.set(k, v);
              }
              return ret;
            }
            return 0.0;
          }
        }
      }
    }
  }

  // 1. Execute INITIAL section
  for (const stmt of program.initialStatements) {
    env.set(stmt.target, evalExpr(stmt.expr, 0.0, delt, `init_${stmt.target}`));
  }

  // 2. Topologically sort DYNAMIC section & identify state blocks
  const { sorted } = topologicalSortEquations(program.dynamicStatements);
  const states: StateBinding[] = [];
  const stateTargets = new Set<string>();
  const y0: number[] = [];

  for (const stmt of sorted) {
    if (stmt.expr.kind === "call") {
      const callee = stmt.expr.callee.toUpperCase();
      if (callee === "INTGRL" && stmt.expr.args.length >= 2) {
        const ic = evalExpr(stmt.expr.args[0]!, 0.0, delt, `ic_${stmt.target}`);
        const idx = y0.length;
        y0.push(ic);
        states.push({ name: stmt.target, kind: "INTGRL", stmt, stateIdx: idx });
        stateTargets.add(stmt.target);
        env.set(stmt.target, ic);
      } else if (callee === "REALPL" && stmt.expr.args.length >= 3) {
        const ic = evalExpr(stmt.expr.args[0]!, 0.0, delt, `ic_${stmt.target}`);
        const idx = y0.length;
        y0.push(ic);
        states.push({ name: stmt.target, kind: "REALPL", stmt, stateIdx: idx });
        stateTargets.add(stmt.target);
        env.set(stmt.target, ic);
      } else if (callee === "CMPXPL" && stmt.expr.args.length >= 5) {
        const ic1 = evalExpr(stmt.expr.args[0]!, 0.0, delt, `ic1_${stmt.target}`);
        const ic2 = evalExpr(stmt.expr.args[1]!, 0.0, delt, `ic2_${stmt.target}`);
        const idx1 = y0.length;
        y0.push(ic1);
        const idx2 = y0.length;
        y0.push(ic2);
        states.push({ name: stmt.target, kind: "CMPXPL", stmt, stateIdx: idx1, stateIdx2: idx2 });
        stateTargets.add(stmt.target);
        env.set(stmt.target, ic1);
      } else if (callee === "LEDLAG" && stmt.expr.args.length >= 3) {
        const idx = y0.length;
        y0.push(0.0);
        states.push({ name: stmt.target, kind: "LEDLAG", stmt, stateIdx: idx });
        stateTargets.add(stmt.target);
        env.set(stmt.target, 0.0);
      }
    }
  }

  const nStates = y0.length;

  // Evaluate algebraic equations + state derivatives for a given (t, y)
  function evalDerivatives(t: number, y: number[], dyOut: number[]): void {
    env.set("TIME", t);

    // Load current continuous state values into env
    for (const st of states) {
      if (st.kind === "LEDLAG" && st.stmt.expr.kind === "call") {
        // LEDLAG output depends on x, handled during algebraic pass
        continue;
      }
      env.set(st.name, y[st.stateIdx]!);
    }

    // Evaluate all algebraic equations in topological order
    for (const stmt of sorted) {
      if (stateTargets.has(stmt.target)) {
        if (stmt.expr.kind === "call" && stmt.expr.callee.toUpperCase() === "LEDLAG") {
          const st = states.find((s) => s.name === stmt.target)!;
          const p1 = evalExpr(stmt.expr.args[0]!, t, delt, `ll_p1_${stmt.target}`);
          const p2 = Math.max(1e-12, evalExpr(stmt.expr.args[1]!, t, delt, `ll_p2_${stmt.target}`));
          const x = evalExpr(stmt.expr.args[2]!, t, delt, `ll_x_${stmt.target}`);
          env.set(stmt.target, y[st.stateIdx]! + (p1 / p2) * x);
        }
        continue;
      }
      const val = evalExpr(stmt.expr, t, delt, stmt.target);
      env.set(stmt.target, val);
    }

    // Compute state derivatives
    for (const st of states) {
      if (st.stmt.expr.kind !== "call") continue;
      const args = st.stmt.expr.args;
      if (st.kind === "INTGRL") {
        dyOut[st.stateIdx] = evalExpr(args[1]!, t, delt, `der_${st.name}`);
      } else if (st.kind === "REALPL") {
        const p = Math.max(1e-12, evalExpr(args[1]!, t, delt, `rp_p_${st.name}`));
        const x = evalExpr(args[2]!, t, delt, `rp_x_${st.name}`);
        dyOut[st.stateIdx] = (x - y[st.stateIdx]!) / p;
      } else if (st.kind === "CMPXPL") {
        const p1 = evalExpr(args[2]!, t, delt, `cp_p1_${st.name}`);
        const p2 = evalExpr(args[3]!, t, delt, `cp_p2_${st.name}`);
        const x = evalExpr(args[4]!, t, delt, `cp_x_${st.name}`);
        const pos = y[st.stateIdx]!;
        const vel = y[st.stateIdx2!]!;
        dyOut[st.stateIdx] = vel;
        dyOut[st.stateIdx2!] = x - 2.0 * p1 * p2 * vel - p2 * p2 * pos;
      } else if (st.kind === "LEDLAG") {
        const p1 = evalExpr(args[0]!, t, delt, `ll_p1_${st.name}`);
        const p2 = Math.max(1e-12, evalExpr(args[1]!, t, delt, `ll_p2_${st.name}`));
        const x = evalExpr(args[2]!, t, delt, `ll_x_${st.name}`);
        dyOut[st.stateIdx] = ((1.0 - p1 / p2) * x - y[st.stateIdx]!) / p2;
      }
    }
  }

  // Tracked output variables
  const trackedVars = new Set<string>();
  for (const stmt of sorted) trackedVars.add(stmt.target);
  for (const v of program.printVars) trackedVars.add(v);
  for (const v of program.prtpltVars) trackedVars.add(v);

  const times: number[] = [];
  const series: Record<string, number[]> = {};
  for (const v of trackedVars) series[v] = [];

  function recordPoint(t: number): void {
    times.push(t);
    for (const v of trackedVars) {
      series[v]!.push(env.get(v) ?? 0.0);
    }
  }

  // Integration loop
  const y = y0.slice();
  const k1 = new Array<number>(nStates).fill(0);
  const k2 = new Array<number>(nStates).fill(0);
  const k3 = new Array<number>(nStates).fill(0);
  const k4 = new Array<number>(nStates).fill(0);
  const yTmp = new Array<number>(nStates).fill(0);

  // History buffers for multistep methods (MILNE / ADAMS)
  const yHist: number[][] = [];
  const fHist: number[][] = [];

  const totalSteps = Math.max(1, Math.round(fintim / delt));
  const recordEvery = Math.max(1, Math.round(prdel / delt));

  // Initial point at t = 0
  evalDerivatives(0.0, y, k1);
  recordPoint(0.0);
  yHist.push(y.slice());
  fHist.push(k1.slice());

  function rk4Step(t: number, h: number): void {
    evalDerivatives(t, y, k1);
    for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + 0.5 * h * k1[i]!;
    evalDerivatives(t + 0.5 * h, yTmp, k2);
    for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + 0.5 * h * k2[i]!;
    evalDerivatives(t + 0.5 * h, yTmp, k3);
    for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + h * k3[i]!;
    evalDerivatives(t + h, yTmp, k4);
    for (let i = 0; i < nStates; i++) {
      y[i] = y[i]! + (h / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!);
    }
  }

  for (let step = 0; step < totalSteps; step++) {
    const t = step * delt;
    const tNext = Math.min(fintim, (step + 1) * delt);
    const h = tNext - t;

    if (nStates > 0) {
      if (method === "RECT") {
        evalDerivatives(t, y, k1);
        for (let i = 0; i < nStates; i++) y[i] = y[i]! + h * k1[i]!;
      } else if (method === "TRAPZ") {
        evalDerivatives(t, y, k1);
        for (let i = 0; i < nStates; i++) yTmp[i] = y[i]! + h * k1[i]!;
        evalDerivatives(tNext, yTmp, k2);
        for (let i = 0; i < nStates; i++) y[i] = y[i]! + 0.5 * h * (k1[i]! + k2[i]!);
      } else if (method === "ADAMS" && fHist.length >= 2) {
        const fn = fHist[fHist.length - 1]!;
        const fn1 = fHist[fHist.length - 2]!;
        for (let i = 0; i < nStates; i++) {
          y[i] = y[i]! + 0.5 * h * (3.0 * fn[i]! - fn1[i]!);
        }
      } else if (method === "MILNE" && yHist.length >= 4 && fHist.length >= 4) {
        // 4th-order Milne predictor + Simpson corrector
        const ym3 = yHist[yHist.length - 4]!;
        const ym1 = yHist[yHist.length - 2]!;
        const fm2 = fHist[fHist.length - 3]!;
        const fm1 = fHist[fHist.length - 2]!;
        const f0 = fHist[fHist.length - 1]!;

        // Predictor: y_{n+1}^{(p)} = y_{n-3} + (4h/3)(2 f_n - f_{n-1} + 2 f_{n-2})
        for (let i = 0; i < nStates; i++) {
          yTmp[i] = ym3[i]! + ((4.0 * h) / 3.0) * (2.0 * f0[i]! - fm1[i]! + 2.0 * fm2[i]!);
        }
        evalDerivatives(tNext, yTmp, k2);
        // Corrector: y_{n+1} = y_{n-1} + (h/3)(f_{n+1}^{(p)} + 4 f_n + f_{n-1})
        for (let i = 0; i < nStates; i++) {
          y[i] = ym1[i]! + (h / 3.0) * (k2[i]! + 4.0 * f0[i]! + fm1[i]!);
        }
      } else {
        // Default / bootstrap: RK4 (RKS / RKSFX / RK4 / SIMP / STIFF / CENTRL)
        rk4Step(t, h);
      }
    }

    // Re-evaluate outputs at tNext so algebraic outputs & history are exact
    evalDerivatives(tNext, y, k1);
    if (method === "MILNE" || method === "ADAMS") {
      yHist.push(y.slice());
      fHist.push(k1.slice());
      if (yHist.length > 5) {
        yHist.shift();
        fHist.shift();
      }
    }

    if ((step + 1) % recordEvery === 0 || step + 1 === totalSteps) {
      recordPoint(tNext);
    }
  }

  const finalValues: Record<string, number> = {};
  for (const [k, v] of env) finalValues[k] = v;

  // 3. Execute TERMINAL section
  const terminalValues: Record<string, number> = {};
  for (const stmt of program.terminalStatements) {
    const val = evalExpr(stmt.expr, fintim, delt, `term_${stmt.target}`);
    env.set(stmt.target, val);
    terminalValues[stmt.target] = val;
  }

  return {
    method,
    fintim,
    delt,
    times,
    series,
    finalValues,
    terminalValues,
    steps: totalSteps,
  };
}
