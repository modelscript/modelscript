// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Arena-Native DAE Interval & Singularity Evaluator (AssemblyScript / WebAssembly)
 *
 * Implements sound interval propagation and mathematical singularity detection
 * directly over DAEBuilder's struct-of-arrays linear memory expressions and equations.
 *
 * Detects:
 *   - Division by zero (definite [0, 0] or possible 0 in interval)
 *   - Negative radicand in sqrt() (definite or possible)
 *   - Non-positive argument in log()/ln() (definite or possible)
 *   - Tangent singularities (asymptotes at odd multiples of pi/2)
 *   - Power domain violations (negative base with fractional exponent)
 *   - Modelica min/max bound violations
 */

import { DaeBuilder, ExprKind, BinOp, UnaryOp } from "./builder";
import { ExprAccessor, EqAccessor } from "./accessors";
import { UnmanagedFloat64Array } from "../core/array";
import {
  Interval,
  getScratchInterval,
  markScratchInterval,
  resetScratchInterval,
  iaAdd,
  iaSub,
  iaMul,
  iaDiv,
  iaPow,
  iaNeg,
  iaSin,
  iaCos,
  iaTan,
  iaExp,
  iaLog,
  iaSqrt,
  iaHull,
  INF,
  NEG_INF,
} from "../autodiff/interval";

// ─────────────────────────────────────────────────────────────────────────────
// Singularity Bitflags & Constants
// ─────────────────────────────────────────────────────────────────────────────

export const SINGULARITY_NONE: u32                      = 0;
export const SINGULARITY_DIV_ZERO_DEFINITE: u32         = 1 << 0;
export const SINGULARITY_DIV_ZERO_POSSIBLE: u32         = 1 << 1;
export const SINGULARITY_SQRT_NEGATIVE_DEFINITE: u32    = 1 << 2;
export const SINGULARITY_SQRT_NEGATIVE_POSSIBLE: u32    = 1 << 3;
export const SINGULARITY_LOG_NONPOS_DEFINITE: u32       = 1 << 4;
export const SINGULARITY_LOG_NONPOS_POSSIBLE: u32       = 1 << 5;
export const SINGULARITY_TAN_SINGULARITY: u32           = 1 << 6;
export const SINGULARITY_POW_DOMAIN_VIOLATION: u32      = 1 << 7;
export const SINGULARITY_MIN_BOUND_VIOLATION: u32       = 1 << 8;
export const SINGULARITY_MAX_BOUND_VIOLATION: u32       = 1 << 9;

// Singularity Kind IDs for structured records
export const ISSUE_KIND_DIV_BY_ZERO: u32       = 1;
export const ISSUE_KIND_SQRT_NEGATIVE: u32     = 2;
export const ISSUE_KIND_LOG_NONPOS: u32        = 3;
export const ISSUE_KIND_TAN_SINGULARITY: u32   = 4;
export const ISSUE_KIND_POW_DOMAIN: u32        = 5;
export const ISSUE_KIND_MIN_BOUND: u32         = 6;
export const ISSUE_KIND_MAX_BOUND: u32         = 7;

export const SEVERITY_DEFINITE: u32 = 1;
export const SEVERITY_POSSIBLE: u32 = 2;

// Maximum number of structured issue descriptors stored in a single evaluation run
export const MAX_RECORDED_ISSUES: i32 = 64;
// Record layout (32 bytes):
// offset 0:  kind (u32)
// offset 4:  severity (u32)
// offset 8:  exprId (u32)
// offset 12: varId (u32)
// offset 16: lo (f64)
// offset 24: hi (f64)
export const ISSUE_RECORD_STRIDE_BYTES: usize = 32;

/** Global state for collecting singularities during an evaluation pass */
let g_issueMask: u32 = 0;
let g_issueCount: u32 = 0;
let g_issueBufferPtr: usize = 0;
let g_maxIssueRecords: u32 = 0;

