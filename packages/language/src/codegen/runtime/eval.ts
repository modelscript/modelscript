import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS } from "./dae";

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values.
 * Returns f64 result.
 */
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: u32): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    return f64.reinterpret_i64(bits as i64);
  }

  if (kind == ExprKind.IntLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    return val as f64;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) return 0.0;
    return load<f64>(varValuesPtr + varId * 8);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let left = exprData.get(offset + EXPR_LEFT);
    let val = evalExpr(left, dae, varValuesPtr);
    return -val;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);

    let lVal = evalExpr(left, dae, varValuesPtr);
    let rVal = evalExpr(right, dae, varValuesPtr);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return rVal != 0.0 ? lVal / rVal : 0.0;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(lVal, rVal);
  }

  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1);
    let arg1 = exprData.get(offset + EXPR_LEFT);
    let arg2 = exprData.get(offset + EXPR_RIGHT);

    let v1 = evalExpr(arg1, dae, varValuesPtr);
    let v2 = evalExpr(arg2, dae, varValuesPtr);

    if (funcId == 1) return Math.abs(v1);
    if (funcId == 2) return Math.sqrt(v1);
    if (funcId == 3) return Math.sin(v1);
    if (funcId == 4) return Math.cos(v1);
    if (funcId == 5) return Math.exp(v1);
    if (funcId == 6) return Math.log(v1);
    if (funcId == 7) return Math.floor(v1);
    if (funcId == 8) return Math.ceil(v1);
    if (funcId == 9) return Math.min(v1, v2);
    if (funcId == 10) return Math.max(v1, v2);
  }

  return 0.0;
}

/**
 * Computes equation residual: F(x) = RHS - LHS
 */
@inline
export function evalEquationResidual(eqId: u32, dae: DaeBuilder, varValuesPtr: u32): f64 {
  if (eqId >= dae.eqCount) return 0.0;
  let eqData = dae.getEqData();
  let offset = eqId * EQ_STRIDE;
  let lhsId = eqData.get(offset + EQ_LHS);
  let rhsId = eqData.get(offset + EQ_RHS);

  let lhsVal = evalExpr(lhsId, dae, varValuesPtr);
  let rhsVal = evalExpr(rhsId, dae, varValuesPtr);

  return rhsVal - lhsVal;
}

export function dae_evalExpr(daePtr: u32, exprId: u32, varValuesPtr: u32): f64 {
  return evalExpr(exprId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}

export function dae_evalEquationResidual(daePtr: u32, eqId: u32, varValuesPtr: u32): f64 {
  return evalEquationResidual(eqId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}
