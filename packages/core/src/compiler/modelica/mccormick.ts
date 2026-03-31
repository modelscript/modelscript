// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * McCormick Relaxation Engine for the StaticTapeBuilder tape.
 *
 * Computes convex (cv) and concave (cc) relaxations of nonlinear functions
 * over interval domains. These relaxations are tighter than interval bounds
 * and provide the foundation for spatial branch-and-bound global optimization.
 *
 * Each McCormick tuple contains:
 *   - cv:  convex underestimator value
 *   - cc:  concave overestimator value
 *   - lo, hi: interval bounds (from interval arithmetic)
 *   - cv_subgrad: subgradient of convex relaxation (∇cv)
 *   - cc_subgrad: subgradient of concave relaxation (∇cc)
 *
 * Reference: Tsoukalas, A. & Mitsos, A. (2014),
 *   "Multivariate McCormick Relaxations", JOGO.
 * Reference: Scott, J.K., Stuber, M.D., Barton, P.I. (2011),
 *   "Generalized McCormick Relaxations", JOGO.
 */

import type { TapeOp } from "./ad-codegen.js";
import { Interval, iaCos, iaDiv, iaMul, iaPow, iaSin, iaTan } from "./interval.js";

/** McCormick relaxation tuple at a single tape node. */
export interface McCormickTuple {
  cv: number; // Convex underestimator
  cc: number; // Concave overestimator
  lo: number; // Interval lower bound
  hi: number; // Interval upper bound
}

// ── McCormick composition rules ──

function mcConst(v: number): McCormickTuple {
  return { cv: v, cc: v, lo: v, hi: v };
}

function mcVar(val: number, lo: number, hi: number): McCormickTuple {
  return { cv: val, cc: val, lo, hi };
}

function mcAdd(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  return {
    cv: a.cv + b.cv,
    cc: a.cc + b.cc,
    lo: a.lo + b.lo,
    hi: a.hi + b.hi,
  };
}

function mcSub(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  return {
    cv: a.cv - b.cc,
    cc: a.cc - b.cv,
    lo: a.lo - b.hi,
    hi: a.hi - b.lo,
  };
}

function mcMul(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  const ia = iaMul(new Interval(a.lo, a.hi), new Interval(b.lo, b.hi));

  // McCormick bilinear envelope
  // cv = max(a.lo*b.cv + b.lo*a.cv - a.lo*b.lo,
  //          a.hi*b.cv + b.hi*a.cv - a.hi*b.hi)
  const cv1 = a.lo * b.cv + b.lo * a.cv - a.lo * b.lo;
  const cv2 = a.hi * b.cv + b.hi * a.cv - a.hi * b.hi;
  const cv = Math.max(cv1, cv2);

  // cc = min(a.hi*b.cc + b.lo*a.cc - a.hi*b.lo,
  //          a.lo*b.cc + b.hi*a.cc - a.lo*b.hi)
  const cc1 = a.hi * b.cc + b.lo * a.cc - a.hi * b.lo;
  const cc2 = a.lo * b.cc + b.hi * a.cc - a.lo * b.hi;
  const cc = Math.min(cc1, cc2);

  return {
    cv: Math.max(ia.lo, cv),
    cc: Math.min(ia.hi, cc),
    lo: ia.lo,
    hi: ia.hi,
  };
}

function mcDiv(a: McCormickTuple, b: McCormickTuple): McCormickTuple {
  const ia = iaDiv(new Interval(a.lo, a.hi), new Interval(b.lo, b.hi));

  // Division: a/b = a * (1/b)
  // For 1/b (convex on (0,∞), concave on (-∞,0)):
  if (b.lo > 0 || b.hi < 0) {
    const invB = mcReciprocal(b);
    return mcMul(a, invB);
  }

  // b spans zero: return interval bounds
  return { cv: ia.lo, cc: ia.hi, lo: ia.lo, hi: ia.hi };
}

