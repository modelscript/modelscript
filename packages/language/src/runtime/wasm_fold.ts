// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on DAEBuilder and WebAssembly memory buffers.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "./runtime.js";
import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";

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
 * Evaluates an expression node in DAEBuilder to a scalar constant if possible.
 */
export function evaluateConstantArenaExpression(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
  visitedDepth = 0,
  db?: QueryDB,
  scopeId?: SymbolId,
): number | boolean | number[] | null {
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
    if (db && scopeId !== undefined) {
      const resolveName = db.query<(q: string) => SymbolEntry | null>("resolveName", scopeId);
      if (resolveName) {
        const resolved = resolveName(varName);
        if (resolved) {
          if (resolved.kind === "Component" && resolved.metadata) {
            const csvValue = (resolved.metadata as any).csvValue;
            if (csvValue !== undefined) {
              return csvValue;
            }
          }
        }
      }
    }
    return null;
  }

  if (kind === ExprKind.Negate) {
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
    );
    if (typeof childVal === "number") return -childVal;
    return null;
  }

  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId);
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
    );
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

    const lVal = evaluateConstantArenaExpression(arena, leftId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    const rVal = evaluateConstantArenaExpression(arena, rightId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);

    if (lVal === null || rVal === null) return null;

    const lNum = typeof lVal === "boolean" ? (lVal ? 1 : 0) : typeof lVal === "number" ? lVal : null;
    const rNum = typeof rVal === "boolean" ? (rVal ? 1 : 0) : typeof rVal === "number" ? rVal : null;
    if (lNum === null || rNum === null) return null;

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
    const condVal = evaluateConstantArenaExpression(arena, condId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    if (condVal !== null) {
      const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
      const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
      return evaluateConstantArenaExpression(arena, branchId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    }
  }

  if (kind === ExprKind.Call) {
    const funcName = arena.interner.resolve(arena.getExprData1(exprId));
    const firstArgId = arena.getExprLeft(exprId);
    const argCount = arena.getExprRight(exprId);

    if (argCount >= 1 && firstArgId >= 0) {
      const arg1 = evaluateConstantArenaExpression(
        arena,
        firstArgId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (typeof arg1 === "number") {
        let arg2 = 0.0;
        if (argCount >= 2) {
          const arg2Val = evaluateConstantArenaExpression(
            arena,
            firstArgId + 1,
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
          );
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
  arena: DAEBuilder,
  db?: QueryDB,
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
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx, 0, db, scopeId);
          if (evalVal !== null) {
            let foldedValue: number | boolean | number[] | null = evalVal;
            const match = name.match(/\[([\d,]+)\]$/);
            if (match && Array.isArray(foldedValue)) {
              const indices = match[1].split(",").map(Number);
              let current: any = foldedValue;
              for (const idx of indices) {
                if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                  current = current[idx - 1];
                } else {
                  foldedValue = null;
                  break;
                }
              }
              if (foldedValue !== null) {
                foldedValue = current;
              }
            }
            if (typeof foldedValue === "number") {
              paramMap.set(name, foldedValue);
              if (arena.getVarStartValue(i) !== foldedValue) {
                arena.setVarStartValue(i, foldedValue);
                changed = true;
              }
              continue;
            } else if (typeof foldedValue === "boolean") {
              const numVal = foldedValue ? 1.0 : 0.0;
              paramMap.set(name, numVal);
              if (arena.getVarStartValue(i) !== numVal) {
                arena.setVarStartValue(i, numVal);
                changed = true;
              }
              continue;
            }
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
        const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx, 0, db, scopeId);
        if (evalVal !== null) {
          let folded: number | boolean | null = null;
          const match = arena.getVarName(i).match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(evalVal)) {
            const indices = match[1].split(",").map(Number);
            let current: any = evalVal;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                current = null;
                break;
              }
            }
            if (current !== null && (typeof current === "number" || typeof current === "boolean")) {
              folded = current;
            }
          } else if (typeof evalVal === "number" || typeof evalVal === "boolean") {
            folded = evalVal;
          }

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

/**
 * Generates all multi-dimensional 1-based indices for a given shape.
 * Example: shape [2, 3] -> [[1,1], [1,2], [1,3], [2,1], [2,2], [2,3]]
 */
function generateIndices(shape: number[]): number[][] {
  if (shape.length === 0) return [];
  const result: number[][] = [];
  const current: number[] = new Array(shape.length).fill(1);

  while (true) {
    result.push([...current]);
    let i = shape.length - 1;
    while (i >= 0) {
      current[i]++;
      if (current[i]! <= shape[i]!) break;
      current[i] = 1;
      i--;
    }
    if (i < 0) break;
  }
  return result;
}

/**
 * Deferred Batch Scalarization Pass.
 * Takes an DAEBuilder where array variables and equations have been preserved,
 * and scalarizes them into a flat DAE of individual scalar variables and equations.
 */
export function scalarizeArena(dae: DAEBuilder): DAEBuilder {
  const out = new DAEBuilder(dae.interner);
  const arrayShapes = new Map<string, number[]>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;

    const name = dae.getVarName(i);
    const shape = dae.getVarShape(i);
    const type = dae.getVarType(i);
    const variability = dae.getVarVariability(i);
    const causality = dae.getVarCausality(i);
    const start = dae.getVarStartValue(i);
    const flags = dae.getVarFlags(i);

    if (shape.length > 0) {
      arrayShapes.set(name, shape);
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const scalarName = `${name}[${idx.join(",")}]`;
        out.addVariable(scalarName, type, variability, causality, start, flags);
      }
    } else {
      out.addVariable(name, type, variability, causality, start, flags);
    }
  }

  const cloneExpr = (exprId: number, indexSuffix: string, currentShape: number[] | null): number => {
    if (exprId < 0) return exprId;
    const kind = dae.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Name: {
        const nameId = dae.getExprData1(exprId);
        const name = dae.interner.resolve(nameId);
        if (name && arrayShapes.has(name)) {
          const shape = arrayShapes.get(name)!;
          if (currentShape && shape.join(",") === currentShape.join(",")) {
            return out.addNameExpr(`${name}${indexSuffix}`);
          }
        }
        return out.addNameExpr(name || "");
      }
      case ExprKind.IntLiteral:
        return out.addIntLiteral(dae.getExprData1(exprId));
      case ExprKind.RealLiteral:
        return out.addRealLiteral(dae.getExprRealValue(exprId));
      case ExprKind.BoolLiteral:
        return out.addBoolLiteral(dae.getExprData1(exprId) !== 0);
      case ExprKind.StringLiteral: {
        const strId = dae.getExprData1(exprId);
        const str = dae.interner.resolve(strId);
        return out.addStringLiteral(str || "");
      }
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const left = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const right = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addBinaryExpr(op, left, right);
      }
      case ExprKind.Unary: {
        const op = dae.getExprData1(exprId);
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addUnaryExpr(op, operand);
      }
      case ExprKind.Der: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addDerExpr(arg);
      }
      case ExprKind.Pre: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addPreExpr(arg);
      }
      case ExprKind.Call: {
        const funcNameId = dae.getExprData1(exprId);
        const argCount = dae.getExprRight(exprId);
        let currentArg = dae.getExprLeft(exprId);
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          args.push(cloneExpr(currentArg, indexSuffix, currentShape));
          currentArg = dae.getExprLeft(currentArg);
        }
        return out.addCallExpr(dae.interner.resolve(funcNameId) || "", args);
      }
      case ExprKind.Tuple: {
        const count = dae.getExprData1(exprId);
        let curr = dae.getExprLeft(exprId);
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          elems.push(cloneExpr(curr, indexSuffix, currentShape));
          curr = dae.getExprLeft(curr);
        }
        return out.addTupleExpr(elems);
      }
      default:
        return exprId;
    }
  };

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);

    const checkShape = (id: number) => {
      if (dae.getExprKind(id) === ExprKind.Name) {
        const name = dae.interner.resolve(dae.getExprData1(id));
        if (name && arrayShapes.has(name)) {
          return arrayShapes.get(name)!;
        }
      }
      return null;
    };

    const shape = checkShape(lhsId) || checkShape(rhsId);

    if (shape && shape.length > 0) {
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const indexSuffix = `[${idx.join(",")}]`;
        const newLhs = cloneExpr(lhsId, indexSuffix, shape);
        const newRhs = cloneExpr(rhsId, indexSuffix, shape);
        out.addEquation(kind, newLhs, newRhs);
      }
    } else {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      out.addEquation(kind, newLhs, newRhs);
    }
  }

  for (const node of dae.boundaryNodes) {
    out.boundaryNodes.push({ ...node });
  }

  for (const algo of dae.algorithmSections) {
    out.addAlgorithmSection(algo.start, algo.count);
  }

  out.isImpure = dae.isImpure;
  out.descriptionId = dae.descriptionId;

  return out;
}
