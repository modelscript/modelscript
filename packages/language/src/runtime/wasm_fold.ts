// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on ArenaDAEBuilder and WebAssembly memory buffers.
 */

import type { QueryDB, SymbolId } from "../compiler/runtime.js";
import { ArenaDAEBuilder, BinOp, EqKind, ExprKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";

export type ArenaConstantValue = number | boolean | string | ArenaConstantValue[];

/**
 * Evaluates an elementary math function on constant real inputs.
 */
function evalMathBuiltin(funcName: string, arg1: number, arg2 = 0.0): number {
  switch (funcName.toLowerCase()) {
    case "sin":
      return Math.sin(arg1);
    case "cos":
      return Math.cos(arg1);
    case "tan":
      return Math.tan(arg1);
    case "asin":
      return Math.asin(arg1);
    case "acos":
      return Math.acos(arg1);
    case "atan":
      return Math.atan(arg1);
    case "atan2":
      return Math.atan2(arg1, arg2);
    case "sinh":
      return Math.sinh(arg1);
    case "cosh":
      return Math.cosh(arg1);
    case "tanh":
      return Math.tanh(arg1);
    case "exp":
      return Math.exp(arg1);
    case "log":
      return arg1 > 0 ? Math.log(arg1) : 0.0;
    case "log10":
      return arg1 > 0 ? Math.log10(arg1) : 0.0;
    case "sqrt":
      return arg1 >= 0 ? Math.sqrt(arg1) : 0.0;
    case "abs":
      return Math.abs(arg1);
    case "sign":
      return arg1 > 0 ? 1.0 : arg1 < 0 ? -1.0 : 0.0;
    case "min":
      return Math.min(arg1, arg2);
    case "max":
      return Math.max(arg1, arg2);
    case "floor":
      return Math.floor(arg1);
    case "ceil":
      return Math.ceil(arg1);
    case "pow":
      return Math.pow(arg1, arg2);
    default:
      return 0.0;
  }
}

/**
 * Evaluates an expression node in ArenaDAEBuilder to a scalar constant if possible.
 */
export function evaluateConstantArenaExpression(
  arena: ArenaDAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
  visitedDepth = 0,
): number | boolean | null {
  if (exprId < 0 || exprId >= arena.exprCount || visitedDepth > 100) {
    return null;
  }

  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.RealLiteral) {
    return arena.getExprRealValue(exprId);
  }

  if (kind === ExprKind.IntLiteral) {
    return arena.getExprData1(exprId);
  }

  if (kind === ExprKind.BoolLiteral) {
    return arena.getExprData1(exprId) !== 0;
  }

  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varName = arena.interner.resolve(nameId);
    if (paramMap && paramMap.has(varName)) {
      return paramMap.get(varName) ?? null;
    }
    const varIdx = nameToIdx ? nameToIdx.get(varName) : undefined;
    if (varIdx !== undefined && !arena.isVarRemoved(varIdx)) {
      const variability = arena.getVarVariability(varIdx);
      if (variability === Variability.Constant || variability === Variability.Parameter) {
        return arena.getVarStartValue(varIdx);
      }
    }
    return null;
  }

  if (kind === ExprKind.Negate) {
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(arena, childId, paramMap, nameToIdx, visitedDepth + 1);
    if (typeof childVal === "number") return -childVal;
    return null;
  }

  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId);
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(arena, childId, paramMap, nameToIdx, visitedDepth + 1);
    if (childVal === null) return null;

    if (op === UnaryOp.Not) {
      if (typeof childVal === "boolean") return !childVal;
      if (typeof childVal === "number") return childVal === 0;
    } else if (op === UnaryOp.Negate) {
      if (typeof childVal === "number") return -childVal;
    }
    return null;
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);

    const lVal = evaluateConstantArenaExpression(arena, leftId, paramMap, nameToIdx, visitedDepth + 1);
    const rVal = evaluateConstantArenaExpression(arena, rightId, paramMap, nameToIdx, visitedDepth + 1);

    if (lVal === null || rVal === null) return null;

    const lNum = typeof lVal === "boolean" ? (lVal ? 1 : 0) : lVal;
    const rNum = typeof rVal === "boolean" ? (rVal ? 1 : 0) : rVal;

    switch (op) {
      case BinOp.Add:
        return lNum + rNum;
      case BinOp.Sub:
        return lNum - rNum;
      case BinOp.Mul:
        return lNum * rNum;
      case BinOp.Div:
        return rNum !== 0 ? lNum / rNum : 0;
      case BinOp.Pow:
        return Math.pow(lNum, rNum);
      case BinOp.Eq:
        return lNum === rNum;
      case BinOp.Neq:
        return lNum !== rNum;
      case BinOp.Lt:
        return lNum < rNum;
      case BinOp.Lte:
        return lNum <= rNum;
      case BinOp.Gt:
        return lNum > rNum;
      case BinOp.Gte:
        return lNum >= rNum;
      case BinOp.And:
        return lVal !== false && lVal !== 0 && rVal !== false && rVal !== 0;
      case BinOp.Or:
        return (lVal !== false && lVal !== 0) || (rVal !== false && rVal !== 0);
    }
  }

  if (kind === ExprKind.IfElse) {
    const condId = arena.getExprData1(exprId);
    const condVal = evaluateConstantArenaExpression(arena, condId, paramMap, nameToIdx, visitedDepth + 1);
    if (condVal !== null) {
      const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
      const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
      return evaluateConstantArenaExpression(arena, branchId, paramMap, nameToIdx, visitedDepth + 1);
    }
  }

  if (kind === ExprKind.Call) {
    const funcName = arena.interner.resolve(arena.getExprData1(exprId));
    const firstArgId = arena.getExprLeft(exprId);
    const argCount = arena.getExprRight(exprId);

    if (argCount >= 1 && firstArgId >= 0) {
      const arg1 = evaluateConstantArenaExpression(arena, firstArgId, paramMap, nameToIdx, visitedDepth + 1);
      if (typeof arg1 === "number") {
        let arg2 = 0.0;
        if (argCount >= 2) {
          const arg2Val = evaluateConstantArenaExpression(arena, firstArgId + 1, paramMap, nameToIdx, visitedDepth + 1);
          if (typeof arg2Val !== "number") return null;
          arg2 = arg2Val;
        }
        return evalMathBuiltin(funcName, arg1, arg2);
      }
    }
  }

  return null;
}

