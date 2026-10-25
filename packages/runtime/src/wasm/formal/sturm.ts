// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance WebAssembly Real Algebraic Root Isolation via Sturm Sequences.
 * Computes exact polynomial derivatives, Euclidean pseudo-division, sign variations,
 * and bisection root isolation directly over flat Float64 arrays in WASM linear memory.
 */

const STURM_MAX_STACK: i32 = 256;
const g_stackLo = new StaticArray<f64>(STURM_MAX_STACK);
const g_stackHi = new StaticArray<f64>(STURM_MAX_STACK);

/**
 * Horner's method polynomial evaluation: p(x) = sum_{i=0}^deg c_i * x^i.
 */
@inline
export function poly_eval(coeffPtr: usize, degree: i32, x: f64): f64 {
  let res: f64 = 0.0;
  for (let i: i32 = degree; i >= 0; i--) {
    let c = load<f64>(coeffPtr + (<usize>i << 3));
    res = res * x + c;
  }
  return res;
}

/**
 * Analytical polynomial derivative: p'(x) = sum_{i=1}^deg i * c_i * x^{i-1}.
 * Writes degree - 1 coefficients to outPtr. Returns new degree.
 */
export function poly_derivative(coeffPtr: usize, degree: i32, outPtr: usize): i32 {
  if (degree <= 0) {
    store<f64>(outPtr, 0.0);
    return 0;
  }
  for (let i: i32 = 1; i <= degree; i++) {
    let c = load<f64>(coeffPtr + (<usize>i << 3));
    store<f64>(outPtr + (<usize>(i - 1) << 3), c * (i as f64));
  }
  return degree - 1;
}

/**
 * In-place polynomial division with remainder: a(x) = q(x) * b(x) + r(x).
 * Writes remainder coefficients to outRPtr and optional quotient to outQPtr.
 * Returns remainder degree (or -1 if b is zero).
 */
export function poly_div_rem(
  aPtr: usize,
  aDeg: i32,
  bPtr: usize,
  bDeg: i32,
  outQPtr: usize,
  outRPtr: usize,
): i32 {
  if (bDeg < 0) return -1;
  let bLead = load<f64>(bPtr + (<usize>bDeg << 3));
  if (Math.abs(bLead) < 1e-12) return -1;

  for (let i: i32 = 0; i <= aDeg; i++) {
    store<f64>(outRPtr + (<usize>i << 3), load<f64>(aPtr + (<usize>i << 3)));
  }
  let rDeg = aDeg;

  let qLen = aDeg >= bDeg ? aDeg - bDeg + 1 : 0;
  if (outQPtr != 0) {
    for (let i: i32 = 0; i < qLen; i++) {
      store<f64>(outQPtr + (<usize>i << 3), 0.0);
    }
  }

  while (rDeg >= bDeg) {
    let rLead = load<f64>(outRPtr + (<usize>rDeg << 3));
    if (Math.abs(rLead) < 1e-12) {
      rDeg--;
      continue;
    }
    let degDiff = rDeg - bDeg;
    let factor = rLead / bLead;
    if (outQPtr != 0) {
      store<f64>(outQPtr + (<usize>degDiff << 3), factor);
    }
    for (let i: i32 = 0; i <= bDeg; i++) {
      let bCoeff = load<f64>(bPtr + (<usize>i << 3));
      let cur = load<f64>(outRPtr + (<usize>(i + degDiff) << 3));
      store<f64>(outRPtr + (<usize>(i + degDiff) << 3), cur - factor * bCoeff);
    }
    rDeg--;
  }

  while (rDeg > 0 && Math.abs(load<f64>(outRPtr + (<usize>rDeg << 3))) < 1e-12) {
    rDeg--;
  }
  return rDeg;
}

/**
 * Builds the canonical Sturm sequence of polynomials for a square-free polynomial.
 * S_0(x) = p(x)
 * S_1(x) = p'(x)
 * S_k(x) = -rem(S_{k-2}, S_{k-1})
 * Returns the number of polynomials in the Sturm chain.
 */
export function sturm_build_sequence(
  inCoeffPtr: usize,
  inDeg: i32,
  degreesPtr: usize,
  coeffsPtr: usize,
  strideBytes: usize,
  maxSeqCount: i32,
): i32 {
  if (inDeg <= 0) return 0;

  // S_0: input polynomial
  store<i32>(degreesPtr, inDeg);
  let p0Ptr = coeffsPtr;
  for (let i: i32 = 0; i <= inDeg; i++) {
    store<f64>(p0Ptr + (<usize>i << 3), load<f64>(inCoeffPtr + (<usize>i << 3)));
  }

  // S_1: derivative
  let p1Ptr = coeffsPtr + strideBytes;
  let deg1 = poly_derivative(p0Ptr, inDeg, p1Ptr);
  store<i32>(degreesPtr + 4, deg1);

  let seqCount: i32 = 2;

  while (seqCount < maxSeqCount) {
    let pPrevPtr = coeffsPtr + (<usize>(seqCount - 2) * strideBytes);
    let pPrevDeg = load<i32>(degreesPtr + (<usize>(seqCount - 2) << 2));

    let pCurrPtr = coeffsPtr + (<usize>(seqCount - 1) * strideBytes);
    let pCurrDeg = load<i32>(degreesPtr + (<usize>(seqCount - 1) << 2));

    if (pCurrDeg <= 0) break;

    let pNextPtr = coeffsPtr + (<usize>seqCount * strideBytes);

    let remDeg = poly_div_rem(pPrevPtr, pPrevDeg, pCurrPtr, pCurrDeg, 0, pNextPtr);
    if (remDeg < 0) break;

    // Negate remainder: S_k = -rem
    let isAllZero: bool = true;
    for (let i: i32 = 0; i <= remDeg; i++) {
      let c = load<f64>(pNextPtr + (<usize>i << 3));
      store<f64>(pNextPtr + (<usize>i << 3), -c);
      if (Math.abs(c) > 1e-12) isAllZero = false;
    }

    if (isAllZero) break;

    store<i32>(degreesPtr + (<usize>seqCount << 2), remDeg);
    seqCount++;
  }

  return seqCount;
}