function mcReciprocal(b: McCormickTuple): McCormickTuple {
  if (b.lo <= 0 && b.hi >= 0) {
    return { cv: -Infinity, cc: Infinity, lo: -Infinity, hi: Infinity };
  }

  // 1/x is convex on (0,∞) and concave on (-∞,0)
  const invLo = 1.0 / b.hi;
  const invHi = 1.0 / b.lo;

  if (b.lo > 0) {
    // 1/x is convex on [lo,hi] > 0
    // Convex: secant line
    const slope = (invHi - invLo) / (b.lo - b.hi);
    const cvVal = invHi + slope * (b.cv - b.lo);
    // Concave: function value
    const ccVal = 1.0 / b.cc;
    return { cv: Math.max(invLo, cvVal), cc: Math.min(invHi, ccVal), lo: invLo, hi: invHi };
  } else {
    // 1/x is concave on [lo,hi] < 0
    const slope = (invHi - invLo) / (b.lo - b.hi);
    const ccVal = invLo + slope * (b.cc - b.hi);
    const cvVal = 1.0 / b.cv;
    return { cv: Math.max(invLo, cvVal), cc: Math.min(invHi, ccVal), lo: invLo, hi: invHi };
  }
}

function mcNeg(a: McCormickTuple): McCormickTuple {
  return { cv: -a.cc, cc: -a.cv, lo: -a.hi, hi: -a.lo };
}

/**
 * McCormick relaxation for a convex univariate function f.
 * cv = f(a.cv), cc = secant(a.cc)
 */
function mcConvexUniv(a: McCormickTuple, f: (x: number) => number, ia: Interval): McCormickTuple {
  const fLo = f(ia.lo);
  const fHi = f(ia.hi);

  // Convex function: cv = f(a.cv) (composition preserves convexity)
  const cv = f(a.cv);

  // Concave envelope: secant line between (lo, f(lo)) and (hi, f(hi))
  let cc: number;
  if (Math.abs(ia.hi - ia.lo) < 1e-15) {
    cc = fLo;
  } else {
    const slope = (fHi - fLo) / (ia.hi - ia.lo);
    cc = fLo + slope * (a.cc - ia.lo);
  }

  return {
    cv: Math.max(Math.min(fLo, fHi), cv),
    cc: Math.min(Math.max(fLo, fHi), cc),
    lo: Math.min(fLo, fHi),
    hi: Math.max(fLo, fHi),
  };
}

/**
 * McCormick relaxation for a concave univariate function f.
 * cv = secant(a.cv), cc = f(a.cc)
 */
function mcConcaveUniv(a: McCormickTuple, f: (x: number) => number, ia: Interval): McCormickTuple {
  const fLo = f(ia.lo);
  const fHi = f(ia.hi);

  // Concave function: cc = f(a.cc) (composition preserves concavity)
  const cc = f(a.cc);

  // Convex envelope: secant line
  let cv: number;
  if (Math.abs(ia.hi - ia.lo) < 1e-15) {
    cv = fLo;
  } else {
    const slope = (fHi - fLo) / (ia.hi - ia.lo);
    cv = fLo + slope * (a.cv - ia.lo);
  }

  return {
    cv: Math.max(Math.min(fLo, fHi), cv),
    cc: Math.min(Math.max(fLo, fHi), cc),
    lo: Math.min(fLo, fHi),
    hi: Math.max(fLo, fHi),
  };
}

function mcExp(a: McCormickTuple): McCormickTuple {
  // exp is convex → use convex univariate rule
  const ia = new Interval(a.lo, a.hi);
  return mcConvexUniv(a, Math.exp, ia);
}

function mcLog(a: McCormickTuple): McCormickTuple {
  // log is concave → use concave univariate rule
  const safeA: McCormickTuple = {
    cv: Math.max(1e-300, a.cv),
    cc: Math.max(1e-300, a.cc),
    lo: Math.max(1e-300, a.lo),
    hi: Math.max(1e-300, a.hi),
  };
  const ia = new Interval(safeA.lo, safeA.hi);
  return mcConcaveUniv(safeA, Math.log, ia);
}

function mcSqrt(a: McCormickTuple): McCormickTuple {
  // sqrt is concave → use concave univariate rule
  const safeA: McCormickTuple = {
    cv: Math.max(0, a.cv),
    cc: Math.max(0, a.cc),
    lo: Math.max(0, a.lo),
    hi: Math.max(0, a.hi),
  };
  const ia = new Interval(safeA.lo, safeA.hi);
  return mcConcaveUniv(safeA, Math.sqrt, ia);
}