@inline
function recordIssue(kind: u32, severity: u32, exprId: u32, varId: u32, lo: f64, hi: f64): void {
  if (severity == SEVERITY_DEFINITE) {
    if (kind == ISSUE_KIND_DIV_BY_ZERO) g_issueMask |= SINGULARITY_DIV_ZERO_DEFINITE;
    else if (kind == ISSUE_KIND_SQRT_NEGATIVE) g_issueMask |= SINGULARITY_SQRT_NEGATIVE_DEFINITE;
    else if (kind == ISSUE_KIND_LOG_NONPOS) g_issueMask |= SINGULARITY_LOG_NONPOS_DEFINITE;
    else if (kind == ISSUE_KIND_TAN_SINGULARITY) g_issueMask |= SINGULARITY_TAN_SINGULARITY;
    else if (kind == ISSUE_KIND_POW_DOMAIN) g_issueMask |= SINGULARITY_POW_DOMAIN_VIOLATION;
    else if (kind == ISSUE_KIND_MIN_BOUND) g_issueMask |= SINGULARITY_MIN_BOUND_VIOLATION;
    else if (kind == ISSUE_KIND_MAX_BOUND) g_issueMask |= SINGULARITY_MAX_BOUND_VIOLATION;
  } else {
    if (kind == ISSUE_KIND_DIV_BY_ZERO) g_issueMask |= SINGULARITY_DIV_ZERO_POSSIBLE;
    else if (kind == ISSUE_KIND_SQRT_NEGATIVE) g_issueMask |= SINGULARITY_SQRT_NEGATIVE_POSSIBLE;
    else if (kind == ISSUE_KIND_LOG_NONPOS) g_issueMask |= SINGULARITY_LOG_NONPOS_POSSIBLE;
    else if (kind == ISSUE_KIND_TAN_SINGULARITY) g_issueMask |= SINGULARITY_TAN_SINGULARITY;
    else if (kind == ISSUE_KIND_POW_DOMAIN) g_issueMask |= SINGULARITY_POW_DOMAIN_VIOLATION;
    else if (kind == ISSUE_KIND_MIN_BOUND) g_issueMask |= SINGULARITY_MIN_BOUND_VIOLATION;
    else if (kind == ISSUE_KIND_MAX_BOUND) g_issueMask |= SINGULARITY_MAX_BOUND_VIOLATION;
  }

  if (g_issueBufferPtr != 0 && g_issueCount < g_maxIssueRecords) {
    let offset = g_issueBufferPtr + ((g_issueCount as usize) * ISSUE_RECORD_STRIDE_BYTES);
    store<u32>(offset + 0, kind);
    store<u32>(offset + 4, severity);
    store<u32>(offset + 8, exprId);
    store<u32>(offset + 12, varId);
    store<f64>(offset + 16, lo);
    store<f64>(offset + 24, hi);
  }
  g_issueCount++;
}

/**
 * Soundly evaluates an expression tree in DaeBuilder with interval arithmetic,
 * recording domain violations and returning bounds into `out`.
 */
