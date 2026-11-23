// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for MIT DYNAMO System Dynamics Models.
 *
 * Translates DYNAMO Levels (`L`), Rates (`R`), Auxiliaries (`A`),
 * Initials (`N`), Constants (`C`), and Supplementaries (`S`) directly into
 * `@modelscript/runtime`'s `IDaeBuilder` linear-memory representation.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  type IDaeBuilder,
  UnaryOp,
  VarType,
  Variability,
} from "@modelscript/runtime";
import { ensureBuiltInDynamoLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { DynamoExpr, DynamoModel } from "../types.js";

export interface DynamoDaeLoweringResult {
  stateVarIndices: number[];
  parameterVarIndices: number[];
  algebraicVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

export interface DynamoToDaeOptions {
  modelName?: string | undefined;
}

function evalConstExpr(expr: DynamoExpr | undefined, env: Map<string, number>): number {
  if (!expr) return 0;
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "var":
      return env.get(expr.name) ?? 0;
    case "unary": {
      const v = evalConstExpr(expr.operand, env);
      return expr.op === "-" ? -v : v;
    }
    case "binary": {
      const l = evalConstExpr(expr.left, env);
      const r = evalConstExpr(expr.right, env);
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
    case "call":
      return 0;
  }
}

/**
 * Extracts the net derivative expression `dL/dt` from a classic DYNAMO Level equation:
 *   `L.K = L.J + (DT) * (netRate)`  or  `L.K = L.J + netRate * DT`
 * Falls back to `(rhs - L.J) / DT` for non-standard level forms.
 */
export function extractLevelRateExpr(levelName: string, rhs: DynamoExpr, dt: number): DynamoExpr {
  // Match L.J + (DT * rate) or L.J + (rate * DT) or L.J - (DT * rate)
  if (rhs.kind === "binary" && (rhs.op === "+" || rhs.op === "-")) {
    const isSelfLeft = rhs.left.kind === "var" && rhs.left.name === levelName;
    const isSelfRight = rhs.right.kind === "var" && rhs.right.name === levelName;

    if (isSelfLeft) {
      const term = rhs.right;
      const rate = unwrapDtFactor(term);
      if (rate) {
        return rhs.op === "-" ? { kind: "unary", op: "-", operand: rate } : rate;
      }
    } else if (isSelfRight && rhs.op === "+") {
      const rate = unwrapDtFactor(rhs.left);
      if (rate) return rate;
    }
  }

  // Fallback: (rhs - L) / DT
  return {
    kind: "binary",
    op: "/",
    left: { kind: "binary", op: "-", left: rhs, right: { kind: "var", name: levelName } },
    right: { kind: "number", value: dt },
  };
}

function unwrapDtFactor(expr: DynamoExpr): DynamoExpr | undefined {
  if (expr.kind === "binary" && expr.op === "*") {
    if (expr.left.kind === "var" && expr.left.name === "DT") return expr.right;
    if (expr.right.kind === "var" && expr.right.name === "DT") return expr.left;
  }
  return undefined;
}

/**
 * Lowers a parsed `DynamoModel` directly into an `IDaeBuilder` arena.
 */
export function lowerDynamoToDae(builder: IDaeBuilder, model: DynamoModel): DynamoDaeLoweringResult {
  ensureBuiltInDynamoLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  const algebraicVarIndices: number[] = [];
  let equationCount = 0;

  const dt = model.spec.dt ?? 1.0;

  // Pre-evaluate constant values and initial values for start attributes
  const constValues = new Map<string, number>();
  constValues.set("DT", dt);
  constValues.set("LENGTH", model.spec.length ?? 100.0);

  for (const eq of model.equations) {
    if (eq.kind === "C") {
      constValues.set(eq.name, evalConstExpr(eq.expr, constValues));
    }
  }
  const initialValues = new Map<string, number>();
  for (const eq of model.equations) {
    if (eq.kind === "N") {
      const val = evalConstExpr(eq.expr, new Map([...constValues, ...initialValues]));
      initialValues.set(eq.name, val);
    }
  }

  function getOrAddVar(name: string, variability: Variability = Variability.Continuous, startVal = 0.0): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existingIdx = builder.lookupVariable(key);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(key, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // Register DT as parameter
  const dtIdx = getOrAddVar("DT", Variability.Parameter, dt);
  parameterVarIndices.push(dtIdx);

  // 1. Register Constants (C)
  for (const eq of model.equations) {
    if (eq.kind === "C") {
      const val = constValues.get(eq.name) ?? 0.0;
      const idx = getOrAddVar(eq.name, Variability.Parameter, val);
      parameterVarIndices.push(idx);
    }
  }

  // 2. Register Levels (L) as continuous state variables
  for (const eq of model.equations) {
    if (eq.kind === "L") {
      const startVal = initialValues.get(eq.name) ?? 0.0;
      const idx = getOrAddVar(eq.name, Variability.Continuous, startVal);
      stateVarIndices.push(idx);
    }
  }

  // 3. Register Rates (R), Auxiliaries (A), and Supplementaries (S)
  for (const eq of model.equations) {
    if (eq.kind === "R" || eq.kind === "A" || eq.kind === "S") {
      const startVal = initialValues.get(eq.name) ?? 0.0;
      const idx = getOrAddVar(eq.name, Variability.Continuous, startVal);
      algebraicVarIndices.push(idx);
    }
  }

  function lowerExpr(expr: DynamoExpr): number {
    switch (expr.kind) {
      case "number":
        return builder.addRealLiteral(expr.value);
      case "var": {
        if (expr.name === "TIME") {
          const tIdx = getOrAddVar("TIME", Variability.Continuous, 0.0);
          return builder.addName(tIdx);
        }
        const varIdx = getOrAddVar(expr.name, Variability.Continuous, 0.0);
        return builder.addName(varIdx);
      }
      case "unary": {
        const inner = lowerExpr(expr.operand);
        if (expr.op === "-") {
          return builder.addUnaryExpr(UnaryOp.Negate, inner);
        }
        return inner;
      }
      case "binary": {
        const left = lowerExpr(expr.left);
        const right = lowerExpr(expr.right);
        switch (expr.op) {
          case "+":
            return builder.addBinaryExpr(BinOp.Add, left, right);
          case "-":
            return builder.addBinaryExpr(BinOp.Sub, left, right);
          case "*":
            return builder.addBinaryExpr(BinOp.Mul, left, right);
          case "/":
            return builder.addBinaryExpr(BinOp.Div, left, right);
          case "^":
            return builder.addBinaryExpr(BinOp.Pow, left, right);
          default:
            return builder.addRealLiteral(0.0);
        }
      }
      case "call": {
        const fn = expr.name.toUpperCase();
        // CLIP(P, Q, R, S) => if R >= S then P else Q
        if ((fn === "CLIP" || fn === "FIFGE") && expr.args.length >= 4) {
          const cond = builder.addBinaryExpr(BinOp.Gte, lowerExpr(expr.args[2]!), lowerExpr(expr.args[3]!));
          return builder.addIfElse(cond, lowerExpr(expr.args[0]!), lowerExpr(expr.args[1]!));
        }
        // SWITCH(P, Q, R) => if R == 0 then P else Q
        if ((fn === "SWITCH" || fn === "FIFZE") && expr.args.length >= 3) {
          const cond = builder.addBinaryExpr(BinOp.Eq, lowerExpr(expr.args[2]!), builder.addRealLiteral(0.0));
          return builder.addIfElse(cond, lowerExpr(expr.args[0]!), lowerExpr(expr.args[1]!));
        }
        // STEP(HEIGHT, STIME) => if TIME >= STIME then HEIGHT else 0
        if (fn === "STEP" && expr.args.length >= 2) {
          const tIdx = getOrAddVar("TIME", Variability.Continuous, 0.0);
          const cond = builder.addBinaryExpr(BinOp.Gte, builder.addName(tIdx), lowerExpr(expr.args[1]!));
          return builder.addIfElse(cond, lowerExpr(expr.args[0]!), builder.addRealLiteral(0.0));
        }
        // RAMP(SLOPE, RTIME) => if TIME >= RTIME then SLOPE * (TIME - RTIME) else 0
        if (fn === "RAMP" && expr.args.length >= 2) {
          const tIdx = getOrAddVar("TIME", Variability.Continuous, 0.0);
          const tExpr = builder.addName(tIdx);
          const rtimeExpr = lowerExpr(expr.args[1]!);
          const cond = builder.addBinaryExpr(BinOp.Gte, tExpr, rtimeExpr);
          const delta = builder.addBinaryExpr(BinOp.Sub, tExpr, rtimeExpr);
          const rampVal = builder.addBinaryExpr(BinOp.Mul, lowerExpr(expr.args[0]!), delta);
          return builder.addIfElse(cond, rampVal, builder.addRealLiteral(0.0));
        }
        // Fallback for SMOOTH/DELAY/TABLE/math functions: lower first argument or 0
        if (expr.args.length > 0) {
          return lowerExpr(expr.args[0]!);
        }
        return builder.addRealLiteral(0.0);
      }
    }
  }

  // 4. Lower Level differential equations: der(L) = rateExpr
  for (const eq of model.equations) {
    if (eq.kind === "L" && eq.expr) {
      const varIdx = getOrAddVar(eq.name, Variability.Continuous, initialValues.get(eq.name) ?? 0.0);
      const rateExpr = extractLevelRateExpr(eq.name, eq.expr, dt);
      const lhs = builder.addDer(varIdx);
      const rhs = lowerExpr(rateExpr);
      builder.addEquation(EqKind.Simple, lhs, rhs);
      equationCount++;
    }
  }

  // 5. Lower Rate, Auxiliary, and Supplementary algebraic equations: X = rhs
  for (const eq of model.equations) {
    if ((eq.kind === "R" || eq.kind === "A" || eq.kind === "S") && eq.expr) {
      const varIdx = getOrAddVar(eq.name, Variability.Continuous, 0.0);
      const lhs = builder.addName(varIdx);
      const rhs = lowerExpr(eq.expr);
      builder.addEquation(EqKind.Simple, lhs, rhs);
      equationCount++;
    }
  }

  return {
    stateVarIndices,
    parameterVarIndices,
    algebraicVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * Lowers a parsed `DynamoModel` into a new `DAEBuilder` linear-memory arena.
 */
export function dynamoToDae(model: DynamoModel, options?: DynamoToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "DynamoModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerDynamoToDae(builder, model);
  return builder;
}
