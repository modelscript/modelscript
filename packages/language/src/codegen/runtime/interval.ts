/* eslint-disable */
// @ts-nocheck
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

export const INF: f64 = f64.POSITIVE_INFINITY;
export const NEG_INF: f64 = f64.NEGATIVE_INFINITY;
export const TWO_PI: f64 = 2.0 * Math.PI;

/**
 * Closed interval [lo, hi] for guaranteed bound propagation in WASM.
 */
export class Interval {
  lo: f64;
  hi: f64;

  constructor(lo: f64 = 0.0, hi: f64 = 0.0) {
    if (lo > hi) {
      this.lo = hi;
      this.hi = lo;
    } else {
      this.lo = lo;
      this.hi = hi;
    }
  }

  @inline
  static create(lo: f64, hi: f64): Interval {
    return new Interval(lo, hi);
  }

  @inline
  static point(v: f64): Interval {
    return new Interval(v, v);
  }

  @inline
  static entire(): Interval {
    return new Interval(NEG_INF, INF);
  }

  @inline
  static empty(): Interval {
    return new Interval(INF, NEG_INF);
  }

  @inline
  width(): f64 {
    return this.hi - this.lo;
  }

  @inline
  mid(): f64 {
    if (!f64.isFinite(this.lo) || !f64.isFinite(this.hi)) return 0.0;
    return 0.5 * (this.lo + this.hi);
  }

  @inline
  contains(x: f64): bool {
    return x >= this.lo && x <= this.hi;
  }

  @inline
  containsZero(): bool {
    return this.lo <= 0.0 && this.hi >= 0.0;
  }

  @inline
  intersect(other: Interval): Interval {
    return new Interval(Math.max(this.lo, other.lo), Math.min(this.hi, other.hi));
  }

