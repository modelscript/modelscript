/* eslint-disable */
// @ts-nocheck
import {
  Interval,
  INF,
  NEG_INF,
  iaMul,
  iaDiv,
  iaPow,
  iaSin,
  iaCos,
  iaTan,
} from "./interval";
import {
  AdTape,
  TAPE_STRIDE,
  TAPE_OP_CONST,
  TAPE_OP_VAR,
  TAPE_OP_ADD,
  TAPE_OP_SUB,
  TAPE_OP_MUL,
  TAPE_OP_DIV,
  TAPE_OP_SIN,
  TAPE_OP_COS,
  TAPE_OP_EXP,
  TAPE_OP_LOG,
} from "./tape";
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
} from "./dae";

/**
 * McCormick Relaxation Tuple for non-convex optimization in WASM.
 * Contains convex underestimator (cv), concave overestimator (cc),
 * and guaranteed interval bounds [lo, hi].
 */
export class McCormickTuple {
  cv: f64; // Convex underestimator
  cc: f64; // Concave overestimator
  lo: f64; // Interval lower bound
  hi: f64; // Interval upper bound

  constructor(cv: f64 = 0.0, cc: f64 = 0.0, lo: f64 = 0.0, hi: f64 = 0.0) {
    this.cv = cv;
    this.cc = cc;
    this.lo = lo;
    this.hi = hi;
  }

  @inline
  static create(cv: f64, cc: f64, lo: f64, hi: f64): McCormickTuple {
    return new McCormickTuple(cv, cc, lo, hi);
  }

  @inline
  static fromConst(v: f64): McCormickTuple {
    return new McCormickTuple(v, v, v, v);
  }

