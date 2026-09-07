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
  getScratchInterval,
  markScratchInterval,
  resetScratchInterval,
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
 * Unmanaged McCormick Relaxation Tuple for non-convex optimization in WASM.
 * Fixed 32-byte layout: [cv: f64, cc: f64, lo: f64, hi: f64].
 * Contains convex underestimator (cv), concave overestimator (cc),
 * and guaranteed interval bounds [lo, hi].
 */
@unmanaged
export class McCormickTuple {
  cv: f64; // Convex underestimator
  cc: f64; // Concave overestimator
  lo: f64; // Interval lower bound
  hi: f64; // Interval upper bound

  @inline
  set(cv: f64, cc: f64, lo: f64, hi: f64): void {
    this.cv = cv;
    this.cc = cc;
    this.lo = lo;
    this.hi = hi;
  }

  @inline
  setConst(v: f64): void {
    this.cv = v;
    this.cc = v;
    this.lo = v;
    this.hi = v;
  }

  @inline
  setVar(val: f64, lo: f64, hi: f64): void {
    this.cv = val;
    this.cc = val;
    this.lo = lo;
    this.hi = hi;
  }

  @inline
  copyFrom(other: McCormickTuple): void {
    this.cv = other.cv;
    this.cc = other.cc;
    this.lo = other.lo;
    this.hi = other.hi;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-GC Scratch Stack
// ─────────────────────────────────────────────────────────────────────────────

let scratchMcCormickStackPtr: usize = 0;
let scratchMcCormickStackHead: usize = 0;
const SCRATCH_MCCORMICK_MAX: usize = 256;

@inline
export function getScratchMcCormick(): McCormickTuple {
  if (scratchMcCormickStackPtr == 0) {
    scratchMcCormickStackPtr = heap.alloc(SCRATCH_MCCORMICK_MAX * 32);
  }
  let ptr = scratchMcCormickStackPtr + (scratchMcCormickStackHead * 32);
  scratchMcCormickStackHead = (scratchMcCormickStackHead + 1) & (SCRATCH_MCCORMICK_MAX - 1);
  return changetype<McCormickTuple>(ptr);
}

@inline
export function markScratchMcCormick(): usize {
  return scratchMcCormickStackHead;
}

@inline
export function resetScratchMcCormick(mark: usize): void {
  scratchMcCormickStackHead = mark;
}

// ─────────────────────────────────────────────────────────────────────────────
// Elementary Operations (Destination-Passing, Alias-Safe)
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function mcConst(v: f64, out: McCormickTuple): void {
  out.setConst(v);
}

@inline
export function mcVar(val: f64, lo: f64, hi: f64, out: McCormickTuple): void {
  out.setVar(val, lo, hi);
}

@inline
export function mcAdd(a: McCormickTuple, b: McCormickTuple, out: McCormickTuple): void {
  let cv = a.cv + b.cv;
  let cc = a.cc + b.cc;
  let lo = a.lo + b.lo;
  let hi = a.hi + b.hi;
  out.set(cv, cc, lo, hi);
}

@inline
export function mcSub(a: McCormickTuple, b: McCormickTuple, out: McCormickTuple): void {
  let cv = a.cv - b.cc;
  let cc = a.cc - b.cv;
  let lo = a.lo - b.hi;
  let hi = a.hi - b.lo;
  out.set(cv, cc, lo, hi);
}

export function mcMul(a: McCormickTuple, b: McCormickTuple, out: McCormickTuple): void {
  let markIv = markScratchInterval();
  let iaA = getScratchInterval();
  let iaB = getScratchInterval();
  let iaRes = getScratchInterval();
  iaA.set(a.lo, a.hi);
  iaB.set(b.lo, b.hi);
  iaMul(iaA, iaB, iaRes);

  let loA = a.lo;
  let hiA = a.hi;
  let loB = b.lo;
  let hiB = b.hi;

  // McCormick bilinear envelope
  let cv1 = loA * b.cv + loB * a.cv - loA * loB;
  let cv2 = hiA * b.cv + hiB * a.cv - hiA * hiB;
  let cv = Math.max(cv1, cv2);

  let cc1 = hiA * b.cc + loB * a.cc - hiA * loB;
  let cc2 = loA * b.cc + hiB * a.cc - loA * hiB;
  let cc = Math.min(cc1, cc2);

  let outCv = Math.max(iaRes.lo, cv);
  let outCc = Math.min(iaRes.hi, cc);
  let outLo = iaRes.lo;
  let outHi = iaRes.hi;

  resetScratchInterval(markIv);
  out.set(outCv, outCc, outLo, outHi);
}

export function mcReciprocal(b: McCormickTuple, out: McCormickTuple): void {
  if (b.lo <= 0.0 && b.hi >= 0.0) {
    out.set(NEG_INF, INF, NEG_INF, INF);
    return;
  }

  let invLo = 1.0 / b.hi;
  let invHi = 1.0 / b.lo;

  if (b.lo > 0.0) {
    let slope = (invHi - invLo) / (b.lo - b.hi);
    let cvVal = invHi + slope * (b.cv - b.lo);
    let ccVal = 1.0 / b.cc;
    out.set(Math.max(invLo, cvVal), Math.min(invHi, ccVal), invLo, invHi);
  } else {
    let slope = (invHi - invLo) / (b.lo - b.hi);
    let ccVal = invHi + slope * (b.cc - b.lo);
    let cvVal = 1.0 / b.cv;
    out.set(Math.max(invLo, cvVal), Math.min(invHi, ccVal), invLo, invHi);
  }
}

export function mcDiv(a: McCormickTuple, b: McCormickTuple, out: McCormickTuple): void {
  let markIv = markScratchInterval();
  let iaA = getScratchInterval();
  let iaB = getScratchInterval();
  let iaRes = getScratchInterval();
  iaA.set(a.lo, a.hi);
  iaB.set(b.lo, b.hi);
  iaDiv(iaA, iaB, iaRes);

  if (b.lo > 0.0 || b.hi < 0.0) {
    let markMc = markScratchMcCormick();
    let invB = getScratchMcCormick();
    mcReciprocal(b, invB);
    mcMul(a, invB, out);
    resetScratchMcCormick(markMc);
    resetScratchInterval(markIv);
    return;
  }

  let lo = iaRes.lo;
  let hi = iaRes.hi;
  resetScratchInterval(markIv);
  out.set(lo, hi, lo, hi);
}

@inline
export function mcNeg(a: McCormickTuple, out: McCormickTuple): void {
  let cv = -a.cc;
  let cc = -a.cv;
  let lo = -a.hi;
  let hi = -a.lo;
  out.set(cv, cc, lo, hi);
}

export function mcExp(a: McCormickTuple, out: McCormickTuple): void {
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

  out.set(Math.max(loExp, cvVal), Math.min(hiExp, ccVal), loExp, hiExp);
}

export function mcLog(a: McCormickTuple, out: McCormickTuple): void {
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

  out.set(Math.max(loLog, cvVal), Math.min(hiLog, ccVal), loLog, hiLog);
}

export function mcSqrt(a: McCormickTuple, out: McCormickTuple): void {
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

  out.set(Math.max(loSqrt, cvVal), Math.min(hiSqrt, ccVal), loSqrt, hiSqrt);
}

export function mcPow(base: McCormickTuple, exp: McCormickTuple, out: McCormickTuple): void {
  if (exp.lo == exp.hi) {
    let n = exp.lo;
    let iN = n as i32;
    if ((iN as f64) == n) {
      if (iN == 0) {
        mcConst(1.0, out);
        return;
      }
      if (iN == 1) {
        out.copyFrom(base);
        return;
      }
      if (iN == -1) {
        mcReciprocal(base, out);
        return;
      }
      if (iN == 2) {
        mcMul(base, base, out);
        return;
      }
    }
  }

  let mark = markScratchMcCormick();
  let safeBase = getScratchMcCormick();
  let logBase = getScratchMcCormick();
  let mulExp = getScratchMcCormick();

  safeBase.set(
    Math.max(1e-300, base.cv),
    Math.max(1e-300, base.cc),
    Math.max(1e-300, base.lo),
    Math.max(1e-300, base.hi),
  );
  mcLog(safeBase, logBase);
  mcMul(exp, logBase, mulExp);
  mcExp(mulExp, out);
  resetScratchMcCormick(mark);
}

export function mcSin(a: McCormickTuple, out: McCormickTuple): void {
  let mark = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  iv.set(a.lo, a.hi);
  iaSin(iv, res);
  let lo = res.lo;
  let hi = res.hi;
  resetScratchInterval(mark);
  out.set(lo, hi, lo, hi);
}

export function mcCos(a: McCormickTuple, out: McCormickTuple): void {
  let mark = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  iv.set(a.lo, a.hi);
  iaCos(iv, res);
  let lo = res.lo;
  let hi = res.hi;
  resetScratchInterval(mark);
  out.set(lo, hi, lo, hi);
}

export function mcTan(a: McCormickTuple, out: McCormickTuple): void {
  let mark = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  iv.set(a.lo, a.hi);
  iaTan(iv, res);
  let lo = res.lo;
  let hi = res.hi;
  resetScratchInterval(mark);
  out.set(lo, hi, lo, hi);
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward McCormick Propagation Engines (Zero-GC)
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
  let mark = markScratchMcCormick();
  let lRes = getScratchMcCormick();
  let rRes = getScratchMcCormick();
  let outMc = getScratchMcCormick();

  for (let i: u32 = 0; i < count; i++) {
    let offset = i * TAPE_STRIDE;
    let op = tape.nodeTable.get(offset + 0);
    let left = tape.nodeTable.get(offset + 1);
    let right = tape.nodeTable.get(offset + 2);

    if (op == TAPE_OP_CONST) {
      let val = tape.getNodeValue(i);
      outMc.setConst(val);
    } else if (op == TAPE_OP_VAR) {
      let varId = left;
      let val = load<f64>(varValsPtr + (varId << 3));
      let lo = load<f64>(varBoundsLoPtr + (varId << 3));
      let hi = load<f64>(varBoundsHiPtr + (varId << 3));
      outMc.setVar(val, lo, hi);
    } else {
      lRes.set(
        load<f64>(outCvPtr + (left << 3)),
        load<f64>(outCcPtr + (left << 3)),
        load<f64>(outLoPtr + (left << 3)),
        load<f64>(outHiPtr + (left << 3)),
      );

      if (op == TAPE_OP_ADD) {
        rRes.set(
          load<f64>(outCvPtr + (right << 3)),
          load<f64>(outCcPtr + (right << 3)),
          load<f64>(outLoPtr + (right << 3)),
          load<f64>(outHiPtr + (right << 3)),
        );
        mcAdd(lRes, rRes, outMc);
      } else if (op == TAPE_OP_SUB) {
        rRes.set(
          load<f64>(outCvPtr + (right << 3)),
          load<f64>(outCcPtr + (right << 3)),
          load<f64>(outLoPtr + (right << 3)),
          load<f64>(outHiPtr + (right << 3)),
        );
        mcSub(lRes, rRes, outMc);
      } else if (op == TAPE_OP_MUL) {
        rRes.set(
          load<f64>(outCvPtr + (right << 3)),
          load<f64>(outCcPtr + (right << 3)),
          load<f64>(outLoPtr + (right << 3)),
          load<f64>(outHiPtr + (right << 3)),
        );
        mcMul(lRes, rRes, outMc);
      } else if (op == TAPE_OP_DIV) {
        rRes.set(
          load<f64>(outCvPtr + (right << 3)),
          load<f64>(outCcPtr + (right << 3)),
          load<f64>(outLoPtr + (right << 3)),
          load<f64>(outHiPtr + (right << 3)),
        );
        mcDiv(lRes, rRes, outMc);
      } else if (op == TAPE_OP_SIN) {
        mcSin(lRes, outMc);
      } else if (op == TAPE_OP_COS) {
        mcCos(lRes, outMc);
      } else if (op == TAPE_OP_EXP) {
        mcExp(lRes, outMc);
      } else if (op == TAPE_OP_LOG) {
        mcLog(lRes, outMc);
      } else {
        outMc.set(NEG_INF, INF, NEG_INF, INF);
      }
    }

    store<f64>(outCvPtr + (i << 3), outMc.cv);
    store<f64>(outCcPtr + (i << 3), outMc.cc);
    store<f64>(outLoPtr + (i << 3), outMc.lo);
    store<f64>(outHiPtr + (i << 3), outMc.hi);
  }

  resetScratchMcCormick(mark);
}

/**
 * Evaluates an AST expression in DaeBuilder with McCormick relaxations.
 * Destination-passing into out McCormickTuple.
 */
export function dae_evaluateExprMcCormick(
  dae: DaeBuilder,
  exprId: u32,
  varValsPtr: usize,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  out: McCormickTuple,
): void {
  if (exprId >= dae.exprCount) {
    out.setConst(0.0);
    return;
  }

  let offset = exprId * EXPR_STRIDE;
  let exprData = dae.getExprData();
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    out.setConst(val as f64);
    return;
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    out.setConst(val);
    return;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) {
      out.setConst(0.0);
      return;
    }
    let val = load<f64>(varValsPtr + (varId << 3));
    let lo = load<f64>(varBoundsLoPtr + (varId << 3));
    let hi = load<f64>(varBoundsHiPtr + (varId << 3));
    out.setVar(val, lo, hi);
    return;
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let operand = exprData.get(offset + EXPR_LEFT);
    dae_evaluateExprMcCormick(dae, operand, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, out);
    if (op == UnaryOp.Negate) {
      mcNeg(out, out);
    }
    return;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);