export function evalExprInterval(
  exprId: u32,
  dae: DaeBuilder,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  out: Interval,
): void {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) {
    out.setPoint(0.0);
    return;
  }

  let e = ExprAccessor.at(dae.getExprData(), exprId);

  // ── Literals ──
  if (e.kind == ExprKind.RealLiteral) {
    out.setPoint(e.realValue);
    return;
  }

  if (e.kind == ExprKind.IntLiteral || e.kind == ExprKind.BoolLiteral || e.kind == ExprKind.EnumLiteral) {
    out.setPoint(e.intValue as f64);
    return;
  }

  // ── Variable Reference ──
  if (e.kind == ExprKind.Name) {
    let varId = e.varId;
    if (varId == 0xffffffff || varId >= dae.varCount) {
      out.setPoint(0.0);
      return;
    }
    let lo: f64 = NEG_INF;
    let hi: f64 = INF;
    if (varBoundsLoPtr != 0) {
      lo = changetype<UnmanagedFloat64Array>(varBoundsLoPtr)[varId];
    }
    if (varBoundsHiPtr != 0) {
      hi = changetype<UnmanagedFloat64Array>(varBoundsHiPtr)[varId];
    }
    out.set(lo, hi);
    return;
  }

  // ── Unary Operations ──
  if (e.kind == ExprKind.Unary || e.kind == ExprKind.Negate) {
    let isNot = e.unaryOp == UnaryOp.Not;
    let left = e.left;
    evalExprInterval(left, dae, varBoundsLoPtr, varBoundsHiPtr, out);
    if (isNot) {
      if (out.lo == 0.0 && out.hi == 0.0) {
        out.setPoint(1.0);
      } else if (out.lo > 0.0 || out.hi < 0.0) {
        out.setPoint(0.0);
      } else {
        out.set(0.0, 1.0);
      }
    } else {
      iaNeg(out, out);
    }
    return;
  }

  // ── Binary Operations ──
  if (e.kind == ExprKind.Binary) {
    let op = e.binOp;
    let left = e.left;
    let right = e.right;

    let mark = markScratchInterval();
    let lRes = getScratchInterval();
    let rRes = getScratchInterval();

    evalExprInterval(left, dae, varBoundsLoPtr, varBoundsHiPtr, lRes);
    evalExprInterval(right, dae, varBoundsLoPtr, varBoundsHiPtr, rRes);

    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      iaAdd(lRes, rRes, out);
    } else if (op == BinOp.Sub || op == BinOp.ElemSub) {
      iaSub(lRes, rRes, out);
    } else if (op == BinOp.Mul || op == BinOp.ElemMul) {
      iaMul(lRes, rRes, out);
    } else if (op == BinOp.Div || op == BinOp.ElemDiv) {
      if (rRes.lo == 0.0 && rRes.hi == 0.0) {
        recordIssue(ISSUE_KIND_DIV_BY_ZERO, SEVERITY_DEFINITE, exprId, 0xffffffff, rRes.lo, rRes.hi);
        out.setEntire();
      } else if (rRes.containsZero()) {
        recordIssue(ISSUE_KIND_DIV_BY_ZERO, SEVERITY_POSSIBLE, exprId, 0xffffffff, rRes.lo, rRes.hi);
        iaDiv(lRes, rRes, out);
      } else {
        iaDiv(lRes, rRes, out);
      }
    } else if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (lRes.hi < 0.0) {
        recordIssue(ISSUE_KIND_POW_DOMAIN, SEVERITY_DEFINITE, exprId, 0xffffffff, lRes.lo, lRes.hi);
      } else if (lRes.lo < 0.0) {
        recordIssue(ISSUE_KIND_POW_DOMAIN, SEVERITY_POSSIBLE, exprId, 0xffffffff, lRes.lo, lRes.hi);
      }
      iaPow(lRes, rRes, out);
    } else if (op == BinOp.Lt) {
      if (lRes.hi < rRes.lo) out.setPoint(1.0);
      else if (lRes.lo >= rRes.hi) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Lte) {
      if (lRes.hi <= rRes.lo) out.setPoint(1.0);
      else if (lRes.lo > rRes.hi) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Gt) {
      if (lRes.lo > rRes.hi) out.setPoint(1.0);
      else if (lRes.hi <= rRes.lo) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Gte) {
      if (lRes.lo >= rRes.hi) out.setPoint(1.0);
      else if (lRes.hi < rRes.lo) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Eq) {
      if (lRes.lo == lRes.hi && rRes.lo == rRes.hi && lRes.lo == rRes.lo) out.setPoint(1.0);
      else if (lRes.hi < rRes.lo || lRes.lo > rRes.hi) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Neq) {
      if (lRes.hi < rRes.lo || lRes.lo > rRes.hi) out.setPoint(1.0);
      else if (lRes.lo == lRes.hi && rRes.lo == rRes.hi && lRes.lo == rRes.lo) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.And) {
      let lTrue = lRes.lo > 0.0 || lRes.hi < 0.0;
      let rTrue = rRes.lo > 0.0 || rRes.hi < 0.0;
      let lFalse = lRes.lo == 0.0 && lRes.hi == 0.0;
      let rFalse = rRes.lo == 0.0 && rRes.hi == 0.0;
      if (lTrue && rTrue) out.setPoint(1.0);
      else if (lFalse || rFalse) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else if (op == BinOp.Or) {
      let lTrue = lRes.lo > 0.0 || lRes.hi < 0.0;
      let rTrue = rRes.lo > 0.0 || rRes.hi < 0.0;
      let lFalse = lRes.lo == 0.0 && lRes.hi == 0.0;
      let rFalse = rRes.lo == 0.0 && rRes.hi == 0.0;
      if (lTrue || rTrue) out.setPoint(1.0);
      else if (lFalse && rFalse) out.setPoint(0.0);
      else out.set(0.0, 1.0);
    } else {
      out.setEntire();
    }

    resetScratchInterval(mark);
    return;
  }

  // ── Conditional (IfElse) ──
  if (e.kind == ExprKind.IfElse) {
    let cond = e.data1u;
    let left = e.left;
    let right = e.right;

    let mark = markScratchInterval();
    let condRes = getScratchInterval();
    evalExprInterval(cond, dae, varBoundsLoPtr, varBoundsHiPtr, condRes);

    if (condRes.lo > 0.0) {
      evalExprInterval(left, dae, varBoundsLoPtr, varBoundsHiPtr, out);
    } else if (condRes.hi <= 0.0) {
      evalExprInterval(right, dae, varBoundsLoPtr, varBoundsHiPtr, out);
    } else {
      let thenRes = getScratchInterval();
      let elseRes = getScratchInterval();
      evalExprInterval(left, dae, varBoundsLoPtr, varBoundsHiPtr, thenRes);
      evalExprInterval(right, dae, varBoundsLoPtr, varBoundsHiPtr, elseRes);
      iaHull(thenRes, elseRes, out);
    }

    resetScratchInterval(mark);
    return;
  }

  // ── Math & Transcendental Function Calls ──
  if (e.kind == ExprKind.Call) {
    let left = e.left;
    let right = e.right;
    let funcId = e.funcId as i32;

    let mark = markScratchInterval();
    let lRes = getScratchInterval();
    let rRes = getScratchInterval();

    evalExprInterval(left, dae, varBoundsLoPtr, varBoundsHiPtr, lRes);
    if ((funcId == 9 || funcId == 10 || funcId == 15) && right != 0xffffffff && right < dae.exprCount) {
      evalExprInterval(right, dae, varBoundsLoPtr, varBoundsHiPtr, rRes);
    }

    if (funcId == 1) { // abs
      if (lRes.lo >= 0.0) {
        out.copyFrom(lRes);
      } else if (lRes.hi <= 0.0) {
        out.set(-lRes.hi, -lRes.lo);
      } else {
        out.set(0.0, Math.max(-lRes.lo, lRes.hi));
      }
    } else if (funcId == 2) { // sqrt
      if (lRes.hi < 0.0) {
        recordIssue(ISSUE_KIND_SQRT_NEGATIVE, SEVERITY_DEFINITE, exprId, 0xffffffff, lRes.lo, lRes.hi);
        out.setEmpty();
      } else if (lRes.lo < 0.0) {
        recordIssue(ISSUE_KIND_SQRT_NEGATIVE, SEVERITY_POSSIBLE, exprId, 0xffffffff, lRes.lo, lRes.hi);
        iaSqrt(lRes, out);
      } else {
        iaSqrt(lRes, out);
      }
    } else if (funcId == 3) { // sin
      iaSin(lRes, out);
    } else if (funcId == 4) { // cos
      iaCos(lRes, out);
    } else if (funcId == 5) { // exp
      iaExp(lRes, out);
    } else if (funcId == 6 || funcId == 19) { // log, log10
      if (lRes.hi <= 0.0) {
        recordIssue(ISSUE_KIND_LOG_NONPOS, SEVERITY_DEFINITE, exprId, 0xffffffff, lRes.lo, lRes.hi);
        out.setEmpty();
      } else if (lRes.lo <= 0.0) {
        recordIssue(ISSUE_KIND_LOG_NONPOS, SEVERITY_POSSIBLE, exprId, 0xffffffff, lRes.lo, lRes.hi);
        iaLog(lRes, out);
      } else {
        iaLog(lRes, out);
      }
      if (funcId == 19 && !out.containsZero()) {
        let invLn10 = 1.0 / Math.log(10.0);
        out.set(out.lo * invLn10, out.hi * invLn10);
      }
    } else if (funcId == 7) { // floor
      out.set(Math.floor(lRes.lo), Math.floor(lRes.hi));
    } else if (funcId == 8) { // ceil
      out.set(Math.ceil(lRes.lo), Math.ceil(lRes.hi));
    } else if (funcId == 9) { // min
      out.set(Math.min(lRes.lo, rRes.lo), Math.min(lRes.hi, rRes.hi));
    } else if (funcId == 10) { // max
      out.set(Math.max(lRes.lo, rRes.lo), Math.max(lRes.hi, rRes.hi));
    } else if (funcId == 11) { // tan
      let width = lRes.hi - lRes.lo;
      if (width >= Math.PI) {
        recordIssue(ISSUE_KIND_TAN_SINGULARITY, SEVERITY_DEFINITE, exprId, 0xffffffff, lRes.lo, lRes.hi);
      } else {
        let kMin = Math.floor((lRes.lo - Math.PI / 2.0) / Math.PI) as i32;
        let kMax = Math.ceil((lRes.hi - Math.PI / 2.0) / Math.PI) as i32;
        for (let k = kMin; k <= kMax; k++) {
          let asymp = Math.PI / 2.0 + (k as f64) * Math.PI;
          if (asymp > lRes.lo && asymp < lRes.hi) {
            recordIssue(ISSUE_KIND_TAN_SINGULARITY, SEVERITY_DEFINITE, exprId, 0xffffffff, lRes.lo, lRes.hi);
            break;
          }
        }
      }
      iaTan(lRes, out);
    } else if (funcId == 20) { // sign
      if (lRes.lo > 0.0) out.setPoint(1.0);
      else if (lRes.hi < 0.0) out.setPoint(-1.0);
      else out.set(-1.0, 1.0);
    } else {
      out.setEntire();
    }

    resetScratchInterval(mark);
    return;
  }

  // ── Der Operator ──
  if (e.kind == ExprKind.Der) {
    let inner = e.data1u;
    evalExprInterval(inner, dae, varBoundsLoPtr, varBoundsHiPtr, out);
    return;
  }

  out.setEntire();
}

