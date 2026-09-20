// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E-Graph-Inspired Equality Saturation & Algebraic Simplifier for DAE Arenas.
 *
 * Applies canonical rewrite rules (identities, double-negations, zero-annihilation,
 * constant folding, and common term cancellations) directly to linear-memory DAE expression trees.
 */

import { BinOp, DAEBuilder, ExprKind, UnaryOp } from "./wasm_dae.js";

export interface SimplificationStats {
  identitiesFolded: number;
  constantsFolded: number;
  subexpressionsEliminated: number;
  equationsSimplified: number;
}

function areArenaExprsEqual(arena: DAEBuilder, a: number, b: number): boolean {
  if (a === b) return true;
  if (a < 0 || b < 0) return false;
  const kA = arena.getExprKind(a);
  const kB = arena.getExprKind(b);
  if (kA !== kB) return false;
  switch (kA) {
    case ExprKind.Name:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.StringLiteral:
      return arena.getExprData1(a) === arena.getExprData1(b);
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(a) === arena.getExprRealValue(b);
    case ExprKind.Negate:
      return areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b));
    case ExprKind.Unary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))
      );
    case ExprKind.Binary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    default:
      return false;
  }
}

/**
 * Recursively simplifies an arena expression using equality saturation rules.
 */
export function simplifyArenaExpr(arena: DAEBuilder, exprId: number, stats?: SimplificationStats): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return exprId;

    case ExprKind.Negate: {
      const inner = simplifyArenaExpr(arena, arena.getExprLeft(exprId), stats);
      const innerKind = arena.getExprKind(inner);

      // Rule: -(-x) => x
      if (
        innerKind === ExprKind.Negate ||
        (innerKind === ExprKind.Unary && arena.getExprData1(inner) === UnaryOp.Negate)
      ) {
        if (stats) stats.identitiesFolded++;
        return arena.getExprLeft(inner);
      }

      // Rule: -(const c) => -c
      if (innerKind === ExprKind.RealLiteral) {
        if (stats) stats.constantsFolded++;
        return arena.addRealLiteral(-arena.getExprRealValue(inner));
      }
      if (innerKind === ExprKind.IntLiteral) {
        if (stats) stats.constantsFolded++;
        return arena.addIntLiteral(-arena.getExprData1(inner));
      }

      if (inner !== arena.getExprLeft(exprId)) {
        return arena.addExpression(ExprKind.Negate, 0, inner);
      }
      return exprId;
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const inner = simplifyArenaExpr(arena, arena.getExprLeft(exprId), stats);

      if (op === UnaryOp.Negate) {
        const innerKind = arena.getExprKind(inner);
        if (
          innerKind === ExprKind.Negate ||
          (innerKind === ExprKind.Unary && arena.getExprData1(inner) === UnaryOp.Negate)
        ) {
          if (stats) stats.identitiesFolded++;
          return arena.getExprLeft(inner);
        }
        if (innerKind === ExprKind.RealLiteral) {
          if (stats) stats.constantsFolded++;
          return arena.addRealLiteral(-arena.getExprRealValue(inner));
        }
        if (innerKind === ExprKind.IntLiteral) {
          if (stats) stats.constantsFolded++;
          return arena.addIntLiteral(-arena.getExprData1(inner));
        }
      }

      if (inner !== arena.getExprLeft(exprId)) {
        return arena.addUnaryExpr(op, inner);
      }
      return exprId;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = simplifyArenaExpr(arena, arena.getExprLeft(exprId), stats);
      const right = simplifyArenaExpr(arena, arena.getExprRight(exprId), stats);

      const lKind = arena.getExprKind(left);
      const rKind = arena.getExprKind(right);

      const lVal =
        lKind === ExprKind.RealLiteral
          ? arena.getExprRealValue(left)
          : lKind === ExprKind.IntLiteral
            ? arena.getExprData1(left)
            : null;
      const rVal =
        rKind === ExprKind.RealLiteral
          ? arena.getExprRealValue(right)
          : rKind === ExprKind.IntLiteral
            ? arena.getExprData1(right)
            : null;

      // Constant folding: c1 op c2 => c3
      if (lVal !== null && rVal !== null) {
        if (stats) stats.constantsFolded++;
        const isInt = lKind === ExprKind.IntLiteral && rKind === ExprKind.IntLiteral;
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return isInt ? arena.addIntLiteral(lVal + rVal) : arena.addRealLiteral(lVal + rVal);
          case BinOp.Sub:
          case BinOp.ElemSub:
            return isInt ? arena.addIntLiteral(lVal - rVal) : arena.addRealLiteral(lVal - rVal);
          case BinOp.Mul:
          case BinOp.ElemMul:
            return isInt ? arena.addIntLiteral(lVal * rVal) : arena.addRealLiteral(lVal * rVal);
          case BinOp.Div:
          case BinOp.ElemDiv:
            return rVal !== 0
              ? isInt && lVal % rVal === 0
                ? arena.addIntLiteral(lVal / rVal)
                : arena.addRealLiteral(lVal / rVal)
              : exprId;
        }
      }

      if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.ElemAdd || op === BinOp.ElemSub) {
        const terms: { exprId: number; coeff: number }[] = [];
        let constVal = 0;
        let hasConst = false;
        let isFloat = false;

        const collect = (id: number, sign: number) => {
          if (id < 0) return;
          const k = arena.getExprKind(id);
          if (k === ExprKind.IntLiteral) {
            constVal += sign * arena.getExprData1(id);
            hasConst = true;
            return;
          }
          if (k === ExprKind.RealLiteral) {
            constVal += sign * arena.getExprRealValue(id);
            hasConst = true;
            isFloat = true;
            return;
          }
          if (k === ExprKind.Negate) {
            collect(arena.getExprLeft(id), -sign);
            return;
          }
          if (k === ExprKind.Unary && arena.getExprData1(id) === UnaryOp.Negate) {
            collect(arena.getExprLeft(id), -sign);
            return;
          }
          if (k === ExprKind.Binary) {
            const bOp = arena.getExprData1(id) as BinOp;
            if (bOp === BinOp.Add || bOp === BinOp.ElemAdd) {
              collect(arena.getExprLeft(id), sign);
              collect(arena.getExprRight(id), sign);
              return;
            }
            if (bOp === BinOp.Sub || bOp === BinOp.ElemSub) {
              collect(arena.getExprLeft(id), sign);
              collect(arena.getExprRight(id), -sign);
              return;
            }
          }
          // Symbolic term
          const existing = terms.find((t) => areArenaExprsEqual(arena, t.exprId, id));
          if (existing) {
            existing.coeff += sign;
          } else {
            terms.push({ exprId: id, coeff: sign });
          }
        };

        collect(left, 1);
        collect(right, op === BinOp.Sub || op === BinOp.ElemSub ? -1 : 1);

        const activeTerms = terms.filter((t) => t.coeff !== 0);
        const didCancel = terms.some((t) => t.coeff === 0);

        if (didCancel && activeTerms.length === 0) {
          if (stats) stats.identitiesFolded++;
          return isFloat ? arena.addRealLiteral(constVal) : arena.addIntLiteral(Math.trunc(constVal));
        }
      }

      // Additive identities
      if (op === BinOp.Add || op === BinOp.ElemAdd) {
        // x + 0 => x
        if (rVal === 0) {
          if (stats) stats.identitiesFolded++;
          return left;
        }
        // 0 + x => x
        if (lVal === 0) {
          if (stats) stats.identitiesFolded++;
          return right;
        }
      }

      // Subtractive identities
      if (op === BinOp.Sub || op === BinOp.ElemSub) {
        // x - 0 => x
        if (rVal === 0) {
          if (stats) stats.identitiesFolded++;
          return left;
        }
        // 0 - x => -x
        if (lVal === 0) {
          if (stats) stats.identitiesFolded++;
          return arena.addUnaryExpr(UnaryOp.Negate, right);
        }
        // x - x => 0
        if (left === right) {
          if (stats) stats.identitiesFolded++;
          return arena.addRealLiteral(0.0);
        }
      }

      // Multiplicative identities
      if (op === BinOp.Mul || op === BinOp.ElemMul) {
        // x * 1 => x
        if (rVal === 1) {
          if (stats) stats.identitiesFolded++;
          return left;
        }
        // 1 * x => x
        if (lVal === 1) {
          if (stats) stats.identitiesFolded++;
          return right;
        }
        // x * 0 => 0
        if (rVal === 0 || lVal === 0) {
          if (stats) stats.identitiesFolded++;
          return arena.addRealLiteral(0.0);
        }
      }

      // Division identities
      if (op === BinOp.Div || op === BinOp.ElemDiv) {
        // x / 1 => x
        if (rVal === 1) {
          if (stats) stats.identitiesFolded++;
          return left;
        }
        // 0 / x => 0
        if (lVal === 0) {
          if (stats) stats.identitiesFolded++;
          return arena.addRealLiteral(0.0);
        }
        // x / x => 1
        if (left === right) {
          if (stats) stats.identitiesFolded++;
          return arena.addRealLiteral(1.0);
        }
      }

      if (left !== arena.getExprLeft(exprId) || right !== arena.getExprRight(exprId)) {
        return arena.addBinaryExpr(op, left, right);
      }
      return exprId;
    }

    default:
      return exprId;
  }
}

