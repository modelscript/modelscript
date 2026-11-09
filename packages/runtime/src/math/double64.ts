// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Quad-Precision (`Double64` / Double-Double) 106-bit Mantissa Arithmetic & Integrator.
 *
 * Implements error-free floating-point transformations (Dekker splitting, Knuth `TwoSum`)
 * to represent extended-precision real numbers as an unevaluated sum of two IEEE-754
 * `Float64` values $x = x_{\text{hi}} + x_{\text{lo}}$ with $|x_{\text{lo}}| \le \frac{1}{2}\text{ulp}(x_{\text{hi}})$,
 * providing 106 bits of significand precision ($\epsilon \approx 4.93 \times 10^{-32}$).
 *
 * Academic Citations:
 * - Dekker, T. J. (1971). "A floating-point technique for extending the available precision."
 *   Numerische Mathematik, 18(3), 224-242. https://doi.org/10.1007/BF01397083
 * - Knuth, D. E. (1997). The Art of Computer Programming, Volume 2: Seminumerical Algorithms
 *   (3rd ed.). Addison-Wesley. Section 4.2.2.
 * - Hida, Y., Li, X. S., & Bailey, D. H. (2001). "Algorithms for quad-double precision
 *   floating point arithmetic." In Proceedings 15th IEEE Symposium on Computer Arithmetic
 *   (ARITH-15), pp. 155-162. https://doi.org/10.1109/ARITH.2001.930115
 */

export interface Double64 {
  /** Most significant IEEE-754 Float64 component. */
  readonly hi: number;
  /** Non-overlapping least significant IEEE-754 Float64 component (|lo| <= 0.5 * ulp(hi)). */
  readonly lo: number;
}

const SPLITTER = 134217729.0; // 2^27 + 1

/** Constructs a `Double64` from one or two `Float64` numbers with renormalization. */
export function ddFromNumber(hi: number, lo = 0.0): Double64 {
  if (lo === 0.0) return { hi, lo: 0.0 };
  const s = hi + lo;
  const v = s - hi;
  const e = hi - (s - v) + (lo - v);
  return { hi: s, lo: e };
}

/** Converts a `Double64` back to standard IEEE-754 `Float64`. */
export function ddToNumber(x: Double64): number {
  return x.hi + x.lo;
}

/** Error-free Knuth `TwoSum(a, b)` returning `[s, err]` such that `s + err = a + b` exactly. */
export function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const v = s - a;
  const err = a - (s - v) + (b - v);
  return [s, err];
}

/** Fast error-free `QuickTwoSum(a, b)` assuming `|a| >= |b|`. */
export function quickTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const err = b - (s - a);
  return [s, err];
}

/** Veltkamp 27-bit splitting of an IEEE-754 `Float64` into high and low 26-bit halves. */
export function splitFloat64(a: number): [number, number] {
  const temp = SPLITTER * a;
  const hi = temp - (temp - a);
  const lo = a - hi;
  return [hi, lo];
}

/** Error-free Dekker `TwoProd(a, b)` returning `[p, err]` such that `p + err = a * b` exactly. */
export function twoProd(a: number, b: number): [number, number] {
  const p = a * b;
  const [aHi, aLo] = splitFloat64(a);
  const [bHi, bLo] = splitFloat64(b);
  const err = aHi * bHi - p + aHi * bLo + aLo * bHi + aLo * bLo;
  return [p, err];
}

export const DD_ZERO: Double64 = { hi: 0.0, lo: 0.0 };
export const DD_ONE: Double64 = { hi: 1.0, lo: 0.0 };
export const DD_PI: Double64 = {
  hi: 3.141592653589793,
  lo: 1.2246467991473532e-16,
};
export const DD_TWO_PI: Double64 = {
  hi: 6.283185307179586,
  lo: 2.4492935982947064e-16,
};
export const DD_HALF_PI: Double64 = {
  hi: 1.5707963267948966,
  lo: 6.123233995736766e-17,
};
export const DD_LN2: Double64 = {
  hi: 0.6931471805599453,
  lo: 2.3190468138462996e-17,
};