/**
 * Evaluates equation residual: F(x) = RHS - LHS as an interval.
 */
export function evalEquationResidualInterval(
  eqId: u32,
  dae: DaeBuilder,
  varBoundsLoPtr: usize,
  varBoundsHiPtr: usize,
  out: Interval,
): void {
  if (eqId >= dae.eqCount) {
    out.setPoint(0.0);
    return;
  }

  let eq = EqAccessor.at(dae.getEqData(), eqId);
  let mark = markScratchInterval();
  let lhsIv = getScratchInterval();
  let rhsIv = getScratchInterval();

  evalExprInterval(eq.lhs, dae, varBoundsLoPtr, varBoundsHiPtr, lhsIv);
  evalExprInterval(eq.rhs, dae, varBoundsLoPtr, varBoundsHiPtr, rhsIv);

  iaSub(rhsIv, lhsIv, out);
  resetScratchInterval(mark);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C-ABI / WebAssembly Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates an expression with interval arithmetic and returns the issues bitmask.
 *
 * Parameters:
 *   - daePtr: pointer to DaeBuilder instance
 *   - exprId: expression ID to evaluate
 *   - boundsLoPtr: array of variable low bounds (f64[])
 *   - boundsHiPtr: array of variable high bounds (f64[])
 *   - outLoPtr: output pointer where interval low (f64) is written
 *   - outHiPtr: output pointer where interval high (f64) is written
 *   - issueBufferPtr: optional pointer to buffer for structured issue records
 *   - maxIssues: capacity of issueBufferPtr in records
 *
 * Returns:
 *   - bitmask of detected singularities (0 if none)
 */
export function dae_evalExprInterval(
  daePtr: u32,
  exprId: u32,
  boundsLoPtr: usize,
  boundsHiPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
  issueBufferPtr: usize,
  maxIssues: u32,
): u32 {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);

  g_issueMask = 0;
  g_issueCount = 0;
  g_issueBufferPtr = issueBufferPtr;
  g_maxIssueRecords = maxIssues;

  let mark = markScratchInterval();
  let out = getScratchInterval();

  evalExprInterval(exprId, dae, boundsLoPtr, boundsHiPtr, out);

  if (outLoPtr != 0) changetype<UnmanagedFloat64Array>(outLoPtr)[0] = out.lo;
  if (outHiPtr != 0) changetype<UnmanagedFloat64Array>(outHiPtr)[0] = out.hi;

  resetScratchInterval(mark);
  return g_issueMask;
}

