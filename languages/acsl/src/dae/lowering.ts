// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for ACSL (Advanced Continuous Simulation Language, 1975).
 *
 * Lowers ACSL INITIAL, DERIVATIVE, INTEG/LIMINT, REALPL/CMPXPL/LEDLAG, DISCRETE,
 * and algebraic assignments directly into `@modelscript/runtime`'s `IDaeBuilder`
 * linear-memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInAcslLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { AcslExpr, AcslProgram } from "../types.js";

export interface AcslDaeLoweringResult {
  stateVarIndices: number[];
  parameterVarIndices: number[];
  discreteVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function evalSimpleConst(expr: AcslExpr | undefined, env: Map<string, number>): number {
  if (!expr) return 0.0;
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value ? 1.0 : 0.0;
    case "ident":
      return env.get(expr.name.toUpperCase()) ?? 0.0;
    case "unary": {
      const v = evalSimpleConst(expr.operand, env);
      if (expr.op === "-") return -v;
      if (expr.op === ".NOT.") return v === 0 ? 1 : 0;
      return v;
    }
    case "binary": {
      const l = evalSimpleConst(expr.left, env);
      const r = evalSimpleConst(expr.right, env);
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
        default:
          return 0.0;
      }
    }
    default:
      return 0.0;
  }
}

function mapBinOp(op: Extract<AcslExpr, { kind: "binary" }>["op"]): BinOp {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
      return BinOp.Div;
    case "**":
      return BinOp.Pow;
    case ".AND.":
      return BinOp.And;
    case ".OR.":
      return BinOp.Or;
    case ".EQ.":
    case "==":
      return BinOp.Eq;
    case ".NE.":
    case "/=":
      return BinOp.Neq;
    case ".LT.":
    case "<":
      return BinOp.Lt;
    case ".LE.":
    case "<=":
      return BinOp.Lte;
    case ".GT.":
    case ">":
      return BinOp.Gt;
    case ".GE.":
    case ">=":
      return BinOp.Gte;
  }
}

/**
 * Lowers a parsed `AcslProgram` directly into an `IDaeBuilder` arena.
 */
