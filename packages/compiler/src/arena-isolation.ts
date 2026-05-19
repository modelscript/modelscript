// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, ExprKind } from "./dae-arena.js";

/**
 * Checks if the arena equation is explicitly solvable for the target variable.
 * An equation is explicitly solvable if it's of the form `Var = Expr` or `Expr = Var`
 * and `Var` does not appear in `Expr`.
 *
 * @returns The ExprId of the isolated expression, or -1 if not explicitly solvable.
 */
export function isExplicitlySolvableArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  const left = arena.getEqLhs(eqIdx);
  const right = arena.getEqRhs(eqIdx);

  if (isTargetVar(arena, left, targetVarIdx)) {
    if (!containsVar(arena, right, targetVarIdx)) return right;
  }
  if (isTargetVar(arena, right, targetVarIdx)) {
    if (!containsVar(arena, left, targetVarIdx)) return left;
  }

  return -1;
}

/**
 * Attempts to symbolically isolate the target variable in the equation.
 * Supports:
 *   1. Explicit form: `x = expr` or `expr = x`
 *   2. Linear isolation: `A*x + B = 0` → `x = -B/A`
 *   3. Single-occurrence inversion: recursive peeling of `f(g(x)) = val`
 *
 * @returns ExprId of the isolated RHS, or -1 if isolation fails.
 */
export function isolateSymbolicallyArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  // Strategy 0: Explicit form
  const explicitRhs = isExplicitlySolvableArena(arena, eqIdx, targetVarIdx);
  if (explicitRhs !== -1) return explicitRhs;

  const lhs = arena.getEqLhs(eqIdx);
  const rhs = arena.getEqRhs(eqIdx);

  // Strategy 1: Linear isolation on residual (lhs - rhs)
  // Build residual = lhs - rhs symbolically
  const residualId = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
  const linear = extractLinearCoeffsArena(arena, residualId, targetVarIdx);
  if (linear) {
    const { aId, bId } = linear;
    // x = -B / A
    const negB = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), bId);
    return arena.addBinaryExpr(BinOp.Div, negB, aId);
  }

  // Strategy 2: Single-occurrence inversion
  const lhsCount = countOccurrences(arena, lhs, targetVarIdx);
  const rhsCount = countOccurrences(arena, rhs, targetVarIdx);

  if (lhsCount === 1 && rhsCount === 0) {
    const result = invertSingleOccurrence(arena, lhs, targetVarIdx, rhs);
    if (result !== -1) return result;
  }
  if (rhsCount === 1 && lhsCount === 0) {
    const result = invertSingleOccurrence(arena, rhs, targetVarIdx, lhs);
    if (result !== -1) return result;
  }

  // Also try on residual = 0
  const totalCount = countOccurrences(arena, residualId, targetVarIdx);
  if (totalCount === 1) {
    const zeroId = arena.addRealLiteral(0);
    const result = invertSingleOccurrence(arena, residualId, targetVarIdx, zeroId);
    if (result !== -1) return result;
  }

  return -1;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Check if exprId is a reference to the target variable (or der(target)). */
function isTargetVar(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    return arena.getVarNameId(targetVarIdx) === arena.getExprData1(exprId);
  }
  if (kind === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (arena.getExprKind(argId) === ExprKind.Name) {
      const targetName = arena.getVarName(targetVarIdx);
      if (targetName.startsWith("der(")) return true;
    }
  }
  return false;
}

