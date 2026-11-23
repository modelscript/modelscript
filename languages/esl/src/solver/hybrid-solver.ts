// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hybrid RK4 + Zero-Crossing Event Detection Solver for ESA ESL models.
 *
 * Supports:
 *  - `INITIAL`, `DYNAMIC`, `STEP`, `TERMINAL` sections
 *  - Classical 4th-order Runge-Kutta (RK4) continuous integration
 *  - `WHEN cond THEN ... END_WHEN` discontinuity detection with bisection root-finding
 *  - `IF cond THEN ... ELSE ... END_IF` piecewise-smooth control laws (e.g. bang-bang AOCS)
 *  - `SUBMODEL` expansion and ESA standard functions (`LIMIT`, `DEADZONE`, `STEP`, `RAMP`, `TAB1`, `TAB2`)
 */

import { parseEsl } from "../parser/esl-parser.js";
import type { EslBlock, EslExpr, EslProgram, EslStatement } from "../types.js";

export interface EslSimulationOptions {
  /** Simulation start time (default: 0.0). */
  tStart?: number;
  /** Simulation end time (default: 10.0). */
  tEnd?: number;
  /** Integration step size dt (default: 0.01). */
  dt?: number;
  /** Communication / output recording interval (default: dt). */
  cint?: number;
  /** Target model name if multiple models exist in the program. */
  modelName?: string;
  /** Zero-crossing event bisection tolerance (default: 1e-10). */
  eventTolerance?: number;
  /** Maximum events per step to guard against Zeno chatter (default: 16). */
  maxEventsPerStep?: number;
  /** Parameter overrides (case-insensitive). */
  overrides?: Record<string, number>;
}

export interface EslEventRecord {
  time: number;
  whenIndex: number;
  stateBefore: Record<string, number>;
  stateAfter: Record<string, number>;
}

export interface EslSimulationResult {
  modelName: string;
  times: number[];
  trajectories: Record<string, number[]>;
  events: EslEventRecord[];
  finalValues: Record<string, number>;
  steps: number;
  terminatedEarly: boolean;
}

interface WhenDescriptor {
  index: number;
  stmt: Extract<EslStatement, { kind: "when" }>;
}

function evalBuiltin(nameUpper: string, args: number[], t: number): number {
  const a0 = args[0] ?? 0;
  const a1 = args[1] ?? 0;
  const a2 = args[2] ?? 0;
  switch (nameUpper) {
    case "SIN":
      return Math.sin(a0);
    case "COS":
      return Math.cos(a0);
    case "TAN":
      return Math.tan(a0);
    case "ASIN":
      return Math.asin(a0);
    case "ACOS":
      return Math.acos(a0);
    case "ATAN":
      return Math.atan(a0);
    case "ATAN2":
      return Math.atan2(a0, a1);
    case "SINH":
      return Math.sinh(a0);
    case "COSH":
      return Math.cosh(a0);
    case "TANH":
      return Math.tanh(a0);
    case "SQRT":
      return Math.sqrt(Math.max(0, a0));
    case "ABS":
      return Math.abs(a0);
    case "EXP":
      return Math.exp(a0);
    case "LOG":
    case "LN":
      return Math.log(Math.max(1e-300, a0));
    case "LOG10":
      return Math.log10(Math.max(1e-300, a0));
    case "SIGN":
      return a0 > 0 ? 1 : a0 < 0 ? -1 : 0;
    case "MIN":
      return Math.min(...args);
    case "MAX":
      return Math.max(...args);
    case "MOD":
      return a1 !== 0 ? a0 % a1 : 0;
    case "INT":
    case "FLOOR":
      return Math.floor(a0);
    case "CEIL":
      return Math.ceil(a0);
    case "ROUND":
      return Math.round(a0);
    case "LIMIT": {
      // LIMIT(lo, hi, u)
      const lo = a0;
      const hi = a1;
      const u = a2;
      return u < lo ? lo : u > hi ? hi : u;
    }
    case "DEADZONE": {
      // DEADZONE(lo, hi, u)
      const lo = a0;
      const hi = a1;
      const u = a2;
      if (u > hi) return u - hi;
      if (u < lo) return u - lo;
      return 0;
    }
    case "STEP": {
      // STEP(t0) -> 1 if t >= t0 else 0
      return t >= a0 ? 1 : 0;
    }
    case "RAMP": {
      // RAMP(t0) -> max(0, t - t0)
      return t >= a0 ? t - a0 : 0;
    }
    case "PULSE": {
      // PULSE(t0, width)
      return t >= a0 && t < a0 + a1 ? 1 : 0;
    }
    case "SWITCH": {
      // SWITCH(cond, valTrue, valFalse)
      return a0 !== 0 ? a1 : a2;
    }
    case "TAB1": {
      // TAB1(x, x0, x1, y0, y1)
      const x = a0;
      const x0 = a1;
      const x1 = a2;
      const y0 = args[3] ?? 0;
      const y1 = args[4] ?? 1;
      if (x <= x0) return y0;
      if (x >= x1) return y1;
      return y0 + ((x - x0) / Math.max(1e-12, x1 - x0)) * (y1 - y0);
    }
    case "TAB2": {
      // TAB2(x, y, x0, x1, y0, y1, z00, z10, z01, z11)
      const x = a0;
      const y = a1;
      const x0 = a2;
      const x1 = args[3] ?? 1;
      const y0 = args[4] ?? 0;
      const y1 = args[5] ?? 1;
      const z00 = args[6] ?? 0;
      const z10 = args[7] ?? 1;
      const z01 = args[8] ?? 2;
      const z11 = args[9] ?? 3;
      const tx = Math.max(0, Math.min(1, (x - x0) / Math.max(1e-12, x1 - x0)));
      const ty = Math.max(0, Math.min(1, (y - y0) / Math.max(1e-12, y1 - y0)));
      const z0 = z00 + tx * (z10 - z00);
      const z1 = z01 + tx * (z11 - z01);
      return z0 + ty * (z1 - z0);
    }
    default:
      return 0;
  }
}

