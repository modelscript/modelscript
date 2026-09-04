/* eslint-disable */
// @ts-nocheck
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
  EQ_LHS,
  EQ_RHS,
} from "./dae";
import { BuiltinMathFunc } from "./fold";

/**
 * Unmanaged Dual number structure (16 bytes: val f64, dot f64) for
 * zero-garbage forward-mode automatic differentiation in WebAssembly linear memory.
 */
@unmanaged
export class Dual {
  val: f64;
  dot: f64;

  @inline
  set(val: f64, dot: f64 = 0.0): void {
    this.val = val;
    this.dot = dot;
  }

  @inline
  copyFrom(other: Dual): void {
    this.val = other.val;
    this.dot = other.dot;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arithmetic Operations
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function dualConst(v: f64, out: Dual): void {
  out.val = v;
  out.dot = 0.0;
}

@inline
export function dualVar(v: f64, dot: f64, out: Dual): void {
  out.val = v;
  out.dot = dot;
}

@inline
export function dualAdd(a: Dual, b: Dual, out: Dual): void {
  out.val = a.val + b.val;
  out.dot = a.dot + b.dot;
}

@inline
export function dualSub(a: Dual, b: Dual, out: Dual): void {
  out.val = a.val - b.val;
  out.dot = a.dot - b.dot;
}

@inline
export function dualMul(a: Dual, b: Dual, out: Dual): void {
  if ((a.val == 0.0 && a.dot == 0.0) || (b.val == 0.0 && b.dot == 0.0)) {
    out.val = 0.0;
    out.dot = 0.0;
    return;
  }
  let v = a.val * b.val;
  let d = a.val * b.dot + a.dot * b.val;
  out.val = v;
  out.dot = d;
}

@inline
export function dualDiv(a: Dual, b: Dual, out: Dual): void {
  if (b.val == 0.0) {
    out.val = 0.0;
    out.dot = 0.0;
    return;
  }
  let b2 = b.val * b.val;
  let v = a.val / b.val;
  let d = (a.dot * b.val - a.val * b.dot) / b2;
  out.val = v;
  out.dot = d;
}

@inline
export function dualPow(a: Dual, b: Dual, out: Dual): void {
  if (b.dot == 0.0) {
    let v = Math.pow(a.val, b.val);
    out.val = v;
    out.dot = b.val * Math.pow(a.val, b.val - 1.0) * a.dot;
    return;
  }
  if (a.dot == 0.0) {
    let v = Math.pow(a.val, b.val);
    out.val = v;
    out.dot = a.val > 0.0 ? v * Math.log(a.val) * b.dot : 0.0;
    return;
  }
  let v = Math.pow(a.val, b.val);
  let logA = a.val > 0.0 ? Math.log(a.val) : 0.0;
  let d = a.val != 0.0 ? v * ((b.val * a.dot) / a.val + b.dot * logA) : 0.0;
  out.val = v;
  out.dot = d;
}

@inline
export function dualNeg(a: Dual, out: Dual): void {
  out.val = -a.val;
  out.dot = -a.dot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigonometric Functions
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function dualSin(a: Dual, out: Dual): void {
  out.val = Math.sin(a.val);
  out.dot = a.dot * Math.cos(a.val);
}

@inline
export function dualCos(a: Dual, out: Dual): void {
  out.val = Math.cos(a.val);
  out.dot = -a.dot * Math.sin(a.val);
}

@inline
export function dualTan(a: Dual, out: Dual): void {
  let t = Math.tan(a.val);
  out.val = t;
  out.dot = a.dot * (1.0 + t * t);
}

@inline
export function dualAsin(a: Dual, out: Dual): void {
  let denom = 1.0 - a.val * a.val;
  out.val = Math.asin(a.val);
  out.dot = denom > 0.0 ? a.dot / Math.sqrt(denom) : 0.0;
}

@inline
export function dualAcos(a: Dual, out: Dual): void {
  let denom = 1.0 - a.val * a.val;
  out.val = Math.acos(a.val);
  out.dot = denom > 0.0 ? -a.dot / Math.sqrt(denom) : 0.0;
}

@inline
export function dualAtan(a: Dual, out: Dual): void {
  out.val = Math.atan(a.val);
  out.dot = a.dot / (1.0 + a.val * a.val);
}

@inline
export function dualAtan2(a: Dual, b: Dual, out: Dual): void {
  let denom = a.val * a.val + b.val * b.val;
  out.val = Math.atan2(a.val, b.val);
  out.dot = denom != 0.0 ? (b.val * a.dot - a.val * b.dot) / denom : 0.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hyperbolic Functions
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function dualSinh(a: Dual, out: Dual): void {
  out.val = Math.sinh(a.val);
  out.dot = a.dot * Math.cosh(a.val);
}

@inline
export function dualCosh(a: Dual, out: Dual): void {
  out.val = Math.cosh(a.val);
  out.dot = a.dot * Math.sinh(a.val);
}

@inline
export function dualTanh(a: Dual, out: Dual): void {
  let t = Math.tanh(a.val);
  out.val = t;
  out.dot = a.dot * (1.0 - t * t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exponential and Logarithmic Functions
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function dualExp(a: Dual, out: Dual): void {
  let e = Math.exp(a.val);
  out.val = e;
  out.dot = a.dot * e;
}

@inline
export function dualLog(a: Dual, out: Dual): void {
  out.val = a.val > 0.0 ? Math.log(a.val) : 0.0;
  out.dot = a.val > 0.0 ? a.dot / a.val : 0.0;
}

@inline
export function dualLog10(a: Dual, out: Dual): void {
  const ln10: f64 = 2.302585092994046;
  out.val = a.val > 0.0 ? Math.log10(a.val) : 0.0;
  out.dot = a.val > 0.0 ? a.dot / (a.val * ln10) : 0.0;
}

@inline
export function dualSqrt(a: Dual, out: Dual): void {
  let s = a.val >= 0.0 ? Math.sqrt(a.val) : 0.0;
  out.val = s;
  out.dot = s > 0.0 ? a.dot / (2.0 * s) : 0.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Piecewise, Non-Smooth & Integer Math Functions
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function dualAbs(a: Dual, out: Dual): void {
  let s: f64 = a.val > 0.0 ? 1.0 : a.val < 0.0 ? -1.0 : 0.0;
  out.val = Math.abs(a.val);
  out.dot = a.dot * s;
}

@inline
export function dualSign(a: Dual, out: Dual): void {
  out.val = Math.sign(a.val);
  out.dot = 0.0;
}

@inline
export function dualCeil(a: Dual, out: Dual): void {
  out.val = Math.ceil(a.val);
  out.dot = 0.0;
}

@inline
export function dualFloor(a: Dual, out: Dual): void {
  out.val = Math.floor(a.val);
  out.dot = 0.0;
}

@inline
export function dualMin(a: Dual, b: Dual, out: Dual): void {
  if (a.val <= b.val) {
    out.val = a.val;
    out.dot = a.dot;
  } else {
    out.val = b.val;
    out.dot = b.dot;
  }
}

@inline
export function dualMax(a: Dual, b: Dual, out: Dual): void {
  if (a.val >= b.val) {
    out.val = a.val;
    out.dot = a.dot;
  } else {
    out.val = b.val;
    out.dot = b.dot;
  }
}

@inline
export function dualMod(a: Dual, b: Dual, out: Dual): void {
  if (b.val == 0.0) {
    out.val = 0.0;
    out.dot = 0.0;
    return;
  }
  out.val = a.val - Math.floor(a.val / b.val) * b.val;
  out.dot = a.dot;
}

@inline
export function dualRem(a: Dual, b: Dual, out: Dual): void {
  if (b.val == 0.0) {
    out.val = 0.0;
    out.dot = 0.0;
    return;
  }
  out.val = a.val - Math.trunc(a.val / b.val) * b.val;
  out.dot = a.dot;
}

@inline
export function dualTrunc(a: Dual, b: Dual, out: Dual): void {
  if (b.val == 0.0) {
    out.val = 0.0;
    out.dot = 0.0;
    return;
  }
  out.val = Math.trunc(a.val / b.val);
  out.dot = 0.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expression Evaluator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively evaluates an AST expression tree in DaeBuilder with dual numbers.
 * Propagates primal values and derivatives through the expression graph.
 */
export function evalDualExpr(exprId: u32, dae: DaeBuilder, dualVarsPtr: usize, outDual: Dual): void {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) {
    outDual.set(0.0, 0.0);
    return;
  }

  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    outDual.set(f64.reinterpret_i64(bits as i64), 0.0);
    return;
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    outDual.set(val as f64, 0.0);
    return;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) {
      outDual.set(0.0, 0.0);
      return;
    }
    let v = load<f64>(dualVarsPtr + (varId << 4));
    let d = load<f64>(dualVarsPtr + (varId << 4) + 8);
    outDual.set(v, d);
    return;
  }

  if (kind == ExprKind.Der) {
    let inner = exprData.get(offset + EXPR_DATA1) as u32;
    if (inner < dae.exprCount && exprData.get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let varId = exprData.get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
      let v = load<f64>(dualVarsPtr + (varId << 4));
      let d = load<f64>(dualVarsPtr + (varId << 4) + 8);
      outDual.set(v, d);
      return;
    }
    outDual.set(0.0, 0.0);
    return;
  }

  if (kind == ExprKind.Negate) {
    let left = exprData.get(offset + EXPR_LEFT) as u32;
    let localDual = new Dual();
    evalDualExpr(left, dae, dualVarsPtr, localDual);
    dualNeg(localDual, outDual);
    return;
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let left = exprData.get(offset + EXPR_LEFT) as u32;
    let localDual = new Dual();
    evalDualExpr(left, dae, dualVarsPtr, localDual);

    if (op == UnaryOp.Negate) {
      dualNeg(localDual, outDual);
    } else if (op == UnaryOp.Not) {
      outDual.set(localDual.val == 0.0 ? 1.0 : 0.0, 0.0);
    } else {
      outDual.copyFrom(localDual);
    }
    return;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let leftId = exprData.get(offset + EXPR_LEFT) as u32;
    let rightId = exprData.get(offset + EXPR_RIGHT) as u32;

    let lDual = new Dual();
    let rDual = new Dual();
    evalDualExpr(leftId, dae, dualVarsPtr, lDual);
    evalDualExpr(rightId, dae, dualVarsPtr, rDual);

    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      dualAdd(lDual, rDual, outDual);
    } else if (op == BinOp.Sub || op == BinOp.ElemSub) {
      dualSub(lDual, rDual, outDual);
    } else if (op == BinOp.Mul || op == BinOp.ElemMul) {
      dualMul(lDual, rDual, outDual);
    } else if (op == BinOp.Div || op == BinOp.ElemDiv) {
      dualDiv(lDual, rDual, outDual);
    } else if (op == BinOp.Pow || op == BinOp.ElemPow) {
      dualPow(lDual, rDual, outDual);
    } else if (op == BinOp.Lt) {
      outDual.set(lDual.val < rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Lte) {
      outDual.set(lDual.val <= rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Gt) {
      outDual.set(lDual.val > rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Gte) {
      outDual.set(lDual.val >= rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Eq) {
      outDual.set(lDual.val == rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Neq) {
      outDual.set(lDual.val != rDual.val ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.And) {
      outDual.set(lDual.val != 0.0 && rDual.val != 0.0 ? 1.0 : 0.0, 0.0);
    } else if (op == BinOp.Or) {
      outDual.set(lDual.val != 0.0 || rDual.val != 0.0 ? 1.0 : 0.0, 0.0);
    } else {
      outDual.set(0.0, 0.0);
    }
    return;
  }

  if (kind == ExprKind.IfElse) {
    let condId = exprData.get(offset + EXPR_DATA1) as u32;
    let thenId = exprData.get(offset + EXPR_LEFT) as u32;
    let elseId = exprData.get(offset + EXPR_RIGHT) as u32;

    let condDual = new Dual();
    evalDualExpr(condId, dae, dualVarsPtr, condDual);
    if (condDual.val != 0.0) {
      evalDualExpr(thenId, dae, dualVarsPtr, outDual);
    } else {
      evalDualExpr(elseId, dae, dualVarsPtr, outDual);
    }
    return;
  }

  if (kind == ExprKind.Pre) {
    let argId = exprData.get(offset + EXPR_DATA1) as u32;
    let argDual = new Dual();
    evalDualExpr(argId, dae, dualVarsPtr, argDual);
    // 'pre' returns previous discrete value, derivative is 0
    outDual.set(argDual.val, 0.0);
    return;
  }

  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1) as u32;
    let arg0Id = exprData.get(offset + EXPR_LEFT) as u32;
    let arg1Id = exprData.get(offset + EXPR_RIGHT) as u32;

    let arg0 = new Dual();
    evalDualExpr(arg0Id, dae, dualVarsPtr, arg0);

    if (funcId == BuiltinMathFunc.Sin) {
      dualSin(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Cos) {
      dualCos(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Tan) {
      dualTan(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Asin) {
      dualAsin(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Acos) {
      dualAcos(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Atan) {
      dualAtan(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Sinh) {
      dualSinh(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Cosh) {
      dualCosh(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Tanh) {
      dualTanh(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Exp) {
      dualExp(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Log) {
      dualLog(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Log10) {
      dualLog10(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Sqrt) {
      dualSqrt(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Abs) {
      dualAbs(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Sign) {
      dualSign(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Ceil) {
      dualCeil(arg0, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Floor) {
      dualFloor(arg0, outDual);
      return;
    }

    // 2-argument functions
    let arg1 = new Dual();
    evalDualExpr(arg1Id, dae, dualVarsPtr, arg1);

    if (funcId == BuiltinMathFunc.Atan2) {
      dualAtan2(arg0, arg1, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Min) {
      dualMin(arg0, arg1, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Max) {
      dualMax(arg0, arg1, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Fmod) {
      dualMod(arg0, arg1, outDual);
      return;
    }
    if (funcId == BuiltinMathFunc.Pow) {
      dualPow(arg0, arg1, outDual);
      return;
    }

    // Fallback: return primal evaluation
    outDual.set(arg0.val, 0.0);
    return;
  }

  outDual.set(0.0, 0.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Equation Residual and Jacobian Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes equation residual R = RHS - LHS and its derivative dR/dx in forward mode.
 */
export function evalDualEquationResidual(eqId: u32, dae: DaeBuilder, dualVarsPtr: usize, outDual: Dual): void {
  if (eqId >= dae.eqCount) {
    outDual.set(0.0, 0.0);
    return;
  }

  let eqData = dae.getEqData();
  let offset = eqId * EQ_STRIDE;
  let lhsId = eqData.get(offset + EQ_LHS) as u32;
  let rhsId = eqData.get(offset + EQ_RHS) as u32;

  let lhsDual = new Dual();
  let rhsDual = new Dual();

  evalDualExpr(lhsId, dae, dualVarsPtr, lhsDual);
  evalDualExpr(rhsId, dae, dualVarsPtr, rhsDual);

  dualSub(rhsDual, lhsDual, outDual);
}

/**
 * Evaluates one column of the Jacobian matrix: J[:, seedCol] = d(Residuals) / d(x_seedVar)
 * in a single forward pass over all active equations.
 */
export function evalDualJacobianColumn(
  dae: DaeBuilder,
  nEqs: u32,
  eqIndicesPtr: usize,
  dualVarsPtr: usize,
  seedVarId: u32,
  outColPtr: usize,
): void {
  // Seed the target variable: dx_seed / dx_seed = 1.0
  let seedOffset = (seedVarId << 4) + 8;
  store<f64>(dualVarsPtr + seedOffset, 1.0);

  let resDual = new Dual();

  for (let i: u32 = 0; i < nEqs; i++) {
    let eqIdx = load<u32>(eqIndicesPtr + (i << 2));
    evalDualEquationResidual(eqIdx, dae, dualVarsPtr, resDual);
    store<f64>(outColPtr + (i << 3), resDual.dot);
  }

  // Reset seed
  store<f64>(dualVarsPtr + seedOffset, 0.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone C-ABI / WASM Exports
// ─────────────────────────────────────────────────────────────────────────────

export function dae_evalDualExpr(daePtr: u32, exprId: u32, dualVarsPtr: u32, outValPtr: u32, outDotPtr: u32): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let res = new Dual();
  evalDualExpr(exprId, dae, dualVarsPtr as usize, res);
  if (outValPtr != 0) store<f64>(outValPtr as usize, res.val);
  if (outDotPtr != 0) store<f64>(outDotPtr as usize, res.dot);
}

export function dae_evalDualEquationResidual(
  daePtr: u32,
  eqId: u32,
  dualVarsPtr: u32,
  outValPtr: u32,
  outDotPtr: u32,
): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let res = new Dual();
  evalDualEquationResidual(eqId, dae, dualVarsPtr as usize, res);
  if (outValPtr != 0) store<f64>(outValPtr as usize, res.val);
  if (outDotPtr != 0) store<f64>(outDotPtr as usize, res.dot);
}

export function dae_evalDualJacobianColumn(
  daePtr: u32,
  nEqs: u32,
  eqIndicesPtr: u32,
  dualVarsPtr: u32,
  seedVarId: u32,
  outColPtr: u32,
): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  evalDualJacobianColumn(
    dae,
    nEqs,
    eqIndicesPtr as usize,
    dualVarsPtr as usize,
    seedVarId,
    outColPtr as usize,
  );
}
