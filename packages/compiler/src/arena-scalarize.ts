// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArenaDAEBuilder } from "./dae-arena.js";
import { ExprKind } from "./dae-arena.js";

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
      if (
        current[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */! <=
        shape[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!
      )
        break;
      current[i] = 1;
      i--;
    }
    if (i < 0) break;
  }
  return result;
}

/**
 * Deferred Batch Scalarization Pass
 * Takes an ArenaDAEBuilder where array variables and equations have been preserved,
 * and scalarizes them into a flat DAE of individual scalar variables and equations.
 */
export function scalarizeArena(dae: ArenaDAEBuilder): ArenaDAEBuilder {
  const out = new ArenaDAEBuilder(dae.interner);

  const arrayShapes = new Map<string, number[]>();

  // 1. Expand variables
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

  // Helper to clone an expression into the new arena, applying a specific multi-index to array names
  const cloneExpr = (exprId: number, indexSuffix: string, currentShape: number[] | null): number => {
    if (exprId < 0) return exprId;
    const kind = dae.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Name: {
        const nameId = dae.getExprData1(exprId);
        const name = dae.interner.resolve(nameId);
        if (name && arrayShapes.has(name)) {
          const shape = arrayShapes.get(name) /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
          // Only append the index if the shape matches the expected dimension we are scalarizing
          // (For simplicity, we assume element-wise operations where shapes match)
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
      case ExprKind.Negate: {
        const arg = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Negate, 0, arg);
      }
      case ExprKind.Call: {
        const funcNameId = dae.getExprData1(exprId);
        const argCount = dae.getExprRight(exprId);
        let currentArg = dae.getExprLeft(exprId);
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          args.push(cloneExpr(currentArg, indexSuffix, currentShape));
          currentArg = dae.getExprLeft(currentArg); // Traverse tuple
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
      // Handle other ExprKinds safely...
      default:
        // For unhandled kinds in this simple pass, emit a zero/dummy or try to copy exactly
        return exprId;
    }
  };

  // 2. Expand equations
  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);

    // Naive shape inference: check if LHS is an array name
    let shape: number[] | null = null;
    if (dae.getExprKind(lhsId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(lhsId));
      if (name && arrayShapes.has(name)) {
        shape = arrayShapes.get(name) /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
      }
    }

    if (shape && shape.length > 0) {
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const indexSuffix = `[${idx.join(",")}]`;
        const newLhs = cloneExpr(lhsId, indexSuffix, shape);
        const newRhs = cloneExpr(rhsId, indexSuffix, shape);
        out.addEquation(kind, newLhs, newRhs);
      }
    } else {
      // Scalar equation, clone normally without index suffixes
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      out.addEquation(kind, newLhs, newRhs);
    }
  }

  // Preserve other lists like boundary nodes, algorithms, etc.
  for (const node of dae.boundaryNodes) {
    out.boundaryNodes.push({ ...node });
  }

  for (const algo of dae.algorithmSections) {
    // For full support, algorithm sections should also be cloned and scalarized.
    // Assuming preserved as-is for now if they don't contain un-scalarized arrays.
    out.addAlgorithmSection(algo.start, algo.count);
  }

  out.isImpure = dae.isImpure;
  out.descriptionId = dae.descriptionId;

  return out;
}