/** Negates a `Double64` value: `-a`. */
export function ddNeg(a: Double64): Double64 {
  return { hi: -a.hi, lo: -a.lo };
}

/** Absolute value of a `Double64`: `|a|`. */
export function ddAbs(a: Double64): Double64 {
  return a.hi < 0.0 || (a.hi === 0.0 && a.lo < 0.0) ? ddNeg(a) : a;
}

/** IEEE-accurate 106-bit addition `a + b` (Hida, Li, & Bailey 2001). */
export function ddAdd(a: Double64, b: Double64): Double64 {
  let [s1, s2] = twoSum(a.hi, b.hi);
  const [t1, t2] = twoSum(a.lo, b.lo);
  s2 += t1;
  [s1, s2] = quickTwoSum(s1, s2);
  s2 += t2;
  [s1, s2] = quickTwoSum(s1, s2);
  return { hi: s1, lo: s2 };
}

/** IEEE-accurate 106-bit subtraction `a - b`. */
export function ddSub(a: Double64, b: Double64): Double64 {
  return ddAdd(a, ddNeg(b));
}

/** 106-bit multiplication `a * b`. */
export function ddMul(a: Double64, b: Double64): Double64 {
  let [p1, p2] = twoProd(a.hi, b.hi);
  p2 += a.hi * b.lo + a.lo * b.hi + a.lo * b.lo;
  [p1, p2] = quickTwoSum(p1, p2);
  return { hi: p1, lo: p2 };
}

/** Multiplies a `Double64` by a scalar `Float64`. */
export function ddMulScalar(a: Double64, s: number): Double64 {
  let [p1, p2] = twoProd(a.hi, s);
  p2 += a.lo * s;
  [p1, p2] = quickTwoSum(p1, p2);
  return { hi: p1, lo: p2 };
}

/** 106-bit division `a / b` using 3-term iterative residual refinement. */
export function ddDiv(a: Double64, b: Double64): Double64 {
  const q1 = a.hi / b.hi;
  let r = ddSub(a, ddMulScalar(b, q1));

  const q2 = r.hi / b.hi;
  r = ddSub(r, ddMulScalar(b, q2));

  const q3 = r.hi / b.hi;
  let [hi, lo] = quickTwoSum(q1, q2);
  return ddAdd({ hi, lo }, { hi: q3, lo: 0.0 });
}

/** 106-bit square root $\sqrt{a}$ via Newton-Raphson refinement. */
export function ddSqrt(a: Double64): Double64 {
  if (a.hi === 0.0 && a.lo === 0.0) return DD_ZERO;
  if (a.hi < 0.0) {
    throw new Error("ddSqrt: Cannot take square root of negative Double64.");
  }
  const x0 = Math.sqrt(a.hi);
  let x: Double64 = { hi: x0, lo: 0.0 };
  // Two Newton-Raphson steps: x_{k+1} = 0.5 * (x_k + a / x_k)
  x = ddMulScalar(ddAdd(x, ddDiv(a, x)), 0.5);
  x = ddMulScalar(ddAdd(x, ddDiv(a, x)), 0.5);
  return x;
}

/** 106-bit exponential $\exp(a)$ using $\ln(2)$ range reduction and 28-term Taylor series. */
export function ddExp(a: Double64): Double64 {
  if (a.hi === 0.0 && a.lo === 0.0) return DD_ONE;

  // Range reduction: a = k * ln(2) + r, with |r| <= 0.5 * ln(2)
  const k = Math.round(a.hi / DD_LN2.hi);
  const r = ddSub(a, ddMulScalar(DD_LN2, k));

  // Further halve r by 2^4 = 16 so |u| <= 0.022
  const m = 16;
  const u = ddMulScalar(r, 1.0 / m);

  // Taylor series for exp(u) = 1 + u + u^2/2! + ...
  let sum = ddAdd(DD_ONE, u);
  let term = u;
  for (let n = 2; n <= 22; n++) {
    term = ddDiv(ddMul(term, u), ddFromNumber(n));
    sum = ddAdd(sum, term);
    if (Math.abs(term.hi) < 1e-34) break;
  }

  // Square 4 times to recover exp(r) = (exp(u))^16
  for (let i = 0; i < 4; i++) {
    sum = ddMul(sum, sum);
  }

  // Scale by 2^k
  const scale = Math.pow(2, k);
  return { hi: sum.hi * scale, lo: sum.lo * scale };
}

