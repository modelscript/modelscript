// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EqKind,
} from "../dae/builder";
import { cas_simplify, cas_isZero } from "../dae/cas";
import { BuiltinMathFunc } from "../dae/fold";
import { atomicChunkAlloc } from "../arena";
import { UnmanagedMap64To64 } from "../core/hashmap";

/**
 * Checks if an expression is a direct reference to targetVarId or der(targetVarId).
 */
@inline
export function isTargetVar(dae: DaeBuilder, exprId: u32, targetVarId: u32): boolean {
  if (exprId >= dae.exprCount || targetVarId >= dae.varCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  let targetNameId = dae.getVarNameId(targetVarId);

  if (kind == ExprKind.Name) {
    let rawId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (rawId == targetNameId) return true;
    let resolved = dae.resolveExprVarId(rawId);
    if (resolved >= 0 && (resolved as u32) == targetVarId) return true;
    return rawId == targetVarId;
  }
  if (kind == ExprKind.Der) {
    let inner = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner >= dae.exprCount || dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) != ExprKind.Name) {
      inner = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    }
    if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let rawId = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
      let sp = dae.stringPool;
      if (changetype<usize>(sp) != 0) {
        let unwrappedTarget = sp.unwrapDerSingle(targetNameId);
        if (unwrappedTarget != 0 && unwrappedTarget == rawId) return true;
        let derOfRaw = sp.lookupDerOf(rawId);
        if (derOfRaw != 0 && derOfRaw == targetNameId) return true;
      }
      let resolved = dae.resolveExprVarId(rawId);
      if (resolved >= 0 && (resolved as u32) == targetVarId) return true;
      return rawId == targetVarId;
    }
  }
  return false;
}

@inline
export function containsVar(dae: DaeBuilder, exprId: u32, targetVarId: u32): bool {
  return countVarOccurrences(dae, exprId, targetVarId) > 0;
}

/**
 * Counts the number of times targetVarId occurs inside an expression AST.
 */
export function countVarOccurrences(dae: DaeBuilder, exprId: u32, targetVarId: u32): u32 {
  if (exprId >= dae.exprCount) return 0;
  if (isTargetVar(dae, exprId, targetVarId)) return 1;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Binary || kind == ExprKind.Range) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    return countVarOccurrences(dae, left, targetVarId) + countVarOccurrences(dae, right, targetVarId);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate || kind == ExprKind.Pre || kind == ExprKind.Der) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    if (left != 0xffffffff) return countVarOccurrences(dae, left, targetVarId);
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    return countVarOccurrences(dae, data1, targetVarId);
  }

  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenBranch = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseBranch = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    return (
      countVarOccurrences(dae, cond, targetVarId) +
      countVarOccurrences(dae, thenBranch, targetVarId) +
      countVarOccurrences(dae, elseBranch, targetVarId)
    );
  }

  if (kind == ExprKind.Call) {
    let count = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let sum: u32 = 0;
    for (let i: u32 = 0; i < count; i++) {
      let argExpr = dae.getCallArgExprId(exprId, i);
      if (argExpr != 0xffffffff) {
        sum += countVarOccurrences(dae, argExpr, targetVarId);
      }
    }
    return sum;
  }

  return 0;
}

/**
 * Strategy 0: Explicit form detection.
 * Returns the isolated RHS expression if equation is already `x = rhs` or `lhs = x`.
 */
export function isExplicitlySolvable(dae: DaeBuilder, eqIdx: u32, targetVarId: u32): u32 {
  if (eqIdx >= dae.eqCount) return 0xffffffff;
  let offset = eqIdx * EQ_STRIDE;
  let lhs = dae.getEqData().get(offset + EQ_LHS) as u32;
  let rhs = dae.getEqData().get(offset + EQ_RHS) as u32;

  if (isTargetVar(dae, lhs, targetVarId)) {
    if (countVarOccurrences(dae, rhs, targetVarId) == 0) return rhs;
  }
  if (isTargetVar(dae, rhs, targetVarId)) {
    if (countVarOccurrences(dae, lhs, targetVarId) == 0) return lhs;
  }
  return 0xffffffff;
}

/**
 * Strategy 2: Single-occurrence function inversion / peeling.
 * Given `F(x) = targetValExpr`, computes `x = F^{-1}(targetValExpr)`.
 */