    let mark = markScratchMcCormick();
    let lRes = getScratchMcCormick();
    let rRes = getScratchMcCormick();

    dae_evaluateExprMcCormick(dae, left, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, lRes);
    dae_evaluateExprMcCormick(dae, right, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, rRes);

    if (op == BinOp.Add || op == BinOp.ElemAdd) mcAdd(lRes, rRes, out);
    else if (op == BinOp.Sub || op == BinOp.ElemSub) mcSub(lRes, rRes, out);
    else if (op == BinOp.Mul || op == BinOp.ElemMul) mcMul(lRes, rRes, out);
    else if (op == BinOp.Div || op == BinOp.ElemDiv) mcDiv(lRes, rRes, out);
    else if (op == BinOp.Pow || op == BinOp.ElemPow) mcPow(lRes, rRes, out);
    else out.set(NEG_INF, INF, NEG_INF, INF);

    resetScratchMcCormick(mark);
    return;
  }

  out.set(NEG_INF, INF, NEG_INF, INF);
}

/**
 * Standalone C-ABI / WASM Export for expression McCormick evaluation.
 */
export function dae_evalMcCormick(
  daePtr: u32,
  exprId: u32,
  varValsPtr: usize,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  outCvPtr: usize,
  outCcPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let mark = markScratchMcCormick();
  let out = getScratchMcCormick();
  dae_evaluateExprMcCormick(dae, exprId, varValsPtr, varBoundsLoPtr, varBoundsHiPtr, out);
  if (outCvPtr != 0) store<f64>(outCvPtr, out.cv);
  if (outCcPtr != 0) store<f64>(outCcPtr, out.cc);
  if (outLoPtr != 0) store<f64>(outLoPtr, out.lo);
  if (outHiPtr != 0) store<f64>(outHiPtr, out.hi);
  resetScratchMcCormick(mark);
}