export function lowerAcslToDae(builder: IDaeBuilder, program: AcslProgram): AcslDaeLoweringResult {
  ensureBuiltInAcslLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  const discreteVarIndices: number[] = [];
  const constEnv = new Map<string, number>([
    ["PI", Math.PI],
    ["E", Math.E],
  ]);
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
    varType: VarType = VarType.Real,
  ): number {
    const key = name.toUpperCase();
    const existing = variableMap.get(key);
    if (existing !== undefined) return existing;

    const inBuilder = builder.lookupVariable(name);
    if (inBuilder !== -1) {
      variableMap.set(key, inBuilder);
      return inBuilder;
    }

    const idx = builder.addVariable(name, varType, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  function lowerExpr(expr: AcslExpr): number {
    switch (expr.kind) {
      case "number":
        return builder.addRealLiteral(expr.value);
      case "boolean":
        return builder.addRealLiteral(expr.value ? 1.0 : 0.0);
      case "string":
        return builder.addRealLiteral(0.0);
      case "ident": {
        const up = expr.name.toUpperCase();
        if (up === "T" || up === "TIME") {
          const tVar = getOrAddVar("time", Variability.Continuous, 0.0);
          return builder.addName(tVar);
        }
        if (up === "PI") return builder.addRealLiteral(Math.PI);
        const vId = getOrAddVar(expr.name, Variability.Continuous, constEnv.get(up) ?? 0.0);
        return builder.addName(vId);
      }
      case "unary": {
        const operandId = lowerExpr(expr.operand);
        if (expr.op === "+") return operandId;
        if (expr.op === "-") return builder.addUnaryExpr(UnaryOp.Negate, operandId);
        return builder.addUnaryExpr(UnaryOp.Not, operandId);
      }
      case "binary": {
        const leftId = lowerExpr(expr.left);
        const rightId = lowerExpr(expr.right);
        return builder.addBinaryExpr(mapBinOp(expr.op), leftId, rightId);
      }
      case "call": {
        const callee = expr.callee.toUpperCase();
        const argIds = expr.args.map((a) => lowerExpr(a));
        // Lower standard ACSL calls via DAEBuilder call expression
        if (
          typeof (builder as unknown as { addCallExpr?: (fn: string, args: number[]) => number }).addCallExpr ===
          "function"
        ) {
          return (builder as unknown as { addCallExpr: (fn: string, args: number[]) => number }).addCallExpr(
            callee.toLowerCase(),
            argIds,
          );
        }
        const firstArg = argIds[0] ?? builder.addRealLiteral(0.0);
        return firstArg;
      }
    }
  }

  // 1. Register CONSTANT / INTEGER / LOGICAL / REAL declarations as parameters or variables
  for (const decl of program.declarations) {
    const val = evalSimpleConst(decl.initialValue, constEnv);
    const key = decl.name.toUpperCase();
    constEnv.set(key, val);

    const varType =
      decl.kind === "INTEGER" ? VarType.Integer : decl.kind === "LOGICAL" ? VarType.Boolean : VarType.Real;
    const variability = decl.kind === "CONSTANT" ? Variability.Parameter : Variability.Continuous;

    const varId = getOrAddVar(decl.name, variability, val, varType);
    if (decl.kind === "CONSTANT") {
      parameterVarIndices.push(varId);
    }
  }

  // 2. Evaluate INITIAL assignments to seed start values and emit initial equations
  for (const assign of program.assignments) {
    if (assign.section !== "INITIAL") continue;
    const val = evalSimpleConst(assign.expr, constEnv);
    const key = assign.target.toUpperCase();
    constEnv.set(key, val);
    const varId = getOrAddVar(assign.target, Variability.Continuous, val);
    const rhsId = lowerExpr(assign.expr);
    builder.addEquation(EqKind.Simple, builder.addName(varId), rhsId);
    equationCount++;
  }

  // 3. Lower INTEG / LIMINT continuous states: der(x) = derivExpr
  const loweredStateTargets = new Set<string>();
  for (const integ of program.integrators) {
    const key = integ.stateVar.toUpperCase();
    const icVal = evalSimpleConst(integ.initialCondExpr, constEnv);
    constEnv.set(key, icVal);

    const stateId = getOrAddVar(integ.stateVar, Variability.Continuous, icVal);
    stateVarIndices.push(stateId);
    loweredStateTargets.add(key);

    const derLhs = builder.addDer(stateId);
    const derivRhs = lowerExpr(integ.derivativeExpr);
    builder.addEquation(EqKind.Simple, derLhs, derivRhs);
    equationCount++;

    if (integ.initialCondExpr) {
      builder.addEquation(EqKind.Simple, builder.addName(stateId), lowerExpr(integ.initialCondExpr));
      equationCount++;
    }
  }

  // 4. Lower DERIVATIVE & DYNAMIC algebraic equations and transfer-function operators
  for (const assign of program.assignments) {
    if (assign.section !== "DERIVATIVE" && assign.section !== "DYNAMIC") continue;
    const key = assign.target.toUpperCase();
    if (loweredStateTargets.has(key)) continue;

    // REALPL(tau, u, ic): tau * der(y) = u - y
    if (assign.expr.kind === "call" && assign.expr.callee === "REALPL" && assign.expr.args.length >= 2) {
      const tauExpr = assign.expr.args[0]!;
      const uExpr = assign.expr.args[1]!;
      const icVal = evalSimpleConst(assign.expr.args[2], constEnv);
      const yId = getOrAddVar(assign.target, Variability.Continuous, icVal);
      stateVarIndices.push(yId);
      const diff = builder.addBinaryExpr(BinOp.Sub, lowerExpr(uExpr), builder.addName(yId));
      const rhs = builder.addBinaryExpr(BinOp.Div, diff, lowerExpr(tauExpr));
      builder.addEquation(EqKind.Simple, builder.addDer(yId), rhs);
      equationCount++;
      continue;
    }

    // CMPXPL(a, b, u, ic1, ic2): der(y) = v; der(v) = (u - b*v - y) / a
    if (assign.expr.kind === "call" && assign.expr.callee === "CMPXPL" && assign.expr.args.length >= 3) {
      const aExpr = assign.expr.args[0]!;
      const bExpr = assign.expr.args[1]!;
      const uExpr = assign.expr.args[2]!;
      const ic1 = evalSimpleConst(assign.expr.args[3], constEnv);
      const ic2 = evalSimpleConst(assign.expr.args[4], constEnv);
      const yId = getOrAddVar(assign.target, Variability.Continuous, ic1);
      const vId = getOrAddVar(`${assign.target}_dot`, Variability.Continuous, ic2);
      stateVarIndices.push(yId, vId);

      builder.addEquation(EqKind.Simple, builder.addDer(yId), builder.addName(vId));
      const bv = builder.addBinaryExpr(BinOp.Mul, lowerExpr(bExpr), builder.addName(vId));
      const num = builder.addBinaryExpr(
        BinOp.Sub,
        builder.addBinaryExpr(BinOp.Sub, lowerExpr(uExpr), bv),
        builder.addName(yId),
      );
      const rhs = builder.addBinaryExpr(BinOp.Div, num, lowerExpr(aExpr));
      builder.addEquation(EqKind.Simple, builder.addDer(vId), rhs);
      equationCount += 2;
      continue;
    }

    // Standard algebraic equation: target = expr
    const lhsId = getOrAddVar(assign.target, Variability.Continuous, 0.0);
    const rhsId = lowerExpr(assign.expr);
    builder.addEquation(EqKind.Simple, builder.addName(lhsId), rhsId);
    equationCount++;
  }

  // 5. Lower DISCRETE blocks as discrete variables & when equations
  for (const disc of program.discreteBlocks) {
    for (const assign of disc.assignments) {
      const dVarId = getOrAddVar(assign.target, Variability.Discrete, constEnv.get(assign.target.toUpperCase()) ?? 0.0);
      if (!discreteVarIndices.includes(dVarId)) {
        discreteVarIndices.push(dVarId);
      }
      const rhsId = lowerExpr(assign.expr);
      builder.addEquation(EqKind.Simple, builder.addName(dVarId), rhsId);
      equationCount++;
    }
  }

  return {
    stateVarIndices,
    parameterVarIndices,
    discreteVarIndices,
    equationCount,
    variableMap,
  };
}
