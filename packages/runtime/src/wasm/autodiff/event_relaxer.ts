// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Parameter-Annealed Sigmoidal Event & Switch Relaxer for DaeBuilder Arenas.
 * Rewrites non-smooth expressions (if-then-else, abs, sign, max, min) into smooth C^inf
 * approximations directly in WebAssembly linear memory.
 */

import {
  BinOp,
  DaeBuilder,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_STRIDE,
  EXPR_DATA1,
  EXPR_KIND,
  EXPR_LEFT,
  EXPR_RIGHT,
  EXPR_STRIDE,
  EqKind,
  ExprKind,
} from "../dae/builder";
import { BuiltinMathFunc } from "../dae/fold";

const FLAG_RELAX_IF_ELSE: u32 = 1;
const FLAG_RELAX_ABS: u32 = 2;
const FLAG_RELAX_SIGN: u32 = 4;
const FLAG_RELAX_MAX_MIN: u32 = 8;

@inline
function internRelaxFunc(dae: DaeBuilder, name: string, fallbackId: u32): u32 {
  const sp = dae.stringPool;
  if (changetype<usize>(sp) != 0) {
    return sp.internUtf16(changetype<usize>(name), (name.length << 1) as u32);
  }
  return fallbackId;
}

function buildSigmoidWasm(dae: DaeBuilder, indicatorId: u32, k: f64): u32 {
  const halfKLit = dae.addRealLiteral(0.5 * k);
  const scaled = dae.addBinaryExpr(BinOp.Mul as u16, halfKLit, indicatorId);
  const tanhId = internRelaxFunc(dae, "tanh", BuiltinMathFunc.Tanh);
  const tanhVal = dae.addCall(tanhId, scaled, 1);
  const oneLit = dae.addRealLiteral(1.0);
  const onePlusTanh = dae.addBinaryExpr(BinOp.Add as u16, oneLit, tanhVal);
  const halfLit = dae.addRealLiteral(0.5);
  return dae.addBinaryExpr(BinOp.Mul as u16, halfLit, onePlusTanh);
}

function extractContinuousIndicatorWasm(dae: DaeBuilder, condExprId: u32, k: f64, flags: u32): u32 {
  if (condExprId < dae.exprCount) {
    const off = condExprId * EXPR_STRIDE;
    const kind = dae.getExprData().get(off + EXPR_KIND);
    if (kind == ExprKind.Binary) {
      const op = dae.getExprData().get(off + EXPR_DATA1);
      const leftId = relaxExprWasm(dae, dae.getExprData().get(off + EXPR_LEFT) as u32, k, flags);
      const rightId = relaxExprWasm(dae, dae.getExprData().get(off + EXPR_RIGHT) as u32, k, flags);
      if (op == BinOp.Gt || op == BinOp.Gte) {
        return dae.addBinaryExpr(BinOp.Sub as u16, leftId, rightId);
      }
      if (op == BinOp.Lt || op == BinOp.Lte) {
        return dae.addBinaryExpr(BinOp.Sub as u16, rightId, leftId);
      }
    }
  }
  const relaxedCond = relaxExprWasm(dae, condExprId, k, flags);
  const halfLit = dae.addRealLiteral(0.5);
  return dae.addBinaryExpr(BinOp.Sub as u16, relaxedCond, halfLit);
}

