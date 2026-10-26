// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Direct Linear-Memory DAE Lowering.
 *
 * Lowers IEC 61131-3 PLCopen POUs and Structured Text statements directly
 * into ModelScript's zero-intermediate DAEBuilder linear memory arena.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  UnaryOp,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { PlcBinaryOp, PlcExpr, PlcPou, PlcProject, PlcStatement, PlcUnaryOp, PlcVariable } from "../types.js";

export function lowerPlcopenToDae(target: PlcPou | PlcProject, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? ("pous" in target ? (target.contentHeader?.name ?? "PLC_Project") : target.name);
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const pous: PlcPou[] = "pous" in target ? target.pous : [target];

  const varMap = new Map<string, number>();
  const varExprMap = new Map<string, number>();

  for (const pou of pous) {
    // 1. Declare POU Variables
    for (const v of pou.variables) {
      declarePlcVariable(arena, interner, pou.name, v, varMap, varExprMap);
    }

    // 2. Lower Body Statements to Equations
    if (pou.body.kind === "ST" && pou.body.st) {
      lowerStatements(arena, interner, pou, pou.body.st.statements, varExprMap);
    }
  }

  return arena;
}

function declarePlcVariable(
  arena: DAEBuilder,
  interner: StringInterner,
  pouName: string,
  v: PlcVariable,
  varMap: Map<string, number>,
  varExprMap: Map<string, number>,
): void {
  const dtUpper = v.dataType.toUpperCase();
  let varType = VarType.Real;
  if (dtUpper === "BOOL") {
    varType = VarType.Boolean;
  } else if (dtUpper === "INT" || dtUpper === "DINT" || dtUpper === "LINT") {
    varType = VarType.Integer;
  }

  let causality = Causality.Local;
  if (v.scope === "input") causality = Causality.Input;
  else if (v.scope === "output") causality = Causality.Output;

  const variability = v.isConstant
    ? Variability.Constant
    : v.scope === "input"
      ? Variability.Continuous
      : Variability.Discrete;

  const fullName = `${pouName}.${v.name}`;
  const nameId = interner.intern(fullName);
  const varIdx = arena.addVariable(fullName, varType, variability, causality);
  const exprId = arena.addExpression(ExprKind.Name, nameId);

  varMap.set(fullName, varIdx);
  varMap.set(v.name, varIdx);
  varExprMap.set(fullName, exprId);
  varExprMap.set(v.name, exprId);

  // If initial value or constant, emit initialization binding
  if (v.initialValue !== undefined) {
    let initExprId: number;
    if (typeof v.initialValue === "number") {
      initExprId = arena.addRealLiteral(v.initialValue);
    } else if (typeof v.initialValue === "boolean") {
      initExprId = arena.addBoolLiteral(v.initialValue);
    } else {
      initExprId = arena.addRealLiteral(0.0);
    }
    arena.addEquation(EqKind.InitialSimple, exprId, initExprId);
  }
}

function lowerStatements(
  arena: DAEBuilder,
  interner: StringInterner,
  pou: PlcPou,
  statements: PlcStatement[],
  varExprMap: Map<string, number>,
): void {
  for (const stmt of statements) {
    if (stmt.kind === "assignment") {
      if (stmt.target.kind === "identifier") {
        const targetName = stmt.target.name;
        const targetExprId = varExprMap.get(`${pou.name}.${targetName}`) ?? varExprMap.get(targetName);

        if (targetExprId !== undefined) {
          const valExprId = lowerExpr(arena, interner, pou, stmt.value, varExprMap);
          arena.addEquation(EqKind.Simple, targetExprId, valExprId);
        }
      }
    } else if (stmt.kind === "if") {
      // Direct lowering of then-statements
      lowerStatements(arena, interner, pou, stmt.thenStatements, varExprMap);
      for (const elif of stmt.elsifs) {
        lowerStatements(arena, interner, pou, elif.statements, varExprMap);
      }
      lowerStatements(arena, interner, pou, stmt.elseStatements, varExprMap);
    } else if (stmt.kind === "call") {
      const calleeUpper = stmt.callee.toUpperCase();
      const calleeVar = pou.variables.find((v) => v.name.toLowerCase() === stmt.callee.toLowerCase());
      const resolvedType = (calleeVar?.dataType ?? stmt.callee).toUpperCase();
      if (
        resolvedType.startsWith("TON") ||
        resolvedType.startsWith("TOF") ||
        calleeUpper.startsWith("TON") ||
        calleeUpper.startsWith("TOF")
      ) {
        // Declare timer ET variable and dynamic rate equation
        const etName = `${pou.name}.${stmt.callee}.ET`;
        const qName = `${pou.name}.${stmt.callee}.Q`;

        let etExpr = varExprMap.get(etName);
        if (etExpr === undefined) {
          const etNameId = interner.intern(etName);
          arena.addVariable(etName, VarType.Real, Variability.Continuous, Causality.Local);
          etExpr = arena.addExpression(ExprKind.Name, etNameId);
          varExprMap.set(etName, etExpr);

          // der(ET) = rate
          const derEt = arena.addExpression(ExprKind.Der, etExpr);
          const oneLit = arena.addRealLiteral(1.0);
          arena.addEquation(EqKind.Simple, derEt, oneLit);
        }

        let qExpr = varExprMap.get(qName);
        if (qExpr === undefined) {
          const qNameId = interner.intern(qName);
          arena.addVariable(qName, VarType.Boolean, Variability.Discrete, Causality.Local);
          qExpr = arena.addExpression(ExprKind.Name, qNameId);
          varExprMap.set(qName, qExpr);
        }
      }
    }
  }
}