/**
 * Fold constant and parameter expressions in the arena to literal values
 * where possible. This is done iteratively until fixed point or maxIterations.
 */
export function foldArenaConstants(
  arena: ArenaDAEBuilder,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  db?: QueryDB,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scopeId?: SymbolId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  omcCompatibility = false,
  maxIterations = 100,
): number {
  const nameToIdx = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      nameToIdx.set(arena.getVarName(i), i);
    }
  }

  const paramMap = new Map<string, number>();

  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // 1. Update parameter map from current constant and parameter variables
    paramMap.clear();
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || v === Variability.Parameter) {
        const name = arena.getVarName(i);
        const exprId = arena.getVarExpression(i);
        if (typeof exprId === "number" && exprId >= 0) {
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx);
          if (typeof evalVal === "number") {
            paramMap.set(name, evalVal);
            if (arena.getVarStartValue(i) !== evalVal) {
              arena.setVarStartValue(i, evalVal);
              changed = true;
            }
            continue;
          } else if (typeof evalVal === "boolean") {
            const numVal = evalVal ? 1.0 : 0.0;
            paramMap.set(name, numVal);
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
            continue;
          }
        }
        paramMap.set(name, arena.getVarStartValue(i));
      }
    }

    // 2. Fold variable binding expressions
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter) continue;

      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        const folded = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx);
        if (folded !== null) {
          const varType = arena.getVarType(i);
          let newLiteralId: number;
          if (varType === VarType.Boolean && typeof folded === "boolean") {
            newLiteralId = arena.addBoolLiteral(folded);
          } else if (varType === VarType.Integer && typeof folded === "number") {
            newLiteralId = arena.addIntLiteral(Math.trunc(folded));
          } else if (typeof folded === "number") {
            newLiteralId = arena.addRealLiteral(folded);
          } else {
            continue;
          }

          if (newLiteralId !== exprId) {
            arena.setVarExpression(i, newLiteralId);
            const numVal = typeof folded === "boolean" ? (folded ? 1.0 : 0.0) : folded;
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
            }
            changed = true;
          }
        }
      }
    }

    // 3. Fold equations (LHS == RHS)
    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.getEqKind(eq) !== EqKind.Simple) continue;

      const lhsExpr = arena.getEqLhs(eq);
      const rhsExpr = arena.getEqRhs(eq);
      if (rhsExpr >= 0) {
        const foldedRhs = evaluateConstantArenaExpression(arena, rhsExpr, paramMap, nameToIdx);
        if (foldedRhs !== null) {
          let varType = VarType.Real;
          if (arena.getExprKind(lhsExpr) === ExprKind.Name) {
            const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
            const varIdx = nameToIdx.get(varName);
            if (varIdx !== undefined) {
              varType = arena.getVarType(varIdx);
            }
          }

          let newRhs: number;
          if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
            newRhs = arena.addBoolLiteral(foldedRhs);
          } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
            newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
          } else if (typeof foldedRhs === "number") {
            newRhs = arena.addRealLiteral(foldedRhs);
          } else {
            newRhs = arena.addRealLiteral(Number(foldedRhs));
          }

          if (newRhs !== rhsExpr) {
            arena.setEqRhs(eq, newRhs);
            changed = true;
          }
        }
      }
    }
  }

  return iterations;
}