/**
 * Runs equality saturation & algebraic simplification across all equations in the arena.
 */
export function saturateArenaEquations(arena: DAEBuilder): SimplificationStats {
  const stats: SimplificationStats = {
    identitiesFolded: 0,
    constantsFolded: 0,
    subexpressionsEliminated: 0,
    equationsSimplified: 0,
  };

  const eqCount = arena.eqCount;
  for (let eq = 0; eq < eqCount; eq++) {
    const lhs = arena.getEqLhs(eq);
    const rhs = arena.getEqRhs(eq);

    const newLhs = simplifyArenaExpr(arena, lhs, stats);
    const newRhs = simplifyArenaExpr(arena, rhs, stats);

    if (newLhs !== lhs || newRhs !== rhs) {
      stats.equationsSimplified++;
      arena.setEqLhs(eq, newLhs);
      arena.setEqRhs(eq, newRhs);
    }
  }

  // Also simplify variable binding expressions
  for (let v = 0; v < arena.varCount; v++) {
    const exprId = arena.getVarExpression(v);
    if (typeof exprId === "number" && exprId >= 0) {
      const newExpr = simplifyArenaExpr(arena, exprId, stats);
      if (newExpr !== exprId) {
        arena.setVarExpression(v, newExpr);
      }
    }
  }

  return stats;
}