function lowerExpr(
  arena: DAEBuilder,
  interner: StringInterner,
  pou: PlcPou,
  expr: PlcExpr,
  varExprMap: Map<string, number>,
): number {
  if (expr.kind === "literal") {
    if (expr.literalType === "bool") {
      return arena.addBoolLiteral(Boolean(expr.value));
    }
    if (expr.literalType === "number") {
      return arena.addRealLiteral(Number(expr.value));
    }
    if (expr.literalType === "time") {
      const ms = parseDurationSeconds(expr.value);
      return arena.addRealLiteral(ms);
    }
    return arena.addRealLiteral(0.0);
  }

  if (expr.kind === "identifier") {
    const fullName = `${pou.name}.${expr.name}`;
    const id = varExprMap.get(fullName) ?? varExprMap.get(expr.name);
    if (id !== undefined) return id;

    // Auto-declare missing identifier
    const nameId = interner.intern(fullName);
    arena.addVariable(fullName, VarType.Real, Variability.Continuous, Causality.Local);
    const exprId = arena.addExpression(ExprKind.Name, nameId);
    varExprMap.set(fullName, exprId);
    return exprId;
  }

  if (expr.kind === "binary") {
    const leftId = lowerExpr(arena, interner, pou, expr.left, varExprMap);
    const rightId = lowerExpr(arena, interner, pou, expr.right, varExprMap);
    const binOp = mapBinaryOp(expr.op);
    return arena.addBinaryExpr(binOp, leftId, rightId);
  }

  if (expr.kind === "unary") {
    const argId = lowerExpr(arena, interner, pou, expr.argument, varExprMap);
    const unOp = mapUnaryOp(expr.op);
    return arena.addUnaryExpr(unOp, argId);
  }

  return arena.addRealLiteral(0.0);
}

function mapBinaryOp(op: PlcBinaryOp): BinOp {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
      return BinOp.Div;
    case "=":
      return BinOp.Eq;
    case "<>":
      return BinOp.Neq;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    case "AND":
      return BinOp.And;
    case "OR":
      return BinOp.Or;
    case "XOR":
      return BinOp.Neq;
    default:
      return BinOp.Add;
  }
}

function mapUnaryOp(op: PlcUnaryOp): UnaryOp {
  switch (op) {
    case "-":
      return UnaryOp.Negate;
    case "NOT":
      return UnaryOp.Not;
    default:
      return UnaryOp.Negate;
  }
}

function parseDurationSeconds(val: any): number {
  if (typeof val === "number") return val / 1000;
  if (typeof val === "string") {
    const m = /(?:T|TIME)#(\d+)(ms|s|m|h)?/i.exec(val);
    if (m) {
      const n = parseInt(m[1]!, 10);
      const u = (m[2] ?? "ms").toLowerCase();
      if (u === "ms") return n / 1000;
      if (u === "s") return n;
      if (u === "m") return n * 60;
      if (u === "h") return n * 3600;
    }
  }
  return 0.0;
}
