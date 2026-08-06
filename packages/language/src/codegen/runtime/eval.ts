import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS } from "./dae";

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values.
 * Returns f64 result.
 */
@inline
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: u32): f64 {
  if (exprId == 0xffffffff) return 0.0;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.RealLiteral) {
    let lo = dae.exprData.get(offset + EXPR_DATA1) as u64;
    let hi = dae.exprData.get(offset + EXPR_LEFT) as u64;
    let bits = (hi << 32) | lo;
    return reinterpret<f64>(bits);
  }

  if (kind == ExprKind.IntLiteral) {
    let val = dae.exprData.get(offset + EXPR_DATA1) as i32;
    return val as f64;
  }

  if (kind == ExprKind.Name) {
    let varId = dae.exprData.get(offset + EXPR_DATA1);
    // Load f64 value from varValuesPtr + varId * 8
    return load<f64>(varValuesPtr + varId * 8);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let left = dae.exprData.get(offset + EXPR_LEFT);
    let val = evalExpr(left, dae, varValuesPtr);
    return -val;
  }

  if (kind == ExprKind.Binary) {
    let op = dae.exprData.get(offset + EXPR_DATA1);
    let left = dae.exprData.get(offset + EXPR_LEFT);
    let right = dae.exprData.get(offset + EXPR_RIGHT);

    let lVal = evalExpr(left, dae, varValuesPtr);
    let rVal = evalExpr(right, dae, varValuesPtr);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return rVal != 0.0 ? lVal / rVal : 0.0;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(lVal, rVal);
  }

  return 0.0;
}

/**
 * Computes equation residual: F(x) = RHS - LHS
 */
@inline
export function evalEquationResidual(eqId: u32, dae: DaeBuilder, varValuesPtr: u32): f64 {
  let offset = eqId * EQ_STRIDE;
  let lhsId = dae.eqData.get(offset + EQ_LHS);
  let rhsId = dae.eqData.get(offset + EQ_RHS);

  let lhsVal = evalExpr(lhsId, dae, varValuesPtr);
  let rhsVal = evalExpr(rhsId, dae, varValuesPtr);

  return rhsVal - lhsVal;
}