function evalExpr(
  expr: EslExpr,
  env: Map<string, number>,
  derivs: Map<string, number>,
  t: number,
  subst?: Map<string, EslExpr>,
): number {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value ? 1 : 0;
    case "string":
      return 0;
    case "identifier": {
      const key = expr.name.toUpperCase();
      const sub = subst?.get(key);
      if (sub) return evalExpr(sub, env, derivs, t);
      if (key === "T" || key === "TIME") return t;
      if (env.has(key)) return env.get(key)!;
      if (key === "PI") return Math.PI;
      if (key === "E") return Math.E;
      return 0;
    }
    case "derivative": {
      const key = expr.target.toUpperCase();
      return derivs.get(key) ?? 0;
    }
    case "unary": {
      const v = evalExpr(expr.operand, env, derivs, t, subst);
      if (expr.op === "-") return -v;
      if (expr.op === "+") return v;
      return v === 0 ? 1 : 0;
    }
    case "binary": {
      const l = evalExpr(expr.left, env, derivs, t, subst);
      const r = evalExpr(expr.right, env, derivs, t, subst);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r !== 0 ? l / r : 0;
        case "**":
        case "^":
          return Math.pow(l, r);
        case "=":
        case "==":
          return l === r ? 1 : 0;
        case "/=":
        case "<>":
        case "!=":
          return l !== r ? 1 : 0;
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "AND":
          return l !== 0 && r !== 0 ? 1 : 0;
        case "OR":
          return l !== 0 || r !== 0 ? 1 : 0;
      }
      return 0;
    }
    case "conditional": {
      const c = evalExpr(expr.condition, env, derivs, t, subst);
      return c !== 0 ? evalExpr(expr.thenExpr, env, derivs, t, subst) : evalExpr(expr.elseExpr, env, derivs, t, subst);
    }
    case "call": {
      const args = expr.args.map((a) => evalExpr(a, env, derivs, t, subst));
      return evalBuiltin(expr.callee.toUpperCase(), args, t);
    }
  }
}

/**
 * Evaluates a smooth crossing indicator g(t, y) for a WHEN condition:
 * g >= 0 means the condition is TRUE; g < 0 means FALSE.
 */
function evalCrossingIndicator(
  expr: EslExpr,
  env: Map<string, number>,
  derivs: Map<string, number>,
  t: number,
): number {
  if (expr.kind === "binary") {
    if (expr.op === "AND") {
      return Math.min(
        evalCrossingIndicator(expr.left, env, derivs, t),
        evalCrossingIndicator(expr.right, env, derivs, t),
      );
    }
    if (expr.op === "OR") {
      return Math.max(
        evalCrossingIndicator(expr.left, env, derivs, t),
        evalCrossingIndicator(expr.right, env, derivs, t),
      );
    }
    const l = evalExpr(expr.left, env, derivs, t);
    const r = evalExpr(expr.right, env, derivs, t);
    switch (expr.op) {
      case "<=":
      case "<":
        return r - l;
      case ">=":
      case ">":
        return l - r;
      default:
        return evalExpr(expr, env, derivs, t) !== 0 ? 1 : -1;
    }
  }
  return evalExpr(expr, env, derivs, t) !== 0 ? 1 : -1;
}