function relaxExprWasm(dae: DaeBuilder, exprId: u32, k: f64, flags: u32): u32 {
  if (exprId >= dae.exprCount) return exprId;
  const off = exprId * EXPR_STRIDE;
  const kind = dae.getExprData().get(off + EXPR_KIND);

  if (kind == ExprKind.IfElse) {
    if ((flags & FLAG_RELAX_IF_ELSE) == 0) return exprId;
    const condId = dae.getExprData().get(off + EXPR_DATA1) as u32;
    const thenId = relaxExprWasm(dae, dae.getExprData().get(off + EXPR_LEFT) as u32, k, flags);
    const elseId = relaxExprWasm(dae, dae.getExprData().get(off + EXPR_RIGHT) as u32, k, flags);
    const ind = extractContinuousIndicatorWasm(dae, condId, k, flags);
    const sigma = buildSigmoidWasm(dae, ind, k);
    const termThen = dae.addBinaryExpr(BinOp.Mul as u16, sigma, thenId);
    const oneMinusSigma = dae.addBinaryExpr(BinOp.Sub as u16, dae.addRealLiteral(1.0), sigma);
    const termElse = dae.addBinaryExpr(BinOp.Mul as u16, oneMinusSigma, elseId);
    return dae.addBinaryExpr(BinOp.Add as u16, termThen, termElse);
  }

  if (kind == ExprKind.Binary) {
    const op = dae.getExprData().get(off + EXPR_DATA1) as u16;
    const leftId = dae.getExprData().get(off + EXPR_LEFT) as u32;
    const rightId = dae.getExprData().get(off + EXPR_RIGHT) as u32;
    const rLeft = relaxExprWasm(dae, leftId, k, flags);
    const rRight = relaxExprWasm(dae, rightId, k, flags);
    if (rLeft != leftId || rRight != rightId) {
      return dae.addBinaryExpr(op, rLeft, rRight);
    }
    return exprId;
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    const op = kind == ExprKind.Negate ? 0 : (dae.getExprData().get(off + EXPR_DATA1) as u16);
    const leftId = dae.getExprData().get(off + EXPR_LEFT) as u32;
    const rLeft = relaxExprWasm(dae, leftId, k, flags);
    if (rLeft != leftId) {
      return dae.addExpression(ExprKind.Unary, op, rLeft, 0xffffffff);
    }
    return exprId;
  }

  if (kind == ExprKind.Call) {
    const rawFuncId = dae.getExprData().get(off + EXPR_DATA1) as i32;
    const funcId = dae.resolveBuiltinMathFunc(rawFuncId);
    const firstArgId = dae.getExprData().get(off + EXPR_LEFT) as u32;
    const argCount = dae.getExprData().get(off + EXPR_RIGHT) as u32;

    if (argCount == 1) {
      const arg = relaxExprWasm(dae, firstArgId, k, flags);
      if (funcId == BuiltinMathFunc.Abs && (flags & FLAG_RELAX_ABS) != 0) {
        const eps = 1.0 / k;
        const epsSq = dae.addRealLiteral(eps * eps);
        const xSq = dae.addBinaryExpr(BinOp.Mul as u16, arg, arg);
        const sum = dae.addBinaryExpr(BinOp.Add as u16, xSq, epsSq);
        return dae.addCall(internRelaxFunc(dae, "sqrt", BuiltinMathFunc.Sqrt), sum, 1);
      }
      if (funcId == BuiltinMathFunc.Sign && (flags & FLAG_RELAX_SIGN) != 0) {
        const kx = dae.addBinaryExpr(BinOp.Mul as u16, dae.addRealLiteral(k), arg);
        return dae.addCall(internRelaxFunc(dae, "tanh", BuiltinMathFunc.Tanh), kx, 1);
      }
      if (arg != firstArgId) {
        return dae.addCall(rawFuncId as u32, arg, 1);
      }
    } else if (argCount == 2) {
      const secondArgId = dae.getExprData().get((exprId + 1) * EXPR_STRIDE + EXPR_LEFT) as u32;
      const arg0 = relaxExprWasm(dae, firstArgId, k, flags);
      const arg1 = relaxExprWasm(dae, secondArgId, k, flags);
      if ((flags & FLAG_RELAX_MAX_MIN) != 0 && (funcId == BuiltinMathFunc.Max || funcId == BuiltinMathFunc.Min)) {
        const diff = dae.addBinaryExpr(BinOp.Sub as u16, arg0, arg1);
        const sigma = buildSigmoidWasm(dae, diff, k);
        const oneMinusSigma = dae.addBinaryExpr(BinOp.Sub as u16, dae.addRealLiteral(1.0), sigma);
        if (funcId == BuiltinMathFunc.Max) {
          const termA = dae.addBinaryExpr(BinOp.Mul as u16, sigma, arg0);
          const termB = dae.addBinaryExpr(BinOp.Mul as u16, oneMinusSigma, arg1);
          return dae.addBinaryExpr(BinOp.Add as u16, termA, termB);
        } else {
          const termA = dae.addBinaryExpr(BinOp.Mul as u16, oneMinusSigma, arg0);
          const termB = dae.addBinaryExpr(BinOp.Mul as u16, sigma, arg1);
          return dae.addBinaryExpr(BinOp.Add as u16, termA, termB);
        }
      }
    }
  }

  return exprId;
}

/**
 * Relaxes a single expression in DaeBuilder linear memory.
 */
export function dae_relaxExpression(daePtr: u32, exprId: u32, k: f64, flags: u32): u32 {
  if (daePtr == 0) return exprId;
  const dae = changetype<DaeBuilder>(daePtr as usize);
  return relaxExprWasm(dae, exprId, k, flags);
}

/**
 * Relaxes all Simple/InitialSimple equations and variable binding expressions
 * in-place in DaeBuilder linear memory. Returns number of rewritten expressions.
 */
export function dae_relaxAllEquations(daePtr: u32, k: f64, flags: u32): i32 {
  if (daePtr == 0) return 0;
  const dae = changetype<DaeBuilder>(daePtr as usize);
  let rewritten: i32 = 0;

  const eqCount = dae.eqCount;
  for (let eqIdx: u32 = 0; eqIdx < eqCount; eqIdx++) {
    const eqOff = eqIdx * EQ_STRIDE;
    const eqKind = dae.getEqData().get(eqOff + EQ_KIND);
    if (eqKind == EqKind.Simple || eqKind == EqKind.InitialSimple) {
      const lhs = dae.getEqData().get(eqOff + EQ_LHS) as u32;
      const rhs = dae.getEqData().get(eqOff + EQ_RHS) as u32;
      const newLhs = relaxExprWasm(dae, lhs, k, flags);
      const newRhs = relaxExprWasm(dae, rhs, k, flags);
      if (newLhs != lhs) {
        dae.getEqData().set(eqOff + EQ_LHS, newLhs as i32);
        rewritten++;
      }
      if (newRhs != rhs) {
        dae.getEqData().set(eqOff + EQ_RHS, newRhs as i32);
        rewritten++;
      }
    }
  }

  return rewritten;
}
