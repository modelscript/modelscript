// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * System Dynamics Numerical Simulation Engine for MIT DYNAMO.
 *
 * Supports:
 * - `"euler"` — Classic DYNAMO 1st-order Euler integration
 * - `"rk2"`   — 2nd-order Runge-Kutta (Heun's method)
 * - Full evaluation of `L`, `R`, `A`, `N`, `C`, `T`, `S` equations
 * - Cleanroom DYNAMO stdlib functions: `SMOOTH`, `DLINF1`, `DLINF3`, `DELAY1`, `DELAY3`,
 *   `TABLE`, `TABHL`, `CLIP`, `SWITCH`, `STEP`, `PULSE`, `RAMP`
 */

import { extractExprRefs } from "../parser/index.js";
import type { DynamoEquation, DynamoExpr, DynamoModel } from "../types.js";

export type DynamoIntegrator = "euler" | "rk2";

export interface DynamoSimOptions {
  integrator?: DynamoIntegrator | undefined;
  dt?: number | undefined;
  length?: number | undefined;
  /** Override constant values before simulation */
  parameterOverrides?: Record<string, number> | undefined;
}

export interface DynamoSimPoint {
  time: number;
  values: Record<string, number>;
}

export interface DynamoSimResult {
  integrator: DynamoIntegrator;
  dt: number;
  length: number;
  times: number[];
  series: Record<string, number[]>;
  points: DynamoSimPoint[];
  finalValues: Record<string, number>;
}

interface DelayState {
  kind: "smooth" | "dlinf3" | "delay1" | "delay3";
  stages: number[];
  delay: number;
  lastInput: number;
  initialized: boolean;
}

function evalTableLookup(
  table: number[],
  x: number,
  xlow: number,
  xhigh: number,
  xincr: number,
  clamp: boolean,
): number {
  if (table.length === 0) return 0;
  if (table.length === 1 || xincr <= 0) return table[0]!;

  if (clamp) {
    if (x <= xlow) return table[0]!;
    if (x >= xhigh) return table[table.length - 1]!;
  }

  const pos = (x - xlow) / xincr;
  if (pos <= 0) {
    // Extrapolate using first segment
    const slope = (table[1]! - table[0]!) / xincr;
    return table[0]! + slope * (x - xlow);
  }
  const maxIdx = table.length - 1;
  if (pos >= maxIdx) {
    // Extrapolate using last segment
    const slope = (table[maxIdx]! - table[maxIdx - 1]!) / xincr;
    const xLast = xlow + maxIdx * xincr;
    return table[maxIdx]! + slope * (x - xLast);
  }

  const idx = Math.floor(pos);
  const frac = pos - idx;
  return table[idx]! + (table[idx + 1]! - table[idx]!) * frac;
}

function topoSortEquations(eqs: DynamoEquation[]): DynamoEquation[] {
  const byName = new Map<string, DynamoEquation>();
  for (const eq of eqs) byName.set(eq.name, eq);

  const visited = new Set<string>();
  const ordered: DynamoEquation[] = [];

  function visit(name: string, active: Set<string>): void {
    if (visited.has(name) || active.has(name)) return;
    const eq = byName.get(name);
    if (!eq) return;
    active.add(name);
    if (eq.expr) {
      for (const ref of extractExprRefs(eq.expr)) {
        if (ref.subscript === "J" || ref.subscript === "JK") continue;
        if (byName.has(ref.name)) {
          visit(ref.name, active);
        }
      }
    }
    active.delete(name);
    visited.add(name);
    ordered.push(eq);
  }

  for (const eq of eqs) {
    visit(eq.name, new Set());
  }
  return ordered;
}

/**
 * Simulates a parsed `DynamoModel` from `TIME = 0` to `LENGTH` with step `DT`.
 */
export function simulateDynamo(model: DynamoModel, options: DynamoSimOptions = {}): DynamoSimResult {
  const integrator: DynamoIntegrator = options.integrator ?? "euler";
  const dt = options.dt ?? model.spec.dt ?? 1.0;
  const length = options.length ?? model.spec.length ?? 100.0;

  if (dt <= 0) {
    throw new Error(`DYNAMO simulation DT must be positive (got ${dt})`);
  }
  if (length < 0) {
    throw new Error(`DYNAMO simulation LENGTH must be non-negative (got ${length})`);
  }

  const constants: Record<string, number> = {
    DT: dt,
    LENGTH: length,
  };
  const tables = new Map<string, number[]>();
  const constEqs: DynamoEquation[] = [];
  const initEqs: DynamoEquation[] = [];
  const levelEqs: DynamoEquation[] = [];
  const auxEqs: DynamoEquation[] = [];
  const rateEqs: DynamoEquation[] = [];
  const suppEqs: DynamoEquation[] = [];

  for (const eq of model.equations) {
    switch (eq.kind) {
      case "C":
        constEqs.push(eq);
        break;
      case "T":
        tables.set(eq.name, eq.tableValues ?? []);
        break;
      case "N":
        initEqs.push(eq);
        break;
      case "L":
        levelEqs.push(eq);
        break;
      case "A":
        auxEqs.push(eq);
        break;
      case "R":
        rateEqs.push(eq);
        break;
      case "S":
        suppEqs.push(eq);
        break;
    }
  }

  const orderedConsts = topoSortEquations(constEqs);
  const orderedInits = topoSortEquations(initEqs);
  const orderedAux = topoSortEquations(auxEqs);
  const orderedRates = topoSortEquations(rateEqs);
  const orderedSupp = topoSortEquations(suppEqs);

  const delayStates = new Map<string, DelayState>();

  function evalExpr(
    expr: DynamoExpr | undefined,
    curr: Record<string, number>,
    prevLevels: Record<string, number>,
    prevRates: Record<string, number>,
    time: number,
    callSitePrefix: string,
  ): number {
    if (!expr) return 0;
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "var": {
        if (expr.name === "TIME") return time;
        if (expr.name === "DT") return dt;
        if (expr.subscript === "J") {
          return prevLevels[expr.name] ?? curr[expr.name] ?? constants[expr.name] ?? 0;
        }
        if (expr.subscript === "JK") {
          return prevRates[expr.name] ?? curr[expr.name] ?? constants[expr.name] ?? 0;
        }
        return curr[expr.name] ?? constants[expr.name] ?? prevLevels[expr.name] ?? prevRates[expr.name] ?? 0;
      }
      case "unary": {
        const v = evalExpr(expr.operand, curr, prevLevels, prevRates, time, `${callSitePrefix}:u`);
        return expr.op === "-" ? -v : v;
      }
      case "binary": {
        const l = evalExpr(expr.left, curr, prevLevels, prevRates, time, `${callSitePrefix}:l`);
        const r = evalExpr(expr.right, curr, prevLevels, prevRates, time, `${callSitePrefix}:r`);
        switch (expr.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return r !== 0 ? l / r : 0;
          case "^":
            return Math.pow(l, r);
          default:
            return 0;
        }
      }
      case "call": {
        const fn = expr.name.toUpperCase();
        const evalArg = (idx: number): number =>
          evalExpr(expr.args[idx], curr, prevLevels, prevRates, time, `${callSitePrefix}:${fn}${idx}`);

        if (fn === "TABLE" || fn === "TAB" || fn === "TABHL" || fn === "TABLEHL") {
          const tabArg = expr.args[0];
          const tabName = tabArg?.kind === "var" ? tabArg.name : "";
          const tabValues = tables.get(tabName) ?? [];
          const x = evalArg(1);
          const xlow = evalArg(2);
          const xhigh = evalArg(3);
          const xincr = evalArg(4);
          return evalTableLookup(tabValues, x, xlow, xhigh, xincr, fn === "TABHL" || fn === "TABLEHL");
        }

        if (fn === "CLIP" || fn === "FIFGE") {
          const p = evalArg(0);
          const q = evalArg(1);
          const r = evalArg(2);
          const s = evalArg(3);
          return r >= s ? p : q;
        }

        if (fn === "SWITCH" || fn === "FIFZE") {
          const p = evalArg(0);
          const q = evalArg(1);
          const r = evalArg(2);
          return r === 0 ? p : q;
        }

        if (fn === "STEP") {
          const height = evalArg(0);
          const stime = evalArg(1);
          return time >= stime - 1e-12 ? height : 0;
        }

        if (fn === "RAMP") {
          const slope = evalArg(0);
          const rtime = evalArg(1);
          return time >= rtime - 1e-12 ? slope * (time - rtime) : 0;
        }

        if (fn === "PULSE") {
          const height = evalArg(0);
          const first = evalArg(1);
          const interval = evalArg(2);
          if (time + dt * 0.5 < first) return 0;
          if (interval <= 0) {
            return time >= first - 1e-9 && time < first + dt - 1e-9 ? height : 0;
          }
          const k = Math.floor((time - first + 1e-9) / interval);
          const pulseStart = first + k * interval;
          return time >= pulseStart - 1e-9 && time < pulseStart + dt - 1e-9 ? height : 0;
        }

        if (fn === "SMOOTH" || fn === "SMTH1" || fn === "DLINF1" || fn === "SMOOTH1") {
          const input = evalArg(0);
          const del = Math.max(evalArg(1), 1e-12);
          let st = delayStates.get(callSitePrefix);
          if (!st) {
            st = { kind: "smooth", stages: [input], delay: del, lastInput: input, initialized: true };
            delayStates.set(callSitePrefix, st);
          } else {
            st.delay = del;
            st.lastInput = input;
          }
          return st.stages[0]!;
        }

        if (fn === "DLINF3" || fn === "SMTH3") {
          const input = evalArg(0);
          const del = Math.max(evalArg(1), 1e-12);
          let st = delayStates.get(callSitePrefix);
          if (!st) {
            st = { kind: "dlinf3", stages: [input, input, input], delay: del, lastInput: input, initialized: true };
            delayStates.set(callSitePrefix, st);
          } else {
            st.delay = del;
            st.lastInput = input;
          }
          return st.stages[2]!;
        }

        if (fn === "DELAY1" || fn === "DEL1") {
          const input = evalArg(0);
          const del = Math.max(evalArg(1), 1e-12);
          let st = delayStates.get(callSitePrefix);
          if (!st) {
            st = { kind: "delay1", stages: [input * del], delay: del, lastInput: input, initialized: true };
            delayStates.set(callSitePrefix, st);
          } else {
            st.delay = del;
            st.lastInput = input;
          }
          return st.stages[0]! / st.delay;
        }

        if (fn === "DELAY3" || fn === "DEL3") {
          const input = evalArg(0);
          const del = Math.max(evalArg(1), 1e-12);
          const stageDel = del / 3;
          let st = delayStates.get(callSitePrefix);
          if (!st) {
            const initStock = input * stageDel;
            st = {
              kind: "delay3",
              stages: [initStock, initStock, initStock],
              delay: del,
              lastInput: input,
              initialized: true,
            };
            delayStates.set(callSitePrefix, st);
          } else {
            st.delay = del;
            st.lastInput = input;
          }
          return st.stages[2]! / (st.delay / 3);
        }

        // Standard math functions
        if (fn === "EXP") return Math.exp(evalArg(0));
        if (fn === "LOGN" || fn === "LN" || fn === "LOG") return Math.log(Math.max(evalArg(0), 1e-300));
        if (fn === "SQRT") return Math.sqrt(Math.max(evalArg(0), 0));
        if (fn === "SIN") return Math.sin(evalArg(0));
        if (fn === "COS") return Math.cos(evalArg(0));
        if (fn === "TAN") return Math.tan(evalArg(0));
        if (fn === "ABS") return Math.abs(evalArg(0));
        if (fn === "MAX") return Math.max(evalArg(0), evalArg(1));
        if (fn === "MIN") return Math.min(evalArg(0), evalArg(1));
        if (fn === "POW") return Math.pow(evalArg(0), evalArg(1));

        return 0;
      }
    }
  }

  function advanceDelayStates(stepDt: number): void {
    for (const st of delayStates.values()) {
      if (st.kind === "smooth") {
        const d = (st.lastInput - st.stages[0]!) / st.delay;
        st.stages[0] = st.stages[0]! + stepDt * d;
      } else if (st.kind === "dlinf3") {
        const sd = st.delay / 3;
        const d0 = (st.lastInput - st.stages[0]!) / sd;
        const d1 = (st.stages[0]! - st.stages[1]!) / sd;
        const d2 = (st.stages[1]! - st.stages[2]!) / sd;
        st.stages[0] = st.stages[0]! + stepDt * d0;
        st.stages[1] = st.stages[1]! + stepDt * d1;
        st.stages[2] = st.stages[2]! + stepDt * d2;
      } else if (st.kind === "delay1") {
        const out = st.stages[0]! / st.delay;
        st.stages[0] = st.stages[0]! + stepDt * (st.lastInput - out);
      } else if (st.kind === "delay3") {
        const sd = st.delay / 3;
        const o0 = st.stages[0]! / sd;
        const o1 = st.stages[1]! / sd;
        const o2 = st.stages[2]! / sd;
        st.stages[0] = st.stages[0]! + stepDt * (st.lastInput - o0);
        st.stages[1] = st.stages[1]! + stepDt * (o0 - o1);
        st.stages[2] = st.stages[2]! + stepDt * (o1 - o2);
      }
    }
  }

  // 1. Evaluate constants (with optional overrides)
  for (const eq of orderedConsts) {
    constants[eq.name] = evalExpr(eq.expr, constants, constants, constants, 0, `C:${eq.name}`);
  }
  if (options.parameterOverrides) {
    for (const [k, v] of Object.entries(options.parameterOverrides)) {
      constants[k.toUpperCase()] = v;
    }
  }

  // 2. Initialize Levels & Initials at TIME = 0
  const curr: Record<string, number> = { ...constants };
  for (const eq of orderedInits) {
    curr[eq.name] = evalExpr(eq.expr, curr, curr, curr, 0, `N:${eq.name}`);
  }
  for (const eq of levelEqs) {
    if (curr[eq.name] === undefined) {
      curr[eq.name] = 0;
    }
  }

  const prevLevels: Record<string, number> = {};
  const prevRates: Record<string, number> = {};
  for (const eq of levelEqs) prevLevels[eq.name] = curr[eq.name]!;

  // Helper to evaluate auxiliaries, rates, and supplementaries at a given state and time
  function evaluateAlgebraicsAndRates(
    state: Record<string, number>,
    pLevels: Record<string, number>,
    pRates: Record<string, number>,
    time: number,
  ): void {
    for (const eq of orderedAux) {
      state[eq.name] = evalExpr(eq.expr, state, pLevels, pRates, time, `A:${eq.name}`);
    }
    for (const eq of orderedRates) {
      state[eq.name] = evalExpr(eq.expr, state, pLevels, pRates, time, `R:${eq.name}`);
    }
    for (const eq of orderedSupp) {
      state[eq.name] = evalExpr(eq.expr, state, pLevels, pRates, time, `S:${eq.name}`);
    }
  }

  // Initial evaluation at TIME = 0
  evaluateAlgebraicsAndRates(curr, prevLevels, prevRates, 0);
  for (const eq of rateEqs) prevRates[eq.name] = curr[eq.name]!;

  const recordedVars = new Set<string>();
  for (const eq of [...levelEqs, ...auxEqs, ...rateEqs, ...suppEqs]) {
    recordedVars.add(eq.name);
  }

  const times: number[] = [];
  const series: Record<string, number[]> = {};
  for (const v of recordedVars) series[v] = [];
  const points: DynamoSimPoint[] = [];

  function recordPoint(t: number, state: Record<string, number>): void {
    times.push(t);
    const snap: Record<string, number> = {};
    for (const v of recordedVars) {
      const val = state[v] ?? 0;
      series[v]!.push(val);
      snap[v] = val;
    }
    points.push({ time: t, values: snap });
  }

  recordPoint(0, curr);

  const steps = Math.round(length / dt);

  for (let step = 1; step <= steps; step++) {
    const tPrev = (step - 1) * dt;
    const tNext = step * dt;

    if (integrator === "euler") {
      // Classic DYNAMO Euler update: evaluate L.K using L.J (prevLevels) and R.JK (prevRates)
      const nextLevels: Record<string, number> = {};
      for (const eq of levelEqs) {
        nextLevels[eq.name] = evalExpr(eq.expr, curr, prevLevels, prevRates, tNext, `L:${eq.name}`);
      }
      advanceDelayStates(dt);

      for (const eq of levelEqs) {
        curr[eq.name] = nextLevels[eq.name]!;
      }

      evaluateAlgebraicsAndRates(curr, prevLevels, prevRates, tNext);

      for (const eq of levelEqs) prevLevels[eq.name] = curr[eq.name]!;
      for (const eq of rateEqs) prevRates[eq.name] = curr[eq.name]!;
    } else {
      // RK2 (Heun's predictor-corrector method)
      // 1. Compute k1 = (L_euler - L_prev) / dt at tPrev
      const k1: Record<string, number> = {};
      const predState: Record<string, number> = { ...curr };
      for (const eq of levelEqs) {
        const lEuler = evalExpr(eq.expr, curr, prevLevels, prevRates, tNext, `L:${eq.name}`);
        k1[eq.name] = (lEuler - prevLevels[eq.name]!) / dt;
        predState[eq.name] = lEuler;
      }

      // 2. Evaluate rates at predictor state at tNext
      const predLevels: Record<string, number> = {};
      for (const eq of levelEqs) predLevels[eq.name] = predState[eq.name]!;
      const predRates: Record<string, number> = { ...prevRates };
      evaluateAlgebraicsAndRates(predState, predLevels, predRates, tNext);
      for (const eq of rateEqs) predRates[eq.name] = predState[eq.name]!;

      // 3. Compute k2 at predictor state and average: L_next = L_prev + 0.5 * dt * (k1 + k2)
      for (const eq of levelEqs) {
        const lPredNext = evalExpr(eq.expr, predState, predLevels, predRates, tNext + dt, `L:${eq.name}`);
        const k2 = (lPredNext - predLevels[eq.name]!) / dt;
        curr[eq.name] = prevLevels[eq.name]! + 0.5 * dt * (k1[eq.name]! + k2);
      }
      advanceDelayStates(dt);

      // 4. Evaluate algebraics and rates at corrected state
      const newLevels: Record<string, number> = {};
      for (const eq of levelEqs) newLevels[eq.name] = curr[eq.name]!;
      evaluateAlgebraicsAndRates(curr, newLevels, prevRates, tNext);

      for (const eq of levelEqs) prevLevels[eq.name] = curr[eq.name]!;
      for (const eq of rateEqs) prevRates[eq.name] = curr[eq.name]!;
    }

    // Suppress unused variable warning for tPrev while keeping step clarity
    void tPrev;
    recordPoint(tNext, curr);
  }

  const finalValues: Record<string, number> = {};
  for (const v of recordedVars) {
    finalValues[v] = curr[v] ?? 0;
  }

  return {
    integrator,
    dt,
    length,
    times,
    series,
    points,
    finalValues,
  };
}
