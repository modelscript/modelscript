// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native RK4 Numerical Simulator for 20-sim Bond Graphs & SIDOPS ODE Systems.
 *
 * Supports:
 * - Linear & coupled Bond Graph networks (0-junctions, 1-junctions, R, C, I, Se, Sf, TF, GY)
 *   solved via exact linear algebraic elimination at each RK4 stage (verifying power conservation).
 * - Standalone SIDOPS `int(expr, x0)` / `ddt(x) = expr` ODE systems.
 */

import { parseTwentySim } from "../parser/emx-parser.js";
import type { SidopsExpr, TwentySimModel, TwentySimSubmodel } from "../types.js";

export interface TwentySimSimulationOptions {
  startTime?: number | undefined;
  finishTime?: number | undefined;
  stepSize?: number | undefined;
}

export interface TwentySimSimulationResult {
  times: number[];
  variables: Record<string, number[]>;
  stateNames: string[];
  maxPowerResidual: number;
}

function getParam(sub: TwentySimSubmodel, names: string[], fallback: number): number {
  for (const name of names) {
    const found = sub.parameters.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found && typeof found.value === "number" && Number.isFinite(found.value)) {
      return found.value;
    }
  }
  return fallback;
}

function evalSidopsExpr(expr: SidopsExpr, env: Record<string, number>): number {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value ? 1 : 0;
    case "string":
      return 0;
    case "ident":
      return env[expr.name] ?? (expr.name === "pi" ? Math.PI : 0);
    case "member":
      return env[`${expr.object}_${expr.field}`] ?? 0;
    case "unary": {
      const v = evalSidopsExpr(expr.operand, env);
      if (expr.op === "-") return -v;
      if (expr.op === "not") return v === 0 ? 1 : 0;
      return v;
    }
    case "binary": {
      const l = evalSidopsExpr(expr.left, env);
      const r = evalSidopsExpr(expr.right, env);
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
        case "==":
          return l === r ? 1 : 0;
        case "<>":
          return l !== r ? 1 : 0;
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "and":
          return l !== 0 && r !== 0 ? 1 : 0;
        case "or":
          return l !== 0 || r !== 0 ? 1 : 0;
        default:
          return 0;
      }
    }
    case "if":
      return evalSidopsExpr(expr.condition, env) !== 0
        ? evalSidopsExpr(expr.thenExpr, env)
        : evalSidopsExpr(expr.elseExpr, env);
    case "call": {
      const fn = expr.callee.toLowerCase();
      const args = expr.args.map((a) => evalSidopsExpr(a, env));
      switch (fn) {
        case "sin":
          return Math.sin(args[0] ?? 0);
        case "cos":
          return Math.cos(args[0] ?? 0);
        case "exp":
          return Math.exp(args[0] ?? 0);
        case "sqrt":
          return Math.sqrt(Math.max(0, args[0] ?? 0));
        case "abs":
          return Math.abs(args[0] ?? 0);
        case "sign":
          return Math.sign(args[0] ?? 0);
        case "limit":
          return Math.min(args[2] ?? Infinity, Math.max(args[1] ?? -Infinity, args[0] ?? 0));
        default:
          return args[0] ?? 0;
      }
    }
  }
}