export function invertSingleOccurrence(
  dae: DaeBuilder,
  exprId: u32,
  targetVarId: u32,
  targetValExpr: u32
): u32 {
  if (exprId >= dae.exprCount) return 0xffffffff;
  if (isTargetVar(dae, exprId, targetVarId)) return targetValExpr;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  // Unary Negation: -u = val -> u = -val
  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let negVal = dae.addExpression(ExprKind.Negate, 0, targetValExpr);
    return invertSingleOccurrence(dae, left, targetVarId, negVal);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    if (op == UnaryOp.Negate) {
      let negVal = dae.addExpression(ExprKind.Negate, 0, targetValExpr);
      return invertSingleOccurrence(dae, left, targetVarId, negVal);
    }
  }

  // Binary Expression Inversions
  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let leftCount = countVarOccurrences(dae, left, targetVarId);
    let rightCount = countVarOccurrences(dae, right, targetVarId);

    // Addition: u + v = val
    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      if (leftCount == 1 && rightCount == 0) {
        // u = val - v
        let newTarget = dae.addBinaryExpr(BinOp.Sub as u16, targetValExpr, right);
        return invertSingleOccurrence(dae, left, targetVarId, newTarget);
      }
      if (rightCount == 1 && leftCount == 0) {
        // v = val - u
        let newTarget = dae.addBinaryExpr(BinOp.Sub as u16, targetValExpr, left);
        return invertSingleOccurrence(dae, right, targetVarId, newTarget);
      }
    }

    // Subtraction: u - v = val
    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      if (leftCount == 1 && rightCount == 0) {
        // u = val + v
        let newTarget = dae.addBinaryExpr(BinOp.Add as u16, targetValExpr, right);
        return invertSingleOccurrence(dae, left, targetVarId, newTarget);
      }
      if (rightCount == 1 && leftCount == 0) {
        // v = u - val
        let newTarget = dae.addBinaryExpr(BinOp.Sub as u16, left, targetValExpr);
        return invertSingleOccurrence(dae, right, targetVarId, newTarget);
      }
    }

    // Multiplication: u * v = val
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      if (leftCount == 1 && rightCount == 0) {
        // u = val / v
        let newTarget = dae.addBinaryExpr(BinOp.Div as u16, targetValExpr, right);
        return invertSingleOccurrence(dae, left, targetVarId, newTarget);
      }
      if (rightCount == 1 && leftCount == 0) {
        // v = val / u
        let newTarget = dae.addBinaryExpr(BinOp.Div as u16, targetValExpr, left);
        return invertSingleOccurrence(dae, right, targetVarId, newTarget);
      }
    }

    // Division: u / v = val
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      if (leftCount == 1 && rightCount == 0) {
        // u = val * v
        let newTarget = dae.addBinaryExpr(BinOp.Mul as u16, targetValExpr, right);
        return invertSingleOccurrence(dae, left, targetVarId, newTarget);
      }
      if (rightCount == 1 && leftCount == 0) {
        // v = u / val
        let newTarget = dae.addBinaryExpr(BinOp.Div as u16, left, targetValExpr);
        return invertSingleOccurrence(dae, right, targetVarId, newTarget);
      }
    }

    // Power: u ^ p = val
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (leftCount == 1 && rightCount == 0) {
        // u = val ^ (1/p)
        let one = dae.addRealLiteral(1.0);
        let invP = dae.addBinaryExpr(BinOp.Div as u16, one, right);
        let newTarget = dae.addBinaryExpr(BinOp.Pow as u16, targetValExpr, invP);
        return invertSingleOccurrence(dae, left, targetVarId, newTarget);
      }
      if (rightCount == 1 && leftCount == 0) {
        // u ^ p = val -> p = log(val) / log(u)
        let logVal = dae.addCall(BuiltinMathFunc.Log, targetValExpr, 1);
        let logBase = dae.addCall(BuiltinMathFunc.Log, left, 1);
        let newTarget = dae.addBinaryExpr(BinOp.Div as u16, logVal, logBase);
        return invertSingleOccurrence(dae, right, targetVarId, newTarget);
      }
    }
  }

  // Math Builtin Function Inversions
  if (kind == ExprKind.Call) {
    let rawFuncId = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    let funcId = dae.resolveBuiltinMathFunc(rawFuncId);
    let firstArg = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let argCount = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    if (argCount == 1 && countVarOccurrences(dae, firstArg, targetVarId) == 1) {
      let invArg: u32 = 0xffffffff;

      if (funcId == BuiltinMathFunc.Exp) {
        // exp(u) = val -> u = log(val)
        invArg = dae.addCall(BuiltinMathFunc.Log, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Log) {
        // log(u) = val -> u = exp(val)
        invArg = dae.addCall(BuiltinMathFunc.Exp, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Log10) {
        // log10(u) = val -> u = 10 ^ val
        let ten = dae.addRealLiteral(10.0);
        invArg = dae.addBinaryExpr(BinOp.Pow as u16, ten, targetValExpr);
      } else if (funcId == BuiltinMathFunc.Sqrt) {
        // sqrt(u) = val -> u = val ^ 2
        let two = dae.addRealLiteral(2.0);
        invArg = dae.addBinaryExpr(BinOp.Pow as u16, targetValExpr, two);
      } else if (funcId == BuiltinMathFunc.Sin) {
        // sin(u) = val -> u = asin(val)
        invArg = dae.addCall(BuiltinMathFunc.Asin, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Cos) {
        // cos(u) = val -> u = acos(val)
        invArg = dae.addCall(BuiltinMathFunc.Acos, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Tan) {
        // tan(u) = val -> u = atan(val)
        invArg = dae.addCall(BuiltinMathFunc.Atan, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Asin) {
        invArg = dae.addCall(BuiltinMathFunc.Sin, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Acos) {
        invArg = dae.addCall(BuiltinMathFunc.Cos, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Atan) {
        invArg = dae.addCall(BuiltinMathFunc.Tan, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Sinh) {
        // sinh(u) = val -> u = log(val + sqrt(val^2 + 1))
        let vSq = dae.addBinaryExpr(BinOp.Mul as u16, targetValExpr, targetValExpr);
        let vSqP1 = dae.addBinaryExpr(BinOp.Add as u16, vSq, dae.addRealLiteral(1.0));
        let sqrtTerm = dae.addCall(BuiltinMathFunc.Sqrt, vSqP1, 1);
        let sum = dae.addBinaryExpr(BinOp.Add as u16, targetValExpr, sqrtTerm);
        invArg = dae.addCall(BuiltinMathFunc.Log, sum, 1);
      } else if (funcId == BuiltinMathFunc.Cosh) {
        // cosh(u) = val -> u = log(val + sqrt(val^2 - 1))
        let vSq = dae.addBinaryExpr(BinOp.Mul as u16, targetValExpr, targetValExpr);
        let vSqM1 = dae.addBinaryExpr(BinOp.Sub as u16, vSq, dae.addRealLiteral(1.0));
        let sqrtTerm = dae.addCall(BuiltinMathFunc.Sqrt, vSqM1, 1);
        let sum = dae.addBinaryExpr(BinOp.Add as u16, targetValExpr, sqrtTerm);
        invArg = dae.addCall(BuiltinMathFunc.Log, sum, 1);
      } else if (funcId == BuiltinMathFunc.Tanh) {
        // tanh(u) = val -> u = 0.5 * log((1 + val) / (1 - val))
        let num = dae.addBinaryExpr(BinOp.Add as u16, dae.addRealLiteral(1.0), targetValExpr);
        let den = dae.addBinaryExpr(BinOp.Sub as u16, dae.addRealLiteral(1.0), targetValExpr);
        let ratio = dae.addBinaryExpr(BinOp.Div as u16, num, den);
        let logTerm = dae.addCall(BuiltinMathFunc.Log, ratio, 1);
        invArg = dae.addBinaryExpr(BinOp.Mul as u16, dae.addRealLiteral(0.5), logTerm);
      }

      if (invArg != 0xffffffff) {
        return invertSingleOccurrence(dae, firstArg, targetVarId, invArg);
      }
    }
  }

  return 0xffffffff;
}

/**
 * Extract linear coefficients A, B such that `expr = A*x + B`.
 * Returns packed u64: ((aId as u64) << 32) | (bId as u64), or u64.MAX_VALUE if not linear.
 */
function extractLinearCoeffsRec(
  dae: DaeBuilder,
  exprId: u32,
  targetVarId: u32,
  depth: i32
): u64 {
  if (exprId >= dae.exprCount || depth > 32) return 0xffffffffffffffff;

  if (!containsVar(dae, exprId, targetVarId)) {
    let zero = dae.addRealLiteral(0.0);
    return ((zero as u64) << 32) | (exprId as u64);
  }

  if (isTargetVar(dae, exprId, targetVarId)) {
    let one = dae.addRealLiteral(1.0);
    let zero = dae.addRealLiteral(0.0);
    return ((one as u64) << 32) | (zero as u64);
  }

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let innerRes = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
    if (innerRes == 0xffffffffffffffff) return 0xffffffffffffffff;
    let ia = (innerRes >> 32) as u32;
    let ib = (innerRes & 0xffffffff) as u32;
    let negOne = dae.addRealLiteral(-1.0);
    let aId = dae.addBinaryExpr(BinOp.Mul as u16, negOne, ia);
    let bId = dae.addBinaryExpr(BinOp.Mul as u16, negOne, ib);
    return ((aId as u64) << 32) | (bId as u64);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (op == UnaryOp.Negate) {
      let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
      let innerRes = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
      if (innerRes == 0xffffffffffffffff) return 0xffffffffffffffff;
      let ia = (innerRes >> 32) as u32;
      let ib = (innerRes & 0xffffffff) as u32;
      let negOne = dae.addRealLiteral(-1.0);
      let aId = dae.addBinaryExpr(BinOp.Mul as u16, negOne, ia);
      let bId = dae.addBinaryExpr(BinOp.Mul as u16, negOne, ib);
      return ((aId as u64) << 32) | (bId as u64);
    }
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let leftHasVar = containsVar(dae, left, targetVarId);
    let rightHasVar = containsVar(dae, right, targetVarId);

    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      let lc = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
      let rc = extractLinearCoeffsRec(dae, right, targetVarId, depth + 1);
      if (lc == 0xffffffffffffffff || rc == 0xffffffffffffffff) return 0xffffffffffffffff;
      let la = (lc >> 32) as u32; let lb = (lc & 0xffffffff) as u32;
      let ra = (rc >> 32) as u32; let rb = (rc & 0xffffffff) as u32;
      let aId = dae.addBinaryExpr(BinOp.Add as u16, la, ra);
      let bId = dae.addBinaryExpr(BinOp.Add as u16, lb, rb);
      return ((aId as u64) << 32) | (bId as u64);
    }

    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      let lc = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
      let rc = extractLinearCoeffsRec(dae, right, targetVarId, depth + 1);
      if (lc == 0xffffffffffffffff || rc == 0xffffffffffffffff) return 0xffffffffffffffff;
      let la = (lc >> 32) as u32; let lb = (lc & 0xffffffff) as u32;
      let ra = (rc >> 32) as u32; let rb = (rc & 0xffffffff) as u32;
      let aId = dae.addBinaryExpr(BinOp.Sub as u16, la, ra);
      let bId = dae.addBinaryExpr(BinOp.Sub as u16, lb, rb);
      return ((aId as u64) << 32) | (bId as u64);
    }

    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      if (!leftHasVar) {
        let rc = extractLinearCoeffsRec(dae, right, targetVarId, depth + 1);
        if (rc == 0xffffffffffffffff) return 0xffffffffffffffff;
        let ra = (rc >> 32) as u32; let rb = (rc & 0xffffffff) as u32;
        let aId = dae.addBinaryExpr(BinOp.Mul as u16, left, ra);
        let bId = dae.addBinaryExpr(BinOp.Mul as u16, left, rb);
        return ((aId as u64) << 32) | (bId as u64);
      }
      if (!rightHasVar) {
        let lc = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
        if (lc == 0xffffffffffffffff) return 0xffffffffffffffff;
        let la = (lc >> 32) as u32; let lb = (lc & 0xffffffff) as u32;
        let aId = dae.addBinaryExpr(BinOp.Mul as u16, la, right);
        let bId = dae.addBinaryExpr(BinOp.Mul as u16, lb, right);
        return ((aId as u64) << 32) | (bId as u64);
      }
    }

    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      if (!rightHasVar) {
        let lc = extractLinearCoeffsRec(dae, left, targetVarId, depth + 1);
        if (lc == 0xffffffffffffffff) return 0xffffffffffffffff;
        let la = (lc >> 32) as u32; let lb = (lc & 0xffffffff) as u32;
        let aId = dae.addBinaryExpr(BinOp.Div as u16, la, right);
        let bId = dae.addBinaryExpr(BinOp.Div as u16, lb, right);
        return ((aId as u64) << 32) | (bId as u64);
      }
    }
  }

  return 0xffffffffffffffff;
}

/**
 * Attempts multi-strategy symbolic equation inversion to isolate targetVarId in eqIdx.
 * Returns the isolated ExprId or 0xffffffff if symbolic isolation fails.
 */
export function isolateSymbolically(dae: DaeBuilder, eqIdx: u32, targetVarId: u32): u32 {
  if (eqIdx >= dae.eqCount) return 0xffffffff;

  // Strategy 0: Explicit form
  let explicitRes = isExplicitlySolvable(dae, eqIdx, targetVarId);
  if (explicitRes != 0xffffffff) return explicitRes;

  let offset = eqIdx * EQ_STRIDE;
  let lhs = dae.getEqData().get(offset + EQ_LHS) as u32;
  let rhs = dae.getEqData().get(offset + EQ_RHS) as u32;

  // Strategy 1: Linear isolation on residual (lhs - rhs = 0 -> A*x + B = 0 -> x = -B / A)
  let residualId = dae.addBinaryExpr(BinOp.Sub as u16, lhs, rhs);
  let linearRes = extractLinearCoeffsRec(dae, residualId, targetVarId, 0);
  if (linearRes != 0xffffffffffffffff) {
    let aId = (linearRes >> 32) as u32;
    let bId = (linearRes & 0xffffffff) as u32;
    if (!cas_isZero(dae, aId)) {
      let negOne = dae.addRealLiteral(-1.0);
      let negB = dae.addBinaryExpr(BinOp.Mul as u16, negOne, bId);
      let divExpr = dae.addBinaryExpr(BinOp.Div as u16, negB, aId);
      return cas_simplify(dae, divExpr);
    }
  }

  // Strategy 2: Single-occurrence peeling
  let lhsCount = countVarOccurrences(dae, lhs, targetVarId);
  let rhsCount = countVarOccurrences(dae, rhs, targetVarId);

  if (lhsCount == 1 && rhsCount == 0) {
    let res = invertSingleOccurrence(dae, lhs, targetVarId, rhs);
    if (res != 0xffffffff) return cas_simplify(dae, res);
  }

  if (rhsCount == 1 && lhsCount == 0) {
    let res = invertSingleOccurrence(dae, rhs, targetVarId, lhs);
    if (res != 0xffffffff) return cas_simplify(dae, res);
  }

  // Also try single-occurrence peeling on residual = 0
  let totalCount = countVarOccurrences(dae, residualId, targetVarId);
  if (totalCount == 1) {
    let zeroId = dae.addRealLiteral(0.0);
    let res = invertSingleOccurrence(dae, residualId, targetVarId, zeroId);
    if (res != 0xffffffff) return cas_simplify(dae, res);
  }

  return 0xffffffff;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_isolateEquation(daePtr: u32, eqId: u32, targetVarId: u32): u32 {
  if (daePtr == 0) return 0xffffffff;
  let dae = changetype<DaeBuilder>(daePtr);
  return isolateSymbolically(dae, eqId, targetVarId);
}

/**
 * Batch-isolates 1x1 BLT blocks in WebAssembly linear memory.
 *
 * @param daePtr Pointer to DaeBuilder in linear memory
 * @param eqIndicesPtr Pointer to u32 array of equation indices (length = count)
 * @param varIndicesPtr Pointer to u32 array of target variable indices (length = count)
 * @param count Number of 1x1 blocks to isolate
 * @param outExprIdsPtr Pointer to output u32 array of isolated ExprIds (length = count)
 * @returns Number of successfully isolated equations (exprId != 0xffffffff)
 */
export function dae_batchIsolate1x1Blocks(
  daePtr: u32,
  eqIndicesPtr: usize,
  varIndicesPtr: usize,
  count: i32,
  outExprIdsPtr: usize
): i32 {
  if (daePtr == 0 || count <= 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr as usize);
  let isolatedCount: i32 = 0;

  for (let i: i32 = 0; i < count; ++i) {
    let eqIdx = load<u32>(eqIndicesPtr + ((i as usize) << 2));
    let varIdx = load<u32>(varIndicesPtr + ((i as usize) << 2));
    let exprId = isolateSymbolically(dae, eqIdx, varIdx);
    store<u32>(outExprIdsPtr + ((i as usize) << 2), exprId);
    if (exprId != 0xffffffff) {
      isolatedCount++;
    }
  }

  return isolatedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dual Numbers & Transcendental Inverses
// ─────────────────────────────────────────────────────────────────────────────

@unmanaged
export class Dual {
  val: f64;
  der: f64;
}

export function createDual(val: f64, der: f64): Dual {
  let ptr = atomicChunkAlloc(sizeof<Dual>());
  let d = changetype<Dual>(ptr);
  d.val = val;
  d.der = der;
  return d;
}

export function dualConst(c: f64): Dual {
  return createDual(c, 0.0);
}

export function dualVar(x: f64): Dual {
  return createDual(x, 1.0);
}

export function dualAdd(a: Dual, b: Dual): Dual {
  return createDual(a.val + b.val, a.der + b.der);
}

export function dualSub(a: Dual, b: Dual): Dual {
  return createDual(a.val - b.val, a.der - b.der);
}

export function dualMul(a: Dual, b: Dual): Dual {
  return createDual(a.val * b.val, a.val * b.der + a.der * b.val);
}

export function dualDiv(a: Dual, b: Dual): Dual {
  let denom = b.val * b.val;
  return createDual(b.val != 0.0 ? a.val / b.val : 0.0, denom != 0.0 ? (a.der * b.val - a.val * b.der) / denom : 0.0);
}

export function dualSin(a: Dual): Dual {
  return createDual(Math.sin(a.val), a.der * Math.cos(a.val));
}

export function dualCos(a: Dual): Dual {
  return createDual(Math.cos(a.val), -a.der * Math.sin(a.val));
}

export function dualExp(a: Dual): Dual {
  let ev = Math.exp(a.val);
  return createDual(ev, a.der * ev);
}

export function dualLog(a: Dual): Dual {
  return createDual(a.val > 0.0 ? Math.log(a.val) : 0.0, a.val > 0.0 ? a.der / a.val : 0.0);
}

export function inverseSinh(x: f64): f64 {
  return Math.log(x + Math.sqrt(x * x + 1.0));
}

export function inverseCosh(x: f64): f64 {
  return x >= 1.0 ? Math.log(x + Math.sqrt(x * x - 1.0)) : 0.0;
}

export function inverseTanh(x: f64): f64 {
  return (x > -1.0 && x < 1.0) ? 0.5 * Math.log((1.0 + x) / (1.0 - x)) : 0.0;
}

/**
 * Principal branch W0 of Lambert W function via Halley's iteration.
 */
export function lambertW0(x: f64): f64 {
  if (x < -0.36787944117144233) return -1.0;
  if (Math.abs(x) < 1e-14) return x;

  let w: f64 = x < 1.0 ? x : Math.log(x);
  for (let i: u32 = 0; i < 20; i++) {
    let ew = Math.exp(w);
    let wew = w * ew;
    let f = wew - x;
    if (Math.abs(f) < 1e-12) break;
    let fprime = ew * (w + 1.0);
    let fdouble = ew * (w + 2.0);
    w -= f / (fprime - (f * fdouble) / (2.0 * fprime));
  }
  return w;
}

export function initWarmStartCache(capacity: u32 = 256): u32 {
  let ptr = atomicChunkAlloc(32);
  memory.fill(ptr, 0, 32);
  let m = changetype<UnmanagedMap64To64>(ptr);
  m.init(capacity);
  return ptr as u32;
}

export function getWarmStartValue(cachePtr: u32, key: u32, defaultVal: f64): f64 {
  if (cachePtr == 0) return defaultVal;
  let m = changetype<UnmanagedMap64To64>(cachePtr);
  let k = (key as u64) + 1;
  if (!m.has(k)) return defaultVal;
  return f64.reinterpret_i64(m.get(k) as i64);
}

export function setWarmStartValue(cachePtr: u32, key: u32, val: f64): void {
  if (cachePtr == 0) return;
  let m = changetype<UnmanagedMap64To64>(cachePtr);
  let k = (key as u64) + 1;
  m.set(k, i64.reinterpret_f64(val) as u64);
}

export function solve1x1Newton(initGuess: f64, targetResidual: f64): f64 {
  if (Math.abs(targetResidual) < 1e-12) return initGuess;
  return initGuess - targetResidual;
}

export function solveHomotopy(initGuess: f64, targetResidual: f64): f64 {
  if (Math.abs(targetResidual) < 1e-12) return initGuess;
  return initGuess - targetResidual;
}

