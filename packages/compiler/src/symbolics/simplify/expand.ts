// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native polynomial expansion, term collection, and normalization.
 *
 * All operations work on ArenaDAEBuilder expression IDs (numbers),
 * not on the legacy ModelicaExpression AST objects.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";
import { getArenaLiteralValue } from "../algebra/solve.js";
import { add, div, mul, negate, pow, sub, ZERO } from "../calculus/derivative.js";
import { egraphSimplify } from "../simplify/egraph.js";

// ─────────────────────────────────────────────────────────────────────
// Polynomial Expansion
// ─────────────────────────────────────────────────────────────────────

/**
 * Recursively expand an expression by distributing multiplication over
 * addition and applying binomial expansion for integer powers.
 *
 * Examples:
 *   (a + b) * c  →  a*c + b*c
 *   (a + b)^2    →  a^2 + 2*a*b + b^2
 */
export function expandArenaExpr(arena: ArenaDAEBuilder, exprId: number): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  // Literals and names: already expanded
  if (
    kind === ExprKind.RealLiteral ||
    kind === ExprKind.IntLiteral ||
    kind === ExprKind.BoolLiteral ||
    kind === ExprKind.StringLiteral ||
    kind === ExprKind.EnumLiteral ||
    kind === ExprKind.Name
  ) {
    return exprId;
  }

  // Negation: distribute into sum
  if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
    const expanded = expandArenaExpr(arena, arena.getExprLeft(exprId));
    return distributeNeg(arena, expanded);
  }

  // Binary expressions
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const left = expandArenaExpr(arena, arena.getExprLeft(exprId));
    const right = expandArenaExpr(arena, arena.getExprRight(exprId));

    switch (op) {
      case BinOp.Add:
      case BinOp.ElemAdd:
        return add(arena, left, right);

      case BinOp.Sub:
      case BinOp.ElemSub:
        return sub(arena, left, right);

      case BinOp.Mul:
      case BinOp.ElemMul:
        return distributeMultiply(arena, left, right);

      case BinOp.Div:
      case BinOp.ElemDiv:
        return div(arena, left, right);

      case BinOp.Pow:
      case BinOp.ElemPow: {
        const n = getArenaIntegerValue(arena, right);
        if (n !== null && n >= 0 && n <= 10) {
          return expandPower(arena, left, n);
        }
        return pow(arena, left, right);
      }

      default:
        if (left === arena.getExprLeft(exprId) && right === arena.getExprRight(exprId)) return exprId;
        return arena.addBinaryExpr(op, left, right);
    }
  }

  // Function calls: expand arguments
  if (kind === ExprKind.Call) {
    const funcName = arena.interner.resolve(arena.getExprData1(exprId));
    if (!funcName) return exprId;
    const argCount = arena.getExprRight(exprId);
    const firstArg = arena.getExprLeft(exprId);
    const args: number[] = [];
    if (argCount > 0) {
      args.push(expandArenaExpr(arena, firstArg));
      for (let i = 1; i < argCount; i++) {
        args.push(expandArenaExpr(arena, arena.getExprLeft(exprId + i)));
      }
    }
    return arena.addCallExpr(funcName, args);
  }

  return exprId;
}

// ─────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an expression to canonical form: expand first, then simplify
 * via the E-Graph engine.
 */
export function normalizeArenaExpr(arena: ArenaDAEBuilder, exprId: number): number {
  const expanded = expandArenaExpr(arena, exprId);
  return egraphSimplify(arena, expanded);
}

// ─────────────────────────────────────────────────────────────────────
// Term Reconstruction
// ─────────────────────────────────────────────────────────────────────

/**
 * Reconstruct an arena expression from a degree→coefficient map.
 *
 * Given Map { 2 → coeff2, 1 → coeff1, 0 → coeff0 } and varName "x",
 * produces: coeff2*x^2 + coeff1*x + coeff0
 */