function collectStatesAndWhens(
  stmts: EslStatement[],
  stateKeys: Set<string>,
  canonicalNames: Map<string, string>,
  whens: WhenDescriptor[],
  submodelMap: Map<string, EslBlock>,
): void {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "assign": {
        const key = stmt.target.toUpperCase();
        if (!canonicalNames.has(key)) canonicalNames.set(key, stmt.target);
        if (stmt.isDerivative) {
          stateKeys.add(key);
        }
        break;
      }
      case "when": {
        whens.push({ index: whens.length, stmt });
        collectStatesAndWhens(stmt.body, stateKeys, canonicalNames, whens, submodelMap);
        collectStatesAndWhens(stmt.elseBody, stateKeys, canonicalNames, whens, submodelMap);
        break;
      }
      case "if": {
        collectStatesAndWhens(stmt.thenBody, stateKeys, canonicalNames, whens, submodelMap);
        collectStatesAndWhens(stmt.elseBody, stateKeys, canonicalNames, whens, submodelMap);
        break;
      }
      case "submodel_call": {
        const sm = submodelMap.get(stmt.callee.toUpperCase());
        if (sm) {
          collectStatesAndWhens(sm.dynamicStatements, stateKeys, canonicalNames, whens, submodelMap);
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Simulates an ESL program (or source string) using a hybrid RK4 + bisection event-detection solver.
 */
export function simulateEsl(
  programOrSource: EslProgram | string,
  options: EslSimulationOptions = {},
): EslSimulationResult {
  const program = typeof programOrSource === "string" ? parseEsl(programOrSource) : programOrSource;

  const submodelMap = new Map<string, EslBlock>();
  for (const [name, sm] of program.submodels) {
    submodelMap.set(name.toUpperCase(), sm);
  }

  let targetBlock: EslBlock | undefined;
  if (options.modelName) {
    targetBlock = program.models.get(options.modelName) ?? program.segments.get(options.modelName);
  }
  if (!targetBlock) {
    targetBlock =
      Array.from(program.models.values())[0] ??
      program.studies[0] ??
      program.blocks.find((b) => b.kind !== "SUBMODEL" && b.kind !== "PACKAGE");
  }
  if (!targetBlock) {
    return {
      modelName: program.name,
      times: [],
      trajectories: {},
      events: [],
      finalValues: {},
      steps: 0,
      terminatedEarly: false,
    };
  }

  const env = new Map<string, number>();
  const derivs = new Map<string, number>();
  const canonicalNames = new Map<string, string>();
  const stateKeySet = new Set<string>();
  const whens: WhenDescriptor[] = [];

  // Initialize package constants
  for (const pkg of program.packages.values()) {
    for (const decl of pkg.declarations) {
      const key = decl.name.toUpperCase();
      canonicalNames.set(key, decl.name);
      const val = decl.initialValue ? evalExpr(decl.initialValue, env, derivs, 0) : 0;
      env.set(key, val);
    }
  }

  // Initialize block declarations
  for (const decl of targetBlock.declarations) {
    const key = decl.name.toUpperCase();
    canonicalNames.set(key, decl.name);
    const val = decl.initialValue ? evalExpr(decl.initialValue, env, derivs, 0) : 0;
    env.set(key, val);
  }

  // Apply overrides before INITIAL
  if (options.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      const key = k.toUpperCase();
      if (!canonicalNames.has(key)) canonicalNames.set(key, k);
      env.set(key, v);
    }
  }

  // Collect states and WHEN clauses
  collectStatesAndWhens(targetBlock.dynamicStatements, stateKeySet, canonicalNames, whens, submodelMap);
  const stateKeys = Array.from(stateKeySet);

  const execStatements = (
    stmts: EslStatement[],
    t: number,
    mode: "initial" | "dynamic" | "event" | "step" | "terminal",
    subst?: Map<string, EslExpr>,
  ): boolean => {
    let terminated = false;
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case "assign": {
          const val = evalExpr(stmt.value, env, derivs, t, subst);
          if (stmt.isDerivative) {
            derivs.set(stmt.target.toUpperCase(), val);
          } else {
            const key = stmt.target.toUpperCase();
            const subTarget = subst?.get(key);
            const targetKey = subTarget?.kind === "identifier" ? subTarget.name.toUpperCase() : key;
            if (!canonicalNames.has(targetKey)) {
              canonicalNames.set(targetKey, subTarget?.kind === "identifier" ? subTarget.name : stmt.target);
            }
            env.set(targetKey, val);
          }
          break;
        }
        case "if": {
          const cond = evalExpr(stmt.condition, env, derivs, t, subst);
          const branch = cond !== 0 ? stmt.thenBody : stmt.elseBody;
          if (execStatements(branch, t, mode, subst)) terminated = true;
          break;
        }
        case "submodel_call": {
          const sm = submodelMap.get(stmt.callee.toUpperCase());
          if (sm) {
            const callSubst = new Map<string, EslExpr>(subst);
            for (let i = 0; i < sm.parameters.length; i++) {
              const p = sm.parameters[i]!;
              const arg = stmt.args[i];
              if (arg) callSubst.set(p.name.toUpperCase(), arg);
            }
            if (execStatements(sm.dynamicStatements, t, mode, callSubst)) terminated = true;
          }
          break;
        }
        case "terminate": {
          if (mode === "dynamic" || mode === "step") {
            const cond = evalExpr(stmt.condition, env, derivs, t, subst);
            if (cond !== 0) terminated = true;
          }
          break;
        }
        case "when":
        case "prepare":
        case "plot":
        case "print":
          break;
      }
    }
    return terminated;
  };

  // Evaluate INITIAL section
  const tStart = options.tStart ?? env.get("TSTART") ?? 0.0;
  execStatements(targetBlock.initialStatements, tStart, "initial");

  // Re-apply explicit overrides after INITIAL so caller overrides always win
  if (options.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      env.set(k.toUpperCase(), v);
    }
  }

  const tEnd = options.tEnd ?? env.get("TFIN") ?? env.get("TSTOP") ?? 10.0;
  const dt = options.dt ?? env.get("DT") ?? 0.01;
  const cint = options.cint ?? env.get("CINT") ?? dt;
  const eventTol = options.eventTolerance ?? 1e-10;
  const maxEventsPerStep = options.maxEventsPerStep ?? 16;

  // Helper to evaluate RHS derivatives at (t, stateVec)
  const evalRhs = (t: number, y: number[]): { dy: number[]; terminated: boolean } => {
    for (let i = 0; i < stateKeys.length; i++) {
      env.set(stateKeys[i]!, y[i]!);
    }
    derivs.clear();
    const terminated = execStatements(targetBlock.dynamicStatements, t, "dynamic");
    const dy = stateKeys.map((k) => derivs.get(k) ?? 0);
    return { dy, terminated };
  };

  // Single RK4 sub-step from (t, y) over step h
  const rk4Step = (t: number, y: number[], h: number): { yNext: number[]; terminated: boolean } => {
    const n = y.length;
    const r1 = evalRhs(t, y);
    const y2 = new Array<number>(n);
    for (let i = 0; i < n; i++) y2[i] = y[i]! + 0.5 * h * r1.dy[i]!;
    const r2 = evalRhs(t + 0.5 * h, y2);

    const y3 = new Array<number>(n);
    for (let i = 0; i < n; i++) y3[i] = y[i]! + 0.5 * h * r2.dy[i]!;
    const r3 = evalRhs(t + 0.5 * h, y3);

    const y4 = new Array<number>(n);
    for (let i = 0; i < n; i++) y4[i] = y[i]! + h * r3.dy[i]!;
    const r4 = evalRhs(t + h, y4);

    const yNext = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yNext[i] = y[i]! + (h / 6.0) * (r1.dy[i]! + 2.0 * r2.dy[i]! + 2.0 * r3.dy[i]! + r4.dy[i]!);
    }
    return { yNext, terminated: r1.terminated || r4.terminated };
  };

  // Initial state vector and algebraic sync at tStart
  let y = stateKeys.map((k) => env.get(k) ?? 0);
  evalRhs(tStart, y);

  // Track initial WHEN indicator signs
  let prevIndicators = whens.map((w) => evalCrossingIndicator(w.stmt.condition, env, derivs, tStart));

  const times: number[] = [];
  const trajectories: Record<string, number[]> = {};
  for (const [, name] of canonicalNames) {
    trajectories[name] = [];
  }

  const recordSample = (t: number): void => {
    times.push(t);
    for (const [key, name] of canonicalNames) {
      if (!trajectories[name]) trajectories[name] = [];
      trajectories[name]!.push(env.get(key) ?? 0);
    }
  };

  recordSample(tStart);

  const events: EslEventRecord[] = [];
  let t = tStart;
  let nextRecordTime = tStart + cint;
  let steps = 0;
  let terminatedEarly = false;

  while (t < tEnd - 1e-12) {
    let hRem = Math.min(dt, tEnd - t);
    let stepEvents = 0;

    while (hRem > 1e-12) {
      const { yNext, terminated } = rk4Step(t, y, hRem);
      // Sync env at t + hRem to check WHEN zero-crossings
      evalRhs(t + hRem, yNext);
      const nextIndicators = whens.map((w) => evalCrossingIndicator(w.stmt.condition, env, derivs, t + hRem));

      // Detect rising zero-crossing (prev < 0 && next >= 0)
      let triggeredIdx = -1;
      for (let wi = 0; wi < whens.length; wi++) {
        if (prevIndicators[wi]! < 0 && nextIndicators[wi]! >= 0) {
          triggeredIdx = wi;
          break;
        }
      }

      if (triggeredIdx >= 0 && stepEvents < maxEventsPerStep) {
        // Bisect in [0, hRem] to locate exact crossing time t + hStar
        const whenDesc = whens[triggeredIdx]!;
        let lo = 0;
        let hi = hRem;
        let yStar = yNext;
        for (let iter = 0; iter < 40; iter++) {
          const mid = 0.5 * (lo + hi);
          const { yNext: yMid } = rk4Step(t, y, mid);
          evalRhs(t + mid, yMid);
          const gMid = evalCrossingIndicator(whenDesc.stmt.condition, env, derivs, t + mid);
          if (gMid >= 0) {
            hi = mid;
            yStar = yMid;
          } else {
            lo = mid;
          }
          if (hi - lo <= eventTol) break;
        }

        const tEvent = t + hi;
        evalRhs(tEvent, yStar);
        const stateBefore: Record<string, number> = {};
        for (const [k, name] of canonicalNames) stateBefore[name] = env.get(k) ?? 0;

        // Execute WHEN event body (reinit / state reset)
        execStatements(whenDesc.stmt.body, tEvent, "event");

        // Sync state vector from env after event action
        y = stateKeys.map((k) => env.get(k) ?? 0);
        evalRhs(tEvent, y);

        const stateAfter: Record<string, number> = {};
        for (const [k, name] of canonicalNames) stateAfter[name] = env.get(k) ?? 0;

        events.push({
          time: tEvent,
          whenIndex: whenDesc.index,
          stateBefore,
          stateAfter,
        });

        // Update indicators after event reset; nudge slightly so already-handled crossing doesn't immediately re-fire
        prevIndicators = whens.map((w, idx) => {
          const g = evalCrossingIndicator(w.stmt.condition, env, derivs, tEvent);
          if (idx === triggeredIdx && Math.abs(g) <= 1e-9) {
            // Evaluate derivative direction slightly after event to determine sign
            const eps = Math.min(1e-7, Math.max(1e-10, hRem - hi));
            const { yNext: yProbe } = rk4Step(tEvent, y, eps);
            evalRhs(tEvent + eps, yProbe);
            const gProbe = evalCrossingIndicator(w.stmt.condition, env, derivs, tEvent + eps);
            evalRhs(tEvent, y);
            return gProbe;
          }
          return g;
        });

        t = tEvent;
        hRem -= hi;
        stepEvents++;
        recordSample(tEvent);
        continue;
      }

      // No event triggered in this sub-step
      t += hRem;
      y = yNext;
      prevIndicators = nextIndicators;
      hRem = 0;

      if (terminated) {
        terminatedEarly = true;
        break;
      }
    }

    steps++;
    if (targetBlock.stepStatements.length > 0) {
      execStatements(targetBlock.stepStatements, t, "step");
      y = stateKeys.map((k) => env.get(k) ?? 0);
    }

    if (t >= nextRecordTime - 1e-10 || t >= tEnd - 1e-12 || terminatedEarly) {
      evalRhs(t, y);
      recordSample(t);
      while (nextRecordTime <= t + 1e-10) {
        nextRecordTime += cint;
      }
    }

    if (terminatedEarly) break;
  }

  // Execute TERMINAL section
  if (targetBlock.terminalStatements.length > 0) {
    execStatements(targetBlock.terminalStatements, t, "terminal");
  }

  const finalValues: Record<string, number> = {};
  for (const [key, name] of canonicalNames) {
    finalValues[name] = env.get(key) ?? 0;
  }

  return {
    modelName: targetBlock.name,
    times,
    trajectories,
    events,
    finalValues,
    steps,
    terminatedEarly,
  };
}