/**
 * Evaluates $\sin(r)$ and $\cos(r)$ for reduced $|r| \le \pi/4$ via 106-bit Taylor series.
 */
function ddSinCosReduced(r: Double64): { sin: Double64; cos: Double64 } {
  const r2 = ddNeg(ddMul(r, r));

  // sin(r) = r - r^3/3! + r^5/5! - ...
  let sinSum = r;
  let sinTerm = r;
  for (let k = 1; k <= 16; k++) {
    const denom = 2 * k * (2 * k + 1);
    sinTerm = ddDiv(ddMul(sinTerm, r2), ddFromNumber(denom));
    sinSum = ddAdd(sinSum, sinTerm);
    if (Math.abs(sinTerm.hi) < 1e-34) break;
  }

  // cos(r) = 1 - r^2/2! + r^4/4! - ...
  let cosSum = DD_ONE;
  let cosTerm = DD_ONE;
  for (let k = 1; k <= 16; k++) {
    const denom = (2 * k - 1) * (2 * k);
    cosTerm = ddDiv(ddMul(cosTerm, r2), ddFromNumber(denom));
    cosSum = ddAdd(cosSum, cosTerm);
    if (Math.abs(cosTerm.hi) < 1e-34) break;
  }

  return { sin: sinSum, cos: cosSum };
}

/** 106-bit sine $\sin(a)$ with $\pi/2$ quadrant reduction. */
export function ddSin(a: Double64): Double64 {
  const j = Math.round(a.hi / DD_HALF_PI.hi);
  const r = ddSub(a, ddMulScalar(DD_HALF_PI, j));
  const { sin, cos } = ddSinCosReduced(r);
  const q = ((j % 4) + 4) % 4;
  if (q === 0) return sin;
  if (q === 1) return cos;
  if (q === 2) return ddNeg(sin);
  return ddNeg(cos);
}

/** 106-bit cosine $\cos(a)$ with $\pi/2$ quadrant reduction. */
export function ddCos(a: Double64): Double64 {
  const j = Math.round(a.hi / DD_HALF_PI.hi);
  const r = ddSub(a, ddMulScalar(DD_HALF_PI, j));
  const { sin, cos } = ddSinCosReduced(r);
  const q = ((j % 4) + 4) % 4;
  if (q === 0) return cos;
  if (q === 1) return ddNeg(sin);
  if (q === 2) return ddNeg(cos);
  return sin;
}

/**
 * Solves a dense linear system $A x = b$ in 106-bit `Double64` arithmetic using
 * Gaussian elimination with partial pivoting. Crucial for severely ill-conditioned
 * systems (e.g., Hilbert matrices, high-order Padé/Vandermonde systems) where standard
 * 53-bit `Float64` loses all significant digits.
 */
export function ddSolveLinear(A: Double64[][], b: Double64[]): Double64[] {
  const n = b.length;
  const mat: Double64[][] = A.map((row) => row.map((v) => ({ hi: v.hi, lo: v.lo })));
  const rhs: Double64[] = b.map((v) => ({ hi: v.hi, lo: v.lo }));

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(mat[k]![k]!.hi);
    let pivot = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(mat[i]![k]!.hi);
      if (v > maxVal) {
        maxVal = v;
        pivot = i;
      }
    }

    if (pivot !== k) {
      const tmpRow = mat[k]!;
      mat[k] = mat[pivot]!;
      mat[pivot] = tmpRow;
      const tmpRhs = rhs[k]!;
      rhs[k] = rhs[pivot]!;
      rhs[pivot] = tmpRhs;
    }

    const diag = mat[k]![k]!;
    for (let i = k + 1; i < n; i++) {
      const factor = ddDiv(mat[i]![k]!, diag);
      mat[i]![k] = DD_ZERO;
      for (let j = k + 1; j < n; j++) {
        mat[i]![j] = ddSub(mat[i]![j]!, ddMul(factor, mat[k]![j]!));
      }
      rhs[i] = ddSub(rhs[i]!, ddMul(factor, rhs[k]!));
    }
  }

  const x: Double64[] = new Array(n).fill(DD_ZERO);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i]!;
    for (let j = i + 1; j < n; j++) {
      sum = ddSub(sum, ddMul(mat[i]![j]!, x[j]!));
    }
    x[i] = ddDiv(sum, mat[i]![i]!);
  }

  return x;
}