/**
 * Evaluates an equation residual interval (RHS - LHS) and returns the issues bitmask.
 */
export function dae_evalEquationInterval(
  daePtr: u32,
  eqId: u32,
  boundsLoPtr: usize,
  boundsHiPtr: usize,
  outResLoPtr: usize,
  outResHiPtr: usize,
  issueBufferPtr: usize,
  maxIssues: u32,
): u32 {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);

  g_issueMask = 0;
  g_issueCount = 0;
  g_issueBufferPtr = issueBufferPtr;
  g_maxIssueRecords = maxIssues;

  let mark = markScratchInterval();
  let out = getScratchInterval();

  evalEquationResidualInterval(eqId, dae, boundsLoPtr, boundsHiPtr, out);

  if (outResLoPtr != 0) changetype<UnmanagedFloat64Array>(outResLoPtr)[0] = out.lo;
  if (outResHiPtr != 0) changetype<UnmanagedFloat64Array>(outResHiPtr)[0] = out.hi;

  resetScratchInterval(mark);
  return g_issueMask;
}

/**
 * Returns total count of issues recorded in last evaluation run.
 */
export function dae_getIssueCount(): u32 {
  return g_issueCount;
}

/**
 * Validates a variable interval against explicit min and max attributes.
 * Returns issue bitmask (SINGULARITY_MIN_BOUND_VIOLATION | SINGULARITY_MAX_BOUND_VIOLATION).
 */
export function dae_checkVarBounds(
  varId: u32,
  lo: f64,
  hi: f64,
  minVal: f64,
  maxVal: f64,
): u32 {
  let mask: u32 = 0;
  if (minVal > NEG_INF) {
    if (hi < minVal) {
      mask |= SINGULARITY_MIN_BOUND_VIOLATION;
    } else if (lo < minVal) {
      mask |= SINGULARITY_MIN_BOUND_VIOLATION;
    }
  }
  if (maxVal < INF) {
    if (lo > maxVal) {
      mask |= SINGULARITY_MAX_BOUND_VIOLATION;
    } else if (hi > maxVal) {
      mask |= SINGULARITY_MAX_BOUND_VIOLATION;
    }
  }
  return mask;
}
