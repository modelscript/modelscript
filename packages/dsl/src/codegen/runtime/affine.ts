/* eslint-disable */
// @ts-nocheck
import {
  Interval,
  INF,
  NEG_INF,
  iaSin,
  iaCos,
  iaExp,
  iaLog,
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
 * Noise Term entry in unmanaged linear memory (16 bytes).
 * Stride: [symbolId: u32, pad: u32, coeff: f64]
 */
@unmanaged
export class AffineTerm {
  symbolId: u32;
  pad: u32;
  coeff: f64;
}

/**
 * High-performance, unmanaged linear noise terms pool for Affine Arithmetic.
 * Eliminates garbage collection by reusing a bump-allocated memory block.
 */
@unmanaged
export class AffineNoisePool {
  termsPtr: usize;
  termsCount: u32;
  termsCapacity: u32;

  init(capacity: u32 = 4096): void {
    this.termsCapacity = capacity;
    this.termsCount = 0;
    this.termsPtr = heap.alloc((capacity as usize) * 16);
  }

  @inline
  reset(): void {
    this.termsCount = 0;
  }

  @inline
  allocTerms(count: u32): u32 {
    let start = this.termsCount;
    let newCount = start + count;
    if (newCount > this.termsCapacity) {
      let newCap = Math.max(newCount, this.termsCapacity * 2) as u32;
      let newPtr = heap.alloc((newCap as usize) * 16);
      memory.copy(newPtr, this.termsPtr, (start as usize) * 16);
      heap.free(this.termsPtr);
      this.termsPtr = newPtr;
      this.termsCapacity = newCap;
    }
    this.termsCount = newCount;
    return start;
  }

  @inline
  getSymbolId(idx: u32): u32 {
    return load<u32>(this.termsPtr + (((idx as usize) << 4) + 0));
  }

  @inline
  setSymbolId(idx: u32, sym: u32): void {
    store<u32>(this.termsPtr + (((idx as usize) << 4) + 0), sym);
  }

  @inline
  getCoeff(idx: u32): f64 {
    return load<f64>(this.termsPtr + (((idx as usize) << 4) + 8));
  }

  @inline
  setCoeff(idx: u32, coeff: f64): void {
    store<f64>(this.termsPtr + (((idx as usize) << 4) + 8), coeff);
  }

  @inline
  setTerm(idx: u32, sym: u32, coeff: f64): void {
    let offset = (idx as usize) << 4;
    store<u32>(this.termsPtr + offset + 0, sym);
    store<u32>(this.termsPtr + offset + 4, 0);
    store<f64>(this.termsPtr + offset + 8, coeff);
  }
}

let globalAffinePool: AffineNoisePool | null = null;

export function getGlobalAffinePool(): AffineNoisePool {
  if (globalAffinePool == null) {
    let pool = changetype<AffineNoisePool>(heap.alloc(32));
    pool.init(4096);
    globalAffinePool = pool;
  }
  return globalAffinePool!;
}

/**
 * Unmanaged Affine Form (24 bytes):
 *   x_hat = x0 + sum(x_i * eps_i) + r * eps_k
 * where eps_i in [-1, 1] are first-order noise symbols.
 */
@unmanaged
export class AffineForm {
  x0: f64;          // Central value
  r: f64;           // Residual non-linear error bound
  termsStart: u32;  // Offset in AffineNoisePool
  termsCount: u32;  // Number of noise terms

  @inline
  set(x0: f64, r: f64, termsStart: u32, termsCount: u32): void {
    this.x0 = x0;
    this.r = r;
    this.termsStart = termsStart;
    this.termsCount = termsCount;
  }

  @inline
  copyFrom(other: AffineForm): void {
    this.x0 = other.x0;
    this.r = other.r;
    this.termsStart = other.termsStart;
    this.termsCount = other.termsCount;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-GC Scratch Stack for Affine Forms
// ─────────────────────────────────────────────────────────────────────────────

let scratchAffineStackPtr: usize = 0;
let scratchAffineStackHead: usize = 0;
const SCRATCH_AFFINE_MAX: usize = 256;

@inline
export function getScratchAffine(): AffineForm {
  if (scratchAffineStackPtr == 0) {
    scratchAffineStackPtr = heap.alloc(SCRATCH_AFFINE_MAX * 32);
  }
  let ptr = scratchAffineStackPtr + (scratchAffineStackHead * 32);
  scratchAffineStackHead = (scratchAffineStackHead + 1) & (SCRATCH_AFFINE_MAX - 1);
  return changetype<AffineForm>(ptr);
}

@inline
export function markScratchAffine(): usize {
  return scratchAffineStackHead;
}

@inline
export function resetScratchAffine(mark: usize): void {
  scratchAffineStackHead = mark;
}

// ─────────────────────────────────────────────────────────────────────────────
// Affine Arithmetic Operations
// ─────────────────────────────────────────────────────────────────────────────

@inline
export function affineConst(v: f64, out: AffineForm): void {
  out.set(v, 0.0, 0, 0);
}

@inline
export function affineVar(lo: f64, hi: f64, symbolId: u32, pool: AffineNoisePool, out: AffineForm): void {
  let x0 = 0.5 * (lo + hi);
  let rad = 0.5 * (hi - lo);
  if (rad <= 0.0) {
    out.set(x0, 0.0, 0, 0);
    return;
  }
  let start = pool.allocTerms(1);
  pool.setTerm(start, symbolId, rad);
  out.set(x0, 0.0, start, 1);
}

/**
 * Converts Affine Form to bounding closed interval [lo, hi]:
 *   rad = r + sum(|x_i|)
 *   [lo, hi] = [x0 - rad, x0 + rad]
 */
export function affineToInterval(a: AffineForm, pool: AffineNoisePool, out: Interval): void {
  let rad = a.r;
  let start = a.termsStart;
  let count = a.termsCount;
  for (let i: u32 = 0; i < count; i++) {
    rad += Math.abs(pool.getCoeff(start + i));
  }
  out.set(a.x0 - rad, a.x0 + rad);
}

export function affineNeg(a: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let count = a.termsCount;
  let start = pool.allocTerms(count);
  for (let i: u32 = 0; i < count; i++) {
    let sym = pool.getSymbolId(a.termsStart + i);
    let c = pool.getCoeff(a.termsStart + i);
    pool.setTerm(start + i, sym, -c);
  }
  out.set(-a.x0, a.r, start, count);
}

export function affineAdd(a: AffineForm, b: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let maxCount = a.termsCount + b.termsCount;
  let start = pool.allocTerms(maxCount);
  let outCount: u32 = 0;

  let iA: u32 = 0;
  let iB: u32 = 0;

  while (iA < a.termsCount && iB < b.termsCount) {
    let symA = pool.getSymbolId(a.termsStart + iA);
    let symB = pool.getSymbolId(b.termsStart + iB);

    if (symA == symB) {
      let c = pool.getCoeff(a.termsStart + iA) + pool.getCoeff(b.termsStart + iB);
      if (Math.abs(c) > 1e-15) {
        pool.setTerm(start + outCount, symA, c);
        outCount++;
      }
      iA++;
      iB++;
    } else if (symA < symB) {
      pool.setTerm(start + outCount, symA, pool.getCoeff(a.termsStart + iA));
      outCount++;
      iA++;
    } else {
      pool.setTerm(start + outCount, symB, pool.getCoeff(b.termsStart + iB));
      outCount++;
      iB++;
    }
  }

  while (iA < a.termsCount) {
    pool.setTerm(start + outCount, pool.getSymbolId(a.termsStart + iA), pool.getCoeff(a.termsStart + iA));
    outCount++;
    iA++;
  }

  while (iB < b.termsCount) {
    pool.setTerm(start + outCount, pool.getSymbolId(b.termsStart + iB), pool.getCoeff(b.termsStart + iB));
    outCount++;
    iB++;
  }

  out.set(a.x0 + b.x0, a.r + b.r, start, outCount);
}

export function affineSub(a: AffineForm, b: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let maxCount = a.termsCount + b.termsCount;
  let start = pool.allocTerms(maxCount);
  let outCount: u32 = 0;

  let iA: u32 = 0;
  let iB: u32 = 0;

  while (iA < a.termsCount && iB < b.termsCount) {
    let symA = pool.getSymbolId(a.termsStart + iA);
    let symB = pool.getSymbolId(b.termsStart + iB);

    if (symA == symB) {
      let c = pool.getCoeff(a.termsStart + iA) - pool.getCoeff(b.termsStart + iB);
      if (Math.abs(c) > 1e-15) {
        pool.setTerm(start + outCount, symA, c);
        outCount++;
      }
      iA++;
      iB++;
    } else if (symA < symB) {
      pool.setTerm(start + outCount, symA, pool.getCoeff(a.termsStart + iA));
      outCount++;
      iA++;
    } else {
      pool.setTerm(start + outCount, symB, -pool.getCoeff(b.termsStart + iB));
      outCount++;
      iB++;
    }
  }

  while (iA < a.termsCount) {
    pool.setTerm(start + outCount, pool.getSymbolId(a.termsStart + iA), pool.getCoeff(a.termsStart + iA));
    outCount++;
    iA++;
  }

  while (iB < b.termsCount) {
    pool.setTerm(start + outCount, pool.getSymbolId(b.termsStart + iB), -pool.getCoeff(b.termsStart + iB));
    outCount++;
    iB++;
  }

  out.set(a.x0 - b.x0, a.r + b.r, start, outCount);
}

export function affineMul(a: AffineForm, b: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let x0 = a.x0 * b.x0;

  let maxCount = a.termsCount + b.termsCount;
  let start = pool.allocTerms(maxCount);
  let outCount: u32 = 0;

  let iA: u32 = 0;
  let iB: u32 = 0;

  let radA = a.r;
  for (let i: u32 = 0; i < a.termsCount; i++) {
    radA += Math.abs(pool.getCoeff(a.termsStart + i));
  }

  let radB = b.r;
  for (let i: u32 = 0; i < b.termsCount; i++) {
    radB += Math.abs(pool.getCoeff(b.termsStart + i));
  }

  while (iA < a.termsCount && iB < b.termsCount) {
    let symA = pool.getSymbolId(a.termsStart + iA);
    let symB = pool.getSymbolId(b.termsStart + iB);

    if (symA == symB) {
      let c = b.x0 * pool.getCoeff(a.termsStart + iA) + a.x0 * pool.getCoeff(b.termsStart + iB);
      if (Math.abs(c) > 1e-15) {
        pool.setTerm(start + outCount, symA, c);
        outCount++;
      }
      iA++;
      iB++;
    } else if (symA < symB) {
      let c = b.x0 * pool.getCoeff(a.termsStart + iA);
      if (Math.abs(c) > 1e-15) {
        pool.setTerm(start + outCount, symA, c);
        outCount++;
      }
      iA++;
    } else {
      let c = a.x0 * pool.getCoeff(b.termsStart + iB);
      if (Math.abs(c) > 1e-15) {
        pool.setTerm(start + outCount, symB, c);
        outCount++;
      }
      iB++;
    }
  }

  while (iA < a.termsCount) {
    let symA = pool.getSymbolId(a.termsStart + iA);
    let c = b.x0 * pool.getCoeff(a.termsStart + iA);
    if (Math.abs(c) > 1e-15) {
      pool.setTerm(start + outCount, symA, c);
      outCount++;
    }
    iA++;
  }

  while (iB < b.termsCount) {
    let symB = pool.getSymbolId(b.termsStart + iB);
    let c = a.x0 * pool.getCoeff(b.termsStart + iB);
    if (Math.abs(c) > 1e-15) {
      pool.setTerm(start + outCount, symB, c);
      outCount++;
    }
    iB++;
  }

  // Second-order non-linear error bound (Comba & Stolfi standard bound)
  let rNonlinear = radA * radB + Math.abs(a.x0) * b.r + Math.abs(b.x0) * a.r;
  out.set(x0, rNonlinear, start, outCount);
}

export function affineDiv(a: AffineForm, b: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let markIv = markScratchInterval();
  let ivB = getScratchInterval();
  affineToInterval(b, pool, ivB);

  if (ivB.containsZero()) {
    out.set(0.0, INF, 0, 0);
    resetScratchInterval(markIv);
    return;
  }

  let midB = ivB.mid();
  let invMidB = 1.0 / midB;
  let radB = 0.5 * ivB.width();
  let q = radB / Math.abs(midB);

  if (q >= 1.0) {
    let ivA = getScratchInterval();
    let res = getScratchInterval();
    affineToInterval(a, pool, ivA);
    res.set(ivA.lo / ivB.hi, ivA.hi / ivB.lo);
    out.set(res.mid(), 0.5 * res.width(), 0, 0);
    resetScratchInterval(markIv);
    return;
  }

  // Reciprocal approximation: 1 / b ~ (1 / midB) - (1 / midB^2) * (b - midB)
  let alpha = -1.0 / (midB * midB);
  let gamma = invMidB - alpha * midB;
  let delta = (alpha * alpha * radB * radB) / (Math.abs(midB) - radB);

  let markAff = markScratchAffine();
  let invB = getScratchAffine();
  let countB = b.termsCount;
  let startInv = pool.allocTerms(countB);
  for (let i: u32 = 0; i < countB; i++) {
    pool.setTerm(startInv + i, pool.getSymbolId(b.termsStart + i), alpha * pool.getCoeff(b.termsStart + i));
  }
  invB.set(gamma + alpha * b.x0, Math.abs(alpha) * b.r + delta, startInv, countB);

  affineMul(a, invB, pool, out);
  resetScratchAffine(markAff);
  resetScratchInterval(markIv);
}

export function affineSin(a: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let markIv = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  affineToInterval(a, pool, iv);
  iaSin(iv, res);
  out.set(res.mid(), 0.5 * res.width(), 0, 0);
  resetScratchInterval(markIv);
}

export function affineCos(a: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let markIv = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  affineToInterval(a, pool, iv);
  iaCos(iv, res);
  out.set(res.mid(), 0.5 * res.width(), 0, 0);
  resetScratchInterval(markIv);
}

export function affineExp(a: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let markIv = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  affineToInterval(a, pool, iv);
  iaExp(iv, res);
  out.set(res.mid(), 0.5 * res.width(), 0, 0);
  resetScratchInterval(markIv);
}

export function affineLog(a: AffineForm, pool: AffineNoisePool, out: AffineForm): void {
  let markIv = markScratchInterval();
  let iv = getScratchInterval();
  let res = getScratchInterval();
  affineToInterval(a, pool, iv);
  iaLog(iv, res);
  out.set(res.mid(), 0.5 * res.width(), 0, 0);
  resetScratchInterval(markIv);
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward Affine Propagation Engines (Zero-GC)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates an AST expression in DaeBuilder with Affine forms.
 * Destination-passing into out AffineForm.
 */
export function dae_evaluateExprAffine(
  dae: DaeBuilder,
  exprId: u32,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  pool: AffineNoisePool,
  out: AffineForm,
): void {
  if (exprId >= dae.exprCount) {
    affineConst(0.0, out);
    return;
  }

  let offset = exprId * EXPR_STRIDE;
  let exprData = dae.getExprData();
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    affineConst(val as f64, out);
    return;
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    affineConst(val, out);
    return;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) {
      affineConst(0.0, out);
      return;
    }
    let lo = load<f64>(varBoundsLoPtr + (varId << 3));
    let hi = load<f64>(varBoundsHiPtr + (varId << 3));
    // Each variable receives a unique noise symbol ID = varId + 1
    affineVar(lo, hi, varId + 1, pool, out);
    return;
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let operand = exprData.get(offset + EXPR_LEFT);
    dae_evaluateExprAffine(dae, operand, varBoundsLoPtr, varBoundsHiPtr, pool, out);
    if (op == UnaryOp.Negate) {
      let mark = markScratchAffine();
      let tmp = getScratchAffine();
      tmp.copyFrom(out);
      affineNeg(tmp, pool, out);
      resetScratchAffine(mark);
    }
    return;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);

    let mark = markScratchAffine();
    let lRes = getScratchAffine();
    let rRes = getScratchAffine();

    dae_evaluateExprAffine(dae, left, varBoundsLoPtr, varBoundsHiPtr, pool, lRes);
    dae_evaluateExprAffine(dae, right, varBoundsLoPtr, varBoundsHiPtr, pool, rRes);

    if (op == BinOp.Add || op == BinOp.ElemAdd) affineAdd(lRes, rRes, pool, out);
    else if (op == BinOp.Sub || op == BinOp.ElemSub) affineSub(lRes, rRes, pool, out);
    else if (op == BinOp.Mul || op == BinOp.ElemMul) affineMul(lRes, rRes, pool, out);
    else if (op == BinOp.Div || op == BinOp.ElemDiv) affineDiv(lRes, rRes, pool, out);
    else {
      out.set(0.0, INF, 0, 0);
    }

    resetScratchAffine(mark);
    return;
  }

  out.set(0.0, INF, 0, 0);
}

/**
 * Standalone C-ABI / WASM Export for expression Affine Arithmetic evaluation.
 * Computes tight interval bounds using inter-variable correlations.
 */
export function dae_evalAffine(
  daePtr: u32,
  exprId: u32,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  if (daePtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let pool = getGlobalAffinePool();
  pool.reset();

  let markAff = markScratchAffine();
  let aff = getScratchAffine();
  dae_evaluateExprAffine(dae, exprId, varBoundsLoPtr, varBoundsHiPtr, pool, aff);

  let markIv = markScratchInterval();
  let iv = getScratchInterval();
  affineToInterval(aff, pool, iv);

  if (outLoPtr != 0) store<f64>(outLoPtr, iv.lo);
  if (outHiPtr != 0) store<f64>(outHiPtr, iv.hi);

  resetScratchInterval(markIv);
  resetScratchAffine(markAff);
}