export interface Double64ODEResult {
  /** Final time tEnd in 106-bit Double64 precision. */
  tFinal: Double64;
  /** Final state vector y(tEnd) in 106-bit Double64 precision. */
  yFinal: Double64[];
  /** Sampled trajectory times (as Double64). */
  times: Double64[];
  /** Sampled trajectory states (as Double64[]). */
  states: Double64[][];
}

/**
 * Integrates an initial-value ODE system $\dot{y} = f(t, y)$ in full 106-bit `Double64`
 * arithmetic using the classical 4th-order Runge-Kutta (RK4) method, eliminating the
 * $10^{-16}$ IEEE-754 `Float64` round-off floor for ultra-high-precision trajectories.
 */
export function integrateODE_Double64(
  f: (t: Double64, y: Double64[]) => Double64[],
  t0: Double64 | number,
  y0: (Double64 | number)[],
  tEnd: Double64 | number,
  numSteps: number,
  recordEvery = 1,
): Double64ODEResult {
  const tStart: Double64 = typeof t0 === "number" ? ddFromNumber(t0) : t0;
  const tStop: Double64 = typeof tEnd === "number" ? ddFromNumber(tEnd) : tEnd;
  const h = ddDiv(ddSub(tStop, tStart), ddFromNumber(numSteps));
  const halfH = ddMulScalar(h, 0.5);
  const sixthH = ddDiv(h, ddFromNumber(6.0));

  let t = tStart;
  let y: Double64[] = y0.map((v) => (typeof v === "number" ? ddFromNumber(v) : v));
  const n = y.length;

  const times: Double64[] = [t];
  const states: Double64[][] = [y.map((v) => ({ hi: v.hi, lo: v.lo }))];

  for (let step = 1; step <= numSteps; step++) {
    const k1 = f(t, y);

    const tMid = ddAdd(t, halfH);
    const y2 = new Array<Double64>(n);
    for (let i = 0; i < n; i++) {
      y2[i] = ddAdd(y[i]!, ddMul(halfH, k1[i]!));
    }
    const k2 = f(tMid, y2);

    const y3 = new Array<Double64>(n);
    for (let i = 0; i < n; i++) {
      y3[i] = ddAdd(y[i]!, ddMul(halfH, k2[i]!));
    }
    const k3 = f(tMid, y3);

    const tNext = ddAdd(tStart, ddMulScalar(h, step));
    const y4 = new Array<Double64>(n);
    for (let i = 0; i < n; i++) {
      y4[i] = ddAdd(y[i]!, ddMul(h, k3[i]!));
    }
    const k4 = f(tNext, y4);

    const yNext = new Array<Double64>(n);
    for (let i = 0; i < n; i++) {
      // k1 + 2*k2 + 2*k3 + k4
      const sumK = ddAdd(ddAdd(k1[i]!, ddMulScalar(k2[i]!, 2.0)), ddAdd(ddMulScalar(k3[i]!, 2.0), k4[i]!));
      yNext[i] = ddAdd(y[i]!, ddMul(sixthH, sumK));
    }

    t = tNext;
    y = yNext;

    if (step % recordEvery === 0 || step === numSteps) {
      times.push(t);
      states.push(y.map((v) => ({ hi: v.hi, lo: v.lo })));
    }
  }

  return {
    tFinal: t,
    yFinal: y,
    times,
    states,
  };
}
