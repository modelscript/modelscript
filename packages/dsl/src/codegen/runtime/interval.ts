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
 * Unmanaged closed interval [lo, hi] for zero-GC guaranteed bound propagation in WASM.
 * Fixed 16-byte layout: [lo: f64, hi: f64].
 */
@unmanaged
export class Interval {
  lo: f64;
  hi: f64;

  @inline
  set(lo: f64, hi: f64): void {
    if (lo > hi) {
      this.lo = hi;
      this.hi = lo;
    } else {
      this.lo = lo;
      this.hi = hi;
    }
  }

  @inline
  setPoint(v: f64): void {
    this.lo = v;
    this.hi = v;
  }

  @inline
  setEntire(): void {
    this.lo = NEG_INF;
    this.hi = INF;
  }

  @inline
  setEmpty(): void {
    this.lo = INF;
    this.hi = NEG_INF;
  }

  @inline
  copyFrom(other: Interval): void {
    this.lo = other.lo;
    this.hi = other.hi;
  }

  @inline
  width(): f64 {
    return this.hi - this.lo;
  }

  @inline
  mid(): f64 {
    if (this.lo <= NEG_INF || this.hi >= INF) return 0.0;
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-GC Scratch Stack
// ─────────────────────────────────────────────────────────────────────────────

let scratchIntervalStackPtr: usize = 0;
let scratchIntervalStackHead: usize = 0;
const SCRATCH_INTERVAL_MAX: usize = 256;

@inline
export function getScratchInterval(): Interval {
  if (scratchIntervalStackPtr == 0) {
    scratchIntervalStackPtr = heap.alloc(SCRATCH_INTERVAL_MAX * 16);
  }
  let ptr = scratchIntervalStackPtr + (scratchIntervalStackHead * 16);
  scratchIntervalStackHead = (scratchIntervalStackHead + 1) & (SCRATCH_INTERVAL_MAX - 1);
  return changetype<Interval>(ptr);
}

@inline
export function markScratchInterval(): usize {
  return scratchIntervalStackHead;
}

@inline
export function resetScratchInterval(mark: usize): void {
  scratchIntervalStackHead = mark;
}

// ─────────────────────────────────────────────────────────────────────────────
// Elementary Interval Operations (Destination-Passing, Alias-Safe)
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function iaConst(v: f64, out: Interval): void {
  out.setPoint(v);
}

@inline
export function iaVar(lo: f64, hi: f64, out: Interval): void {
  out.set(lo, hi);
}

@inline
export function iaAdd(a: Interval, b: Interval, out: Interval): void {
  let lo = a.lo + b.lo;
  let hi = a.hi + b.hi;
  out.set(lo, hi);
}

@inline
export function iaSub(a: Interval, b: Interval, out: Interval): void {
  let lo = a.lo - b.hi;
  let hi = a.hi - b.lo;
  out.set(lo, hi);
}

export function iaMul(a: Interval, b: Interval, out: Interval): void {
  let p1 = a.lo * b.lo;
  let p2 = a.lo * b.hi;
  let p3 = a.hi * b.lo;
  let p4 = a.hi * b.hi;
  let minP = Math.min(Math.min(p1, p2), Math.min(p3, p4));
  let maxP = Math.max(Math.max(p1, p2), Math.max(p3, p4));
  out.set(minP, maxP);
}

export function iaDiv(a: Interval, b: Interval, out: Interval): void {
  if (b.containsZero()) {
    if (b.lo == 0.0 && b.hi == 0.0) {
      out.setEntire();
      return;
    }
    let mark = markScratchInterval();
    let inv = getScratchInterval();
    if (b.lo == 0.0) {
      inv.set(1.0 / b.hi, INF);
      iaMul(a, inv, out);
    } else if (b.hi == 0.0) {
      inv.set(NEG_INF, 1.0 / b.lo);
      iaMul(a, inv, out);
    } else {
      out.setEntire();
    }
    resetScratchInterval(mark);
    return;
  }
  let mark = markScratchInterval();
  let inv = getScratchInterval();
  inv.set(1.0 / b.hi, 1.0 / b.lo);
  iaMul(a, inv, out);
  resetScratchInterval(mark);
}

export function iaPowInt(a: Interval, n: i32, out: Interval): void {
  if (n == 0) {
    out.setPoint(1.0);
    return;
  }
  if (n == 1) {
    out.copyFrom(a);
    return;
  }
  if (n == -1) {
    let mark = markScratchInterval();
    let one = getScratchInterval();
    one.setPoint(1.0);
    iaDiv(one, a, out);
    resetScratchInterval(mark);
    return;
  }

  if (n > 0 && n % 2 == 0) {
    let pLo = Math.pow(a.lo, n as f64);
    let pHi = Math.pow(a.hi, n as f64);
    if (a.lo >= 0.0) {
      out.set(pLo, pHi);
    } else if (a.hi <= 0.0) {
      out.set(pHi, pLo);
    } else {
      out.set(0.0, Math.max(pLo, pHi));
    }
    return;
  }

  if (n > 0) {
    out.set(Math.pow(a.lo, n as f64), Math.pow(a.hi, n as f64));
    return;
  }

  let mark = markScratchInterval();
  let posResult = getScratchInterval();
  let one = getScratchInterval();
  iaPowInt(a, -n, posResult);
  one.setPoint(1.0);
  iaDiv(one, posResult, out);
  resetScratchInterval(mark);
}

export function iaPow(base: Interval, exp: Interval, out: Interval): void {
  if (exp.lo == exp.hi) {
    let n = exp.lo;
    let iN = n as i32;
    if ((iN as f64) == n) {
      iaPowInt(base, iN, out);
      return;
    }
  }
  let mark = markScratchInterval();
  let safeBase = getScratchInterval();
  let logBase = getScratchInterval();
  let mulExp = getScratchInterval();

  safeBase.set(Math.max(1e-300, base.lo), Math.max(1e-300, base.hi));
  iaLog(safeBase, logBase);
  iaMul(exp, logBase, mulExp);
  iaExp(mulExp, out);
  resetScratchInterval(mark);
}

@inline
export function iaNeg(a: Interval, out: Interval): void {
  let lo = -a.hi;
  let hi = -a.lo;
  out.set(lo, hi);
}

export function iaSin(a: Interval, out: Interval): void {
  let width = a.hi - a.lo;
  if (width >= TWO_PI) {
    out.set(-1.0, 1.0);
    return;
  }

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

  out.set(minVal, maxVal);
}

@inline
export function iaCos(a: Interval, out: Interval): void {
  let mark = markScratchInterval();
  let shifted = getScratchInterval();
  shifted.set(a.lo + Math.PI / 2.0, a.hi + Math.PI / 2.0);
  iaSin(shifted, out);
  resetScratchInterval(mark);
}

export function iaTan(a: Interval, out: Interval): void {
  let width = a.hi - a.lo;
  if (width >= Math.PI) {
    out.setEntire();
    return;
  }

  let kMin = Math.floor((a.lo - Math.PI / 2.0) / Math.PI) as i32;
  let kMax = Math.ceil((a.hi - Math.PI / 2.0) / Math.PI) as i32;
  for (let k = kMin; k <= kMax; k++) {
    let asymptote = Math.PI / 2.0 + (k as f64) * Math.PI;
    if (asymptote > a.lo && asymptote < a.hi) {
      out.setEntire();
      return;
    }
  }

  out.set(Math.tan(a.lo), Math.tan(a.hi));
}

@inline
export function iaExp(a: Interval, out: Interval): void {
  out.set(Math.exp(a.lo), Math.exp(a.hi));
}

@inline
export function iaLog(a: Interval, out: Interval): void {
  let safeLo = Math.max(1e-300, a.lo);
  let safeHi = Math.max(1e-300, a.hi);
  out.set(Math.log(safeLo), Math.log(safeHi));
}

@inline
export function iaSqrt(a: Interval, out: Interval): void {
  let safeLo = Math.max(0.0, a.lo);
  let safeHi = Math.max(0.0, a.hi);
  out.set(Math.sqrt(safeLo), Math.sqrt(safeHi));
}

@inline
export function iaIntersect(a: Interval, b: Interval, out: Interval): void {
  out.set(Math.max(a.lo, b.lo), Math.min(a.hi, b.hi));
}

@inline
export function iaHull(a: Interval, b: Interval, out: Interval): void {
  out.set(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi));
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward Interval Propagation Engines (Zero-GC)
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
  let mark = markScratchInterval();
  let lRes = getScratchInterval();
  let rRes = getScratchInterval();
  let outIv = getScratchInterval();

  for (let i: u32 = 0; i < count; i++) {
    let offset = i * TAPE_STRIDE;
    let op = tape.nodeTable.get(offset + 0);
    let left = tape.nodeTable.get(offset + 1);
    let right = tape.nodeTable.get(offset + 2);

    if (op == TAPE_OP_CONST) {
      let val = tape.getNodeValue(i);
      outIv.setPoint(val);
    } else if (op == TAPE_OP_VAR) {
      let varId = left;
      let lo = load<f64>(varBoundsLoPtr + (varId << 3));
      let hi = load<f64>(varBoundsHiPtr + (varId << 3));
      outIv.set(lo, hi);
    } else {
      lRes.set(load<f64>(outLoPtr + (left << 3)), load<f64>(outHiPtr + (left << 3)));

      if (op == TAPE_OP_ADD) {
        rRes.set(load<f64>(outLoPtr + (right << 3)), load<f64>(outHiPtr + (right << 3)));
        iaAdd(lRes, rRes, outIv);
      } else if (op == TAPE_OP_SUB) {
        rRes.set(load<f64>(outLoPtr + (right << 3)), load<f64>(outHiPtr + (right << 3)));
        iaSub(lRes, rRes, outIv);
      } else if (op == TAPE_OP_MUL) {
        rRes.set(load<f64>(outLoPtr + (right << 3)), load<f64>(outHiPtr + (right << 3)));
        iaMul(lRes, rRes, outIv);
      } else if (op == TAPE_OP_DIV) {
        rRes.set(load<f64>(outLoPtr + (right << 3)), load<f64>(outHiPtr + (right << 3)));
        iaDiv(lRes, rRes, outIv);
      } else if (op == TAPE_OP_SIN) {
        iaSin(lRes, outIv);
      } else if (op == TAPE_OP_COS) {
        iaCos(lRes, outIv);
      } else if (op == TAPE_OP_EXP) {
        iaExp(lRes, outIv);
      } else if (op == TAPE_OP_LOG) {
        iaLog(lRes, outIv);
      } else {
        outIv.setEntire();
      }
    }

    store<f64>(outLoPtr + (i << 3), outIv.lo);
    store<f64>(outHiPtr + (i << 3), outIv.hi);
  }

  resetScratchInterval(mark);
}

/**
 * Recursively evaluates an AST expression in DaeBuilder with interval bounds.
 * Writes result into out Interval (destination-passing).
 */
export function dae_evaluateExprInterval(
  dae: DaeBuilder,
  exprId: u32,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  out: Interval,
): void {
  if (exprId >= dae.exprCount) {
    out.setPoint(0.0);
    return;
  }

  let offset = exprId * EXPR_STRIDE;
  let exprData = dae.getExprData();
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    out.setPoint(val as f64);
    return;
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    out.setPoint(val);
    return;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) {
      out.setPoint(0.0);
      return;
    }
    let lo = load<f64>(varBoundsLoPtr + (varId << 3));
    let hi = load<f64>(varBoundsHiPtr + (varId << 3));
    out.set(lo, hi);
    return;
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let operand = exprData.get(offset + EXPR_LEFT);
    dae_evaluateExprInterval(dae, operand, varBoundsLoPtr, varBoundsHiPtr, out);
    if (op == UnaryOp.Negate) {
      iaNeg(out, out);
    }
    return;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);

    let mark = markScratchInterval();
    let lRes = getScratchInterval();
    let rRes = getScratchInterval();

    dae_evaluateExprInterval(dae, left, varBoundsLoPtr, varBoundsHiPtr, lRes);
    dae_evaluateExprInterval(dae, right, varBoundsLoPtr, varBoundsHiPtr, rRes);

    if (op == BinOp.Add || op == BinOp.ElemAdd) iaAdd(lRes, rRes, out);
    else if (op == BinOp.Sub || op == BinOp.ElemSub) iaSub(lRes, rRes, out);
    else if (op == BinOp.Mul || op == BinOp.ElemMul) iaMul(lRes, rRes, out);
    else if (op == BinOp.Div || op == BinOp.ElemDiv) iaDiv(lRes, rRes, out);
    else if (op == BinOp.Pow || op == BinOp.ElemPow) iaPow(lRes, rRes, out);
    else out.setEntire();

    resetScratchInterval(mark);
    return;
  }

  out.setEntire();
}

/**
 * Standalone C-ABI / WASM Export for expression interval evaluation.
 */
export function dae_evalInterval(
  daePtr: u32,
  exprId: u32,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let mark = markScratchInterval();
  let out = getScratchInterval();
  dae_evaluateExprInterval(dae, exprId, varBoundsLoPtr, varBoundsHiPtr, out);
  if (outLoPtr != 0) store<f64>(outLoPtr, out.lo);
  if (outHiPtr != 0) store<f64>(outHiPtr, out.hi);
  resetScratchInterval(mark);
}