/** Check if the expression tree contains a reference to the target variable. */
function containsVar(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): boolean {
  if (exprId < 0) return false;
  if (isTargetVar(arena, exprId, targetVarIdx)) return true;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
      return (
        containsVar(arena, arena.getExprLeft(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return containsVar(
        arena,
        arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
        targetVarIdx,
      );
    case ExprKind.Call: {
      const count = arena.getExprRight(exprId);
      const first = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        if (containsVar(arena, first + i, targetVarIdx)) return true;
      }
      return false;
    }
    case ExprKind.IfElse:
      return (
        containsVar(arena, arena.getExprData1(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprLeft(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    default:
      return false;
  }
}

/** Count occurrences of the target variable in the expression tree. */
function countOccurrences(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): number {
  if (exprId < 0) return 0;
  if (isTargetVar(arena, exprId, targetVarIdx)) return 1;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
      return (
        countOccurrences(arena, arena.getExprLeft(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return countOccurrences(
        arena,
        arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
        targetVarIdx,
      );
    case ExprKind.Call: {
      const count = arena.getExprRight(exprId);
      const first = arena.getExprLeft(exprId);
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += countOccurrences(arena, first + i, targetVarIdx);
      }
      return total;
    }
    case ExprKind.IfElse:
      return (
        countOccurrences(arena, arena.getExprData1(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprLeft(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Linear Coefficient Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract linear coefficients A, B such that `expr = A*x + B`.
 * Returns {aId, bId} as ExprIds, or null if expr is not linear in x.
 */
function extractLinearCoeffsArena(
  arena: ArenaDAEBuilder,
  exprId: number,
  targetVarIdx: number,
): { aId: number; bId: number } | null {
  if (exprId < 0) return null;

  // If expr doesn't contain x, it's a constant: A=0, B=expr
  if (!containsVar(arena, exprId, targetVarIdx)) {
    return { aId: arena.addRealLiteral(0), bId: exprId };
  }

  // If expr IS x, then A=1, B=0
  if (isTargetVar(arena, exprId, targetVarIdx)) {
    return { aId: arena.addRealLiteral(1), bId: arena.addRealLiteral(0) };
  }

  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.Negate) {
    const inner = extractLinearCoeffsArena(
      arena,
      arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
      targetVarIdx,
    );
    if (!inner) return null;
    return {
      aId: arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), inner.aId),
      bId: arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), inner.bId),
    };
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);
    const leftHasVar = containsVar(arena, leftId, targetVarIdx);
    const rightHasVar = containsVar(arena, rightId, targetVarIdx);

    if (op === BinOp.Add || op === BinOp.ElemAdd) {
      const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
      const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
      if (!lc || !rc) return null;
      return {
        aId: arena.addBinaryExpr(BinOp.Add, lc.aId, rc.aId),
        bId: arena.addBinaryExpr(BinOp.Add, lc.bId, rc.bId),
      };
    }

    if (op === BinOp.Sub || op === BinOp.ElemSub) {
      const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
      const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
      if (!lc || !rc) return null;
      return {
        aId: arena.addBinaryExpr(BinOp.Sub, lc.aId, rc.aId),
        bId: arena.addBinaryExpr(BinOp.Sub, lc.bId, rc.bId),
      };
    }

    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      // Only handle: const * linear(x) or linear(x) * const
      if (!leftHasVar) {
        const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
        if (!rc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Mul, leftId, rc.aId),
          bId: arena.addBinaryExpr(BinOp.Mul, leftId, rc.bId),
        };
      }
      if (!rightHasVar) {
        const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
        if (!lc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Mul, lc.aId, rightId),
          bId: arena.addBinaryExpr(BinOp.Mul, lc.bId, rightId),
        };
      }
      return null; // Both sides contain x → non-linear
    }

    if (op === BinOp.Div || op === BinOp.ElemDiv) {
      // Only handle: linear(x) / const
      if (!rightHasVar) {
        const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
        if (!lc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Div, lc.aId, rightId),
          bId: arena.addBinaryExpr(BinOp.Div, lc.bId, rightId),
        };
      }
      return null;
    }
  }

  return null; // Non-linear or unsupported
}

// ─────────────────────────────────────────────────────────────────────
// Single-Occurrence Inversion
// ─────────────────────────────────────────────────────────────────────

/**
 * Given `expr` containing the target variable exactly once, and `valueId`
 * such that `expr = value`, recursively invert to yield `x = f(value)`.
 *
 * @returns ExprId of the isolated expression, or -1 on failure.
 */
function invertSingleOccurrence(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number, valueId: number): number {
  if (exprId < 0) return -1;

  // Base case: expr IS the variable
  if (isTargetVar(arena, exprId, targetVarIdx)) return valueId;

  const kind = arena.getExprKind(exprId);

  // Negate: -f(x) = value → f(x) = -value
  if (kind === ExprKind.Negate) {
    const operand = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    const negValue = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), valueId);
    return invertSingleOccurrence(arena, operand, targetVarIdx, negValue);
  }

  // Binary operations
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);
    const leftHas = containsVar(arena, leftId, targetVarIdx);
    const rightHas = containsVar(arena, rightId, targetVarIdx);

    if (leftHas && rightHas) return -1; // Both sides → can't invert single occurrence
    if (!leftHas && !rightHas) return -1;

    const varSide = leftHas ? leftId : rightId;
    const otherSide = leftHas ? rightId : leftId;
    const varOnLeft = leftHas;

    switch (op) {
      // f(x) + b = val → f(x) = val - b
      case BinOp.Add:
      case BinOp.ElemAdd:
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Sub, valueId, otherSide));

      // f(x) - b = val → f(x) = val + b;  a - f(x) = val → f(x) = a - val
      case BinOp.Sub:
      case BinOp.ElemSub:
        if (varOnLeft) {
          return invertSingleOccurrence(
            arena,
            varSide,
            targetVarIdx,
            arena.addBinaryExpr(BinOp.Add, valueId, otherSide),
          );
        }
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Sub, otherSide, valueId));

      // f(x) * b = val → f(x) = val / b
      case BinOp.Mul:
      case BinOp.ElemMul:
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, valueId, otherSide));

      // f(x) / b = val → f(x) = val * b;  a / f(x) = val → f(x) = a / val
      case BinOp.Div:
      case BinOp.ElemDiv:
        if (varOnLeft) {
          return invertSingleOccurrence(
            arena,
            varSide,
            targetVarIdx,
            arena.addBinaryExpr(BinOp.Mul, valueId, otherSide),
          );
        }
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, otherSide, valueId));

      // f(x) ^ n = val → f(x) = val ^ (1/n) (constant exponent only)
      case BinOp.Pow:
      case BinOp.ElemPow:
        if (varOnLeft) {
          // Check if exponent is a constant
          const expKind = arena.getExprKind(otherSide);
          if (expKind === ExprKind.RealLiteral || expKind === ExprKind.IntLiteral) {
            const invExp = arena.addBinaryExpr(BinOp.Div, arena.addRealLiteral(1), otherSide);
            return invertSingleOccurrence(
              arena,
              varSide,
              targetVarIdx,
              arena.addBinaryExpr(BinOp.Pow, valueId, invExp),
            );
          }
        } else {
          // b ^ f(x) = val → f(x) = log(val) / log(b)
          const logVal = arena.addCallExpr("log", [valueId]);
          const logBase = arena.addCallExpr("log", [otherSide]);
          return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, logVal, logBase));
        }
        return -1;

      default:
        return -1;
    }
  }

  // Function calls: f(g(x)) = val → g(x) = f⁻¹(val)
  if (kind === ExprKind.Call) {
    const argCount = arena.getExprRight(exprId);
    if (argCount !== 1) return -1; // Only invert single-arg functions

    const argId = arena.getExprLeft(exprId);
    if (!containsVar(arena, argId, targetVarIdx)) return -1;

    const funcNameId = arena.getExprData1(exprId);
    const funcName = arena.interner.resolve(funcNameId) ?? "";
    const inverseValueId = getInverseFunctionArena(arena, funcName, valueId);
    if (inverseValueId === -1) return -1;

    return invertSingleOccurrence(arena, argId, targetVarIdx, inverseValueId);
  }

  return -1;
}

