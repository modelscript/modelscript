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
} from "./dae";
import { cas_simplify, cas_isZero } from "./cas";
import { BuiltinMathFunc } from "./fold";

/**
 * Checks if an expression is a direct reference to targetVarId or der(targetVarId).
 */
@inline
export function isTargetVar(dae: DaeBuilder, exprId: u32, targetVarId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as u32) == targetVarId;
  }
  if (kind == ExprKind.Der) {
    let inner = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      return (dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32) == targetVarId;
    }
  }
  return false;
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
    let first = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let sum: u32 = 0;
    for (let i: u32 = 0; i < count; i++) {
      sum += countVarOccurrences(dae, first + i, targetVarId);
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
    }
  }

  // Math Builtin Function Inversions
  if (kind == ExprKind.Call) {
    let funcId = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    let firstArg = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let argCount = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    if (argCount == 1 && countVarOccurrences(dae, firstArg, targetVarId) == 1) {
      let invArg: u32 = 0xffffffff;
      let newFirst = dae.exprCount;

      if (funcId == BuiltinMathFunc.Exp) {
        // exp(u) = val -> u = log(val)
        invArg = dae.addCall(BuiltinMathFunc.Log, targetValExpr, 1);
      } else if (funcId == BuiltinMathFunc.Log) {
        // log(u) = val -> u = exp(val)
        invArg = dae.addCall(BuiltinMathFunc.Exp, targetValExpr, 1);
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
      }

      if (invArg != 0xffffffff) {
        return invertSingleOccurrence(dae, firstArg, targetVarId, invArg);
      }
    }
  }

  return 0xffffffff;
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

  // Residual peeling: (LHS - RHS) = 0
  let residual = dae.addBinaryExpr(BinOp.Sub as u16, lhs, rhs);
  let totalCount = countVarOccurrences(dae, residual, targetVarId);
  if (totalCount == 1) {
    let zero = dae.addRealLiteral(0.0);
    let res = invertSingleOccurrence(dae, residual, targetVarId, zero);
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