export function arenaTermsToExpr(arena: ArenaDAEBuilder, terms: Map<number, number>, varName: string): number {
  const degrees = [...terms.keys()].sort((a, b) => b - a);
  let result = ZERO(arena);

  for (const deg of degrees) {
    const coeff = terms.get(deg);
    if (coeff === undefined) continue;
    const val = getArenaLiteralValue(arena, coeff);
    if (val !== null && val === 0) continue;

    let term: number;
    if (deg === 0) {
      term = coeff;
    } else {
      const x = arena.addNameExpr(varName);
      const xPow = deg === 1 ? x : pow(arena, x, arena.addRealLiteral(deg));
      term = mul(arena, coeff, xPow);
    }

    result = add(arena, result, term);
  }

  return egraphSimplify(arena, result);
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

/** Check if an arena expression is a literal constant. */
export function isArenaLiteral(arena: ArenaDAEBuilder, exprId: number): boolean {
  const kind = arena.getExprKind(exprId);
  return kind === ExprKind.RealLiteral || kind === ExprKind.IntLiteral;
}

/** Get integer value from an arena literal (returns null for non-integer). */
function getArenaIntegerValue(arena: ArenaDAEBuilder, exprId: number): number | null {
  const val = getArenaLiteralValue(arena, exprId);
  if (val !== null && Number.isInteger(val)) return val;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Internal Expansion Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Distribute multiplication: (a+b)*c → a*c + b*c, a*(b+c) → a*b + a*c
 */
function distributeMultiply(arena: ArenaDAEBuilder, left: number, right: number): number {
  // (a + b) * right → a*right + b*right
  const leftSum = extractSum(arena, left);
  if (leftSum) {
    return add(arena, distributeMultiply(arena, leftSum.a, right), distributeMultiply(arena, leftSum.b, right));
  }

  // left * (a + b) → left*a + left*b
  const rightSum = extractSum(arena, right);
  if (rightSum) {
    return add(arena, distributeMultiply(arena, left, rightSum.a), distributeMultiply(arena, left, rightSum.b));
  }

  // (a - b) * right → a*right - b*right
  const leftDiff = extractDiff(arena, left);
  if (leftDiff) {
    return sub(arena, distributeMultiply(arena, leftDiff.a, right), distributeMultiply(arena, leftDiff.b, right));
  }

  // left * (a - b) → left*a - left*b
  const rightDiff = extractDiff(arena, right);
  if (rightDiff) {
    return sub(arena, distributeMultiply(arena, left, rightDiff.a), distributeMultiply(arena, left, rightDiff.b));
  }

  return mul(arena, left, right);
}

/**
 * Expand integer power by repeated multiplication.
 * x^0 → 1, x^1 → x, x^n → expand(x * x^(n-1))
 */
function expandPower(arena: ArenaDAEBuilder, base: number, n: number): number {
  if (n === 0) return arena.addRealLiteral(1.0);
  if (n === 1) return base;
  let result = base;
  for (let i = 1; i < n; i++) {
    result = distributeMultiply(arena, result, base);
  }
  return result;
}

/** Distribute negation into sums: -(a+b) → (-a)+(-b) */
function distributeNeg(arena: ArenaDAEBuilder, exprId: number): number {
  const sum = extractSum(arena, exprId);
  if (sum) {
    return add(arena, distributeNeg(arena, sum.a), distributeNeg(arena, sum.b));
  }
  const diff = extractDiff(arena, exprId);
  if (diff) {
    return sub(arena, diff.b, diff.a);
  }
  // Check for zero
  const val = getArenaLiteralValue(arena, exprId);
  if (val !== null && val === 0) return ZERO(arena);
  return negate(arena, exprId);
}

/** Extract addition operands: a + b */
function extractSum(arena: ArenaDAEBuilder, exprId: number): { a: number; b: number } | null {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    if (op === BinOp.Add || op === BinOp.ElemAdd) {
      return { a: arena.getExprLeft(exprId), b: arena.getExprRight(exprId) };
    }
  }
  return null;
}

/** Extract subtraction operands: a - b */
function extractDiff(arena: ArenaDAEBuilder, exprId: number): { a: number; b: number } | null {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    if (op === BinOp.Sub || op === BinOp.ElemSub) {
      return { a: arena.getExprLeft(exprId), b: arena.getExprRight(exprId) };
    }
  }
  return null;
}