/**
 * Dense Gaussian elimination with partial pivoting for small linear algebraic systems Ax = b.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    let maxAbs = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivot = r;
      }
    }
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }
    const diag = M[col]![col]!;
    if (Math.abs(diag) < 1e-14) continue;
    for (let r = col + 1; r < n; r++) {
      const factor = M[r]![col]! / diag;
      for (let c = col; c <= n; c++) {
        M[r]![c] = M[r]![c]! - factor * M[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) {
      sum -= M[r]![c]! * x[c]!;
    }
    const diag = M[r]![r]!;
    x[r] = Math.abs(diag) > 1e-14 ? sum / diag : 0;
  }
  return x;
}

function simulateBondGraph(
  root: TwentySimSubmodel,
  startTime: number,
  finishTime: number,
  stepSize: number,
): TwentySimSimulationResult {
  // Collect all bonds and assign (e, f) indices for each bond
  const bonds = root.connections.filter((c) => c.kind === "bond");
  const subByName = new Map(root.submodels.map((s) => [s.name, s]));

  // Unknowns: 2 * bonds.length => [e_0, f_0, e_1, f_1, ...]
  const numUnknowns = bonds.length * 2;
  const bondIndexByEndpoint = new Map<string, { idx: number; sign: 1 | -1 }[]>();

  const addIncident = (key: string, idx: number, sign: 1 | -1): void => {
    if (!bondIndexByEndpoint.has(key)) bondIndexByEndpoint.set(key, []);
    bondIndexByEndpoint.get(key)!.push({ idx, sign });
  };

  bonds.forEach((b, idx) => {
    addIncident(`${b.fromSubmodel}.${b.fromPort}`, idx, -1);
    addIncident(`${b.toSubmodel}.${b.toPort}`, idx, 1);
    // Also index by submodel name alone for junctions
    addIncident(b.fromSubmodel, idx, -1);
    addIncident(b.toSubmodel, idx, 1);
  });

  // Identify C and I state variables
  const states: Array<{
    name: string;
    kind: "C" | "I";
    param: number;
    bondIdx: number;
    init: number;
  }> = [];

  for (const sub of root.submodels) {
    if (sub.elementKind === "C") {
      const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(sub.name) ?? [];
      if (inc.length > 0) {
        states.push({
          name: `${sub.name}_q`,
          kind: "C",
          param: getParam(sub, ["c", "C", "capacitance", "compliance"], 1.0),
          bondIdx: inc[0]!.idx,
          init: getParam(sub, ["q0", "state_initial", "initial"], 0.0),
        });
      }
    } else if (sub.elementKind === "I") {
      const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(sub.name) ?? [];
      if (inc.length > 0) {
        states.push({
          name: `${sub.name}_p_state`,
          kind: "I",
          param: getParam(sub, ["i", "I", "m", "mass", "inertia", "L", "inductance"], 1.0),
          bondIdx: inc[0]!.idx,
          init: getParam(sub, ["p0", "state_initial", "initial"], 0.0),
        });
      }
    }
  }

  // Solve algebraic bond variables (e_k, f_k) given current state vector y
  const solveAlgebraic = (y: number[]): { ef: number[]; powerResidual: number } => {
    const rows: number[][] = [];
    const rhs: number[] = [];

    const pushRow = (entries: Array<[number, number]>, bVal: number): void => {
      const row = new Array<number>(numUnknowns).fill(0);
      for (const [col, coeff] of entries) {
        row[col] = row[col]! + coeff;
      }
      rows.push(row);
      rhs.push(bVal);
    };

    const eCol = (bIdx: number): number => bIdx * 2;
    const fCol = (bIdx: number): number => bIdx * 2 + 1;

    for (const sub of root.submodels) {
      if (sub.elementKind === "0") {
        const inc = bondIndexByEndpoint.get(sub.name) ?? [];
        if (inc.length === 0) continue;
        // Common effort
        for (let k = 1; k < inc.length; k++) {
          pushRow(
            [
              [eCol(inc[k]!.idx), 1],
              [eCol(inc[0]!.idx), -1],
            ],
            0,
          );
        }
        // Sum of signed flows = 0
        pushRow(
          inc.map((it) => [fCol(it.idx), it.sign]),
          0,
        );
      } else if (sub.elementKind === "1") {
        const inc = bondIndexByEndpoint.get(sub.name) ?? [];
        if (inc.length === 0) continue;
        // Common flow
        for (let k = 1; k < inc.length; k++) {
          pushRow(
            [
              [fCol(inc[k]!.idx), 1],
              [fCol(inc[0]!.idx), -1],
            ],
            0,
          );
        }
        // Sum of signed efforts = 0
        pushRow(
          inc.map((it) => [eCol(it.idx), it.sign]),
          0,
        );
      } else if (sub.elementKind === "Se") {
        const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(sub.name) ?? [];
        if (inc.length > 0) {
          pushRow([[eCol(inc[0]!.idx), 1]], getParam(sub, ["effort", "e", "value", "F", "V"], 1.0));
        }
      } else if (sub.elementKind === "Sf") {
        const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(sub.name) ?? [];
        if (inc.length > 0) {
          pushRow([[fCol(inc[0]!.idx), 1]], getParam(sub, ["flow", "f", "value", "v", "I"], 1.0));
        }
      } else if (sub.elementKind === "R") {
        const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(sub.name) ?? [];
        if (inc.length > 0) {
          const r = getParam(sub, ["r", "R", "resistance", "damping", "b"], 1.0);
          pushRow(
            [
              [eCol(inc[0]!.idx), 1],
              [fCol(inc[0]!.idx), -r],
            ],
            0,
          );
        }
      } else if (sub.elementKind === "C") {
        const stIdx = states.findIndex((st) => st.name === `${sub.name}_q`);
        if (stIdx >= 0) {
          const st = states[stIdx]!;
          pushRow([[eCol(st.bondIdx), 1]], y[stIdx]! / st.param);
        }
      } else if (sub.elementKind === "I") {
        const stIdx = states.findIndex((st) => st.name === `${sub.name}_p_state`);
        if (stIdx >= 0) {
          const st = states[stIdx]!;
          pushRow([[fCol(st.bondIdx), 1]], y[stIdx]! / st.param);
        }
      } else if (sub.elementKind === "TF") {
        const p1 = bondIndexByEndpoint.get(`${sub.name}.p1`) ?? [];
        const p2 = bondIndexByEndpoint.get(`${sub.name}.p2`) ?? [];
        if (p1.length > 0 && p2.length > 0) {
          const r = getParam(sub, ["r", "m", "ratio", "n"], 1.0);
          pushRow(
            [
              [eCol(p1[0]!.idx), 1],
              [eCol(p2[0]!.idx), -r],
            ],
            0,
          );
          pushRow(
            [
              [fCol(p2[0]!.idx), 1],
              [fCol(p1[0]!.idx), -r],
            ],
            0,
          );
        }
      } else if (sub.elementKind === "GY") {
        const p1 = bondIndexByEndpoint.get(`${sub.name}.p1`) ?? [];
        const p2 = bondIndexByEndpoint.get(`${sub.name}.p2`) ?? [];
        if (p1.length > 0 && p2.length > 0) {
          const r = getParam(sub, ["r", "ratio", "g"], 1.0);
          pushRow(
            [
              [eCol(p1[0]!.idx), 1],
              [fCol(p2[0]!.idx), -r],
            ],
            0,
          );
          pushRow(
            [
              [eCol(p2[0]!.idx), 1],
              [fCol(p1[0]!.idx), -r],
            ],
            0,
          );
        }
      }
    }

    const ef =
      numUnknowns > 0 && rows.length === numUnknowns
        ? solveLinearSystem(rows, rhs)
        : new Array<number>(numUnknowns).fill(0);

    // Compute power conservation residual across all junctions, TF, and GY
    let powerResidual = 0;
    for (const sub of root.submodels) {
      if (sub.elementKind === "0" || sub.elementKind === "1") {
        const inc = bondIndexByEndpoint.get(sub.name) ?? [];
        let pSum = 0;
        for (const it of inc) {
          pSum += it.sign * ef[eCol(it.idx)]! * ef[fCol(it.idx)]!;
        }
        powerResidual = Math.max(powerResidual, Math.abs(pSum));
      } else if (sub.elementKind === "TF" || sub.elementKind === "GY") {
        const p1 = bondIndexByEndpoint.get(`${sub.name}.p1`) ?? [];
        const p2 = bondIndexByEndpoint.get(`${sub.name}.p2`) ?? [];
        if (p1.length > 0 && p2.length > 0) {
          const pIn = ef[eCol(p1[0]!.idx)]! * ef[fCol(p1[0]!.idx)]!;
          const pOut = ef[eCol(p2[0]!.idx)]! * ef[fCol(p2[0]!.idx)]!;
          powerResidual = Math.max(powerResidual, Math.abs(pIn - pOut));
        }
      }
    }

    return { ef, powerResidual };
  };

  const rhsDerivs = (y: number[]): number[] => {
    const { ef } = solveAlgebraic(y);
    return states.map((st) => (st.kind === "C" ? ef[st.bondIdx * 2 + 1]! : ef[st.bondIdx * 2]!));
  };

  const times: number[] = [];
  const variables: Record<string, number[]> = {};
  for (const st of states) variables[st.name] = [];
  for (const sub of root.submodels) {
    if (sub.elementKind !== "0" && sub.elementKind !== "1") {
      variables[`${sub.name}_p_e`] = [];
      variables[`${sub.name}_p_f`] = [];
    }
  }

  let y = states.map((s) => s.init);
  const steps = Math.max(1, Math.round((finishTime - startTime) / stepSize));
  let maxPowerResidual = 0;

  const record = (t: number, stateVec: number[]): void => {
    times.push(t);
    const { ef, powerResidual } = solveAlgebraic(stateVec);
    maxPowerResidual = Math.max(maxPowerResidual, powerResidual);
    states.forEach((st, idx) => variables[st.name]!.push(stateVec[idx]!));
    for (const sub of root.submodels) {
      if (sub.elementKind === "0" || sub.elementKind === "1") continue;
      const inc = bondIndexByEndpoint.get(`${sub.name}.p`) ?? bondIndexByEndpoint.get(`${sub.name}.p1`) ?? [];
      const bIdx = inc[0]?.idx;
      variables[`${sub.name}_p_e`]!.push(bIdx !== undefined ? ef[bIdx * 2]! : 0);
      variables[`${sub.name}_p_f`]!.push(bIdx !== undefined ? ef[bIdx * 2 + 1]! : 0);
    }
  };

  record(startTime, y);
  for (let step = 0; step < steps; step++) {
    const t = startTime + (step + 1) * stepSize;
    const h = stepSize;
    const k1 = rhsDerivs(y);
    const k2 = rhsDerivs(y.map((v, i) => v + 0.5 * h * k1[i]!));
    const k3 = rhsDerivs(y.map((v, i) => v + 0.5 * h * k2[i]!));
    const k4 = rhsDerivs(y.map((v, i) => v + h * k3[i]!));
    y = y.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
    record(t, y);
  }

  void subByName;
  return {
    times,
    variables,
    stateNames: states.map((s) => s.name),
    maxPowerResidual,
  };
}

function simulateSidopsEquations(
  root: TwentySimSubmodel,
  startTime: number,
  finishTime: number,
  stepSize: number,
): TwentySimSimulationResult {
  const baseEnv: Record<string, number> = { time: startTime };
  for (const p of root.parameters) {
    baseEnv[p.name] = typeof p.value === "number" ? p.value : 0;
  }
  for (const v of root.variables) {
    baseEnv[v.name] = v.initialValue ?? 0;
  }

  const states: Array<{ name: string; derivExpr: SidopsExpr; init: number }> = [];
  const algEqs: Array<{ name: string; expr: SidopsExpr }> = [];

  for (const eq of root.equations) {
    if (eq.lhs.kind === "ident" && eq.rhs.kind === "call" && eq.rhs.callee.toLowerCase() === "int") {
      const init = eq.rhs.args[1] ? evalSidopsExpr(eq.rhs.args[1], baseEnv) : (baseEnv[eq.lhs.name] ?? 0);
      states.push({ name: eq.lhs.name, derivExpr: eq.rhs.args[0] ?? { kind: "number", value: 0 }, init });
    } else if (eq.lhs.kind === "call" && eq.lhs.callee.toLowerCase() === "ddt" && eq.lhs.args[0]?.kind === "ident") {
      const name = eq.lhs.args[0].name;
      states.push({ name, derivExpr: eq.rhs, init: baseEnv[name] ?? 0 });
    } else if (eq.lhs.kind === "ident") {
      algEqs.push({ name: eq.lhs.name, expr: eq.rhs });
    }
  }

  const evalEnv = (t: number, y: number[]): Record<string, number> => {
    const env: Record<string, number> = { ...baseEnv, time: t };
    states.forEach((st, i) => {
      env[st.name] = y[i]!;
    });
    for (const alg of algEqs) {
      env[alg.name] = evalSidopsExpr(alg.expr, env);
    }
    return env;
  };

  const rhsDerivs = (t: number, y: number[]): number[] => {
    const env = evalEnv(t, y);
    return states.map((st) => evalSidopsExpr(st.derivExpr, env));
  };

  const times: number[] = [];
  const variables: Record<string, number[]> = {};
  for (const st of states) variables[st.name] = [];
  for (const alg of algEqs) variables[alg.name] = [];

  let y = states.map((s) => s.init);
  const steps = Math.max(1, Math.round((finishTime - startTime) / stepSize));

  const record = (t: number, stateVec: number[]): void => {
    times.push(t);
    const env = evalEnv(t, stateVec);
    for (const st of states) variables[st.name]!.push(env[st.name]!);
    for (const alg of algEqs) variables[alg.name]!.push(env[alg.name]!);
  };

  record(startTime, y);
  for (let step = 0; step < steps; step++) {
    const t0 = startTime + step * stepSize;
    const h = stepSize;
    const k1 = rhsDerivs(t0, y);
    const k2 = rhsDerivs(
      t0 + 0.5 * h,
      y.map((v, i) => v + 0.5 * h * k1[i]!),
    );
    const k3 = rhsDerivs(
      t0 + 0.5 * h,
      y.map((v, i) => v + 0.5 * h * k2[i]!),
    );
    const k4 = rhsDerivs(
      t0 + h,
      y.map((v, i) => v + h * k3[i]!),
    );
    y = y.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
    record(t0 + h, y);
  }

  return {
    times,
    variables,
    stateNames: states.map((s) => s.name),
    maxPowerResidual: 0,
  };
}

/**
 * Simulates a 20-sim Bond Graph or SIDOPS model with 4th-order Runge-Kutta.
 */
export function simulateTwentySim(
  modelOrSource: TwentySimModel | string | Buffer | Uint8Array,
  options?: TwentySimSimulationOptions,
): TwentySimSimulationResult {
  const model =
    typeof modelOrSource === "string" || modelOrSource instanceof Uint8Array
      ? parseTwentySim(modelOrSource)
      : modelOrSource;

  const startTime = options?.startTime ?? model.experiment?.startTime ?? 0;
  const finishTime = options?.finishTime ?? model.experiment?.finishTime ?? 5;
  const stepSize = options?.stepSize ?? model.experiment?.stepSize ?? 0.01;

  if (model.root.connections.some((c) => c.kind === "bond")) {
    return simulateBondGraph(model.root, startTime, finishTime, stepSize);
  }
  return simulateSidopsEquations(model.root, startTime, finishTime, stepSize);
}