/**
 * Counts the sign variations of a Sturm sequence evaluated at x.
 */
export function sturm_sign_variations(
  count: i32,
  degreesPtr: usize,
  coeffsPtr: usize,
  strideBytes: usize,
  x: f64,
): i32 {
  let prevSign: i32 = 0;
  let variations: i32 = 0;

  for (let k: i32 = 0; k < count; k++) {
    let deg = load<i32>(degreesPtr + (<usize>k << 2));
    let cPtr = coeffsPtr + (<usize>k * strideBytes);
    let val = poly_eval(cPtr, deg, x);
    if (Math.abs(val) > 1e-11) {
      let sign: i32 = val > 0.0 ? 1 : -1;
      if (prevSign != 0 && sign != prevSign) {
        variations++;
      }
      prevSign = sign;
    }
  }
  return variations;
}

/**
 * Counts the exact number of real roots in interval (a, b] via Sturm's Theorem:
 * count = V(a) - V(b).
 */
export function sturm_count_roots(
  count: i32,
  degreesPtr: usize,
  coeffsPtr: usize,
  strideBytes: usize,
  a: f64,
  b: f64,
): i32 {
  let va = sturm_sign_variations(count, degreesPtr, coeffsPtr, strideBytes, a);
  let vb = sturm_sign_variations(count, degreesPtr, coeffsPtr, strideBytes, b);
  return va - vb;
}

/**
 * Isolates all distinct real roots of a Sturm sequence in [a, b] using binary bisection.
 * Writes isolated roots into outRootsPtr and returns the number of roots found.
 */
export function sturm_isolate_roots(
  count: i32,
  degreesPtr: usize,
  coeffsPtr: usize,
  strideBytes: usize,
  a: f64,
  b: f64,
  eps: f64,
  outRootsPtr: usize,
  maxRoots: i32,
): i32 {
  let totalRoots = sturm_count_roots(count, degreesPtr, coeffsPtr, strideBytes, a, b);
  if (totalRoots <= 0) return 0;

  let stackHead: i32 = 0;
  g_stackLo[0] = a;
  g_stackHi[0] = b;
  stackHead++;

  let foundRoots: i32 = 0;

  while (stackHead > 0 && foundRoots < maxRoots) {
    stackHead--;
    let lo = g_stackLo[stackHead];
    let hi = g_stackHi[stackHead];

    let num = sturm_count_roots(count, degreesPtr, coeffsPtr, strideBytes, lo, hi);
    if (num <= 0) continue;

    if (num == 1) {
      if (hi - lo < eps) {
        store<f64>(outRootsPtr + (<usize>foundRoots << 3), (lo + hi) * 0.5);
        foundRoots++;
      } else {
        let mid = (lo + hi) * 0.5;
        let leftCount = sturm_count_roots(count, degreesPtr, coeffsPtr, strideBytes, lo, mid);
        if (stackHead < STURM_MAX_STACK - 1) {
          if (leftCount == 1) {
            g_stackLo[stackHead] = lo;
            g_stackHi[stackHead] = mid;
            stackHead++;
          } else {
            g_stackLo[stackHead] = mid;
            g_stackHi[stackHead] = hi;
            stackHead++;
          }
        }
      }
    } else {
      let mid = (lo + hi) * 0.5;
      if (stackHead < STURM_MAX_STACK - 2) {
        g_stackLo[stackHead] = mid;
        g_stackHi[stackHead] = hi;
        stackHead++;

        g_stackLo[stackHead] = lo;
        g_stackHi[stackHead] = mid;
        stackHead++;
      }
    }
  }

  // Sort isolated roots in ascending order (insertion sort)
  for (let i: i32 = 1; i < foundRoots; i++) {
    let key = load<f64>(outRootsPtr + (<usize>i << 3));
    let j = i - 1;
    while (j >= 0 && load<f64>(outRootsPtr + (<usize>j << 3)) > key) {
      store<f64>(outRootsPtr + (<usize>(j + 1) << 3), load<f64>(outRootsPtr + (<usize>j << 3)));
      j--;
    }
    store<f64>(outRootsPtr + (<usize>(j + 1) << 3), key);
  }

  return foundRoots;
}