/**
 * Get the inverse function expression for common math functions.
 * @returns ExprId of f⁻¹(value), or -1 if unknown.
 */
function getInverseFunctionArena(arena: ArenaDAEBuilder, funcName: string, valueId: number): number {
  switch (funcName) {
    case "sin":
    case "Modelica.Math.sin":
      return arena.addCallExpr("asin", [valueId]);
    case "cos":
    case "Modelica.Math.cos":
      return arena.addCallExpr("acos", [valueId]);
    case "tan":
    case "Modelica.Math.tan":
      return arena.addCallExpr("atan", [valueId]);
    case "asin":
    case "Modelica.Math.asin":
      return arena.addCallExpr("sin", [valueId]);
    case "acos":
    case "Modelica.Math.acos":
      return arena.addCallExpr("cos", [valueId]);
    case "atan":
    case "Modelica.Math.atan":
      return arena.addCallExpr("tan", [valueId]);
    case "exp":
    case "Modelica.Math.exp":
      return arena.addCallExpr("log", [valueId]);
    case "log":
    case "Modelica.Math.log":
      return arena.addCallExpr("exp", [valueId]);
    case "sqrt":
      return arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
    case "sinh":
    case "Modelica.Math.sinh": {
      // sinh(u)=v → u = log(v + sqrt(v²+1))
      const vSq = arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
      const vSqP1 = arena.addBinaryExpr(BinOp.Add, vSq, arena.addRealLiteral(1));
      const sqrtTerm = arena.addCallExpr("sqrt", [vSqP1]);
      return arena.addCallExpr("log", [arena.addBinaryExpr(BinOp.Add, valueId, sqrtTerm)]);
    }
    case "cosh":
    case "Modelica.Math.cosh": {
      // cosh(u)=v → u = log(v + sqrt(v²-1))
      const vSq = arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
      const vSqM1 = arena.addBinaryExpr(BinOp.Sub, vSq, arena.addRealLiteral(1));
      const sqrtTerm = arena.addCallExpr("sqrt", [vSqM1]);
      return arena.addCallExpr("log", [arena.addBinaryExpr(BinOp.Add, valueId, sqrtTerm)]);
    }
    case "tanh":
    case "Modelica.Math.tanh": {
      // tanh(u)=v → u = 0.5 * log((1+v)/(1-v))
      const one = arena.addRealLiteral(1);
      const num = arena.addBinaryExpr(BinOp.Add, one, valueId);
      const den = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1), valueId);
      const ratio = arena.addBinaryExpr(BinOp.Div, num, den);
      const logTerm = arena.addCallExpr("log", [ratio]);
      return arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(0.5), logTerm);
    }
    default:
      return -1;
  }
}