  @inline
  static fromVar(val: f64, lo: f64, hi: f64): McCormickTuple {
    return new McCormickTuple(val, val, lo, hi);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// McCormick Composition Rules
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function mcConst(v: f64): McCormickTuple {
  return new McCormickTuple(v, v, v, v);
}

@inline
export function mcVar(val: f64, lo: f64, hi: f64): McCormickTuple {
  return new McCormickTuple(val, val, lo, hi);
}

@inline
export function mcAdd(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  return new McCormickTuple(
    a.cv + b.cv,
    a.cc + b.cc,
    a.lo + b.lo,
    a.hi + b.hi,
  );
}

@inline
export function mcSub(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  return new McCormickTuple(
    a.cv - b.cc,
    a.cc - b.cv,
    a.lo - b.hi,
    a.hi - b.lo,
  );
}

export function mcMul(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  let ia = iaMul(new Interval(a.lo, a.hi), new Interval(b.lo, b.hi));

  // McCormick bilinear envelope
  let cv1 = a.lo * b.cv + b.lo * a.cv - a.lo * b.lo;
  let cv2 = a.hi * b.cv + b.hi * a.cv - a.hi * b.hi;
  let cv = Math.max(cv1, cv2);

  let cc1 = a.hi * b.cc + b.lo * a.cc - a.hi * b.lo;
  let cc2 = a.lo * b.cc + b.hi * a.cc - a.lo * b.hi;
  let cc = Math.min(cc1, cc2);

  return new McCormickTuple(
    Math.max(ia.lo, cv),
    Math.min(ia.hi, cc),
    ia.lo,
    ia.hi,
  );
}

export function mcReciprocal(b: McCormickTuple): McCormickTuple {
  if (b.lo <= 0.0 && b.hi >= 0.0) {
    return new McCormickTuple(NEG_INF, INF, NEG_INF, INF);
  }

  let invLo = 1.0 / b.hi;
  let invHi = 1.0 / b.lo;

  if (b.lo > 0.0) {
    let slope = (invHi - invLo) / (b.lo - b.hi);
    let cvVal = invHi + slope * (b.cv - b.lo);
    let ccVal = 1.0 / b.cc;
    return new McCormickTuple(Math.max(invLo, cvVal), Math.min(invHi, ccVal), invLo, invHi);
  } else {
    let slope = (invHi - invLo) / (b.lo - b.hi);
    let ccVal = invHi + slope * (b.cc - b.lo);
    let cvVal = 1.0 / b.cv;
    return new McCormickTuple(Math.max(invLo, cvVal), Math.min(invHi, ccVal), invLo, invHi);
  }
}

export function mcDiv(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  let ia = iaDiv(new Interval(a.lo, a.hi), new Interval(b.lo, b.hi));

  if (b.lo > 0.0 || b.hi < 0.0) {
    let invB = mcReciprocal(b);
    return mcMul(a, invB);
  }

  return new McCormickTuple(ia.lo, ia.hi, ia.lo, ia.hi);
}

@inline
export function mcNeg(a: McCormickTuple): McCormickTuple {
  return new McCormickTuple(-a.cc, -a.cv, -a.hi, -a.lo);
}

export function mcExp(a: McCormickTuple): McCormickTuple {
  let loExp = Math.exp(a.lo);
  let hiExp = Math.exp(a.hi);
  let cvVal = Math.exp(a.cv);
  let ccVal: f64;

  if (a.hi - a.lo < 1e-12) {
    ccVal = hiExp;
  } else {
    let slope = (hiExp - loExp) / (a.hi - a.lo);
    ccVal = loExp + slope * (a.cc - a.lo);
  }

  return new McCormickTuple(Math.max(loExp, cvVal), Math.min(hiExp, ccVal), loExp, hiExp);
}

export function mcLog(a: McCormickTuple): McCormickTuple {
  let safeLo = Math.max(1e-300, a.lo);
  let safeHi = Math.max(1e-300, a.hi);
  let loLog = Math.log(safeLo);
  let hiLog = Math.log(safeHi);
  let ccVal = Math.log(Math.max(1e-300, a.cc));
  let cvVal: f64;

  if (safeHi - safeLo < 1e-12) {
    cvVal = loLog;
  } else {
    let slope = (hiLog - loLog) / (safeHi - safeLo);
    cvVal = loLog + slope * (Math.max(1e-300, a.cv) - safeLo);
  }

  return new McCormickTuple(Math.max(loLog, cvVal), Math.min(hiLog, ccVal), loLog, hiLog);
}

export function mcSqrt(a: McCormickTuple): McCormickTuple {
  let safeLo = Math.max(0.0, a.lo);
  let safeHi = Math.max(0.0, a.hi);
  let loSqrt = Math.sqrt(safeLo);
  let hiSqrt = Math.sqrt(safeHi);
  let ccVal = Math.sqrt(Math.max(0.0, a.cc));
  let cvVal: f64;

  if (safeHi - safeLo < 1e-12) {
    cvVal = loSqrt;
  } else {
    let slope = (hiSqrt - loSqrt) / (safeHi - safeLo);
    cvVal = loSqrt + slope * (Math.max(0.0, a.cv) - safeLo);
  }

  return new McCormickTuple(Math.max(loSqrt, cvVal), Math.min(hiSqrt, ccVal), loSqrt, hiSqrt);
}

export function mcPow(base: McCormickTuple, exp: McCormickTuple): McCormickTuple {
  if (exp.lo == exp.hi) {
    let n = exp.lo;
    let iN = n as i32;
    if ((iN as f64) == n) {
      if (iN == 0) return mcConst(1.0);
      if (iN == 1) return base;
      if (iN == -1) return mcReciprocal(base);
      if (iN == 2) return mcMul(base, base);
    }
  }

  // a^b = exp(b * log(a))
  let safeBase = new McCormickTuple(
    Math.max(1e-300, base.cv),
    Math.max(1e-300, base.cc),
    Math.max(1e-300, base.lo),
    Math.max(1e-300, base.hi),
  );
  let logBase = mcLog(safeBase);
  return mcExp(mcMul(exp, logBase));
}

export function mcSin(a: McCormickTuple): McCormickTuple {
  let ia = iaSin(new Interval(a.lo, a.hi));
  return new McCormickTuple(ia.lo, ia.hi, ia.lo, ia.hi);
}

export function mcCos(a: McCormickTuple): McCormickTuple {
  let ia = iaCos(new Interval(a.lo, a.hi));
  return new McCormickTuple(ia.lo, ia.hi, ia.lo, ia.hi);
}

export function mcTan(a: McCormickTuple): McCormickTuple {
  let ia = iaTan(new Interval(a.lo, a.hi));
  return new McCormickTuple(ia.lo, ia.hi, ia.lo, ia.hi);
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward McCormick Propagation Engines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates an AdTape forward pass with McCormick relaxations.
 * Inputs:
 *   - varValsPtr: current primal variable values (f64[])
 *   - varBoundsLoPtr, varBoundsHiPtr: variable interval bounds (f64[])
 * Outputs:
 *   - outCvPtr, outCcPtr, outLoPtr, outHiPtr: computed McCormick bounds per tape slot
 */
export function tape_evaluateMcCormick(
  tape: AdTape,
  varValsPtr: usize,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  outCvPtr: usize,
  outCcPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  let count = tape.nodeCount;
  let tuples = new Array<McCormickTuple>(count);

  for (let i: u32 = 0; i < count; i++) {
    let offset = i * TAPE_STRIDE;
    let op = tape.nodeTable.get(offset + 0);
    let left = tape.nodeTable.get(offset + 1);
    let right = tape.nodeTable.get(offset + 2);

    let res: McCormickTuple;

    if (op == TAPE_OP_CONST) {
      let val = tape.getNodeValue(i);
      res = mcConst(val);
    } else if (op == TAPE_OP_VAR) {
      let varId = left;
      let val = load<f64>(varValsPtr + (varId << 3));
      let lo = load<f64>(varBoundsLoPtr + (varId << 3));
      let hi = load<f64>(varBoundsHiPtr + (varId << 3));
      res = mcVar(val, lo, hi);
    } else if (op == TAPE_OP_ADD) {
      res = mcAdd(tuples[left], tuples[right]);
    } else if (op == TAPE_OP_SUB) {
      res = mcSub(tuples[left], tuples[right]);
    } else if (op == TAPE_OP_MUL) {
      res = mcMul(tuples[left], tuples[right]);
    } else if (op == TAPE_OP_DIV) {
      res = mcDiv(tuples[left], tuples[right]);
    } else if (op == TAPE_OP_SIN) {
      res = mcSin(tuples[left]);
    } else if (op == TAPE_OP_COS) {
      res = mcCos(tuples[left]);
    } else if (op == TAPE_OP_EXP) {
      res = mcExp(tuples[left]);
    } else if (op == TAPE_OP_LOG) {
      res = mcLog(tuples[left]);
    } else {
      res = new McCormickTuple(NEG_INF, INF, NEG_INF, INF);
    }

    tuples[i] = res;
    store<f64>(outCvPtr + (i << 3), res.cv);
    store<f64>(outCcPtr + (i << 3), res.cc);
    store<f64>(outLoPtr + (i << 3), res.lo);
    store<f64>(outHiPtr + (i << 3), res.hi);
  }
}

/**
 * Evaluates an AST expression in DaeBuilder with McCormick relaxations.
 */
export function dae_evaluateExprMcCormick(
  dae: DaeBuilder,
  exprId: u32,
  varValsPtr: usize,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
): McCormickTuple {
  if (exprId >= dae.exprCount) return mcConst(0.0);

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral) {
    let val = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    return mcConst(val as f64);
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = dae.getExprData().get(offset + EXPR_LEFT);
    let hi = dae.getExprData().get(offset + EXPR_RIGHT);
    let bits = ((hi as u64) << 32) | (lo as u64);
    let val = f64.reinterpret_i64(bits as i64);
    return mcConst(val);
  }

  if (kind == ExprKind.Name) {
    let varId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let val = load<f64>(varValsPtr + (varId << 3));
    let lo = load<f64>(varBoundsLoPtr + (varId << 3));
    let hi = load<f64>(varBoundsHiPtr + (varId << 3));
    return mcVar(val, lo, hi);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u16;
    let operand = dae.getExprData().get(offset + EXPR_LEFT);
    let subRes = dae_evaluateExprMcCormick(dae, operand, varValsPtr, varBoundsLoPtr, varBoundsHiPtr);
    if (op == UnaryOp.Negate) return mcNeg(subRes);
    return subRes;
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u16;
    let left = dae.getExprData().get(offset + EXPR_LEFT);
    let right = dae.getExprData().get(offset + EXPR_RIGHT);

    let lRes = dae_evaluateExprMcCormick(dae, left, varValsPtr, varBoundsLoPtr, varBoundsHiPtr);
    let rRes = dae_evaluateExprMcCormick(dae, right, varValsPtr, varBoundsLoPtr, varBoundsHiPtr);

    if (op == BinOp.Add) return mcAdd(lRes, rRes);
    if (op == BinOp.Sub) return mcSub(lRes, rRes);
    if (op == BinOp.Mul) return mcMul(lRes, rRes);
    if (op == BinOp.Div) return mcDiv(lRes, rRes);
    if (op == BinOp.Pow) return mcPow(lRes, rRes);
  }

  return new McCormickTuple(NEG_INF, INF, NEG_INF, INF);
}