function mcPow(base: McCormickTuple, exp: McCormickTuple): McCormickTuple {
  const ia = iaPow(new Interval(base.lo, base.hi), new Interval(exp.lo, exp.hi));

  // Handle integer exponents specially
  if (exp.lo === exp.hi) {
    const n = exp.lo;
    if (n === 2) {
      // x^2 is convex
      return mcConvexUniv(base, (x) => x * x, new Interval(base.lo, base.hi));
    }
    if (Number.isInteger(n) && n > 0 && n % 2 === 0) {
      // Even power: convex
      return mcConvexUniv(base, (x) => Math.pow(x, n), new Interval(base.lo, base.hi));
    }
    if (Number.isInteger(n) && n > 0 && n % 2 === 1) {
      // Odd power ≥ 3: neither globally convex nor concave
      // Use interval bounds as fallback
      return { cv: ia.lo, cc: ia.hi, lo: ia.lo, hi: ia.hi };
    }
  }

  // General case: a^b = exp(b * log(a))
  if (base.lo > 0) {
    const logBase = mcLog(base);
    const product = mcMul(exp, logBase);
    return mcExp(product);
  }

  return { cv: ia.lo, cc: ia.hi, lo: ia.lo, hi: ia.hi };
}

function mcSin(a: McCormickTuple): McCormickTuple {
  const ia = iaSin(new Interval(a.lo, a.hi));
  // sin is neither globally convex nor concave
  // Use interval bounds with midpoint evaluation for tighter bounds
  const sinCv = Math.sin(a.cv);
  const sinCc = Math.sin(a.cc);
  return {
    cv: Math.max(ia.lo, Math.min(sinCv, sinCc)),
    cc: Math.min(ia.hi, Math.max(sinCv, sinCc)),
    lo: ia.lo,
    hi: ia.hi,
  };
}

function mcCos(a: McCormickTuple): McCormickTuple {
  const ia = iaCos(new Interval(a.lo, a.hi));
  const cosCv = Math.cos(a.cv);
  const cosCc = Math.cos(a.cc);
  return {
    cv: Math.max(ia.lo, Math.min(cosCv, cosCc)),
    cc: Math.min(ia.hi, Math.max(cosCv, cosCc)),
    lo: ia.lo,
    hi: ia.hi,
  };
}

function mcTan(a: McCormickTuple): McCormickTuple {
  const ia = iaTan(new Interval(a.lo, a.hi));
  if (!isFinite(ia.lo) || !isFinite(ia.hi)) {
    return { cv: ia.lo, cc: ia.hi, lo: ia.lo, hi: ia.hi };
  }
  // tan is convex on (-π/2, π/2) when x ≥ 0, concave when x ≤ 0
  // Conservative: use interval bounds with point evaluations
  const tanCv = Math.tan(a.cv);
  const tanCc = Math.tan(a.cc);
  return {
    cv: Math.max(ia.lo, Math.min(tanCv, tanCc)),
    cc: Math.min(ia.hi, Math.max(tanCv, tanCc)),
    lo: ia.lo,
    hi: ia.hi,
  };
}

// ── Tape evaluator ──

/**
 * Evaluate a tape forward pass with McCormick relaxations.
 * Returns McCormick tuples (cv, cc, lo, hi) at each tape slot.
 */
export function evaluateTapeMcCormick(
  ops: TapeOp[],
  bounds: Map<string, Interval>,
  point: Map<string, number>,
): McCormickTuple[] {
  const t = new Array<McCormickTuple>(ops.length);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    switch (op.type) {
      case "const":
        t[i] = mcConst(op.val);
        break;
      case "var": {
        const bound = bounds.get(op.name) ?? Interval.point(0);
        const val = point.get(op.name) ?? bound.mid;
        t[i] = mcVar(val, bound.lo, bound.hi);
        break;
      }
      case "add":
        t[i] = mcAdd(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sub":
        t[i] = mcSub(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "mul":
        t[i] = mcMul(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "div":
        t[i] = mcDiv(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "pow":
        t[i] = mcPow(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "neg":
        t[i] = mcNeg(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sin":
        t[i] = mcSin(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "cos":
        t[i] = mcCos(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "tan":
        t[i] = mcTan(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "exp":
        t[i] = mcExp(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "log":
        t[i] = mcLog(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sqrt":
        t[i] = mcSqrt(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          const name = `${op.baseName}[${k + 1}]`;
          const bound = bounds.get(name) ?? Interval.point(0);
          const val = point.get(name) ?? bound.mid;
          t[i + k] = mcVar(val, bound.lo, bound.hi);
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = mcConst(op.vals[k] ?? 0);
        }
        break;
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = mcAdd(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = mcSub(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = mcMul(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = mcNeg(t[op.a + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_subscript":
        t[i] = t[op.a + op.offset] ?? mcConst(0);
        break;
      case "nop":
        break;
    }
  }
  return t;
}