  @inline
  hull(other: Interval): Interval {
    return new Interval(Math.min(this.lo, other.lo), Math.max(this.hi, other.hi));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Elementary Interval Operations
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function iaAdd(a: Interval, b: Interval): Interval {
  return new Interval(a.lo + b.lo, a.hi + b.hi);
}

@inline
export function iaSub(a: Interval, b: Interval): Interval {
  return new Interval(a.lo - b.hi, a.hi - b.lo);
}

export function iaMul(a: Interval, b: Interval): Interval {
  let p1 = a.lo * b.lo;
  let p2 = a.lo * b.hi;
  let p3 = a.hi * b.lo;
  let p4 = a.hi * b.hi;
  let minP = Math.min(Math.min(p1, p2), Math.min(p3, p4));
  let maxP = Math.max(Math.max(p1, p2), Math.max(p3, p4));
  return new Interval(minP, maxP);
}

export function iaDiv(a: Interval, b: Interval): Interval {
  if (b.containsZero()) {
    if (b.lo == 0.0 && b.hi == 0.0) return Interval.entire();
    if (b.lo == 0.0) return iaMul(a, new Interval(1.0 / b.hi, INF));
    if (b.hi == 0.0) return iaMul(a, new Interval(NEG_INF, 1.0 / b.lo));
    return Interval.entire();
  }
  return iaMul(a, new Interval(1.0 / b.hi, 1.0 / b.lo));
}

export function iaPowInt(a: Interval, n: i32): Interval {
  if (n == 0) return Interval.point(1.0);
  if (n == 1) return a;
  if (n == -1) return iaDiv(Interval.point(1.0), a);

  if (n > 0 && n % 2 == 0) {
    if (a.lo >= 0.0) {
      return new Interval(Math.pow(a.lo, n as f64), Math.pow(a.hi, n as f64));
    } else if (a.hi <= 0.0) {
      return new Interval(Math.pow(a.hi, n as f64), Math.pow(a.lo, n as f64));
    } else {
      return new Interval(0.0, Math.max(Math.pow(a.lo, n as f64), Math.pow(a.hi, n as f64)));
    }
  }

  if (n > 0) {
    return new Interval(Math.pow(a.lo, n as f64), Math.pow(a.hi, n as f64));
  }

  let posResult = iaPowInt(a, -n);
  return iaDiv(Interval.point(1.0), posResult);
}

export function iaPow(base: Interval, exp: Interval): Interval {
  if (exp.lo == exp.hi) {
    let n = exp.lo;
    let iN = n as i32;
    if ((iN as f64) == n) {
      return iaPowInt(base, iN);
    }
  }
  let safeBase = new Interval(Math.max(1e-300, base.lo), Math.max(1e-300, base.hi));
  let logBase = iaLog(safeBase);
  return iaExp(iaMul(exp, logBase));
}

@inline
export function iaNeg(a: Interval): Interval {
  return new Interval(-a.hi, -a.lo);
}

export function iaSin(a: Interval): Interval {
  let width = a.hi - a.lo;
  if (width >= TWO_PI) return new Interval(-1.0, 1.0);

  let lo = ((a.lo % TWO_PI) + TWO_PI) % TWO_PI;
  let hi = lo + width;

  let minVal = Math.sin(a.lo);
  let maxVal = Math.sin(a.lo);

  let sinHi = Math.sin(a.hi);
  minVal = Math.min(minVal, sinHi);
  maxVal = Math.max(maxVal, sinHi);

  let kMinMax = Math.floor((lo - Math.PI / 2.0) / TWO_PI) as i32;
  let kMaxMax = Math.ceil((hi - Math.PI / 2.0) / TWO_PI) as i32;
  for (let k = kMinMax; k <= kMaxMax; k++) {
    let cp = Math.PI / 2.0 + (k as f64) * TWO_PI;
    if (cp >= lo && cp <= hi) maxVal = 1.0;
  }

  let kMinMin = Math.floor((lo - (3.0 * Math.PI) / 2.0) / TWO_PI) as i32;
  let kMaxMin = Math.ceil((hi - (3.0 * Math.PI) / 2.0) / TWO_PI) as i32;
  for (let k = kMinMin; k <= kMaxMin; k++) {
    let cp = (3.0 * Math.PI) / 2.0 + (k as f64) * TWO_PI;
    if (cp >= lo && cp <= hi) minVal = -1.0;
  }

  return new Interval(minVal, maxVal);
}

@inline
export function iaCos(a: Interval): Interval {
  return iaSin(new Interval(a.lo + Math.PI / 2.0, a.hi + Math.PI / 2.0));
}

export function iaTan(a: Interval): Interval {
  let width = a.hi - a.lo;
  if (width >= Math.PI) return Interval.entire();

  let kMin = Math.floor((a.lo - Math.PI / 2.0) / Math.PI) as i32;
  let kMax = Math.ceil((a.hi - Math.PI / 2.0) / Math.PI) as i32;
  for (let k = kMin; k <= kMax; k++) {
    let asymptote = Math.PI / 2.0 + (k as f64) * Math.PI;
    if (asymptote > a.lo && asymptote < a.hi) return Interval.entire();
  }

  return new Interval(Math.tan(a.lo), Math.tan(a.hi));
}

@inline
export function iaExp(a: Interval): Interval {
  return new Interval(Math.exp(a.lo), Math.exp(a.hi));
}

export function iaLog(a: Interval): Interval {
  let safeLo = Math.max(1e-300, a.lo);
  let safeHi = Math.max(1e-300, a.hi);
  return new Interval(Math.log(safeLo), Math.log(safeHi));
}

export function iaSqrt(a: Interval): Interval {
  let safeLo = Math.max(0.0, a.lo);
  let safeHi = Math.max(0.0, a.hi);
  return new Interval(Math.sqrt(safeLo), Math.sqrt(safeHi));
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward Interval Propagation Engines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates an AdTape forward pass with interval bounds.
 * Inputs:
 *   - varBoundsLoPtr, varBoundsHiPtr: array of variable [lo, hi] bounds indexed by varId
 * Outputs:
 *   - outLoPtr, outHiPtr: array of computed interval bounds for each tape slot
 */
export function tape_evaluateInterval(
  tape: AdTape,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  let count = tape.nodeCount;
  let intervals = new Array<Interval>(count);

  for (let i: u32 = 0; i < count; i++) {
    let offset = i * TAPE_STRIDE;
    let op = tape.nodeTable.get(offset + 0);
    let left = tape.nodeTable.get(offset + 1);
    let right = tape.nodeTable.get(offset + 2);

    let res: Interval;

    if (op == TAPE_OP_CONST) {
      let val = tape.getNodeValue(i);
      res = Interval.point(val);
    } else if (op == TAPE_OP_VAR) {
      let varId = left;
      let lo = load<f64>(varBoundsLoPtr + (varId << 3));
      let hi = load<f64>(varBoundsHiPtr + (varId << 3));
      res = new Interval(lo, hi);
    } else if (op == TAPE_OP_ADD) {
      res = iaAdd(intervals[left], intervals[right]);
    } else if (op == TAPE_OP_SUB) {
      res = iaSub(intervals[left], intervals[right]);
    } else if (op == TAPE_OP_MUL) {
      res = iaMul(intervals[left], intervals[right]);
    } else if (op == TAPE_OP_DIV) {
      res = iaDiv(intervals[left], intervals[right]);
    } else if (op == TAPE_OP_SIN) {
      res = iaSin(intervals[left]);
    } else if (op == TAPE_OP_COS) {
      res = iaCos(intervals[left]);
    } else if (op == TAPE_OP_EXP) {
      res = iaExp(intervals[left]);
    } else if (op == TAPE_OP_LOG) {
      res = iaLog(intervals[left]);
    } else {
      res = Interval.entire();
    }

    intervals[i] = res;
    store<f64>(outLoPtr + (i << 3), res.lo);
    store<f64>(outHiPtr + (i << 3), res.hi);
  }
}

/**
 * Evaluates an AST expression in DaeBuilder with interval bounds.
 */
export function dae_evaluateExprInterval(
  dae: DaeBuilder,
  exprId: u32,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
): Interval {
  if (exprId >= dae.exprCount) return Interval.point(0.0);

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral) {
    let val = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    return Interval.point(val as f64);
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = dae.getExprData().get(offset + EXPR_LEFT);
    let hi = dae.getExprData().get(offset + EXPR_RIGHT);
    let bits = ((hi as u64) << 32) | (lo as u64);
    let val = f64.reinterpret_i64(bits as i64);
    return Interval.point(val);
  }

  if (kind == ExprKind.Name) {
    let varId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let lo = load<f64>(varBoundsLoPtr + (varId << 3));
    let hi = load<f64>(varBoundsHiPtr + (varId << 3));
    return new Interval(lo, hi);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u16;
    let operand = dae.getExprData().get(offset + EXPR_LEFT);
    let subRes = dae_evaluateExprInterval(dae, operand, varBoundsLoPtr, varBoundsHiPtr);
    if (op == UnaryOp.Negate) return iaNeg(subRes);
    return subRes;
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as u16;
    let left = dae.getExprData().get(offset + EXPR_LEFT);
    let right = dae.getExprData().get(offset + EXPR_RIGHT);

    let lRes = dae_evaluateExprInterval(dae, left, varBoundsLoPtr, varBoundsHiPtr);
    let rRes = dae_evaluateExprInterval(dae, right, varBoundsLoPtr, varBoundsHiPtr);

    if (op == BinOp.Add) return iaAdd(lRes, rRes);
    if (op == BinOp.Sub) return iaSub(lRes, rRes);
    if (op == BinOp.Mul) return iaMul(lRes, rRes);
    if (op == BinOp.Div) return iaDiv(lRes, rRes);
    if (op == BinOp.Pow) return iaPow(lRes, rRes);
  }

  return Interval.entire();
}
